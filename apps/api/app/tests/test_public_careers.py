from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app
from app.routers import api as api_module


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeRpc:
    def __init__(self, db, name, params):
        self.db = db
        self.name = name
        self.params = params

    def execute(self):
        self.db.calls.append((self.name, self.params))
        if self.name == "submit_employer_lead":
            return FakeResult("test-lead-id")
        if self.name == "public_job_detail":
            return FakeResult({"privacy_notice_version": "1"})
        return FakeResult({"application_id": "test-application-id", "duplicate_email": False})


class FakeStorage:
    def __init__(self, calls):
        self.calls = calls

    def from_(self, bucket):
        self.calls.append(("bucket", bucket))
        return self

    def upload(self, path, content, options):
        self.calls.append(("upload", path, content, options))

    def remove(self, paths):
        self.calls.append(("remove", paths))


class FakeDb:
    def __init__(self):
        self.calls = []
        self.storage = FakeStorage(self.calls)

    def rpc(self, name, params):
        return FakeRpc(self, name, params)


def test_public_application_requires_explicit_consent(monkeypatch):
    monkeypatch.setattr(api_module, "get_settings", lambda: Settings(
        supabase_url="https://example.supabase.co", supabase_anon_key="anon",
        supabase_service_role_key="secret", public_careers_org_id="workspace-id",
    ))
    client = TestClient(app)
    response = client.post(
        "/api/v1/public/jobs/sample-role/apply",
        data={"full_name": "Test Candidate", "email": "candidate@example.com", "phone": "+91 98765 43210", "consent": "false", "privacy_notice_version": "1"},
        files={"resume": ("resume.txt", b"Test Candidate\ncandidate@example.com\nSkills: welding, safety\n", "text/plain")},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error"]["code"] == "consent_required"


def test_public_application_uploads_privately_and_issues_hashed_key(monkeypatch):
    fake_admin = FakeDb()
    fake_public = FakeDb()
    clients = iter([FakeDb(), fake_admin, fake_public])
    monkeypatch.setattr(api_module, "get_settings", lambda: Settings(
        supabase_url="https://example.supabase.co", supabase_anon_key="anon",
        supabase_service_role_key="secret", public_careers_org_id="workspace-id",
    ))
    monkeypatch.setattr(api_module, "create_client", lambda *args, **kwargs: next(clients))
    client = TestClient(app)
    response = client.post(
        "/api/v1/public/jobs/sample-role/apply",
        data={"full_name": "Test Candidate", "email": "candidate@example.com", "phone": "+91 98765 43210", "city": "Bhubaneswar", "consent": "true", "privacy_notice_version": "1"},
        files={"resume": ("resume.txt", b"Test Candidate\ncandidate@example.com\nSkills: welding, safety\nExperience\nWelder at Factory - 2020 to Present\n", "text/plain")},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["application_id"] == "test-application-id"
    assert len(payload["access_key"]) >= 40
    assert fake_admin.calls[0] == ("bucket", "candidate-resumes")
    upload = next(call for call in fake_admin.calls if call[0] == "upload")
    assert upload[1].startswith("public-applications/workspace-id/")
    application_call = next(call for call in fake_public.calls if call[0] == "submit_public_job_application")
    rpc_args = application_call[1]
    assert rpc_args["p_consent"] is True
    assert rpc_args["p_notice_version"] == "1"
    assert len(rpc_args["p_portal_token_hash"]) == 64
    assert rpc_args["p_portal_token_hash"] != payload["access_key"]


def test_public_careers_migration_has_no_direct_public_table_access():
    migration = Path(__file__).parents[4] / "supabase" / "migrations" / "202611110006_public_careers.sql"
    sql = migration.resolve().read_text(encoding="utf-8").lower()
    assert "security definer" in sql
    assert "public_job_list" in sql
    assert "submit_public_job_application" in sql
    assert "candidate_portal_access enable row level security" in sql
    assert "revoke all on public.candidate_portal_access from anon,authenticated,public" in sql
    assert "candidate_consent_withdrawn" in sql
    assert "create table public.employer_leads" in sql
    assert "grant execute on function public.submit_employer_lead" in sql
    assert "to service_role" in sql


def test_public_employer_inquiry_uses_private_service_rpc(monkeypatch):
    fake_admin = FakeDb()
    monkeypatch.setattr(api_module, "get_settings", lambda: Settings(
        supabase_url="https://example.supabase.co", supabase_anon_key="anon",
        supabase_service_role_key="secret", public_careers_org_id="careers-workspace",
        public_employer_leads_org_id="leads-workspace",
    ))
    monkeypatch.setattr(api_module, "create_client", lambda *args, **kwargs: fake_admin)
    client = TestClient(app)
    response = client.post("/api/v1/public/hire-talent", json={
        "company_name": "Fictional Factory", "website": "https://example.com",
        "contact_name": "Recruiting Contact", "email": "hiring@example.com", "phone": "+91 98765 43210",
        "job_title": "Maintenance Technician", "vacancies": 4, "required_skills": ["maintenance", "safety"],
        "location": "Bhubaneswar", "experience": "2–4 years", "salary_min": 250000, "salary_max": 400000,
        "hiring_timeline": "Within 45 days",
    })
    assert response.status_code == 201
    assert response.json()["id"] == "test-lead-id"
    assert fake_admin.calls[0][0] == "submit_employer_lead"
    assert fake_admin.calls[0][1]["p_org_id"] == "leads-workspace"
