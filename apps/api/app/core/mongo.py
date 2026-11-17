"""MongoDB storage adapter for the existing RecruitOS service layer.

The adapter deliberately keeps business routes using a small, familiar query
interface while storing each tenant-owned record in a MongoDB collection.
Tenant checks remain in the route authorization layer; indexes support those
workspace-scoped access patterns.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from gridfs import GridFSBucket
from pymongo import MongoClient
from pymongo import ReturnDocument

from app.core.config import get_settings


def create_mongo_client(uri: str) -> MongoClient:
    return MongoClient(uri, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000, retryWrites=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any) -> Any:
    if isinstance(value, list):
        return [_clean(item) for item in value]
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in value.items() if key != "_id"}
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _split_fields(value: str) -> list[str]:
    result: list[str] = []
    depth = 0
    start = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            result.append(value[start:index].strip())
            start = index + 1
    tail = value[start:].strip()
    if tail:
        result.append(tail)
    return result


@dataclass
class QueryResult:
    data: Any


class MongoDatabase:
    def __init__(self, database: Any, user_id: str):
        self.raw = database
        self.user_id = user_id
        self.storage = MongoStorage(self)

    def table(self, name: str) -> "MongoQuery":
        return MongoQuery(self, name)

    def rpc(self, name: str, params: dict[str, Any] | None = None) -> "MongoRPC":
        return MongoRPC(self, name, params or {})


class MongoQuery:
    def __init__(self, database: MongoDatabase, table: str):
        self.db = database
        self.table_name = table
        self.collection = database.raw[table]
        self.operation = "select"
        self.values: dict[str, Any] = {}
        self.filters: list[tuple[str, str, Any]] = []
        self.sorts: list[tuple[str, int]] = []
        self.columns = "*"
        self.max_results: int | None = None
        self.skip_results = 0
        self.one = False
        self.insert_values: list[dict[str, Any]] = []
        self.conflict_fields: list[str] = []

    def select(self, columns: str = "*", **_: Any) -> "MongoQuery":
        self.columns = columns or "*"
        return self

    def insert(self, values: dict[str, Any] | list[dict[str, Any]], **_: Any) -> "MongoQuery":
        self.operation = "insert"
        rows = values if isinstance(values, list) else [values]
        self.insert_values = [dict(row) for row in rows]
        return self

    def update(self, values: dict[str, Any], **_: Any) -> "MongoQuery":
        self.operation = "update"
        self.values = dict(values)
        return self

    def delete(self, **_: Any) -> "MongoQuery":
        self.operation = "delete"
        return self

    def upsert(self, values: dict[str, Any], on_conflict: str | None = None, **_: Any) -> "MongoQuery":
        self.operation = "upsert"
        self.insert_values = [dict(values)]
        self.conflict_fields = [part.strip() for part in (on_conflict or "id").split(",") if part.strip()]
        return self

    def eq(self, key: str, value: Any) -> "MongoQuery":
        self.filters.append((key, "eq", value)); return self

    def neq(self, key: str, value: Any) -> "MongoQuery":
        self.filters.append((key, "ne", value)); return self

    def in_(self, key: str, values: list[Any]) -> "MongoQuery":
        self.filters.append((key, "in", values)); return self

    def gte(self, key: str, value: Any) -> "MongoQuery":
        self.filters.append((key, "gte", value)); return self

    def order(self, key: str, desc: bool = False, **_: Any) -> "MongoQuery":
        self.sorts.append((key, -1 if desc else 1)); return self

    def limit(self, value: int) -> "MongoQuery":
        self.max_results = max(0, int(value)); return self

    def range(self, start: int, end: int) -> "MongoQuery":
        self.skip_results = max(0, int(start)); self.max_results = max(0, int(end) - int(start) + 1); return self

    def or_(self, expression: str) -> "MongoQuery":
        clauses = re.findall(r"([a-zA-Z0-9_]+)\.ilike\.%([^%]*)%", expression)
        if clauses:
            self.filters.append(("$or", "regex", [(field, text) for field, text in clauses]))
        return self

    def single(self) -> "MongoQuery":
        self.one = True; self.max_results = 1; return self

    def maybe_single(self) -> "MongoQuery":
        self.one = True; self.max_results = 1; return self

    def _filter(self) -> dict[str, Any]:
        query: dict[str, Any] = {}
        for key, operator, value in self.filters:
            if operator == "regex":
                query["$or"] = [{field: {"$regex": re.escape(text), "$options": "i"}} for field, text in value]
                continue
            mongo_op = {"ne": "$ne", "in": "$in", "gte": "$gte"}.get(operator)
            if mongo_op:
                query.setdefault(key, {})[mongo_op] = value
            elif operator == "eq":
                if key in query and isinstance(query[key], dict):
                    query[key]["$eq"] = value
                else:
                    query[key] = value
        return query

    def _related(self, row: dict[str, Any], relation: str) -> Any:
        parent = self.table_name
        relation = relation.strip()
        one_to_many = {
            ("placements", "replacement_records"): ("replacement_records", "placement_id", "id"),
            ("interview_scorecards", "interview_scorecard_answers"): ("interview_scorecard_answers", "scorecard_id", "id"),
        }
        if (parent, relation) in one_to_many:
            collection, foreign_key, local_key = one_to_many[(parent, relation)]
            return [_clean(item) for item in self.db.raw[collection].find({foreign_key: row.get(local_key)})]
        relation_specs = {
            "organization_members": {"organizations": ("organizations", "org_id")},
            "jobs": {"clients": ("clients", "client_id")},
            "applications": {"candidates": ("candidates", "candidate_id"), "jobs": ("jobs", "job_id")},
            "candidate_submissions": {"clients": ("clients", "client_id"), "applications": ("applications", "application_id")},
            "placements": {"clients": ("clients", "client_id"), "candidates": ("candidates", "candidate_id"), "jobs": ("jobs", "job_id")},
            "recruiter_tasks": {"jobs": ("jobs", "job_id"), "clients": ("clients", "client_id")},
            "interviews": {"jobs": ("jobs", "job_id"), "clients": ("clients", "client_id")},
            "applications_nested": {"candidates": ("candidates", "candidate_id"), "jobs": ("jobs", "job_id")},
        }
        spec = relation_specs.get(parent, {}).get(relation)
        if not spec and parent == "candidate_submissions" and relation == "applications":
            spec = ("applications", "application_id")
        if not spec:
            return None
        collection, foreign_key = spec
        related = self.db.raw[collection].find_one({"id": row.get(foreign_key)})
        return _clean(related) if related else None

    def _project(self, row: dict[str, Any], columns: str | None = None) -> dict[str, Any]:
        row = _clean(row)
        columns = columns or self.columns
        if columns.strip() == "*":
            return row
        output: dict[str, Any] = {}
        for field in _split_fields(columns):
            match = re.fullmatch(r"([\w]+)\((.*)\)", field)
            if match:
                relation, nested = match.groups()
                related = self._related(row, relation)
                if isinstance(related, list):
                    output[relation] = [MongoQuery(self.db, relation)._project(item, nested) for item in related]
                elif isinstance(related, dict):
                    output[relation] = MongoQuery(self.db, relation)._project(related, nested)
                else:
                    output[relation] = None
            elif field in row:
                output[field] = row[field]
        return output

    def execute(self) -> QueryResult:
        now = _now()
        if self.operation == "insert":
            docs = []
            for value in self.insert_values:
                doc = {**value, "id": value.get("id") or str(uuid.uuid4()), "created_at": value.get("created_at", now)}
                docs.append(doc)
            if docs:
                self.collection.insert_many(docs)
            return QueryResult([self._project(doc) for doc in docs])
        if self.operation == "upsert":
            docs = []
            for value in self.insert_values:
                condition = {key: value[key] for key in self.conflict_fields if key in value} or {"id": value.get("id") or str(uuid.uuid4())}
                doc = {**value, "id": value.get("id") or str(uuid.uuid4()), "created_at": value.get("created_at", now), "updated_at": now}
                update_values = {key: val for key, val in value.items() if key not in {"id", "created_at"}}
                update_values["updated_at"] = now
                result = self.collection.find_one_and_update(condition, {"$set": update_values, "$setOnInsert": {"id": doc["id"], "created_at": doc["created_at"]}}, upsert=True, return_document=ReturnDocument.AFTER)
                docs.append(_clean(result or doc))
            return QueryResult(docs[0] if self.one and docs else docs)
        query = self._filter()
        if self.operation == "update":
            self.values["updated_at"] = now
            self.collection.update_many(query, {"$set": self.values})
        elif self.operation == "delete":
            self.collection.delete_many(query)
            return QueryResult(None if self.one else [])
        cursor = self.collection.find(query)
        if self.sorts:
            cursor = cursor.sort(self.sorts)
        if self.skip_results:
            cursor = cursor.skip(self.skip_results)
        if self.max_results is not None:
            cursor = cursor.limit(self.max_results)
        rows = [_clean(row) for row in cursor]
        projected = [self._project(row) for row in rows]
        if self.one:
            return QueryResult(projected[0] if projected else None)
        return QueryResult(projected)


class MongoRPC:
    def __init__(self, database: MongoDatabase, name: str, params: dict[str, Any]):
        self.db = database
        self.name = name
        self.params = params

    def execute(self) -> QueryResult:
        p = self.params
        collections = self.db.raw
        if self.name == "create_workspace":
            org_id = str(uuid.uuid4())
            now = _now()
            collections.organizations.insert_one({"id": org_id, "name": p["p_name"], "privacy_notice_text": "", "privacy_notice_version": "initial", "retention_days": 365, "ai_processing_enabled": False, "ai_notice_acknowledged": False, "created_at": now, "updated_at": now})
            collections.organization_members.insert_one({"id": str(uuid.uuid4()), "org_id": org_id, "user_id": self.db.user_id, "role": "owner", "created_at": now})
            return QueryResult(org_id)
        if self.name == "get_workspace_settings":
            org = collections.organizations.find_one({"id": p["p_org_id"]})
            if not org:
                return QueryResult(None)
            org = _clean(org)
            org["has_openai_key"] = get_settings().openai_key_ready
            return QueryResult(org)
        if self.name == "convert_employer_lead":
            lead = collections.employer_leads.find_one({"id": p["p_lead_id"]})
            if not lead:
                return QueryResult(None)
            existing = collections.clients.find_one({"org_id": lead["org_id"], "name": lead.get("company_name")})
            if existing:
                return QueryResult(existing["id"])
            client_id = str(uuid.uuid4())
            collections.clients.insert_one({"id": client_id, "org_id": lead["org_id"], "name": lead.get("company_name") or "New client", "website": lead.get("website"), "notes": "Converted from employer lead.\n" + str(lead.get("job_title") or ""), "created_at": _now()})
            collections.employer_leads.update_one({"id": p["p_lead_id"]}, {"$set": {"status": "converted", "converted_client_id": client_id, "updated_at": _now()}})
            return QueryResult(client_id)
        if self.name == "cleanup_empty_candidate":
            candidate_id = p["p_candidate_id"]
            if not collections.applications.find_one({"candidate_id": candidate_id}) and not collections.resume_assets.find_one({"candidate_id": candidate_id}):
                collections.candidates.delete_one({"org_id": p["p_org_id"], "id": candidate_id})
            return QueryResult(None)
        if self.name == "assign_application_owner":
            collections.applications.update_one({"id": p["p_application_id"]}, {"$set": {"owner_id": p["p_assigned_to"], "updated_at": _now()}})
            return QueryResult(None)
        if self.name == "submit_application_to_client":
            application = collections.applications.find_one({"id": p["p_application_id"]})
            if not application:
                return QueryResult(None)
            job = collections.jobs.find_one({"id": application.get("job_id")}) or {}
            candidate = collections.candidates.find_one({"id": application.get("candidate_id")}) or {}
            if not job.get("client_id") or candidate.get("consent_status") not in {"recorded", "not_required"}:
                raise ValueError("A client and candidate sharing consent are required before submission.")
            submission_id = str(uuid.uuid4())
            collections.candidate_submissions.insert_one({"id": submission_id, "org_id": application["org_id"], "application_id": application["id"], "client_id": job["client_id"], "status": "submitted", "shared_profile": {"candidate_name": candidate.get("full_name"), "current_title": candidate.get("current_title"), "current_employer": candidate.get("current_employer"), "skills": candidate.get("skills") or [], "job_title": job.get("title"), "candidate_reference": str(application["id"])[:8].upper()}, "feedback": None, "reviewed_at": None, "created_at": _now()})
            collections.applications.update_one({"id": application["id"]}, {"$set": {"stage": "Submitted to Client", "stage_changed_at": _now(), "updated_at": _now()}})
            return QueryResult(submission_id)
        if self.name == "review_candidate_submission":
            collections.candidate_submissions.update_one({"id": p["p_submission_id"]}, {"$set": {"status": p["p_status"], "feedback": p["p_feedback"], "reviewed_at": _now(), "updated_at": _now()}})
            return QueryResult(None)
        if self.name == "anonymize_candidate":
            collections.candidates.update_one({"org_id": p["p_org_id"], "id": p["p_candidate_id"]}, {"$set": {"full_name": "Deleted candidate", "email": None, "phone": None, "normalized_email": None, "normalized_phone": None, "current_title": None, "current_employer": None, "skills": [], "parsed_profile": {}, "updated_at": _now()}})
            collections.candidate_submissions.update_many({"org_id": p["p_org_id"], "application_id": {"$in": [item["id"] for item in collections.applications.find({"candidate_id": p["p_candidate_id"]}, {"id": 1})]}}, {"$set": {"shared_profile": {"full_name": "Deleted candidate"}}})
            return QueryResult(None)
        raise NotImplementedError(f"Mongo RPC is not implemented: {self.name}")


class MongoStorage:
    def __init__(self, database: MongoDatabase):
        self.db = database
        self.bucket = GridFSBucket(database.raw, bucket_name="candidate_resumes")

    def from_(self, _: str) -> "MongoStorage":
        return self

    def upload(self, path: str, body: bytes, options: dict[str, Any] | None = None) -> dict[str, Any]:
        self.remove([path])
        options = options or {}
        with self.bucket.open_upload_stream(path, metadata={"content_type": options.get("content-type", "application/octet-stream"), "owner_id": self.db.user_id}) as stream:
            stream.write(body)
        return {"path": path}

    def remove(self, paths: list[str]) -> dict[str, Any]:
        for path in paths:
            for item in self.db.raw["candidate_resumes.files"].find({"filename": path}, {"_id": 1}):
                self.bucket.delete(item["_id"])
        return {"data": paths}

    def create_signed_url(self, path: str, expires_in: int) -> dict[str, str]:
        settings = get_settings()
        expiry = int(datetime.now(timezone.utc).timestamp()) + max(1, min(int(expires_in), 600))
        payload = f"{path}\n{expiry}".encode()
        key = (settings.jwt_secret or settings.mongodb_uri or "local-development-only").encode()
        signature = hmac.new(key, payload, hashlib.sha256).hexdigest().encode()
        token = base64.urlsafe_b64encode(payload + b"\n" + signature).decode().rstrip("=")
        base_url = settings.api_public_url.rstrip("/")
        if not base_url.startswith(("http://", "https://")):
            base_url = ("https://" if settings.app_env == "production" else "http://") + base_url
        return {"signedURL": f"{base_url}/api/v1/storage/resumes/{token}"}

    def open_signed(self, token: str) -> tuple[bytes, str] | None:
        try:
            raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
            path, expiry, signature = raw.rsplit(b"\n", 2)
            payload = path + b"\n" + expiry
            settings = get_settings()
            key = (settings.jwt_secret or settings.mongodb_uri or "local-development-only").encode()
            if int(expiry) < int(datetime.now(timezone.utc).timestamp()) or not hmac.compare_digest(signature, hmac.new(key, payload, hashlib.sha256).hexdigest().encode()):
                return None
            file_doc = self.db.raw["candidate_resumes.files"].find_one({"filename": path.decode()}, sort=[("uploadDate", -1)])
            if not file_doc:
                return None
            stream = self.bucket.open_download_stream(file_doc["_id"])
            return stream.read(), file_doc.get("metadata", {}).get("content_type", "application/octet-stream")
        except Exception:
            return None
