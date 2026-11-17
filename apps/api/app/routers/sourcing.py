from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.errors import api_error
from app.dependencies.auth import AuthContext, get_context, get_member_role, require_roles, row_or_404
from app.services.scoring import score_requirements

router = APIRouter(prefix="/api/v1", tags=["X-ray sourcing"])
SOURCING_ROLES = {"owner", "admin", "recruitment_manager", "recruiter", "sourcer"}


class ProfileUrlImport(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=25)


class ProfileEvidence(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    headline: str | None = Field(default=None, max_length=300)
    profile_text: str = Field(min_length=30, max_length=12000)


def _job_and_requirements(job_id: str, ctx: AuthContext) -> tuple[dict, list[dict]]:
    job = row_or_404(ctx, "jobs", job_id)
    require_roles(ctx, job["org_id"], SOURCING_ROLES)
    requirements = ctx.db.table("job_requirements").select("*").eq("job_id", job_id).eq("active", True).order("created_at").execute().data or []
    return job, requirements


def _phrase(value: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r'["\r\n]+', " ", str(value or ""))).strip()[:90]


def _title_query(title: str) -> str:
    variants = []
    for value in re.split(r"\s*(?:/|\||,|\bor\b)\s*", title, flags=re.I):
        phrase = _phrase(value)
        if phrase and phrase.casefold() not in {item.casefold() for item in variants}:
            variants.append(phrase)
    variants = variants[:3] or [_phrase(title)]
    return "(" + " OR ".join(f'"{item}"' for item in variants) + ")"


def _criterion_group(requirement: dict) -> list[str]:
    terms = [_phrase(requirement.get("criterion"))]
    aliases = requirement.get("aliases") or []
    terms.extend(_phrase(alias) for alias in aliases if isinstance(alias, str))
    unique = []
    for term in terms:
        if term and term.casefold() not in {item.casefold() for item in unique}:
            unique.append(term)
    return unique[:4]


def _search_queries(job: dict, requirements: list[dict]) -> list[dict[str, str]]:
    base = ["site:linkedin.com/in", _title_query(job.get("title") or "")]
    location = _phrase(job.get("location"))
    industry = _phrase(job.get("industry") or job.get("department"))
    required = [item for item in requirements if item.get("required")]
    ranked = sorted(requirements, key=lambda item: int(item.get("weight") or 0), reverse=True)
    core = required or ranked
    skill_groups = [_criterion_group(item) for item in core[:4]]
    skill_groups = [items for items in skill_groups if items]
    queries = []

    focused = base.copy()
    for terms in skill_groups[:3]:
        focused.append("(" + " OR ".join(f'"{term}"' for term in terms) + ")")
    if location:
        focused.append(f'"{location}"')
    focused.append("-jobs")
    queries.append({"label": "Role + must-have criteria", "intent": "Narrow search for the role and its most important required criteria.", "query": " ".join(focused)})

    display_terms = []
    for requirement in ranked[:8]:
        for term in _criterion_group(requirement):
            if term.casefold() not in {item.casefold() for item in display_terms}:
                display_terms.append(term)
    broad = base.copy()
    if display_terms:
        broad.append("(" + " OR ".join(f'"{term}"' for term in display_terms[:12]) + ")")
    if location:
        broad.append(f'"{location}"')
    broad.append("-jobs")
    queries.append({"label": "Role + broader skill pool", "intent": "Wider search that accepts a match to any listed criterion or alias.", "query": " ".join(broad)})

    contextual = base.copy()
    if industry:
        contextual.append(f'"{industry}"')
    if skill_groups:
        contextual.append("(" + " OR ".join(f'"{term}"' for term in skill_groups[0]) + ")")
    if location:
        contextual.append(f'"{location}"')
    contextual.append("-jobs")
    third = {"label": "Industry + location", "intent": "Find relevant professionals in the job's industry and location.", "query": " ".join(contextual)}
    if third["query"] not in {item["query"] for item in queries}:
        queries.append(third)
    return queries


def _canonical_linkedin_url(value: str) -> str:
    raw = value.strip()
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not (host == "linkedin.com" or host.endswith(".linkedin.com")):
        raise ValueError("Use a LinkedIn profile URL from linkedin.com.")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2 or parts[0].lower() != "in" or not re.fullmatch(r"[A-Za-z0-9._%-]+", parts[1]):
        raise ValueError("Use an individual LinkedIn profile URL in the /in/ format.")
    return f"https://www.linkedin.com/in/{parts[1]}/"


