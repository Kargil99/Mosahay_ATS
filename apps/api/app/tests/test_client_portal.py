from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.models import ApplicationAssignment, SubmissionReview


def test_review_feedback_accepts_only_client_response_actions():
    request = SubmissionReview(status="interview_requested", feedback="Can meet next Tuesday.")
    assert request.status == "interview_requested"
    with pytest.raises(ValidationError):
        SubmissionReview(status="hired", feedback="")
    with pytest.raises(ValidationError):
        SubmissionReview(status="accepted", feedback="x" * 5001)


def test_client_portal_api_requires_an_authenticated_session():
    response = TestClient(app).get("/api/v1/client-portal/submissions?org_id=org-id")
    assert response.status_code in {401, 503}


def test_application_assignment_requires_a_target_user_id():
    assert ApplicationAssignment(assigned_to="recruiter-user").assigned_to == "recruiter-user"
    with pytest.raises(ValidationError):
        ApplicationAssignment(assigned_to="")


def test_client_portal_migration_limits_submissions_and_candidate_data():
    migration = Path(__file__).parents[4] / "supabase" / "migrations" / "202611110004_client_portal.sql"
    sql = migration.resolve().read_text(encoding="utf-8").lower()
    assert "submissions_read_assigned_reviewer" in sql
    assert "can_review_application(org_id,application_id)" in sql
    assert "review_candidate_submission" in sql
    assert "candidates_read_internal" in sql
    assert "notes_read_internal" in sql
    assert "resumes_read_internal" in sql
    assert "score_runs_read_internal" in sql
    assert "revoke select on public.organizations from authenticated" in sql
    assert "grant select (id,name,created_at) on public.organizations to authenticated" in sql
    assert "get_workspace_settings" in sql
    submission_rpc = sql.split("create or replace function public.submit_application_to_client", 1)[1]
    assert "'phone'" not in submission_rpc
    assert "'email'" not in submission_rpc


def test_sourcer_migration_scopes_intake_and_recruiter_assignment():
    migration = Path(__file__).parents[4] / "supabase" / "migrations" / "202611110005_sourcer_workflows.sql"
    sql = migration.resolve().read_text(encoding="utf-8").lower()
    assert "candidates_insert_sourcer" in sql
    assert "resumes_insert_sourcer" in sql
    assert "assign_application_owner" in sql
    assert "role='recruiter'" in sql
    assert "created_by=auth.uid()" in sql
