from __future__ import annotations

import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.mongo import create_mongo_client
from app.routers.ai import router as ai_router
from app.routers.auth import router as auth_router
from app.routers.api import router
from app.routers.sourcing import router as sourcing_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = create_mongo_client(settings.mongodb_uri) if settings.mongodb_uri else None
    app.state.mongo_client = client
    app.state.mongo_database = client[settings.mongodb_database] if client else None
    if client:
        client.admin.command("ping")
        app.state.mongo_database.users.create_index("email_normalized", unique=True)
        app.state.mongo_database.users.create_index("google_sub", unique=True, sparse=True)
        app.state.mongo_database.organization_members.create_index([("org_id", 1), ("user_id", 1)], unique=True)
        app.state.mongo_database.job_reviewer_assignments.create_index([("job_id", 1), ("user_id", 1)], unique=True)
        for table in ("organizations", "clients", "jobs", "candidates", "applications", "candidate_submissions", "interviews", "placements", "recruiter_tasks", "privacy_requests"):
            app.state.mongo_database[table].create_index([("org_id", 1), ("id", 1)])
        for table in ("organizations", "organization_members", "clients", "jobs", "job_requirements", "candidates", "applications", "resume_assets", "candidate_submissions", "job_posters", "interviews", "placements", "recruiter_tasks", "privacy_requests", "activity_events", "audit_logs", "team_invitations", "candidate_portal_access", "employer_leads", "job_reviewer_assignments", "interview_questions", "interview_scorecards", "interview_scorecard_answers", "notes", "score_runs", "score_overrides", "candidate_skills", "candidate_experiences", "candidate_educations", "replacement_records", "client_contacts", "client_offices", "client_contracts", "client_activity_logs", "xray_profiles"):
            app.state.mongo_database[table].create_index("id", unique=True)
        app.state.mongo_database.xray_profiles.create_index([("org_id", 1), ("job_id", 1), ("linkedin_url", 1)], unique=True)
        for table in ("job_requirements", "resume_assets", "score_runs", "score_overrides", "interview_questions", "job_posters", "notes", "activity_events", "audit_logs", "candidate_skills", "candidate_experiences", "candidate_educations", "interviews", "replacement_records", "client_contacts", "client_offices", "client_contracts", "client_activity_logs", "interview_scorecards", "interview_scorecard_answers"):
            app.state.mongo_database[table].create_index([("org_id", 1), ("created_at", -1)])
        app.state.mongo_database.auth_oauth_states.create_index("expires_at", expireAfterSeconds=0)
        app.state.mongo_database.candidate_portal_access.create_index("token_hash", unique=True)
        app.state.mongo_database.candidate_portal_access.create_index("expires_at", expireAfterSeconds=0)
        app.state.mongo_database.team_invitations.create_index("token_hash", unique=True)
        app.state.mongo_database.team_invitations.create_index("expires_at", expireAfterSeconds=0)
        app.state.mongo_database.candidates.create_index([("org_id", 1), ("normalized_email", 1)])
        app.state.mongo_database.candidates.create_index([("org_id", 1), ("normalized_phone", 1)])
        app.state.mongo_database.resume_assets.create_index([("org_id", 1), ("sha256", 1)])
        app.state.mongo_database.jobs.create_index([("org_id", 1), ("public_slug", 1)], sparse=True)
    try:
        yield
    finally:
        if client:
            client.close()


app = FastAPI(
    title="MoSahay RecruitOS API",
    version="0.1.0",
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "apikey", "x-client-info", "x-candidate-access-key"],
)

_requests: dict[str, deque[float]] = defaultdict(deque)
_public_applications: dict[str, deque[float]] = defaultdict(deque)


@app.middleware("http")
async def security_and_rate_limit(request: Request, call_next):
    now = time.monotonic()
    key = request.client.host if request.client else "unknown"
    if request.method in {"POST", "PATCH", "PUT", "DELETE"} and request.cookies.get("recruitos_session"):
        origin = request.headers.get("origin", "").rstrip("/")
        allowed_origins = set(settings.origins) | {settings.app_web_url.rstrip("/")}
        if not origin or origin not in allowed_origins:
            return JSONResponse(status_code=403, content={"detail": {"error": {"code": "origin_forbidden", "message": "This request did not come from an approved RecruitOS web origin."}}})
    public_submission = (request.url.path.endswith("/apply") and request.url.path.startswith("/api/v1/public/jobs/")) or request.url.path == "/api/v1/public/hire-talent"
    if public_submission:
        public_bucket = _public_applications[key]
        while public_bucket and now - public_bucket[0] > 60:
            public_bucket.popleft()
        if len(public_bucket) >= settings.public_apply_rate_limit_per_minute:
            return JSONResponse(status_code=429, content={"error": {"code": "application_rate_limited", "message": "Too many applications were submitted from this connection. Please wait before trying again."}})
        public_bucket.append(now)
    bucket = _requests[key]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= settings.api_rate_limit_per_minute:
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limited", "message": "Please wait before retrying."}})
    bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health")
def health(request: Request):
    database = getattr(request.app.state, "mongo_database", None)
    return {"status": "ok", "service": "mosahay-recruitos-api", "database": "mongodb" if database is not None else "not_configured"}


app.include_router(auth_router)
app.include_router(ai_router)
app.include_router(router)
app.include_router(sourcing_router)