@router.get("/jobs/{job_id}/xray-search")
def generate_xray_search(job_id: str, ctx: AuthContext = Depends(get_context)):
    job, requirements = _job_and_requirements(job_id, ctx)
    return {"job_id": job_id, "job_title": job.get("title"), "queries": _search_queries(job, requirements), "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/jobs/{job_id}/xray-profiles")
def list_xray_profiles(job_id: str, ctx: AuthContext = Depends(get_context)):
    job, _ = _job_and_requirements(job_id, ctx)
    rows = list(ctx.db.raw.xray_profiles.find({"org_id": job["org_id"], "job_id": job_id}).sort("created_at", -1).limit(100))
    return [{key: value for key, value in row.items() if key != "_id"} for row in rows]


@router.post("/jobs/{job_id}/xray-profiles", status_code=201)
def import_xray_profiles(job_id: str, body: ProfileUrlImport, ctx: AuthContext = Depends(get_context)):
    job, _ = _job_and_requirements(job_id, ctx)
    require_roles(ctx, job["org_id"], SOURCING_ROLES)
    valid_urls = []
    invalid_urls = []
    for raw_url in body.urls:
        try:
            canonical = _canonical_linkedin_url(raw_url)
            if canonical not in valid_urls:
                valid_urls.append(canonical)
        except ValueError as exc:
            invalid_urls.append({"url": raw_url[:500], "reason": str(exc)})
    if not valid_urls:
        raise api_error(422, "linkedin_urls_invalid", "Paste individual LinkedIn profile links in the linkedin.com/in/ format.")

    collection = ctx.db.raw.xray_profiles
    now = datetime.now(timezone.utc).isoformat()
    for url in valid_urls:
        collection.update_one(
            {"org_id": job["org_id"], "job_id": job_id, "linkedin_url": url},
            {"$setOnInsert": {"id": str(uuid.uuid4()), "org_id": job["org_id"], "job_id": job_id, "linkedin_url": url, "name": "", "headline": "", "profile_text": "", "score_result": None, "created_by": ctx.user_id, "created_at": now, "updated_at": now}},
            upsert=True,
        )
    profiles = list(collection.find({"org_id": job["org_id"], "job_id": job_id}).sort("created_at", -1).limit(100))
    output = [{key: value for key, value in row.items() if key != "_id"} for row in profiles]
    return {"profiles": output, "imported": len(valid_urls), "invalid_urls": invalid_urls}


@router.post("/jobs/{job_id}/xray-profiles/{profile_id}/compare")
def compare_xray_profile(job_id: str, profile_id: str, body: ProfileEvidence, ctx: AuthContext = Depends(get_context)):
    job, requirements = _job_and_requirements(job_id, ctx)
    require_roles(ctx, job["org_id"], SOURCING_ROLES)
    if not requirements:
        raise api_error(422, "job_rubric_missing", "Add active job criteria and weights before comparing profiles.")
    profile = ctx.db.raw.xray_profiles.find_one({"id": profile_id, "org_id": job["org_id"], "job_id": job_id})
    if not profile:
        raise api_error(404, "xray_profile_not_found", "This LinkedIn profile is no longer in this job's sourcing list.")
    try:
        result = score_requirements(requirements, body.profile_text.strip(), int(job.get("scoring_version") or 1), "partial")
    except ValueError as exc:
        raise api_error(422, "job_rubric_invalid", str(exc)) from exc
    now = datetime.now(timezone.utc).isoformat()
    ctx.db.raw.xray_profiles.update_one(
        {"id": profile_id, "org_id": job["org_id"], "job_id": job_id},
        {"$set": {"name": (body.name or "").strip()[:120], "headline": (body.headline or "").strip()[:300], "profile_text": body.profile_text.strip(), "score_result": result, "scored_at": now, "updated_at": now}},
    )
    updated = ctx.db.raw.xray_profiles.find_one({"id": profile_id}, {"_id": 0})
    return updated


@router.delete("/jobs/{job_id}/xray-profiles/{profile_id}", status_code=204)
def remove_xray_profile(job_id: str, profile_id: str, ctx: AuthContext = Depends(get_context)):
    job, _ = _job_and_requirements(job_id, ctx)
    require_roles(ctx, job["org_id"], SOURCING_ROLES)
    deleted = ctx.db.raw.xray_profiles.delete_one({"id": profile_id, "org_id": job["org_id"], "job_id": job_id})
    if not deleted.deleted_count:
        raise api_error(404, "xray_profile_not_found", "This LinkedIn profile is no longer in this job's sourcing list.")
