from __future__ import annotations

import csv
import hashlib
import io
import re
import secrets
import uuid
from io import BytesIO
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.core.config import get_settings
from app.core.errors import api_error
from app.core.mongo import MongoDatabase, MongoStorage
from app.dependencies.auth import AuthContext, get_context, get_member_role, require_roles, row_or_404
from app.schemas.models import (ApplicationAssignment, BulkScoreCreate, ClientCreate, ClientContactCreate, ClientContactUpdate,
                                ClientOfficeCreate, ClientOfficeUpdate, ClientContractCreate, ClientContractUpdate,
                                ClientActivityCreate, JobCreate, NoteCreate, PrivacyRequestCreate,
                                InterviewCreate, InterviewUpdate, JobPosterCreate, JobPosterUpdate, PlacementCreate,
                                PlacementUpdate, RecruiterTaskCreate, RecruiterTaskUpdate, ReplacementCreate,
                                ReplacementUpdate, RequirementCreate, StageChange, SubmissionReview, WorkspaceCreate,
                                PublicCandidateProfileUpdate, PublicPrivacyRequestCreate, EmployerLeadCreate,
                                EmployerLeadStatusUpdate, ReviewerInviteCreate)
from app.services.parsing import ALLOWED, parse_resume
from app.services.ai_extraction import OpenAIExtractionProvider
from app.services.finance import calculate_placement_fee
from app.services.interviews import validate_interview_questions
from app.services.reporting import build_pipeline_report
from app.services.executive import build_executive_report
from app.services.scoring import score_requirements, validate_weights

router = APIRouter(prefix="/api/v1")
ctx_dep = Depends(get_context)
STAGES = ["New", "Parsing", "Needs Review", "Shortlisted", "Recruiter Screen", "Submitted to Client", "Interview", "Offer", "Hired", "Rejected", "Withdrawn", "Talent Pool"]
WRITE_ROLES = {"owner", "admin", "recruitment_manager", "recruiter"}
CANDIDATE_WRITE_ROLES = WRITE_ROLES | {"sourcer"}
ADMIN_ROLES = {"owner", "admin"}
MANAGER_ROLES = {"owner", "admin", "recruitment_manager"}
OPERATIONS_ROLES = {"owner", "admin", "recruitment_manager", "recruiter"}
CLIENT_CRM_READ_ROLES = WRITE_ROLES
CLIENT_CONTRACT_READ_ROLES = MANAGER_ROLES
DEFAULT_INTERVIEW_QUESTIONS = [
    "Role-related problem solving",
    "Evidence of relevant collaboration",
    "Communication about role-specific work",
]


@router.get("/storage/resumes/{signed_token}")
def download_signed_resume(signed_token: str, request: Request):
    database = getattr(request.app.state, "mongo_database", None)
    if database is None:
        raise api_error(503, "mongodb_not_configured", "Resume storage is unavailable.")
    stored = MongoStorage(MongoDatabase(database, "signed-download")).open_signed(signed_token)
    if not stored:
        raise api_error(404, "resume_link_expired", "This private resume link is invalid or has expired. Request a fresh link.")
    data, content_type = stored
    return StreamingResponse(BytesIO(data), media_type=content_type, headers={"Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


def _public_database(request: Request):
    settings = get_settings()
    database = getattr(request.app.state, "mongo_database", None)
    if database is None:
        raise api_error(503, "mongodb_not_configured", "MongoDB is required for public careers workflows.")
    if not settings.public_careers_org_id:
        raise api_error(503, "public_careers_not_configured", "Public careers are not configured on this service.")
    return database


@router.get("/public/jobs")
def public_jobs(request: Request, search: str | None = None, location: str | None = None, industry: str | None = None,
                salary_min: float | None = None, salary_max: float | None = None,
                experience_min: float | None = None, experience_max: float | None = None,
                employment_type: str | None = None):
    settings = get_settings()
    if any(value is not None and not 0 <= value <= 100_000_000 for value in (salary_min, salary_max)):
        raise api_error(422, "invalid_salary_filter", "Salary filters must be between 0 and 100,000,000.")
    if any(value is not None and not 0 <= value <= 100 for value in (experience_min, experience_max)):
        raise api_error(422, "invalid_experience_filter", "Experience filters must be between 0 and 100 years.")
    if salary_min is not None and salary_max is not None and salary_min > salary_max:
        raise api_error(422, "invalid_salary_filter", "Minimum salary cannot exceed maximum salary.")
    if experience_min is not None and experience_max is not None and experience_min > experience_max:
        raise api_error(422, "invalid_experience_filter", "Minimum experience cannot exceed maximum experience.")
    if employment_type and employment_type not in {"full_time", "part_time", "contract", "temporary", "internship"}:
        raise api_error(422, "invalid_employment_type", "Choose a supported employment type.")
    database = _public_database(request)
    rows = list(database.jobs.find({"org_id": settings.public_careers_org_id, "status": "open", "public_listing_enabled": True}).sort("created_at", -1).limit(300))
    today = date.today().isoformat()
    term = (search or "").strip()[:80].casefold()
    loc = (location or "").strip()[:80].casefold()
    industry_term = (industry or "").strip()[:80].casefold()
    organization = database.organizations.find_one({"id": settings.public_careers_org_id}) or {}
    output = []
    for job in rows:
        if job.get("application_deadline") and str(job["application_deadline"]) < today: continue
        if term and term not in f"{job.get('title','')} {job.get('description','')}".casefold(): continue
        if loc and loc not in str(job.get("location") or "").casefold(): continue
        if industry_term and industry_term not in str(job.get("industry") or "").casefold(): continue
        if employment_type and job.get("employment_type") != employment_type: continue
        if salary_min is not None and job.get("salary_max") is not None and job["salary_max"] < salary_min: continue
        if salary_max is not None and job.get("salary_min") is not None and job["salary_min"] > salary_max: continue
        if experience_min is not None and job.get("experience_max") is not None and job["experience_max"] < experience_min: continue
        if experience_max is not None and job.get("experience_min") is not None and job["experience_min"] > experience_max: continue
        output.append({key: job.get(key) for key in ("id", "public_slug", "title", "description", "location", "work_arrangement", "employment_type", "salary_min", "salary_max", "salary_currency", "experience_min", "experience_max", "vacancies", "application_deadline", "department", "industry", "created_at")} | {"slug": job.get("public_slug"), "organization_name": organization.get("name", "MoSahay"), "privacy_notice_text": organization.get("privacy_notice_text", ""), "privacy_notice_version": job.get("privacy_notice_version") or organization.get("privacy_notice_version")})
    return output[:100]


@router.get("/public/jobs/{slug}")
def public_job(slug: str, request: Request):
    settings = get_settings()
    database = _public_database(request)
    job = database.jobs.find_one({"org_id": settings.public_careers_org_id, "public_slug": slug[:180], "status": "open", "public_listing_enabled": True})
    if not job or (job.get("application_deadline") and str(job["application_deadline"]) < date.today().isoformat()):
        raise api_error(404, "job_not_found", "This job is no longer accepting applications.")
    organization = database.organizations.find_one({"id": settings.public_careers_org_id}) or {}
    return {key: job.get(key) for key in ("id", "title", "description", "location", "work_arrangement", "employment_type", "salary_min", "salary_max", "salary_currency", "experience_min", "experience_max", "vacancies", "application_deadline", "department", "industry")} | {"slug": job.get("public_slug"), "organization_name": organization.get("name", "MoSahay"), "privacy_notice_text": organization.get("privacy_notice_text", ""), "privacy_notice_version": job.get("privacy_notice_version") or organization.get("privacy_notice_version")}


def _candidate_token_hash(access_key: str) -> str:
    if not 40 <= len(access_key) <= 100:
        raise api_error(401, "candidate_portal_unauthorized", "Enter a valid candidate access key.")
    return hashlib.sha256(access_key.encode("utf-8")).hexdigest()


@router.get("/public/candidate-portal")
def get_candidate_portal(request: Request, x_candidate_access_key: str = Header(default="")):
    token_hash = _candidate_token_hash(x_candidate_access_key)
    database = getattr(request.app.state, "mongo_database", None)
    if database is None:
        raise api_error(503, "mongodb_not_configured", "Candidate portal storage is unavailable.")
    access = _public_portal_access(database, token_hash)
    if not access:
        raise api_error(401, "candidate_portal_unauthorized", "The candidate access key is invalid or expired.")
    candidate, application, job, organization = access
    asset = database.resume_assets.find_one({"org_id": candidate["org_id"], "candidate_id": candidate["id"]}, sort=[("created_at", -1)]) or {}
    profile = asset.get("profile_json") or {}
    return {"candidate": {"full_name": candidate.get("full_name"), "email": candidate.get("email"), "phone": candidate.get("phone"), "skills": candidate.get("skills") or [], "consent_status": candidate.get("consent_status", "recorded"), "privacy_notice_version": candidate.get("privacy_notice_version", "current"), "city": profile.get("city", ""), "preferred_location": profile.get("preferred_location", ""), "availability": profile.get("availability", ""), "experience_years": profile.get("approximate_experience_years")}, "application": {"job_title": job.get("title", "Role"), "location": job.get("location") or "Location discussed", "stage": application.get("stage", "New"), "status": application.get("status", "active"), "submitted_at": application.get("created_at")}, "privacy_notice_text": organization.get("privacy_notice_text", "")}


def _public_portal_access(database: Any, token_hash: str):
    access = database.candidate_portal_access.find_one({"token_hash": token_hash, "revoked_at": None, "expires_at": {"$gt": datetime.now(timezone.utc)}})
    if not access:
        return None
    candidate = database.candidates.find_one({"org_id": access["org_id"], "id": access["candidate_id"]})
    application = database.applications.find_one({"org_id": access["org_id"], "id": access["application_id"]})
    if not candidate or not application:
        return None
    job = database.jobs.find_one({"org_id": access["org_id"], "id": application.get("job_id")}) or {}
    organization = database.organizations.find_one({"id": access["org_id"]}) or {}
    return candidate, application, job, organization


@router.patch("/public/candidate-portal/profile")
def update_candidate_portal_profile(body: PublicCandidateProfileUpdate, request: Request, x_candidate_access_key: str = Header(default="")):
    token_hash = _candidate_token_hash(x_candidate_access_key)
    database = getattr(request.app.state, "mongo_database", None)
    access = _public_portal_access(database, token_hash) if database is not None else None
    if not access:
        raise api_error(401, "candidate_portal_unauthorized", "The candidate access key is invalid or expired.")
    candidate = access[0]
    profile_values = {"city": body.city, "preferred_location": body.preferred_location, "availability": body.availability, "skills": body.skills}
    database.candidates.update_one({"id": candidate["id"], "org_id": candidate["org_id"]}, {"$set": {"phone": body.phone, "skills": body.skills, "updated_at": datetime.now(timezone.utc).isoformat()}})
    database.resume_assets.update_one({"org_id": candidate["org_id"], "candidate_id": candidate["id"]}, {"$set": {"profile_json.city": body.city, "profile_json.preferred_location": body.preferred_location, "profile_json.availability": body.availability, "profile_json.skills": body.skills}})
    database.activity_events.insert_one({"id": str(uuid.uuid4()), "org_id": candidate["org_id"], "actor_id": None, "entity_type": "candidate", "entity_id": candidate["id"], "action": "candidate_self_service_profile_updated", "metadata": {}, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"updated": True, "fields": list(profile_values)}


@router.post("/public/candidate-portal/withdraw-consent")
def withdraw_candidate_portal_consent(request: Request, x_candidate_access_key: str = Header(default="")):
    token_hash = _candidate_token_hash(x_candidate_access_key)
    database = getattr(request.app.state, "mongo_database", None)
    access = _public_portal_access(database, token_hash) if database is not None else None
    if not access:
        raise api_error(401, "candidate_portal_unauthorized", "The candidate access key is invalid or expired.")
    candidate = access[0]
    database.candidates.update_one({"id": candidate["id"], "org_id": candidate["org_id"]}, {"$set": {"consent_status": "withdrawn", "updated_at": datetime.now(timezone.utc).isoformat()}})
    database.applications.update_many({"org_id": candidate["org_id"], "candidate_id": candidate["id"], "status": "active"}, {"$set": {"status": "withdrawn", "updated_at": datetime.now(timezone.utc).isoformat()}})
    database.activity_events.insert_one({"id": str(uuid.uuid4()), "org_id": candidate["org_id"], "actor_id": None, "entity_type": "candidate", "entity_id": candidate["id"], "action": "candidate_consent_withdrawn", "metadata": {}, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"withdrawn": True}


@router.post("/public/candidate-portal/privacy-requests", status_code=201)
def create_candidate_portal_privacy_request(body: PublicPrivacyRequestCreate, request: Request, x_candidate_access_key: str = Header(default="")):
    token_hash = _candidate_token_hash(x_candidate_access_key)
    database = getattr(request.app.state, "mongo_database", None)
    access = _public_portal_access(database, token_hash) if database is not None else None
    if not access:
        raise api_error(401, "candidate_portal_unauthorized", "The candidate access key is invalid or expired.")
    candidate = access[0]
    request_id = str(uuid.uuid4())
    database.privacy_requests.insert_one({"id": request_id, "org_id": candidate["org_id"], "candidate_id": candidate["id"], "requested_by": None, "request_type": body.request_type, "details": body.details, "status": "open", "created_at": datetime.now(timezone.utc).isoformat()})
    database.activity_events.insert_one({"id": str(uuid.uuid4()), "org_id": candidate["org_id"], "actor_id": None, "entity_type": "candidate", "entity_id": candidate["id"], "action": "candidate_privacy_request_received", "metadata": {"request_type": body.request_type}, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": request_id}


@router.post("/public/hire-talent", status_code=201)
def submit_employer_lead(body: EmployerLeadCreate, request: Request):
    settings = get_settings()
    org_id = settings.public_employer_leads_org_id or settings.public_careers_org_id
    database = getattr(request.app.state, "mongo_database", None)
    if database is None or not org_id:
        raise api_error(503, "employer_leads_not_configured", "Employer inquiries are not configured on this service.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", body.email.strip()):
        raise api_error(422, "invalid_business_email", "Enter a valid business email address.")
    if body.salary_min is not None and body.salary_max is not None and body.salary_min > body.salary_max:
        raise api_error(422, "invalid_salary_range", "Maximum salary cannot be lower than minimum salary.")
    lead_id = str(uuid.uuid4())
    database.employer_leads.insert_one({"id": lead_id, "org_id": org_id, "company_name": body.company_name.strip(), "website": body.website, "contact_name": body.contact_name.strip(), "email": body.email.strip().lower(), "phone": body.phone.strip(), "job_title": body.job_title.strip(), "vacancies": body.vacancies, "required_skills": [skill.strip()[:120] for skill in body.required_skills if skill.strip()][:50], "location": body.location.strip(), "experience": body.experience, "salary_min": body.salary_min, "salary_max": body.salary_max, "hiring_timeline": body.hiring_timeline.strip(), "status": "new", "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": lead_id, "status": "received"}


@router.post("/public/jobs/{slug}/apply", status_code=201)
async def apply_to_public_job(
    slug: str,
    request: Request,
    full_name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(...),
    city: str = Form(default=""),
    preferred_location: str = Form(default=""),
    experience_years: float | None = Form(default=None),
    skills: str = Form(default=""),
    availability: str = Form(default=""),
    consent: bool = Form(default=False),
    privacy_notice_version: str = Form(...),
    resume: UploadFile = File(...),
):
    settings = get_settings()
    database = _public_database(request)
    if not 2 <= len(full_name.strip()) <= 180:
        raise api_error(422, "invalid_candidate_name", "Enter your full name.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()) or len(email) > 254:
        raise api_error(422, "invalid_candidate_email", "Enter a valid email address.")
    if not 7 <= len(phone.strip()) <= 40:
        raise api_error(422, "invalid_candidate_phone", "Enter a valid mobile number.")
    if experience_years is not None and not 0 <= experience_years <= 80:
        raise api_error(422, "invalid_experience", "Enter experience from 0 to 80 years.")
    if not consent:
        raise api_error(422, "consent_required", "Review and accept the privacy notice to submit your application.")
    current_job = database.jobs.find_one({"org_id": settings.public_careers_org_id, "public_slug": slug[:180], "status": "open", "public_listing_enabled": True})
    if current_job and current_job.get("application_deadline") and str(current_job["application_deadline"]) < date.today().isoformat():
        current_job = None
    if not current_job or (current_job.get("privacy_notice_version") or (database.organizations.find_one({"id": settings.public_careers_org_id}) or {}).get("privacy_notice_version")) != privacy_notice_version:
        raise api_error(409, "privacy_notice_changed", "The privacy notice has changed. Reload this job and review the current notice before applying.")
    if len(city) > 120 or len(preferred_location) > 120 or len(availability) > 120:
        raise api_error(422, "invalid_profile_field", "One of the profile fields is too long.")

    name = (resume.filename or "resume").replace("\\", "/").split("/")[-1]
    try:
        raw = await resume.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if len(raw) > settings.max_upload_mb * 1024 * 1024:
            raise api_error(413, "resume_too_large", f"Resume must be {settings.max_upload_mb} MB or smaller.")
        parsed = parse_resume(name, raw, settings.max_upload_mb * 1024 * 1024)
    except HTTPException:
        raise
    except ValueError as exc:
        raise api_error(422, "invalid_resume", str(exc)) from exc
    except Exception as exc:
        raise api_error(422, "invalid_resume", "The resume could not be read. Upload a PDF, DOCX, or UTF-8 text file.") from exc

    candidate_id = str(uuid.uuid4())
    access_key = secrets.token_urlsafe(32)
    portal_token_hash = hashlib.sha256(access_key.encode("utf-8")).hexdigest()
    ext = "." + name.rsplit(".", 1)[-1].lower()
    storage_path = f"public-applications/{settings.public_careers_org_id}/{candidate_id}/{uuid.uuid4().hex}{ext}"
    profile = {**parsed.profile, "full_name": full_name.strip(), "email": email.strip().lower(), "phone": phone.strip(),
               "city": city.strip(), "preferred_location": preferred_location.strip(), "availability": availability.strip()}
    if experience_years is not None:
        profile["approximate_experience_years"] = experience_years
    submitted_skills = [value.strip()[:100] for value in skills.split(",") if value.strip()][:30]
    clean_skills = list(dict.fromkeys([*parsed.profile.get("skills", []), *submitted_skills]))[:30]
    profile["skills"] = clean_skills

    storage = MongoStorage(MongoDatabase(database, "public-application"))
    duplicate_email = bool(database.candidates.find_one({"org_id": settings.public_careers_org_id, "normalized_email": email.strip().lower()}))
    duplicate_resume = bool(database.resume_assets.find_one({"org_id": settings.public_careers_org_id, "sha256": parsed.sha256}))
    organization = database.organizations.find_one({"id": settings.public_careers_org_id}) or {}
    if duplicate_email: parsed.warnings.append("Possible duplicate by normalized email; review before linking or merging.")
    if duplicate_resume: parsed.warnings.append("Possible duplicate resume file; review before linking or merging.")
    now = datetime.now(timezone.utc)
    try:
        storage.upload(storage_path, raw, {"content-type": ALLOWED[ext]})
        candidate = {"id": candidate_id, "org_id": settings.public_careers_org_id, "full_name": full_name.strip(), "email": email.strip().lower(), "normalized_email": email.strip().lower(), "phone": phone.strip(), "normalized_phone": _normalize_phone(phone), "current_title": profile.get("current_title"), "current_employer": profile.get("current_employer"), "skills": clean_skills, "source": "public_job_board", "consent_status": "recorded", "privacy_notice_version": current_job.get("privacy_notice_version") or organization.get("privacy_notice_version"), "notice_recorded_at": now.isoformat(), "parse_status": parsed.status, "parsing_warnings": parsed.warnings, "created_at": now.isoformat(), "updated_at": now.isoformat()}
        database.candidates.insert_one(candidate)
        database.resume_assets.insert_one({"id": str(uuid.uuid4()), "org_id": settings.public_careers_org_id, "candidate_id": candidate_id, "storage_path": storage_path, "original_filename": re.sub(r"[^\w.() -]", "_", name)[:180], "mime_type": ALLOWED[ext], "size_bytes": len(raw), "sha256": parsed.sha256, "parse_status": parsed.status, "parsed_at": now.isoformat(), "parsed_text": parsed.text, "profile_json": profile, "created_at": now.isoformat()})
        if parsed.profile.get("experiences"):
            database.candidate_experiences.insert_many([{"id": str(uuid.uuid4()), "org_id": settings.public_careers_org_id, "candidate_id": candidate_id, **row, "created_at": now.isoformat()} for row in parsed.profile["experiences"]])
        if parsed.profile.get("educations"):
            database.candidate_educations.insert_many([{"id": str(uuid.uuid4()), "org_id": settings.public_careers_org_id, "candidate_id": candidate_id, **row, "created_at": now.isoformat()} for row in parsed.profile["educations"]])
        if clean_skills:
            database.candidate_skills.insert_many([{"id": str(uuid.uuid4()), "org_id": settings.public_careers_org_id, "candidate_id": candidate_id, "skill": skill, "source": "public_application", "created_at": now.isoformat()} for skill in clean_skills])
        application_id = str(uuid.uuid4())
        database.applications.insert_one({"id": application_id, "org_id": settings.public_careers_org_id, "candidate_id": candidate_id, "job_id": current_job["id"], "owner_id": None, "stage": "New", "status": "active", "created_at": now.isoformat(), "stage_changed_at": now.isoformat()})
        database.candidate_portal_access.insert_one({"id": str(uuid.uuid4()), "token_hash": portal_token_hash, "org_id": settings.public_careers_org_id, "candidate_id": candidate_id, "application_id": application_id, "expires_at": now + timedelta(days=365), "revoked_at": None})
        database.activity_events.insert_one({"id": str(uuid.uuid4()), "org_id": settings.public_careers_org_id, "actor_id": None, "entity_type": "application", "entity_id": application_id, "action": "public_application_received", "metadata": {"job_id": current_job["id"], "source": "public_job_board"}, "created_at": now.isoformat()})
        return {"application_id": application_id, "duplicate_email": duplicate_email, "duplicate_resume": duplicate_resume, "access_key": access_key}
    except Exception as exc:
        try: storage.remove([storage_path])
        except Exception: pass
        database.applications.delete_one({"candidate_id": candidate_id})
        database.candidate_portal_access.delete_many({"candidate_id": candidate_id})
        database.candidate_skills.delete_many({"candidate_id": candidate_id})
        database.candidate_experiences.delete_many({"candidate_id": candidate_id})
        database.candidate_educations.delete_many({"candidate_id": candidate_id})
        database.resume_assets.delete_many({"candidate_id": candidate_id})
        database.candidates.delete_one({"id": candidate_id})
        raise _safe_error(exc, "application_submit_failed") from exc


def _data(result: Any) -> Any:
    return result.data


def _safe_csv_cell(value: Any) -> str:
    text_value = "" if value is None else str(value)
    if text_value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text_value
    return text_value


def _normalize_phone(value: str | None) -> str | None:
    digits = re.sub(r"[^0-9]", "", value or "")
    return digits if len(digits) >= 7 else None


def _org_data(ctx: AuthContext, table: str, org_id: str, limit: int = 100):
    get_member_role(ctx, org_id)
    return _data(ctx.db.table(table).select("*").eq("org_id", org_id).order("created_at", desc=True).limit(limit).execute()) or []


def _org_row(ctx: AuthContext, table: str, row_id: str, org_id: str) -> dict[str, Any]:
    row = row_or_404(ctx, table, row_id)
    if row.get("org_id") != org_id:
        raise api_error(404, "not_found", "The requested record was not found in this workspace.")
    return row


def _safe_error(exc: Exception, code: str = "request_failed"):
    # Provider/db errors can contain query values; keep response generic.
    return api_error(400, code, "The request could not be completed. Check the submitted values and permissions.")


@router.get("/me")
def me(ctx: AuthContext = ctx_dep):
    try:
        memberships = _data(ctx.db.table("organization_members").select("org_id,role,organizations(id,name,created_at)").eq("user_id", ctx.user_id).execute()) or []
        return {"id": ctx.user_id, "email": ctx.email, "workspaces": memberships}
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_error(exc)


@router.post("/organizations", status_code=201)
def create_workspace(body: WorkspaceCreate, ctx: AuthContext = ctx_dep):
    try:
        result = ctx.db.rpc("create_workspace", {"p_name": body.name.strip()}).execute()
        return {"id": result.data, "name": body.name.strip(), "role": "owner"}
    except Exception as exc:
        raise _safe_error(exc, "workspace_create_failed")


@router.get("/dashboard")
def dashboard(org_id: str, ctx: AuthContext = ctx_dep):
    get_member_role(ctx, org_id)
    try:
        jobs = _data(ctx.db.table("jobs").select("id,status").eq("org_id", org_id).execute()) or []
        candidates = _data(ctx.db.table("candidates").select("id,created_at").eq("org_id", org_id).execute()) or []
        apps = _data(ctx.db.table("applications").select("id,stage").eq("org_id", org_id).execute()) or []
        by_stage = {stage: sum(1 for app in apps if app["stage"] == stage) for stage in STAGES}
        return {"active_jobs": sum(1 for job in jobs if job["status"] == "open"),
                "total_jobs": len(jobs), "candidate_count": len(candidates),
                "needs_review": by_stage.get("Needs Review", 0), "stage_counts": by_stage}
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/organizations/{org_id}")
def workspace_settings(org_id: str, ctx: AuthContext = ctx_dep):
    get_member_role(ctx, org_id)
    try:
        return _data(ctx.db.rpc("get_workspace_settings", {"p_org_id": org_id}).execute())
    except Exception as exc:
        raise _safe_error(exc)


@router.patch("/organizations/{org_id}")
def update_workspace_settings(org_id: str, changes: dict[str, Any], ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, ADMIN_ROLES)
    try:
        current = _data(ctx.db.rpc("get_workspace_settings", {"p_org_id": org_id}).execute())
    except Exception as exc:
        raise _safe_error(exc)
    allowed: dict[str, Any] = {}
    if "name" in changes:
        name = str(changes["name"]).strip()
        if not 2 <= len(name) <= 120:
            raise api_error(422, "invalid_name", "Workspace name must be 2 to 120 characters.")
        allowed["name"] = name
    if "privacy_notice_text" in changes:
        notice = str(changes["privacy_notice_text"]).strip()
        if not 30 <= len(notice) <= 10000:
            raise api_error(422, "invalid_notice", "Privacy notice must be 30 to 10,000 characters.")
        allowed["privacy_notice_text"] = notice
        allowed["privacy_notice_version"] = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        if changes.get("ai_processing_enabled") is not True:
            allowed["ai_processing_enabled"] = False
            allowed["ai_notice_acknowledged"] = False
    if "retention_days" in changes:
        days = changes["retention_days"]
        if not isinstance(days, int) or not 1 <= days <= 3650:
            raise api_error(422, "invalid_retention", "Retention period must be 1 to 3,650 days.")
        allowed["retention_days"] = days
    if "ai_processing_enabled" in changes:
        enabled = changes["ai_processing_enabled"]
        if not isinstance(enabled, bool):
            raise api_error(422, "invalid_ai_setting", "AI setting must be true or false.")
        if enabled:
            runtime = get_settings()
            if not runtime.ai_scoring_enabled or not runtime.openai_key_ready or not runtime.openai_model:
                raise api_error(503, "ai_provider_unavailable", "Enable AI_SCORING_ENABLED and configure OPENAI_API_KEY plus OPENAI_MODEL on the API before enabling workspace AI.")
            notice_text = allowed.get("privacy_notice_text", current["privacy_notice_text"])
            ack = changes.get("ai_notice_acknowledged", current.get("ai_notice_acknowledged", False))
            if ack is not True or not re.search(r"\b(ai|artificial intelligence|openai|model provider)\b", notice_text, re.I):
                raise api_error(422, "ai_notice_required", "Update the active privacy notice to explain AI/model processing and confirm that notice before enabling it.")
            allowed["ai_processing_enabled"] = True
            allowed["ai_notice_acknowledged"] = True
        else:
            allowed["ai_processing_enabled"] = False
            if "ai_notice_acknowledged" in changes:
                allowed["ai_notice_acknowledged"] = bool(changes["ai_notice_acknowledged"])
    if not allowed:
        raise api_error(422, "no_supported_changes", "No supported workspace settings were supplied.")
    try:
        ctx.db.table("organizations").update(allowed, returning="minimal").eq("id", org_id).execute()
        ctx.db.table("activity_events").insert({"org_id": org_id, "actor_id": ctx.user_id, "entity_type": "organization", "entity_id": org_id, "action": "workspace_settings_updated", "metadata": {"fields": list(allowed)}}).execute()
        return _data(ctx.db.rpc("get_workspace_settings", {"p_org_id": org_id}).execute())
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/organizations/{org_id}/members")
def workspace_members(org_id: str, ctx: AuthContext = ctx_dep):
    get_member_role(ctx, org_id)
    try:
        members = _data(ctx.db.table("organization_members").select("id,user_id,role,created_at").eq("org_id", org_id).order("created_at").execute()) or []
        for member in members:
            user = ctx.db.raw.users.find_one({"id": member["user_id"]}, {"email": 1, "name": 1})
            member["email"] = member.get("user_email") or (user or {}).get("email")
            member["name"] = member.get("user_name") or (user or {}).get("name")
        return members
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/organizations/{org_id}/invitations")
def list_team_invitations(org_id: str, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, ADMIN_ROLES)
    return _data(ctx.db.table("team_invitations").select("id,email,role,created_at,expires_at,accepted_at,created_by").eq("org_id", org_id).order("created_at", desc=True).limit(100).execute()) or []


@router.post("/organizations/{org_id}/invitations", status_code=201)
def create_team_invitation(org_id: str, body: dict[str, str], ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, ADMIN_ROLES)
    email = str(body.get("email", "")).strip().lower()
    role = body.get("role")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
        raise api_error(422, "invalid_invite_email", "Enter a valid team member email address.")
    if role not in {"admin", "recruitment_manager", "recruiter", "sourcer", "finance", "reviewer"}:
        raise api_error(422, "invalid_invite_role", "Choose a supported workspace role.")
    user = ctx.db.raw.users.find_one({"email_normalized": email}, {"id": 1})
    if user and ctx.db.raw.organization_members.find_one({"org_id": org_id, "user_id": user["id"]}):
        raise api_error(409, "already_a_member", "This account already belongs to the workspace.")
    invite_token = secrets.token_urlsafe(36)
    now = datetime.now(timezone.utc)
    invitation = _data(ctx.db.table("team_invitations").insert({"org_id": org_id, "email": email, "email_normalized": email, "role": role, "token_hash": hashlib.sha256(invite_token.encode()).hexdigest(), "created_by": ctx.user_id, "created_at": now.isoformat(), "expires_at": now + timedelta(days=7), "accepted_at": None}).execute())[0]
    ctx.db.table("activity_events").insert({"org_id": org_id, "actor_id": ctx.user_id, "entity_type": "organization_invitation", "entity_id": invitation["id"], "action": "team_invitation_created", "metadata": {"email": email, "role": role}}).execute()
    settings = get_settings()
    return {"id": invitation["id"], "email": email, "role": role, "invite_url": f"{settings.app_web_url.rstrip('/')}/?invite={invite_token}", "invite_sent": False, "expires_at": invitation["expires_at"]}


@router.post("/organizations/invitations/accept")
def accept_team_invitation(body: dict[str, str], ctx: AuthContext = ctx_dep):
    token = str(body.get("token", ""))
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    invitation = ctx.db.raw.team_invitations.find_one({"token_hash": token_hash, "email_normalized": (ctx.email or "").lower(), "accepted_at": None, "expires_at": {"$gt": now}})
    if not invitation:
        raise api_error(400, "invite_invalid", "This invitation is expired, already used, or belongs to a different email account.")
    membership = ctx.db.raw.organization_members.find_one({"org_id": invitation["org_id"], "user_id": ctx.user_id})
    if not membership:
        ctx.db.raw.organization_members.insert_one({"id": str(uuid.uuid4()), "org_id": invitation["org_id"], "user_id": ctx.user_id, "role": invitation["role"], "user_email": ctx.email, "created_at": now.isoformat()})
    if invitation.get("job_id"):
        ctx.db.raw.job_reviewer_assignments.update_one({"job_id": invitation["job_id"], "user_id": ctx.user_id}, {"$set": {"id": str(uuid.uuid4()), "org_id": invitation["org_id"], "job_id": invitation["job_id"], "user_id": ctx.user_id, "assigned_by": invitation["created_by"], "created_at": now.isoformat()}}, upsert=True)
    ctx.db.raw.team_invitations.update_one({"_id": invitation["_id"]}, {"$set": {"accepted_at": now}})
    ctx.db.table("activity_events").insert({"org_id": invitation["org_id"], "actor_id": ctx.user_id, "entity_type": "organization_invitation", "entity_id": invitation["id"], "action": "team_invitation_accepted", "metadata": {"role": invitation["role"]}}).execute()
    return {"org_id": invitation["org_id"], "role": invitation["role"], "accepted": True}


@router.patch("/organizations/{org_id}/members/{user_id}")
def update_member_role(org_id: str, user_id: str, body: dict[str, str], ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, ADMIN_ROLES)
    new_role = body.get("role")
    if new_role not in {"admin", "recruitment_manager", "recruiter", "sourcer", "finance", "reviewer"}:
        raise api_error(422, "invalid_role", "Choose admin, recruitment manager, recruiter, sourcer, finance, or reviewer. Owner transfer is not supported here.")
    try:
        member = _data(ctx.db.table("organization_members").select("id,role").eq("org_id", org_id).eq("user_id", user_id).single().execute())
        if member["role"] == "owner":
            raise api_error(409, "owner_protected", "The owner cannot be changed without the safe owner-transfer workflow.")
        updated = _data(ctx.db.table("organization_members").update({"role": new_role}).eq("id", member["id"]).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": org_id, "actor_id": ctx.user_id, "entity_type": "organization_member", "entity_id": member["id"], "action": "member_role_changed", "metadata": {"user_id": user_id, "to": new_role}}).execute()
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/organizations/{org_id}/audit-logs")
def workspace_audit_log(org_id: str, limit: int = 100, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, ADMIN_ROLES)
    try:
        return _data(ctx.db.table("audit_logs").select("id,actor_id,entity_type,entity_id,action,safe_metadata,created_at").eq("org_id", org_id).order("created_at", desc=True).limit(min(max(limit, 1), 200)).execute()) or []
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/activity")
def recent_activity(org_id: str, limit: int = 30, ctx: AuthContext = ctx_dep):
    get_member_role(ctx, org_id)
    try:
        return _data(ctx.db.table("activity_events").select("id,actor_id,entity_type,entity_id,action,metadata,created_at").eq("org_id", org_id).order("created_at", desc=True).limit(min(max(limit, 1), 100)).execute()) or []
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/clients")
def clients(org_id: str, ctx: AuthContext = ctx_dep):
    return _org_data(ctx, "clients", org_id)


def _client_crm_context(ctx: AuthContext, client_id: str, roles: set[str] = WRITE_ROLES) -> dict[str, Any]:
    client = row_or_404(ctx, "clients", client_id)
    require_roles(ctx, client["org_id"], roles)
    return client


def _client_crm_rows(ctx: AuthContext, table: str, client: dict[str, Any], order_by: str = "created_at") -> list[dict[str, Any]]:
    return _data(ctx.db.table(table).select("*").eq("org_id", client["org_id"]).eq("client_id", client["id"]).order(order_by, desc=True).limit(100).execute()) or []


def _create_client_crm_record(ctx: AuthContext, table: str, client: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    payload = {**values, "org_id": client["org_id"], "client_id": client["id"]}
    if table == "client_contracts":
        payload["created_by"] = ctx.user_id
    try:
        return _data(ctx.db.table(table).insert(payload).execute())[0]
    except Exception as exc:
        raise _safe_error(exc, "client_crm_create_failed")


def _update_client_crm_record(ctx: AuthContext, table: str, client: dict[str, Any], record_id: str, values: dict[str, Any], roles: set[str] = WRITE_ROLES) -> dict[str, Any]:
    require_roles(ctx, client["org_id"], roles)
    record = row_or_404(ctx, table, record_id)
    if record.get("org_id") != client["org_id"] or record.get("client_id") != client["id"]:
        raise api_error(404, "not_found", "The requested client record was not found.")
    if not values:
        return record
    if table == "client_contracts":
        valid_from = values.get("valid_from", record.get("valid_from"))
        valid_until = values.get("valid_until", record.get("valid_until"))
        if valid_from and valid_until and str(valid_until) < str(valid_from):
            raise api_error(422, "invalid_contract_dates", "Contract end date must be on or after its start date.")
        if values.get("fee_model", record.get("fee_model")) == "percentage" and values.get("fee_value", record.get("fee_value", 0)) is not None and float(values.get("fee_value", record.get("fee_value", 0))) > 100:
            raise api_error(422, "invalid_contract_fee", "Percentage fees must be between 0 and 100.")
    values["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        return _data(ctx.db.table(table).update(values).eq("id", record_id).execute())[0]
    except Exception as exc:
        raise _safe_error(exc, "client_crm_update_failed")


@router.get("/clients/{client_id}/crm")
def client_crm(client_id: str, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id, CLIENT_CRM_READ_ROLES)
    role = get_member_role(ctx, client["org_id"])
    result = {
        "contacts": _client_crm_rows(ctx, "client_contacts", client),
        "offices": _client_crm_rows(ctx, "client_offices", client),
        "activities": _client_crm_rows(ctx, "client_activity_logs", client, "happened_at"),
        "contracts": [],
        "contracts_visible": role in CLIENT_CONTRACT_READ_ROLES,
    }
    if result["contracts_visible"]:
        result["contracts"] = _client_crm_rows(ctx, "client_contracts", client)
    return result


@router.post("/clients/{client_id}/contacts", status_code=201)
def create_client_contact(client_id: str, body: ClientContactCreate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id)
    return _create_client_crm_record(ctx, "client_contacts", client, body.model_dump())


@router.patch("/clients/{client_id}/contacts/{record_id}")
def update_client_contact(client_id: str, record_id: str, body: ClientContactUpdate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id)
    return _update_client_crm_record(ctx, "client_contacts", client, record_id, body.model_dump(exclude_unset=True))


@router.post("/clients/{client_id}/offices", status_code=201)
def create_client_office(client_id: str, body: ClientOfficeCreate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id)
    return _create_client_crm_record(ctx, "client_offices", client, body.model_dump())


@router.patch("/clients/{client_id}/offices/{record_id}")
def update_client_office(client_id: str, record_id: str, body: ClientOfficeUpdate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id)
    return _update_client_crm_record(ctx, "client_offices", client, record_id, body.model_dump(exclude_unset=True))


@router.post("/clients/{client_id}/contracts", status_code=201)
def create_client_contract(client_id: str, body: ClientContractCreate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id, MANAGER_ROLES)
    return _create_client_crm_record(ctx, "client_contracts", client, body.model_dump())


@router.patch("/clients/{client_id}/contracts/{record_id}")
def update_client_contract(client_id: str, record_id: str, body: ClientContractUpdate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id, MANAGER_ROLES)
    return _update_client_crm_record(ctx, "client_contracts", client, record_id, body.model_dump(exclude_unset=True), MANAGER_ROLES)


@router.post("/clients/{client_id}/activities", status_code=201)
def create_client_activity(client_id: str, body: ClientActivityCreate, ctx: AuthContext = ctx_dep):
    client = _client_crm_context(ctx, client_id)
    payload = {**body.model_dump(), "org_id": client["org_id"], "client_id": client["id"], "actor_id": ctx.user_id}
    if not payload["happened_at"]:
        payload["happened_at"] = datetime.now(timezone.utc).isoformat()
    try:
        return _data(ctx.db.table("client_activity_logs").insert(payload).execute())[0]
    except Exception as exc:
        raise _safe_error(exc, "client_activity_create_failed")


@router.post("/clients", status_code=201)
def create_client(body: ClientCreate, ctx: AuthContext = ctx_dep):
    require_roles(ctx, body.org_id, WRITE_ROLES)
    try:
        return _data(ctx.db.table("clients").insert(body.model_dump()).execute())[0]
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/employer-leads")
def employer_leads(org_id: str, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, MANAGER_ROLES)
    try:
        return _data(ctx.db.table("employer_leads").select("*").eq("org_id", org_id).order("created_at", desc=True).limit(100).execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "employer_leads_list_failed")


@router.patch("/employer-leads/{lead_id}")
def update_employer_lead(lead_id: str, body: EmployerLeadStatusUpdate, ctx: AuthContext = ctx_dep):
    lead = row_or_404(ctx, "employer_leads", lead_id)
    require_roles(ctx, lead["org_id"], MANAGER_ROLES)
    try:
        return _data(ctx.db.table("employer_leads").update({"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", lead_id).execute())[0]
    except Exception as exc:
        raise _safe_error(exc, "employer_lead_update_failed")


@router.post("/employer-leads/{lead_id}/convert", status_code=201)
def convert_employer_lead(lead_id: str, ctx: AuthContext = ctx_dep):
    lead = row_or_404(ctx, "employer_leads", lead_id)
    require_roles(ctx, lead["org_id"], MANAGER_ROLES)
    try:
        client_id = _data(ctx.db.rpc("convert_employer_lead", {"p_lead_id": lead_id}).execute())
        return {"client_id": client_id}
    except Exception as exc:
        raise _safe_error(exc, "employer_lead_convert_failed")


@router.patch("/clients/{client_id}")
def update_client(client_id: str, changes: dict[str, Any], ctx: AuthContext = ctx_dep):
    row = row_or_404(ctx, "clients", client_id)
    require_roles(ctx, row["org_id"], WRITE_ROLES)
    allowed = {key: changes[key] for key in ("name", "website", "notes", "archived_at") if key in changes}
    try:
        return _data(ctx.db.table("clients").update(allowed).eq("id", client_id).execute())[0]
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/jobs")
def jobs(org_id: str, ctx: AuthContext = ctx_dep):
    return _org_data(ctx, "jobs", org_id)


@router.post("/jobs", status_code=201)
def create_job(body: JobCreate, ctx: AuthContext = ctx_dep):
    require_roles(ctx, body.org_id, WRITE_ROLES)
    try:
        row = body.model_dump()
        row["owner_id"] = ctx.user_id
        org = _data(ctx.db.rpc("get_workspace_settings", {"p_org_id": body.org_id}).execute())
        row["privacy_notice_version"] = org["privacy_notice_version"]
        return _data(ctx.db.table("jobs").insert(row).execute())[0]
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/jobs/{job_id}")
def job_detail(job_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    get_member_role(ctx, job["org_id"])
    requirements = _data(ctx.db.table("job_requirements").select("*").eq("job_id", job_id).order("created_at").execute()) or []
    return {**job, "requirements": requirements}


@router.patch("/jobs/{job_id}")
def update_job(job_id: str, changes: dict[str, Any], ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    allowed_keys = {"title", "description", "client_id", "location", "work_arrangement", "employment_type", "status"}
    allowed = {key: changes[key] for key in allowed_keys if key in changes}
    if allowed.get("status") not in (None, "open") and job.get("public_listing_enabled"):
        allowed["public_listing_enabled"] = False
    try:
        updated = _data(ctx.db.table("jobs").update(allowed).eq("id", job_id).execute())[0]
        if job.get("public_listing_enabled") and updated.get("public_listing_enabled") is False:
            ctx.db.table("activity_events").insert({"org_id": job["org_id"], "actor_id": ctx.user_id, "entity_type": "job", "entity_id": job_id, "action": "public_listing_disabled", "metadata": {"reason": "job_status_changed"}}).execute()
        return updated
    except Exception as exc:
        raise _safe_error(exc)


@router.patch("/jobs/{job_id}/public-listing")
def update_job_public_listing(job_id: str, changes: dict[str, Any], ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], MANAGER_ROLES)
    enabled = changes.get("enabled")
    if not isinstance(enabled, bool):
        raise api_error(422, "invalid_public_listing", "Choose whether the public listing is enabled.")
    if enabled and job.get("status") != "open":
        raise api_error(409, "job_not_open", "Change the job status to Open before publishing it.")
    slug = job.get("public_slug")
    if enabled and not slug:
        title_slug = re.sub(r"[^a-z0-9]+", "-", str(job.get("title", "job")).lower()).strip("-")[:70] or "job"
        slug = f"{title_slug}-{job_id.replace('-', '')[:8]}"
    try:
        updated = _data(ctx.db.table("jobs").update({"public_listing_enabled": enabled, "public_slug": slug}).eq("id", job_id).execute())[0]
        ctx.db.table("activity_events").insert({
            "org_id": job["org_id"], "actor_id": ctx.user_id, "entity_type": "job", "entity_id": job_id,
            "action": "public_listing_enabled" if enabled else "public_listing_disabled",
            "metadata": {"public_slug": slug},
        }).execute()
        return updated
    except Exception as exc:
        raise _safe_error(exc, "public_listing_update_failed") from exc


@router.get("/jobs/{job_id}/posters")
def list_job_posters(job_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], {"owner", "admin", "recruitment_manager", "recruiter"})
    try:
        return _data(ctx.db.table("job_posters").select("id,job_id,title,template_id,format,language,poster_copy,style,status,created_at,updated_at").eq("job_id", job_id).order("created_at", desc=True).limit(50).execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "poster_history_failed")


@router.post("/jobs/{job_id}/posters", status_code=201)
def create_job_poster(job_id: str, body: JobPosterCreate, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], {"owner", "admin", "recruitment_manager", "recruiter"})
    if body.org_id != job["org_id"]:
        raise api_error(404, "not_found", "Job not found in this workspace.")
    try:
        result = _data(ctx.db.table("job_posters").insert({**body.model_dump(), "job_id": job_id, "created_by": ctx.user_id}).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": job["org_id"], "actor_id": ctx.user_id, "entity_type": "job_poster", "entity_id": result["id"], "action": "poster_created", "metadata": {"job_id": job_id, "template_id": body.template_id, "format": body.format}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "poster_save_failed")


@router.patch("/posters/{poster_id}")
def update_job_poster(poster_id: str, body: JobPosterUpdate, ctx: AuthContext = ctx_dep):
    poster = row_or_404(ctx, "job_posters", poster_id)
    require_roles(ctx, poster["org_id"], {"owner", "admin", "recruitment_manager", "recruiter"})
    changes = body.model_dump(exclude_unset=True)
    copy = changes.get("poster_copy")
    if copy is not None and (len(copy) > 16 or any(len(value) > 2000 for value in copy.values())):
        raise api_error(422, "poster_copy_too_long", "Poster copy supports up to 16 fields with 2,000 characters each.")
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = _data(ctx.db.table("job_posters").update(changes).eq("id", poster_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": poster["org_id"], "actor_id": ctx.user_id, "entity_type": "job_poster", "entity_id": poster_id, "action": "poster_updated", "metadata": {"status": changes.get("status", poster["status"])}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "poster_update_failed")


@router.post("/jobs/{job_id}/record-current-privacy-notice")
def record_current_privacy_notice(job_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    try:
        org = _data(ctx.db.rpc("get_workspace_settings", {"p_org_id": job["org_id"]}).execute())
        return _data(ctx.db.table("jobs").update({"privacy_notice_version": org["privacy_notice_version"]}).eq("id", job_id).execute())[0]
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/jobs/{job_id}/reviewers")
def list_job_reviewers(job_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    get_member_role(ctx, job["org_id"])
    try:
        return _data(ctx.db.table("job_reviewer_assignments").select("id,user_id,assigned_by,created_at").eq("job_id", job_id).order("created_at").execute()) or []
    except Exception as exc:
        raise _safe_error(exc)


@router.post("/jobs/{job_id}/reviewers", status_code=201)
def assign_job_reviewer(job_id: str, body: dict[str, str], ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], ADMIN_ROLES)
    user_id = body.get("user_id", "")
    try:
        member = _data(ctx.db.table("organization_members").select("role").eq("org_id", job["org_id"]).eq("user_id", user_id).single().execute())
        if member.get("role") != "reviewer":
            raise api_error(422, "reviewer_role_required", "Only a workspace member with reviewer role can be assigned to a job.")
        result = ctx.db.table("job_reviewer_assignments").upsert({"org_id": job["org_id"], "job_id": job_id, "user_id": user_id, "assigned_by": ctx.user_id}, on_conflict="job_id,user_id").execute()
        return (_data(result) or [None])[0]
    except Exception as exc:
        if getattr(exc, "status_code", None):
            raise
        raise _safe_error(exc)


@router.post("/jobs/{job_id}/reviewers/invite", status_code=201)
def invite_job_reviewer(job_id: str, body: ReviewerInviteCreate, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], ADMIN_ROLES)
    settings = get_settings()
    email = body.email.strip().lower()
    user = ctx.db.raw.users.find_one({"email_normalized": email})
    if user:
        member = ctx.db.raw.organization_members.find_one({"org_id": job["org_id"], "user_id": user["id"]})
        if member and member.get("role") != "reviewer":
            raise api_error(409, "reviewer_member_role_conflict", "This account already belongs to the workspace with a different role.")
        if not member:
            ctx.db.raw.organization_members.insert_one({"id": str(uuid.uuid4()), "org_id": job["org_id"], "user_id": user["id"], "user_email": email, "user_name": user.get("name"), "role": "reviewer", "created_at": datetime.now(timezone.utc).isoformat()})
        assignment = ctx.db.table("job_reviewer_assignments").upsert({"org_id": job["org_id"], "job_id": job_id, "user_id": user["id"], "assigned_by": ctx.user_id}, on_conflict="job_id,user_id").execute().data
        return {"user_id": user["id"], "email": email, "invite_sent": False, "assignment": assignment[0] if assignment else None}
    raw_token = secrets.token_urlsafe(36)
    now = datetime.now(timezone.utc)
    ctx.db.raw.team_invitations.insert_one({"id": str(uuid.uuid4()), "org_id": job["org_id"], "job_id": job_id, "email": email, "email_normalized": email, "role": "reviewer", "token_hash": hashlib.sha256(raw_token.encode()).hexdigest(), "created_by": ctx.user_id, "created_at": now.isoformat(), "expires_at": now + timedelta(days=7), "accepted_at": None})
    ctx.db.table("activity_events").insert({"org_id": job["org_id"], "actor_id": ctx.user_id, "entity_type": "job", "entity_id": job_id, "action": "reviewer_invitation_created", "metadata": {"email": email}}).execute()
    return {"email": email, "invite_sent": False, "invite_url": f"{settings.app_web_url.rstrip('/')}/?invite={raw_token}"}


@router.delete("/jobs/{job_id}/reviewers/{user_id}", status_code=204)
def remove_job_reviewer(job_id: str, user_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], ADMIN_ROLES)
    try:
        ctx.db.table("job_reviewer_assignments").delete().eq("job_id", job_id).eq("user_id", user_id).execute()
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/jobs/{job_id}/interview-questions")
def list_interview_questions(job_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    get_member_role(ctx, job["org_id"])
    try:
        rows = _data(ctx.db.table("interview_questions").select("id,question,sort_order,rubric").eq("job_id", job_id).eq("active", True).order("sort_order").execute()) or []
        return {"questions": [row["question"] for row in rows] or DEFAULT_INTERVIEW_QUESTIONS, "configured": bool(rows)}
    except Exception as exc:
        raise _safe_error(exc)


@router.put("/jobs/{job_id}/interview-questions")
def replace_interview_questions(job_id: str, body: dict[str, Any], ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    try:
        cleaned = validate_interview_questions(body.get("questions"))
    except ValueError as exc:
        raise api_error(422, "invalid_questions", str(exc)) from exc
    try:
        ctx.db.table("interview_questions").delete().eq("job_id", job_id).execute()
        saved = _data(ctx.db.table("interview_questions").insert([
            {"org_id": job["org_id"], "job_id": job_id, "question": question, "sort_order": index, "active": True}
            for index, question in enumerate(cleaned)
        ]).execute()) or []
        ctx.db.table("activity_events").insert({"org_id": job["org_id"], "actor_id": ctx.user_id, "entity_type": "job", "entity_id": job_id, "action": "interview_questions_updated", "metadata": {"count": len(saved)}}).execute()
        return {"questions": [row["question"] for row in saved], "configured": True}
    except Exception as exc:
        raise _safe_error(exc)


@router.post("/jobs/{job_id}/parse-jd")
def parse_jd(job_id: str, body: dict[str, str], ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    text = (body.get("text") or job.get("description") or "")[:100_000]
    lines = [re.sub(r"^[\s•*\-\d.)]+", "", line).strip() for line in text.splitlines() if line.strip()]
    title = next((line for line in lines[:8] if len(line) < 140 and re.search(r"\b(engineer|manager|analyst|developer|designer|consultant|specialist|lead|director|recruiter)\b", line, re.I)), None)
    bullets = [line for line in lines if len(line) > 12 and len(line) < 240][:20]
    suggestions = [{"criterion": item[:100], "description": item, "required": True, "weight": 0, "aliases": [], "source_status": "proposed"} for item in bullets]
    return {"title": title or job["title"], "responsibilities": bullets[:10], "essential_skills": [], "preferred_skills": [], "experience_expectations": [], "qualifications": [], "proposed_requirements": suggestions, "needs_recruiter_confirmation": True, "notice": "Suggestions are extracted from supplied text only. Review and edit every field before using it."}


@router.post("/jobs/{job_id}/jd-file")
async def upload_jd_file(job_id: str, file: UploadFile = File(...), ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    settings = get_settings()
    name = (file.filename or "job-description").replace("\\", "/").split("/")[-1]
    try:
        raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if len(raw) > settings.max_upload_mb * 1024 * 1024:
            raise ValueError(f"File exceeds the {settings.max_upload_mb} MB limit.")
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        expected = ALLOWED.get(ext)
        supplied = (file.content_type or "").split(";", 1)[0].lower()
        if supplied and supplied not in {expected, "application/octet-stream"}:
            raise ValueError("File content type does not match the supported file extension.")
        parsed = parse_resume(name, raw, settings.max_upload_mb * 1024 * 1024)
        if not parsed.text:
            raise ValueError("No readable job description text was extracted.")
        path = f"{job['org_id']}/jobs/{job_id}/{ctx.user_id}/{uuid.uuid4().hex}{ext}"
        storage = ctx.db.storage.from_("candidate-resumes")
        try:
            storage.upload(path, raw, {"content-type": expected, "upsert": "false"})
            ctx.db.table("jobs").update({"description": parsed.text, "jd_storage_path": path}).eq("id", job_id).execute()
        except Exception:
            try:
                storage.remove([path])
            except Exception:
                pass
            raise
        if job.get("jd_storage_path"):
            try:
                storage.remove([job["jd_storage_path"]])
            except Exception:
                pass
        return {"filename": name, "character_count": len(parsed.text), "warnings": parsed.warnings, "needs_manual_review": parsed.status != "parsed", "needs_recruiter_confirmation": True}
    except ValueError as exc:
        raise api_error(422, "jd_file_invalid", str(exc)) from exc
    except Exception as exc:
        raise _safe_error(exc, "jd_file_upload_failed") from exc


@router.get("/jobs/{job_id}/requirements")
def list_requirements(job_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    get_member_role(ctx, job["org_id"])
    return _data(ctx.db.table("job_requirements").select("*").eq("job_id", job_id).order("created_at").execute()) or []


@router.post("/jobs/{job_id}/requirements", status_code=201)
def create_requirement(job_id: str, body: RequirementCreate, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    if body.org_id != job["org_id"]:
        raise api_error(400, "workspace_mismatch", "Requirement workspace does not match the job.")
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    row = body.model_dump()
    row.update({"job_id": job_id, "rubric_version": int(job.get("scoring_version") or 1), "approval_status": "approved"})
    try:
        return _data(ctx.db.table("job_requirements").insert(row).execute())[0]
    except Exception as exc:
        raise _safe_error(exc)


@router.patch("/jobs/{job_id}/requirements/{requirement_id}")
def update_requirement(job_id: str, requirement_id: str, changes: dict[str, Any], ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    req = row_or_404(ctx, "job_requirements", requirement_id)
    if req["job_id"] != job_id:
        raise api_error(404, "not_found", "Requirement not found for this job.")
    allowed = {key: changes[key] for key in ("criterion", "description", "weight", "required", "aliases", "active") if key in changes}
    try:
        result = _data(ctx.db.table("job_requirements").update(allowed).eq("id", requirement_id).execute())[0]
        ctx.db.table("jobs").update({"scoring_version": int(job.get("scoring_version") or 1) + 1}).eq("id", job_id).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc)


@router.delete("/jobs/{job_id}/requirements/{requirement_id}", status_code=204)
def delete_requirement(job_id: str, requirement_id: str, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    req = row_or_404(ctx, "job_requirements", requirement_id)
    if req["job_id"] != job_id:
        raise api_error(404, "not_found", "Requirement not found for this job.")
    try:
        ctx.db.table("job_requirements").delete().eq("id", requirement_id).execute()
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/candidates")
def candidates(org_id: str, search: str | None = None, limit: int = 100, offset: int = 0, ctx: AuthContext = ctx_dep):
    get_member_role(ctx, org_id)
    limit = min(max(limit, 1), 100)
    query = ctx.db.table("candidates").select("id,org_id,full_name,current_title,current_employer,skills,source,parse_status,created_at").eq("org_id", org_id).order("created_at", desc=True).range(max(0, offset), max(0, offset) + limit - 1)
    if search:
        # Search only recruiter-visible fields, escape PostgREST punctuation.
        safe = re.sub(r"[^\w @.+-]", "", search)[:80]
        if safe:
            query = query.or_(f"full_name.ilike.%{safe}%,current_title.ilike.%{safe}%,current_employer.ilike.%{safe}%")
    try:
        return _data(query.execute()) or []
    except Exception as exc:
        raise _safe_error(exc)


@router.post("/candidates/import.csv")
async def import_candidates_csv(org_id: str, file: UploadFile = File(...), job_id: str | None = None, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, CANDIDATE_WRITE_ROLES)
    job = None
    if job_id:
        job = _org_row(ctx, "jobs", job_id, org_id)
    settings = get_settings()
    filename = (file.filename or "candidates.csv").replace("\\", "/").split("/")[-1]
    if not filename.lower().endswith(".csv"):
        raise api_error(415, "csv_required", "Choose a .csv file.")
    raw = await file.read(min(settings.max_upload_mb * 1024 * 1024, 5 * 1024 * 1024) + 1)
    if len(raw) > min(settings.max_upload_mb * 1024 * 1024, 5 * 1024 * 1024):
        raise api_error(413, "csv_too_large", "Candidate CSV files are limited to 5 MB.")
    try:
        text_value = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise api_error(422, "csv_encoding_invalid", "Save the CSV as UTF-8 and retry.") from exc
    reader = csv.DictReader(io.StringIO(text_value, newline=""))
    headers = [str(item or "").strip().lower() for item in (reader.fieldnames or [])]
    allowed = {"full_name", "email", "phone", "current_title", "current_employer", "skills", "source"}
    if not headers or "full_name" not in headers or len(headers) != len(set(headers)) or set(headers) - allowed:
        raise api_error(422, "csv_headers_invalid", "Use unique headers from: full_name, email, phone, current_title, current_employer, skills, source. The full_name column is required.")
    reader.fieldnames = headers
    try:
        all_rows = list(reader)
    except csv.Error as exc:
        raise api_error(422, "csv_invalid", "The CSV file could not be parsed. Check its quoting and delimiters.") from exc
    if len(all_rows) > 500:
        raise api_error(413, "csv_row_limit", "Import at most 500 candidate rows at a time.")
    input_emails = list({str(row.get("email") or "").strip().lower() for row in all_rows if str(row.get("email") or "").strip()})
    input_phones = list({normalized for row in all_rows if (normalized := _normalize_phone(str(row.get("phone") or "")))})
    try:
        existing = _data(ctx.db.table("candidates").select("id,normalized_email").eq("org_id", org_id).in_("normalized_email", input_emails).limit(500).execute()) or [] if input_emails else []
        existing_phone_rows = _data(ctx.db.table("candidates").select("id,normalized_phone").eq("org_id", org_id).in_("normalized_phone", input_phones).limit(500).execute()) or [] if input_phones else []
    except Exception as exc:
        raise _safe_error(exc, "candidate_duplicate_check_failed")
    existing_by_email = {row["normalized_email"].lower(): row["id"] for row in existing if row.get("normalized_email")}
    existing_by_phone = {row["normalized_phone"]: row["id"] for row in existing_phone_rows if row.get("normalized_phone")}
    seen_emails: dict[str, str | None] = {}
    seen_phones: dict[str, str | None] = {}
    results = []
    for row_number, row in enumerate(all_rows, start=2):
        if None in row:
            results.append({"row": row_number, "status": "failed", "error": "The row has more values than the header. Check its delimiters."}); continue
        values = {key: str(row.get(key) or "").strip() for key in allowed}
        name = values["full_name"]
        email = values["email"].lower()
        normalized_phone = _normalize_phone(values["phone"])
        if not any(values.values()):
            continue
        issue = None
        if not 2 <= len(name) <= 180:
            issue = "Full name must be between 2 and 180 characters."
        elif values["email"] and (len(values["email"]) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["email"])):
            issue = "Email address is invalid."
        elif len(values["phone"]) > 40 or len(values["current_title"]) > 180 or len(values["current_employer"]) > 180 or len(values["source"]) > 100:
            issue = "A phone, role, employer, or source field is too long."
        elif len(values["skills"]) > 3000:
            issue = "Skills must be 3,000 characters or fewer."
        if issue:
            results.append({"row": row_number, "status": "failed", "error": issue}); continue
        duplicate_signals = []
        duplicate_candidate_id = None
        if email and email in existing_by_email:
            duplicate_signals.append("normalized_email")
            duplicate_candidate_id = existing_by_email[email]
        elif email and email in seen_emails:
            duplicate_signals.append("normalized_email_in_file")
            duplicate_candidate_id = seen_emails[email]
        if normalized_phone and normalized_phone in existing_by_phone:
            duplicate_signals.append("normalized_phone")
            duplicate_candidate_id = duplicate_candidate_id or existing_by_phone[normalized_phone]
        elif normalized_phone and normalized_phone in seen_phones:
            duplicate_signals.append("normalized_phone_in_file")
            duplicate_candidate_id = duplicate_candidate_id or seen_phones[normalized_phone]
        if duplicate_signals:
            matches = {"normalized_email": "An existing profile uses this email.", "normalized_email_in_file": "This email appears earlier in the file.", "normalized_phone": "An existing profile uses this phone number.", "normalized_phone_in_file": "This phone number appears earlier in the file."}
            warning = " ".join(matches[signal] for signal in duplicate_signals) + " Review before creating another record."
            results.append({"row": row_number, "status": "duplicate_review", "candidate_id": duplicate_candidate_id, "duplicate_signals": duplicate_signals, "warning": warning}); continue
        skills = list(dict.fromkeys(skill.strip()[:100] for skill in re.split(r"[;,|]", values["skills"]) if skill.strip()))[:30]
        candidate_row = {
            "org_id": org_id, "full_name": name, "email": values["email"] or None,
            "normalized_email": email or None, "phone": values["phone"] or None,
            "current_title": values["current_title"] or None, "current_employer": values["current_employer"] or None,
            "skills": skills, "source": values["source"] or "csv_import", "consent_status": "not_recorded",
            "parse_status": "not_uploaded", "parsing_warnings": ["Imported from CSV; no resume file was attached."],
        }
        try:
            candidate = _data(ctx.db.table("candidates").insert(candidate_row).execute())[0]
        except Exception:
            results.append({"row": row_number, "status": "failed", "error": "This row could not be saved. Verify the workspace connection and retry the failed rows."})
            continue
        application_id = None
        warning = None
        if job:
            try:
                application = _data(ctx.db.table("applications").insert({"org_id": org_id, "candidate_id": candidate["id"], "job_id": job["id"], "stage": "Needs Review", "status": "active", "owner_id": ctx.user_id}).execute())[0]
                application_id = application["id"]
            except Exception:
                warning = "Profile saved, but its application could not be linked to the selected job."
        try:
            ctx.db.table("activity_events").insert({"org_id": org_id, "actor_id": ctx.user_id, "entity_type": "candidate", "entity_id": candidate["id"], "action": "candidate_imported", "metadata": {"source": "csv", "job_id": job_id}}).execute()
        except Exception:
            pass
        if email:
            existing_by_email[email] = candidate["id"]
            seen_emails[email] = candidate["id"]
        if normalized_phone:
            existing_by_phone[normalized_phone] = candidate["id"]
            seen_phones[normalized_phone] = candidate["id"]
        results.append({"row": row_number, "status": "imported", "candidate_id": candidate["id"], "application_id": application_id, "warning": warning})
    return {"total": len(results), "imported": sum(item["status"] == "imported" for item in results),
            "duplicate_review": sum(item["status"] == "duplicate_review" for item in results),
            "failed": sum(item["status"] == "failed" for item in results), "results": results}


@router.post("/jobs/{job_id}/resumes")
async def upload_resumes(job_id: str, files: list[UploadFile] = File(...), consent_status: str = Form(default="not_recorded"), ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], CANDIDATE_WRITE_ROLES)
    settings = get_settings()
    if len(files) > settings.max_files_per_batch:
        raise api_error(413, "batch_too_large", f"Upload at most {settings.max_files_per_batch} files per batch.")
    if consent_status not in {"not_recorded", "recorded", "not_required"}:
        raise api_error(422, "invalid_consent_state", "Consent status must be explicitly recorded or left not recorded.")
    ai_policy = None
    if settings.ai_scoring_enabled and settings.openai_key_ready and settings.openai_model:
        try:
            ai_policy = _data(ctx.db.rpc("get_workspace_settings", {"p_org_id": job["org_id"]}).execute())
        except Exception:
            ai_policy = None
    output = []
    for upload in files:
        name = (upload.filename or "resume").replace("\\", "/").split("/")[-1]
        try:
            raw = await upload.read(settings.max_upload_mb * 1024 * 1024 + 1)
            if len(raw) > settings.max_upload_mb * 1024 * 1024:
                raise ValueError(f"File exceeds the {settings.max_upload_mb} MB limit.")
            ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
            supplied_mime = (upload.content_type or "").split(";", 1)[0].lower()
            if supplied_mime and supplied_mime not in {ALLOWED.get(ext), "application/octet-stream"}:
                raise ValueError("File content type does not match the supported file extension.")
            parsed = parse_resume(name, raw, settings.max_upload_mb * 1024 * 1024)
            if ai_policy and ai_policy.get("ai_processing_enabled") and ai_policy.get("ai_notice_acknowledged"):
                if consent_status == "recorded" and job.get("privacy_notice_version") == ai_policy.get("privacy_notice_version"):
                    profile, ai_warnings = OpenAIExtractionProvider(settings.openai_api_key, settings.openai_model).extract(parsed.text, parsed.profile)
                    profile["extraction_model"] = settings.openai_model
                    parsed.profile = profile
                    parsed.warnings.extend(ai_warnings)
                else:
                    parsed.warnings.append("Optional AI extraction was skipped because current AI notice delivery was not recorded for this upload. Deterministic parsing was used.")
            existing_rows = _data(ctx.db.table("resume_assets").select("id,candidate_id").eq("org_id", job["org_id"]).eq("sha256", parsed.sha256).order("created_at").limit(1).execute()) or []
            existing = existing_rows[0] if existing_rows else None
            duplicate_signals = []
            if existing:
                candidate_id = existing["candidate_id"]
                candidate = row_or_404(ctx, "candidates", candidate_id)
                asset_id = existing["id"]
                duplicate_signals.append("same_resume_sha256")
            else:
                email = parsed.profile.get("email")
                normalized_email = email.lower() if email else None
                normalized_phone = _normalize_phone(parsed.profile.get("phone"))
                candidate_id = str(uuid.uuid4())
                if normalized_email:
                    email_match = _data(ctx.db.table("candidates").select("id").eq("org_id", job["org_id"]).eq("normalized_email", normalized_email).limit(1).execute()) or []
                    if email_match:
                        duplicate_signals.append("normalized_email")
                if normalized_phone:
                    phone_match = _data(ctx.db.table("candidates").select("id").eq("org_id", job["org_id"]).eq("normalized_phone", normalized_phone).limit(1).execute()) or []
                    if phone_match:
                        duplicate_signals.append("normalized_phone")
                candidate_row = {
                    "id": candidate_id, "org_id": job["org_id"], "full_name": parsed.profile.get("full_name"),
                    "email": parsed.profile.get("email"), "normalized_email": normalized_email, "phone": parsed.profile.get("phone"),
                    "current_title": parsed.profile.get("current_title"), "current_employer": parsed.profile.get("current_employer"),
                    "skills": parsed.profile.get("skills", []), "source": parsed.profile.get("source"),
                    "consent_status": consent_status, "privacy_notice_version": job.get("privacy_notice_version"),
                    "notice_recorded_at": datetime.now(timezone.utc).isoformat() if consent_status in {"recorded", "not_required"} else None,
                    "parse_status": parsed.status, "parsing_warnings": parsed.warnings,
                }
                _data(ctx.db.table("candidates").insert(candidate_row).execute())
                safe_ext = "." + name.rsplit(".", 1)[-1].lower()
                object_path = f"{job['org_id']}/{candidate_id}/{ctx.user_id}/{uuid.uuid4().hex}{safe_ext}"
                try:
                    storage = ctx.db.storage.from_("candidate-resumes")
                    storage.upload(object_path, raw, {"content-type": ALLOWED[safe_ext], "upsert": "false"})
                except Exception as exc:
                    try:
                        ctx.db.rpc("cleanup_empty_candidate", {"p_org_id": job["org_id"], "p_candidate_id": candidate_id}).execute()
                    except Exception:
                        pass
                    raise ValueError("The private resume file could not be stored; no candidate record was kept.") from exc
                asset_row = {"org_id": job["org_id"], "candidate_id": candidate_id, "storage_path": object_path,
                             "original_filename": re.sub(r"[^\w.() -]", "_", name)[:180], "mime_type": ALLOWED[safe_ext],
                             "size_bytes": len(raw), "sha256": parsed.sha256, "parse_status": parsed.status,
                             "parsing_error": None, "parsed_at": datetime.now(timezone.utc).isoformat(),
                             "parsed_text": parsed.text, "profile_json": parsed.profile}
                try:
                    asset = _data(ctx.db.table("resume_assets").insert(asset_row).execute())[0]
                except Exception as exc:
                    try:
                        storage.remove([object_path])
                    except Exception:
                        pass
                    try:
                        ctx.db.rpc("cleanup_empty_candidate", {"p_org_id": job["org_id"], "p_candidate_id": candidate_id}).execute()
                    except Exception:
                        pass
                    raise ValueError("The resume record could not be saved; the private file was removed. Retry this file.") from exc
                asset_id = asset["id"]
                try:
                    if parsed.profile.get("experiences"):
                        ctx.db.table("candidate_experiences").insert([{"org_id": job["org_id"], "candidate_id": candidate_id, **row} for row in parsed.profile["experiences"]]).execute()
                    if parsed.profile.get("educations"):
                        ctx.db.table("candidate_educations").insert([{"org_id": job["org_id"], "candidate_id": candidate_id, **row} for row in parsed.profile["educations"]]).execute()
                    if parsed.profile.get("skills"):
                        ctx.db.table("candidate_skills").insert([{"org_id": job["org_id"], "candidate_id": candidate_id, "skill": skill, "source": "resume"} for skill in parsed.profile["skills"]]).execute()
                except Exception:
                    # A structured field may not fit its schema; raw evidence remains private with the resume asset.
                    pass
            app_match = _data(ctx.db.table("applications").select("id").eq("org_id", job["org_id"]).eq("job_id", job_id).eq("candidate_id", candidate_id).limit(1).execute()) or []
            if app_match:
                application_id = app_match[0]["id"]
            else:
                application = _data(ctx.db.table("applications").insert({"org_id": job["org_id"], "candidate_id": candidate_id, "job_id": job_id, "stage": "Needs Review", "status": "active", "owner_id": ctx.user_id}).execute())[0]
                application_id = application["id"]
            ctx.db.table("activity_events").insert({"org_id": job["org_id"], "actor_id": ctx.user_id, "entity_type": "candidate", "entity_id": candidate_id, "action": "resume_uploaded", "metadata": {"job_id": job_id}}).execute()
            output.append({"filename": name, "status": parsed.status if not existing else "duplicate_file_reused", "candidate_id": candidate_id,
                           "application_id": application_id, "resume_asset_id": asset_id,
                           "duplicate_warning": bool(duplicate_signals), "duplicate_signals": duplicate_signals,
                           "warnings": parsed.warnings if not existing else []})
        except ValueError as exc:
            output.append({"filename": name, "status": "failed", "error": str(exc)})
        except Exception:
            output.append({"filename": name, "status": "failed", "error": "This file could not be processed. Retry it or contact your workspace administrator."})
    return {"results": output, "total": len(output), "succeeded": sum(1 for item in output if item["status"] != "failed")}


@router.get("/jobs/{job_id}/applications")
def applications(job_id: str, stage: str | None = None, sort: str = "created_at", limit: int = 100, offset: int = 0, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    get_member_role(ctx, job["org_id"])
    if sort not in {"created_at", "stage", "score", "coverage"}:
        raise api_error(422, "invalid_sort", "Sort must be created_at, stage, score, or coverage.")
    safe_limit = min(max(limit, 1), 100)
    query = ctx.db.table("applications").select("*,candidates(id,full_name,current_title,parse_status,skills)").eq("job_id", job_id).order("created_at", desc=True).range(max(0, offset), max(0, offset) + safe_limit - 1)
    if stage:
        if stage not in STAGES:
            raise api_error(422, "invalid_stage", "Unknown hiring pipeline stage.")
        query = query.eq("stage", stage)
    try:
        rows = _data(query.execute()) or []
        if not rows:
            return rows
        ids = [row["id"] for row in rows]
        scores = _data(ctx.db.table("score_runs").select("id,application_id,total_score,evidence_coverage,confidence,result,created_at,rubric_version,algorithm_version").in_("application_id", ids).order("created_at", desc=True).execute()) or []
        latest = {}
        for score in scores:
            latest.setdefault(score["application_id"], score)
        for row in rows:
            row["latest_score"] = latest.get(row["id"])
        if sort == "stage":
            rows.sort(key=lambda row: (row["stage"], row["created_at"]), reverse=False)
        elif sort == "score":
            rows.sort(key=lambda row: (row.get("latest_score") is None or row["latest_score"].get("total_score") is None, -(row["latest_score"].get("total_score") or 0) if row.get("latest_score") else 0))
        elif sort == "coverage":
            rows.sort(key=lambda row: (row.get("latest_score") is None, -(row["latest_score"].get("evidence_coverage") or 0) if row.get("latest_score") else 0))
        return rows
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/candidates/{candidate_id}")
def candidate_detail(candidate_id: str, ctx: AuthContext = ctx_dep):
    candidate = row_or_404(ctx, "candidates", candidate_id)
    role = get_member_role(ctx, candidate["org_id"])
    assets = _data(ctx.db.table("resume_assets").select("id,original_filename,mime_type,size_bytes,parse_status,parsing_error,parsed_at,created_at").eq("candidate_id", candidate_id).order("created_at", desc=True).execute()) or []
    apps = _data(ctx.db.table("applications").select("id,job_id,stage,status,created_at,jobs(title)").eq("candidate_id", candidate_id).execute()) or []
    if apps and role in WRITE_ROLES:
        score_rows = _data(ctx.db.table("score_runs").select("application_id,total_score,evidence_coverage,confidence,created_at").in_("application_id", [item["id"] for item in apps]).order("created_at", desc=True).execute()) or []
        latest_scores = {}
        for score in score_rows:
            latest_scores.setdefault(score["application_id"], score)
        for item in apps:
            item["latest_score"] = latest_scores.get(item["id"])
    profile = _data(ctx.db.table("resume_assets").select("profile_json").eq("candidate_id", candidate_id).order("created_at", desc=True).limit(1).execute()) or []
    return {**candidate, "resume_assets": assets, "applications": apps, "parsed_profile": profile[0].get("profile_json", {}) if profile else {}}


@router.post("/candidates/{candidate_id}/resumes", status_code=201)
async def add_candidate_resume_version(candidate_id: str, file: UploadFile = File(...), ctx: AuthContext = ctx_dep):
    candidate = row_or_404(ctx, "candidates", candidate_id)
    require_roles(ctx, candidate["org_id"], CANDIDATE_WRITE_ROLES)
    settings = get_settings()
    name = (file.filename or "resume").replace("\\", "/").split("/")[-1]
    try:
        raw = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if len(raw) > settings.max_upload_mb * 1024 * 1024:
            raise ValueError(f"File exceeds the {settings.max_upload_mb} MB limit.")
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        supplied_mime = (file.content_type or "").split(";", 1)[0].lower()
        if supplied_mime and supplied_mime not in {ALLOWED.get(ext), "application/octet-stream"}:
            raise ValueError("File content type does not match the supported file extension.")
        parsed = parse_resume(name, raw, settings.max_upload_mb * 1024 * 1024)
    except ValueError as exc:
        raise api_error(422, "resume_invalid", str(exc)) from exc
    try:
        duplicates = _data(ctx.db.table("resume_assets").select("id,original_filename,created_at").eq("org_id", candidate["org_id"]).eq("candidate_id", candidate_id).eq("sha256", parsed.sha256).limit(1).execute()) or []
        if duplicates:
            return {"status": "duplicate_version", "asset": duplicates[0], "warning": "This exact file is already attached to the profile."}
    except Exception as exc:
        raise _safe_error(exc, "resume_duplicate_check_failed")
    object_path = f"{candidate['org_id']}/{candidate_id}/{ctx.user_id}/{uuid.uuid4().hex}{ext}"
    storage = ctx.db.storage.from_("candidate-resumes")
    try:
        storage.upload(object_path, raw, {"content-type": ALLOWED[ext], "upsert": "false"})
    except Exception as exc:
        raise api_error(503, "resume_storage_unavailable", "The private resume file could not be stored. Retry after checking workspace storage.") from exc
    asset_row = {"org_id": candidate["org_id"], "candidate_id": candidate_id, "storage_path": object_path,
                 "original_filename": re.sub(r"[^\w.() -]", "_", name)[:180], "mime_type": ALLOWED[ext],
                 "size_bytes": len(raw), "sha256": parsed.sha256, "parse_status": parsed.status,
                 "parsing_error": None, "parsed_at": datetime.now(timezone.utc).isoformat(),
                 "parsed_text": parsed.text, "profile_json": parsed.profile}
    try:
        asset = _data(ctx.db.table("resume_assets").insert(asset_row).execute())[0]
    except Exception as exc:
        try:
            storage.remove([object_path])
        except Exception:
            pass
        raise _safe_error(exc, "resume_version_save_failed")
    warnings = list(parsed.warnings)
    try:
        ctx.db.table("candidates").update({"parse_status": parsed.status, "parsing_warnings": parsed.warnings, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", candidate_id).execute()
    except Exception:
        warnings.append("Resume version was saved, but the profile status did not refresh.")
    try:
        ctx.db.table("activity_events").insert({"org_id": candidate["org_id"], "actor_id": ctx.user_id, "entity_type": "candidate", "entity_id": candidate_id, "action": "resume_version_added", "metadata": {"resume_asset_id": asset["id"]}}).execute()
    except Exception:
        warnings.append("Resume version was saved, but its activity event could not be recorded.")
    return {"status": parsed.status, "asset": {"id": asset["id"], "original_filename": asset["original_filename"], "parse_status": asset["parse_status"], "created_at": asset["created_at"]}, "warnings": warnings}


@router.patch("/candidates/{candidate_id}")
def update_candidate(candidate_id: str, changes: dict[str, Any], ctx: AuthContext = ctx_dep):
    candidate = row_or_404(ctx, "candidates", candidate_id)
    require_roles(ctx, candidate["org_id"], CANDIDATE_WRITE_ROLES)
    allowed = {key: changes[key] for key in ("full_name", "email", "phone", "current_title", "current_employer", "skills", "source", "consent_status", "parsing_warnings") if key in changes}
    if "email" in allowed:
        allowed["normalized_email"] = allowed["email"].lower().strip() if allowed["email"] else None
    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = _data(ctx.db.table("candidates").update(allowed).eq("id", candidate_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": candidate["org_id"], "actor_id": ctx.user_id, "entity_type": "candidate", "entity_id": candidate_id, "action": "candidate_updated", "metadata": {"fields": list(allowed)}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/candidates/{candidate_id}/resume-url")
def resume_url(candidate_id: str, asset_id: str | None = None, ctx: AuthContext = ctx_dep):
    candidate = row_or_404(ctx, "candidates", candidate_id)
    role = get_member_role(ctx, candidate["org_id"])
    if role not in {"owner", "admin", "recruitment_manager", "recruiter", "sourcer"}:
        raise api_error(403, "role_forbidden", "Your workspace role cannot access resumes.")
    asset_query = ctx.db.table("resume_assets").select("storage_path").eq("org_id", candidate["org_id"]).eq("candidate_id", candidate_id)
    if asset_id: asset_query = asset_query.eq("id", asset_id)
    else: asset_query = asset_query.order("created_at", desc=True)
    assets = _data(asset_query.limit(1).execute()) or []
    if not assets:
        raise api_error(404, "resume_not_found", "No resume is available for this candidate.")
    try:
        signed = ctx.db.storage.from_("candidate-resumes").create_signed_url(assets[0]["storage_path"], 60)
        url = signed.get("signedURL") or signed.get("signedUrl")
        return {"url": url, "expires_in": 60}
    except Exception as exc:
        raise _safe_error(exc, "resume_unavailable")


@router.post("/applications/{application_id}/score")
def score_application(application_id: str, ctx: AuthContext = ctx_dep):
    application = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, application["org_id"], WRITE_ROLES)
    requirements = _data(ctx.db.table("job_requirements").select("*").eq("job_id", application["job_id"]).eq("active", True).execute()) or []
    if not requirements:
        raise api_error(422, "requirements_missing", "Add and confirm job requirements before scoring.")
    try:
        validate_weights(requirements)
    except ValueError as exc:
        raise api_error(422, "rubric_invalid", str(exc)) from exc
    assets = _data(ctx.db.table("resume_assets").select("parsed_text,parse_status").eq("candidate_id", application["candidate_id"]).order("created_at", desc=True).limit(1).execute()) or []
    if not assets or not assets[0].get("parsed_text"):
        raise api_error(422, "resume_text_missing", "No readable resume text is available. Keep this application in manual review.")
    quality = "incomplete" if assets[0].get("parse_status") != "parsed" else "complete"
    job = row_or_404(ctx, "jobs", application["job_id"])
    result = score_requirements(requirements, assets[0]["parsed_text"], int(job.get("scoring_version") or 1), quality)
    try:
        saved = _data(ctx.db.table("score_runs").insert({"org_id": application["org_id"], "application_id": application_id,
                    "algorithm_version": result["scoring_version"], "rubric_version": result["rubric_version"],
                    "criteria_snapshot": requirements, "total_score": result["match_score"],
                    "evidence_coverage": result["evidence_coverage"], "confidence": result["confidence"],
                    "result": result, "provider": "deterministic", "model": None, "run_by": ctx.user_id}).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": application["org_id"], "actor_id": ctx.user_id, "entity_type": "application", "entity_id": application_id, "action": "score_run_created", "metadata": {"score_run_id": saved["id"], "rubric_version": result["rubric_version"]}}).execute()
        if result["review_priority"] == "manual_review":
            ctx.db.table("applications").update({"stage": "Needs Review"}).eq("id", application_id).execute()
        return {"id": saved["id"], **result}
    except Exception as exc:
        raise _safe_error(exc, "score_save_failed")


@router.post("/jobs/{job_id}/bulk-score")
def bulk_score_job_applications(job_id: str, body: BulkScoreCreate, ctx: AuthContext = ctx_dep):
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], WRITE_ROLES)
    try:
        selected = _data(ctx.db.table("applications").select("id").eq("org_id", job["org_id"]).eq("job_id", job_id).in_("id", body.application_ids).execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "bulk_score_selection_failed")
    if len(selected) != len(body.application_ids):
        raise api_error(404, "application_selection_not_found", "One or more selected applications are not part of this job.")
    results = []
    for row in selected:
        try:
            score = score_application(row["id"], ctx)
            results.append({"application_id": row["id"], "status": "scored", "match_score": score["match_score"], "evidence_coverage": score["evidence_coverage"], "confidence": score["confidence"], "review_priority": score["review_priority"]})
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            issue = detail.get("error", detail)
            results.append({"application_id": row["id"], "status": "failed", "error": issue.get("message", "This application could not be scored.")})
        except Exception:
            results.append({"application_id": row["id"], "status": "failed", "error": "This application could not be scored. Keep it in manual review."})
    return {"job_id": job_id, "total": len(results), "succeeded": sum(1 for item in results if item["status"] == "scored"), "failed": sum(1 for item in results if item["status"] == "failed"), "results": results}


@router.get("/applications/{application_id}/score-runs")
def score_history(application_id: str, ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    get_member_role(ctx, app["org_id"])
    return _data(ctx.db.table("score_runs").select("id,algorithm_version,rubric_version,total_score,evidence_coverage,confidence,result,created_at").eq("application_id", application_id).order("created_at", desc=True).limit(50).execute()) or []


@router.post("/applications/{application_id}/score-overrides", status_code=201)
def score_override(application_id: str, body: dict[str, Any], ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, app["org_id"], WRITE_ROLES)
    reason = str(body.get("reason", "")).strip()
    if len(reason) < 5:
        raise api_error(422, "reason_required", "A meaningful reason is required for a score override.")
    value = body.get("score")
    if not isinstance(value, int) or not 0 <= value <= 100:
        raise api_error(422, "invalid_score", "Override score must be an integer from 0 to 100.")
    latest = _data(ctx.db.table("score_runs").select("id,total_score").eq("application_id", application_id).order("created_at", desc=True).limit(1).execute()) or []
    try:
        result = _data(ctx.db.table("score_overrides").insert({"org_id": app["org_id"], "application_id": application_id, "score_run_id": latest[0]["id"] if latest else None, "original_score": latest[0]["total_score"] if latest else None, "override_score": value, "reason": reason, "actor_id": ctx.user_id}).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": app["org_id"], "actor_id": ctx.user_id, "entity_type": "application", "entity_id": application_id, "action": "score_overridden", "metadata": {"reason": reason, "before": latest[0]["total_score"] if latest else None, "after": value}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc)


@router.patch("/applications/{application_id}/stage")
def change_stage(application_id: str, body: StageChange, ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, app["org_id"], WRITE_ROLES)
    if body.stage not in STAGES:
        raise api_error(422, "invalid_stage", "Unknown hiring pipeline stage.")
    try:
        decision_map = {"Hired": "hired", "Rejected": "rejected", "Withdrawn": "withdrawn"}
        decision = decision_map.get(body.stage)
        if decision and len((body.decision_reason or "").strip()) < 3:
            raise api_error(422, "decision_reason_required", "Record a short human decision reason before using this final stage.")
        update = {"stage": body.stage, "stage_changed_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}
        if decision:
            update.update({"decision": decision, "decision_reason": body.decision_reason.strip()})
        updated = _data(ctx.db.table("applications").update(update).eq("id", application_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": app["org_id"], "actor_id": ctx.user_id, "entity_type": "application", "entity_id": application_id, "action": "stage_changed", "metadata": {"from": app["stage"], "to": body.stage}}).execute()
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_error(exc)


@router.patch("/applications/{application_id}/assign")
def assign_application(application_id: str, body: ApplicationAssignment, ctx: AuthContext = ctx_dep):
    application = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, application["org_id"], {"owner", "admin", "recruitment_manager", "recruiter", "sourcer"})
    try:
        ctx.db.rpc("assign_application_owner", {"p_application_id": application_id, "p_assigned_to": body.assigned_to}).execute()
        return _data(ctx.db.table("applications").select("id,org_id,job_id,owner_id,stage,updated_at").eq("id", application_id).single().execute())
    except Exception as exc:
        raise _safe_error(exc, "application_assignment_failed")


@router.get("/applications/{application_id}/notes")
def list_notes(application_id: str, ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    get_member_role(ctx, app["org_id"])
    return _data(ctx.db.table("notes").select("id,body,author_id,created_at").eq("application_id", application_id).order("created_at", desc=True).limit(100).execute()) or []


@router.post("/applications/{application_id}/notes", status_code=201)
def add_note(application_id: str, body: NoteCreate, ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, app["org_id"], CANDIDATE_WRITE_ROLES)
    try:
        result = _data(ctx.db.table("notes").insert({"org_id": app["org_id"], "application_id": application_id, "author_id": ctx.user_id, "body": body.body}).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": app["org_id"], "actor_id": ctx.user_id, "entity_type": "application", "entity_id": application_id, "action": "note_added", "metadata": {}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/applications/{application_id}/scorecards")
def scorecards(application_id: str, ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    get_member_role(ctx, app["org_id"])
    return _data(ctx.db.table("interview_scorecards").select("*,interview_scorecard_answers(*)").eq("application_id", application_id).order("created_at", desc=True).limit(50).execute()) or []


@router.post("/applications/{application_id}/scorecards", status_code=201)
def submit_scorecard(application_id: str, body: dict[str, Any], ctx: AuthContext = ctx_dep):
    app = row_or_404(ctx, "applications", application_id)
    role = get_member_role(ctx, app["org_id"])
    if role not in {"owner", "admin", "recruitment_manager", "recruiter", "reviewer"}:
        raise api_error(403, "role_forbidden", "Your role cannot submit interview feedback.")
    answers = body.get("answers") or []
    if not answers or any(not isinstance(a.get("rating"), int) or not 1 <= a["rating"] <= 5 for a in answers):
        raise api_error(422, "invalid_scorecard", "Provide at least one scorecard answer with a 1–5 rating.")
    try:
        card = _data(ctx.db.table("interview_scorecards").insert({"org_id": app["org_id"], "application_id": application_id, "reviewer_id": ctx.user_id, "submitted_at": datetime.now(timezone.utc).isoformat(), "blinded": bool(body.get("blinded", False))}).execute())[0]
        rows = [{"org_id": app["org_id"], "scorecard_id": card["id"], "question": str(a.get("question", ""))[:500], "rating": a["rating"], "evidence_notes": str(a.get("evidence_notes", ""))[:5000]} for a in answers]
        saved = _data(ctx.db.table("interview_scorecard_answers").insert(rows).execute())
        return {**card, "answers": saved}
    except Exception as exc:
        raise _safe_error(exc)


@router.get("/tasks")
def list_tasks(org_id: str, status: str | None = None, assigned_to: str | None = None, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, {"owner", "admin", "recruitment_manager", "recruiter", "sourcer", "finance"})
    try:
        query = ctx.db.table("recruiter_tasks").select("*,candidates(full_name),jobs(title),clients(name)").eq("org_id", org_id).order("due_at").limit(300)
        if status: query = query.eq("status", status)
        if assigned_to: query = query.eq("assigned_to", assigned_to)
        return _data(query.execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "task_list_failed")


@router.post("/tasks", status_code=201)
def create_task(body: RecruiterTaskCreate, ctx: AuthContext = ctx_dep):
    require_roles(ctx, body.org_id, {"owner", "admin", "recruitment_manager", "recruiter", "sourcer"})
    if body.assigned_to:
        membership = _data(ctx.db.table("organization_members").select("user_id").eq("org_id", body.org_id).eq("user_id", body.assigned_to).maybe_single().execute())
        if not membership:
            raise api_error(422, "invalid_task_assignee", "Choose a user who belongs to this workspace.")
    for table, row_id in (("candidates", body.candidate_id), ("jobs", body.job_id), ("clients", body.client_id), ("applications", body.application_id)):
        if row_id: _org_row(ctx, table, row_id, body.org_id)
    if body.assigned_to:
        membership = ctx.db.table("organization_members").select("user_id").eq("org_id", body.org_id).eq("user_id", body.assigned_to).maybe_single().execute()
        if not membership.data: raise api_error(422, "assignee_not_member", "Assign tasks only to an existing workspace member.")
    try:
        values = body.model_dump(mode="json", exclude_none=True)
        values.update({"created_by": ctx.user_id, "status": "open"})
        result = _data(ctx.db.table("recruiter_tasks").insert(values).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": body.org_id, "actor_id": ctx.user_id, "entity_type": "task", "entity_id": result["id"], "action": "task_created", "metadata": {"priority": body.priority}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "task_create_failed")


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, body: RecruiterTaskUpdate, ctx: AuthContext = ctx_dep):
    task = row_or_404(ctx, "recruiter_tasks", task_id)
    role = get_member_role(ctx, task["org_id"])
    allowed = {"owner", "admin", "recruitment_manager", "recruiter", "sourcer"}
    if role not in allowed or (role in {"recruiter", "sourcer"} and task.get("assigned_to") != ctx.user_id and task.get("created_by") != ctx.user_id):
        raise api_error(403, "task_forbidden", "Your role or task assignment does not allow this update.")
    changes = body.model_dump(mode="json", exclude_unset=True)
    if changes.get("assigned_to"):
        membership = _data(ctx.db.table("organization_members").select("user_id").eq("org_id", task["org_id"]).eq("user_id", changes["assigned_to"]).maybe_single().execute())
        if not membership:
            raise api_error(422, "invalid_task_assignee", "Choose a user who belongs to this workspace.")
    if "assigned_to" in changes and changes["assigned_to"]:
        membership = ctx.db.table("organization_members").select("user_id").eq("org_id", task["org_id"]).eq("user_id", changes["assigned_to"]).maybe_single().execute()
        if not membership.data: raise api_error(422, "assignee_not_member", "Assign tasks only to an existing workspace member.")
    if changes.get("status") == "completed": changes["completed_at"] = datetime.now(timezone.utc).isoformat()
    elif changes.get("status") in {"open", "in_progress"}: changes["completed_at"] = None
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        updated = _data(ctx.db.table("recruiter_tasks").update(changes).eq("id", task_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": task["org_id"], "actor_id": ctx.user_id, "entity_type": "task", "entity_id": task_id, "action": "task_updated", "metadata": {"status": changes.get("status", task["status"])}}).execute()
        return updated
    except Exception as exc:
        raise _safe_error(exc, "task_update_failed")


@router.get("/interviews")
def list_interviews(org_id: str, upcoming_only: bool = False, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, {"owner", "admin", "recruitment_manager", "recruiter", "reviewer"})
    try:
        query = ctx.db.table("interviews").select("*,candidates(full_name,current_title),jobs(title),clients(name)").eq("org_id", org_id).order("scheduled_at").limit(500)
        if upcoming_only: query = query.gte("scheduled_at", datetime.now(timezone.utc).isoformat()).eq("status", "scheduled")
        return _data(query.execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "interview_list_failed")


@router.post("/applications/{application_id}/interviews", status_code=201)
def schedule_interview(application_id: str, body: InterviewCreate, ctx: AuthContext = ctx_dep):
    application = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, application["org_id"], OPERATIONS_ROLES)
    if body.scheduled_at.tzinfo is None: raise api_error(422, "timezone_required", "Include a timezone in the interview date and time.")
    if application["stage"] in {"Hired", "Rejected", "Withdrawn"}: raise api_error(422, "final_application", "A final application cannot be scheduled for interview.")
    job = _org_row(ctx, "jobs", application["job_id"], application["org_id"])
    _org_row(ctx, "candidates", application["candidate_id"], application["org_id"])
    try:
        values = {**body.model_dump(mode="json"), "org_id": application["org_id"], "application_id": application_id,
                  "candidate_id": application["candidate_id"], "job_id": application["job_id"], "client_id": job.get("client_id"), "scheduled_by": ctx.user_id}
        result = _data(ctx.db.table("interviews").insert(values).execute())[0]
        ctx.db.table("applications").update({"stage": "Interview", "stage_changed_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", application_id).execute()
        ctx.db.table("activity_events").insert({"org_id": application["org_id"], "actor_id": ctx.user_id, "entity_type": "interview", "entity_id": result["id"], "action": "interview_scheduled", "metadata": {"application_id": application_id, "scheduled_at": values["scheduled_at"], "mode": body.mode}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "interview_schedule_failed")


@router.patch("/interviews/{interview_id}")
def update_interview(interview_id: str, body: InterviewUpdate, ctx: AuthContext = ctx_dep):
    interview = row_or_404(ctx, "interviews", interview_id)
    require_roles(ctx, interview["org_id"], OPERATIONS_ROLES)
    if body.scheduled_at and body.scheduled_at.tzinfo is None: raise api_error(422, "timezone_required", "Include a timezone in the interview date and time.")
    changes = body.model_dump(mode="json", exclude_unset=True)
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = _data(ctx.db.table("interviews").update(changes).eq("id", interview_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": interview["org_id"], "actor_id": ctx.user_id, "entity_type": "interview", "entity_id": interview_id, "action": "interview_updated", "metadata": {"status": changes.get("status", interview["status"])}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "interview_update_failed")


@router.post("/applications/{application_id}/submit-to-client", status_code=201)
def submit_application_to_client(application_id: str, ctx: AuthContext = ctx_dep):
    application = row_or_404(ctx, "applications", application_id)
    require_roles(ctx, application["org_id"], OPERATIONS_ROLES)
    try:
        result = ctx.db.rpc("submit_application_to_client", {"p_application_id": application_id}).execute()
        submission_id = result.data
        return _data(ctx.db.table("candidate_submissions").select("*,clients(name)").eq("id", submission_id).single().execute())
    except Exception as exc:
        raise _safe_error(exc, "candidate_submission_failed")


@router.get("/submissions")
def list_submissions(org_id: str, status: str | None = None, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, {"owner", "admin", "recruitment_manager", "recruiter", "finance"})
    try:
        query = ctx.db.table("candidate_submissions").select("*,clients(name),applications(id,stage,candidates(full_name,current_title),jobs(title))").eq("org_id", org_id).order("created_at", desc=True).limit(500)
        if status: query = query.eq("status", status)
        return _data(query.execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "submission_list_failed")


@router.get("/client-portal/submissions")
def client_portal_submissions(org_id: str, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, {"reviewer"})
    try:
        return _data(ctx.db.table("candidate_submissions")
            .select("id,org_id,application_id,client_id,status,shared_profile,feedback,reviewed_at,created_at")
            .eq("org_id", org_id).neq("status", "withdrawn")
            .order("created_at", desc=True).limit(500).execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "client_portal_submissions_failed")


@router.patch("/client-portal/submissions/{submission_id}")
def review_client_submission(submission_id: str, body: SubmissionReview, ctx: AuthContext = ctx_dep):
    submission = row_or_404(ctx, "candidate_submissions", submission_id)
    require_roles(ctx, submission["org_id"], {"reviewer"})
    try:
        ctx.db.rpc("review_candidate_submission", {
            "p_submission_id": submission_id,
            "p_status": body.status,
            "p_feedback": body.feedback,
        }).execute()
        return _data(ctx.db.table("candidate_submissions")
            .select("id,org_id,application_id,client_id,status,shared_profile,feedback,reviewed_at,created_at")
            .eq("id", submission_id).single().execute())
    except Exception as exc:
        raise _safe_error(exc, "client_submission_review_failed")


@router.get("/placements")
def list_placements(org_id: str, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, {"owner", "admin", "recruitment_manager", "recruiter", "finance"})
    try:
        return _data(ctx.db.table("placements").select("*,candidates(full_name,current_title),jobs(title),clients(name),replacement_records(*)").eq("org_id", org_id).order("joining_date", desc=True).limit(500).execute()) or []
    except Exception as exc:
        raise _safe_error(exc, "placement_list_failed")


@router.post("/placements", status_code=201)
def create_placement(body: PlacementCreate, ctx: AuthContext = ctx_dep):
    application = row_or_404(ctx, "applications", body.application_id)
    require_roles(ctx, application["org_id"], {"owner", "admin", "finance"})
    if application["stage"] != "Hired" or application.get("decision") != "hired":
        raise api_error(422, "application_not_hired", "Record a human Hired decision before creating a placement.")
    job = _org_row(ctx, "jobs", application["job_id"], application["org_id"])
    if not job.get("client_id"): raise api_error(422, "placement_client_missing", "Link a client to the job before creating a placement.")
    client = _org_row(ctx, "clients", job["client_id"], application["org_id"])
    recruiter_id = body.recruiter_id or application.get("owner_id") or ctx.user_id
    member = ctx.db.table("organization_members").select("user_id").eq("org_id", application["org_id"]).eq("user_id", recruiter_id).maybe_single().execute()
    if not member.data: raise api_error(422, "recruiter_not_member", "The placement recruiter must be a workspace member.")
    try:
        expected_fee = calculate_placement_fee(body.fee_model, body.fee_value, body.agreed_ctc)
    except ValueError as exc:
        raise api_error(422, "invalid_placement_fee", str(exc)) from exc
    guarantee_deadline = None
    if body.guarantee_months:
        from calendar import monthrange
        month = body.joining_date.month - 1 + body.guarantee_months
        year = body.joining_date.year + month // 12
        month = month % 12 + 1
        guarantee_deadline = body.joining_date.replace(year=year, month=month, day=min(body.joining_date.day, monthrange(year, month)[1])).isoformat()
    try:
        values = {"org_id": application["org_id"], "application_id": application["id"], "candidate_id": application["candidate_id"],
                  "job_id": job["id"], "client_id": client["id"], "recruiter_id": recruiter_id, "joining_date": body.joining_date.isoformat(),
                  "designation": body.designation, "agreed_ctc": str(body.agreed_ctc) if body.agreed_ctc is not None else None,
                  "fee_model": body.fee_model, "fee_value": str(body.fee_value), "expected_fee": str(expected_fee),
                  "guarantee_months": body.guarantee_months, "replacement_deadline": guarantee_deadline,
                  "notes": body.notes, "created_by": ctx.user_id}
        result = _data(ctx.db.table("placements").insert(values).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": application["org_id"], "actor_id": ctx.user_id, "entity_type": "placement", "entity_id": result["id"], "action": "placement_created", "metadata": {"joining_date": values["joining_date"], "expected_fee": str(expected_fee), "client_id": client["id"]}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "placement_create_failed")


@router.patch("/placements/{placement_id}")
def update_placement(placement_id: str, body: PlacementUpdate, ctx: AuthContext = ctx_dep):
    placement = row_or_404(ctx, "placements", placement_id)
    require_roles(ctx, placement["org_id"], {"owner", "admin", "finance"})
    changes = body.model_dump(mode="json", exclude_unset=True)
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = _data(ctx.db.table("placements").update(changes).eq("id", placement_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": placement["org_id"], "actor_id": ctx.user_id, "entity_type": "placement", "entity_id": placement_id, "action": "placement_updated", "metadata": {"invoice_status": changes.get("invoice_status", placement["invoice_status"]), "payment_status": changes.get("payment_status", placement["payment_status"])}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "placement_update_failed")


@router.post("/placements/{placement_id}/replacements", status_code=201)
def create_replacement_record(placement_id: str, body: ReplacementCreate, ctx: AuthContext = ctx_dep):
    placement = row_or_404(ctx, "placements", placement_id)
    require_roles(ctx, placement["org_id"], {"owner", "admin", "finance"})
    if placement.get("replacement_deadline") and body.due_date and body.due_date.isoformat() > placement["replacement_deadline"]:
        raise api_error(422, "outside_guarantee", "Replacement due date cannot exceed the recorded guarantee deadline.")
    try:
        result = _data(ctx.db.table("replacement_records").insert({"org_id": placement["org_id"], "placement_id": placement_id, "reason": body.reason, "due_date": body.due_date.isoformat() if body.due_date else placement.get("replacement_deadline"), "created_by": ctx.user_id}).execute())[0]
        ctx.db.table("placements").update({"status": "replacement_due", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", placement_id).execute()
        ctx.db.table("activity_events").insert({"org_id": placement["org_id"], "actor_id": ctx.user_id, "entity_type": "placement", "entity_id": placement_id, "action": "replacement_opened", "metadata": {"replacement_id": result["id"]}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "replacement_create_failed")


@router.patch("/replacements/{replacement_id}")
def update_replacement_record(replacement_id: str, body: ReplacementUpdate, ctx: AuthContext = ctx_dep):
    record = row_or_404(ctx, "replacement_records", replacement_id)
    require_roles(ctx, record["org_id"], {"owner", "admin", "finance"})
    if body.replacement_candidate_id: _org_row(ctx, "candidates", body.replacement_candidate_id, record["org_id"])
    try:
        changes = {**body.model_dump(mode="json"), "resolved_at": datetime.now(timezone.utc).isoformat() if body.status in {"filled", "closed"} else None}
        result = _data(ctx.db.table("replacement_records").update(changes).eq("id", replacement_id).execute())[0]
        if body.status == "filled": ctx.db.table("placements").update({"status": "replaced"}).eq("id", record["placement_id"]).execute()
        ctx.db.table("activity_events").insert({"org_id": record["org_id"], "actor_id": ctx.user_id, "entity_type": "replacement", "entity_id": replacement_id, "action": "replacement_updated", "metadata": {"status": body.status}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc, "replacement_update_failed")


@router.get("/analytics/pipeline")
def pipeline_analytics(org_id: str, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, WRITE_ROLES | {"finance"})
    rows = _data(ctx.db.table("applications").select("id,job_id,candidate_id,stage,decision,created_at,stage_changed_at,jobs(title,created_at),candidates(source)").eq("org_id", org_id).order("created_at", desc=True).limit(5000).execute()) or []
    report = build_pipeline_report(rows, STAGES)
    report["truncated"] = len(rows) == 5000
    return report


@router.get("/analytics/executive")
def executive_analytics(org_id: str, date_from: date | None = None, date_to: date | None = None,
                        recruiter_id: str | None = None, client_id: str | None = None,
                        industry: str | None = None, job_id: str | None = None, location: str | None = None,
                        ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, MANAGER_ROLES)
    if date_from and date_to and date_from > date_to:
        raise api_error(422, "invalid_date_range", "Start date cannot be after end date.")
    try:
        jobs = _data(ctx.db.table("jobs").select("id,title,client_id,status,vacancies,industry,location,application_deadline,created_at").eq("org_id", org_id).order("created_at", desc=True).limit(5000).execute()) or []
        jobs = [row for row in jobs
                if (not job_id or row["id"] == job_id)
                and (not client_id or row.get("client_id") == client_id)
                and (not industry or industry.casefold() in (row.get("industry") or "").casefold())
                and (not location or location.casefold() in (row.get("location") or "").casefold())
                and (not date_from or str(row.get("created_at", ""))[:10] >= date_from.isoformat())
                and (not date_to or str(row.get("created_at", ""))[:10] <= date_to.isoformat())]
        job_ids = [row["id"] for row in jobs]
        if job_id and not job_ids:
            raise api_error(404, "job_not_found", "The requested job is not in this workspace or does not match the selected filters.")

        applications = _data(ctx.db.table("applications").select("id,org_id,job_id,candidate_id,owner_id,stage,created_at,stage_changed_at,hired_at").eq("org_id", org_id).limit(5000).execute()) or []
        if job_id or client_id or industry or location:
            job_id_set = set(job_ids)
            applications = [row for row in applications if row.get("job_id") in job_id_set]
        if recruiter_id:
            applications = [row for row in applications if row.get("owner_id") == recruiter_id]
        if date_from:
            applications = [row for row in applications if str(row.get("created_at", ""))[:10] >= date_from.isoformat()]
        if date_to:
            applications = [row for row in applications if str(row.get("created_at", ""))[:10] <= date_to.isoformat()]

        app_ids = {row["id"] for row in applications}
        selected_applications = bool(job_id or client_id or industry or location or recruiter_id)
        candidates = _data(ctx.db.table("candidates").select("id,full_name,source,parse_status,created_at").eq("org_id", org_id).limit(5000).execute()) or []
        if selected_applications:
            candidate_ids = {row.get("candidate_id") for row in applications}
            candidates = [row for row in candidates if row.get("id") in candidate_ids]
        if date_from: candidates = [row for row in candidates if str(row.get("created_at", ""))[:10] >= date_from.isoformat()]
        if date_to: candidates = [row for row in candidates if str(row.get("created_at", ""))[:10] <= date_to.isoformat()]

        submissions = _data(ctx.db.table("candidate_submissions").select("application_id,client_id,status,created_at").eq("org_id", org_id).limit(5000).execute()) or []
        if selected_applications: submissions = [row for row in submissions if row.get("application_id") in app_ids]
        if client_id: submissions = [row for row in submissions if row.get("client_id") == client_id]
        if date_from: submissions = [row for row in submissions if str(row.get("created_at", ""))[:10] >= date_from.isoformat()]
        if date_to: submissions = [row for row in submissions if str(row.get("created_at", ""))[:10] <= date_to.isoformat()]

        interviews = _data(ctx.db.table("interviews").select("application_id,job_id,client_id,scheduled_at,status").eq("org_id", org_id).limit(5000).execute()) or []
        if selected_applications: interviews = [row for row in interviews if row.get("application_id") in app_ids]
        if date_from: interviews = [row for row in interviews if str(row.get("scheduled_at", ""))[:10] >= date_from.isoformat()]
        if date_to: interviews = [row for row in interviews if str(row.get("scheduled_at", ""))[:10] <= date_to.isoformat()]

        placements = _data(ctx.db.table("placements").select("id,application_id,client_id,recruiter_id,job_id,joining_date,expected_fee,payment_status,status").eq("org_id", org_id).limit(5000).execute()) or []
        if job_id or client_id or industry or location:
            job_id_set = set(job_ids)
            placements = [row for row in placements if row.get("job_id") in job_id_set]
        if client_id: placements = [row for row in placements if row.get("client_id") == client_id]
        if recruiter_id: placements = [row for row in placements if row.get("recruiter_id") == recruiter_id]
        if date_from:
            placements = [row for row in placements if str(row.get("joining_date", "")) >= date_from.isoformat()]
        if date_to:
            placements = [row for row in placements if str(row.get("joining_date", "")) <= date_to.isoformat()]

        tasks = _data(ctx.db.table("recruiter_tasks").select("id,title,status,priority,due_at,job_id,client_id,assigned_to").eq("org_id", org_id).limit(5000).execute()) or []
        if job_id or client_id or industry or location:
            job_id_set = set(job_ids)
            tasks = [row for row in tasks if row.get("job_id") in job_id_set or (client_id and row.get("client_id") == client_id)]
        if client_id: tasks = [row for row in tasks if row.get("client_id") == client_id or row.get("job_id") in set(job_ids)]
        if recruiter_id: tasks = [row for row in tasks if row.get("assigned_to") == recruiter_id]

        client_query = ctx.db.table("clients").select("id,name,archived_at").eq("org_id", org_id).limit(5000)
        if client_id: client_query = client_query.eq("id", client_id)
        clients = _data(client_query.execute()) or []
        report = build_executive_report(jobs=jobs, clients=clients, candidates=candidates, applications=applications,
                                        submissions=submissions, interviews=interviews, placements=placements,
                                        tasks=tasks, stages=STAGES)
        report["filters"] = {"date_from": date_from.isoformat() if date_from else None, "date_to": date_to.isoformat() if date_to else None,
                             "recruiter_id": recruiter_id, "client_id": client_id, "industry": industry, "job_id": job_id, "location": location}
        report["truncated"] = any(len(rows) == 5000 for rows in (jobs, applications, candidates, submissions, interviews, placements, tasks, clients))
        return report
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_error(exc, "executive_analytics_failed")


@router.get("/analytics/export.csv")
def export_csv(org_id: str, ctx: AuthContext = ctx_dep):
    require_roles(ctx, org_id, WRITE_ROLES)
    rows = _data(ctx.db.table("applications").select("id,stage,created_at,candidates(full_name,current_title),jobs(title)").eq("org_id", org_id).order("created_at", desc=True).limit(5000).execute()) or []
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["application_id", "candidate_name", "current_title", "job_title", "stage", "created_at"])
    for row in rows:
        candidate = row.get("candidates") or {}
        job = row.get("jobs") or {}
        writer.writerow([_safe_csv_cell(row["id"]), _safe_csv_cell(candidate.get("full_name")), _safe_csv_cell(candidate.get("current_title")), _safe_csv_cell(job.get("title")), _safe_csv_cell(row["stage"]), _safe_csv_cell(row["created_at"])])
    headers = {"Content-Disposition": "attachment; filename=mosahay-recruitos-applications.csv"}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/privacy-requests")
def list_privacy_requests(org_id: str, ctx: AuthContext = ctx_dep):
    role = require_roles(ctx, org_id, ADMIN_ROLES)
    return _org_data(ctx, "privacy_requests", org_id, 200)


@router.post("/privacy-requests", status_code=201)
def create_privacy_request(body: PrivacyRequestCreate, ctx: AuthContext = ctx_dep):
    require_roles(ctx, body.org_id, WRITE_ROLES)
    if body.candidate_id:
        candidate = row_or_404(ctx, "candidates", body.candidate_id)
        if candidate["org_id"] != body.org_id:
            raise api_error(404, "not_found", "Candidate not found in this workspace.")
    try:
        result = _data(ctx.db.table("privacy_requests").insert({**body.model_dump(), "requested_by": ctx.user_id, "status": "open"}).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": body.org_id, "actor_id": ctx.user_id, "entity_type": "privacy_request", "entity_id": result["id"], "action": "privacy_request_created", "metadata": {"request_type": body.request_type}}).execute()
        return result
    except Exception as exc:
        raise _safe_error(exc)


@router.patch("/privacy-requests/{request_id}")
def update_privacy_request(request_id: str, body: dict[str, str], ctx: AuthContext = ctx_dep):
    request = row_or_404(ctx, "privacy_requests", request_id)
    require_roles(ctx, request["org_id"], ADMIN_ROLES)
    status = body.get("status")
    if status not in {"open", "in_progress", "completed", "rejected"}:
        raise api_error(422, "invalid_status", "Choose a supported privacy request status.")
    if status == "completed" and request.get("request_type") == "deletion":
        raise api_error(409, "fulfillment_required", "Use the deletion fulfillment endpoint so candidate data is anonymized and private files are removed.")
    try:
        return _data(ctx.db.table("privacy_requests").update({"status": status, "resolution_notes": body.get("resolution_notes", "")[:5000], "resolved_by": ctx.user_id if status in {"completed", "rejected"} else None}).eq("id", request_id).execute())[0]
    except Exception as exc:
        raise _safe_error(exc)


@router.post("/privacy-requests/{request_id}/fulfill-deletion")
def fulfill_deletion_request(request_id: str, ctx: AuthContext = ctx_dep):
    request = row_or_404(ctx, "privacy_requests", request_id)
    require_roles(ctx, request["org_id"], ADMIN_ROLES)
    if request["request_type"] != "deletion" or not request.get("candidate_id"):
        raise api_error(422, "deletion_request_required", "This action requires a deletion request linked to a candidate.")
    candidate_id = request["candidate_id"]
    try:
        assets = _data(ctx.db.table("resume_assets").select("storage_path").eq("org_id", request["org_id"]).eq("candidate_id", candidate_id).execute()) or []
        if assets:
            ctx.db.storage.from_("candidate-resumes").remove([asset["storage_path"] for asset in assets])
        ctx.db.rpc("anonymize_candidate", {"p_org_id": request["org_id"], "p_candidate_id": candidate_id}).execute()
        updated = _data(ctx.db.table("privacy_requests").update({"status": "completed", "resolution_notes": "Candidate profile was anonymized and private resume assets were removed.", "resolved_by": ctx.user_id}).eq("id", request_id).execute())[0]
        ctx.db.table("activity_events").insert({"org_id": request["org_id"], "actor_id": ctx.user_id, "entity_type": "privacy_request", "entity_id": request_id, "action": "candidate_deletion_fulfilled", "metadata": {"candidate_id": candidate_id}}).execute()
        return updated
    except Exception as exc:
        raise _safe_error(exc, "deletion_fulfillment_failed")
