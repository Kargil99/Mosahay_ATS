from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app.core.config import get_settings
from app.core.errors import api_error
from app.dependencies.auth import AuthContext, get_context

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
COOKIE_NAME = "recruitos_session"


class RegisterBody(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    invite_token: str | None = Field(default=None, max_length=160)


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


def _database(request: Request):
    settings = get_settings()
    database = getattr(request.app.state, "mongo_database", None)
    if database is None:
        raise api_error(503, "mongodb_not_configured", "Add MONGODB_URI and JWT_SECRET to the API environment to enable team accounts.")
    if not settings.jwt_secret_ready:
        raise api_error(503, "auth_secret_not_configured", "Set JWT_SECRET to a random value with at least 32 characters on the API service.")
    return database


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt$16384${salt.hex()}${digest.hex()}"


def _password_matches(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$", 3)
        if algorithm != "scrypt" or rounds != "16384":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _issue_token(user: dict) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user["id"], "email": user["email"], "iat": now, "exp": now + timedelta(hours=settings.jwt_ttl_hours), "iss": settings.jwt_issuer}, settings.jwt_secret, algorithm="HS256")


def _set_session(response, user: dict) -> None:
    settings = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        _issue_token(user),
        httponly=True,
        secure=settings.app_env == "production",
        samesite="none" if settings.app_env == "production" else "lax",
        max_age=settings.jwt_ttl_hours * 3600,
        path="/",
        domain=settings.auth_cookie_domain or None,
    )


def _public_user(user: dict) -> dict:
    return {"id": user["id"], "email": user["email"], "name": user.get("name") or "RecruitOS teammate", "providers": [name for name, linked in (("password", bool(user.get("password_hash"))), ("google", bool(user.get("google_sub")))) if linked]}


def _check_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    settings = get_settings()
    allowed = set(settings.origins) | {settings.app_web_url.rstrip("/")}
    if origin.rstrip("/") not in allowed:
        raise api_error(403, "origin_forbidden", "This request did not come from an approved RecruitOS web origin.")


@router.get("/config")
def auth_config(request: Request):
    settings = get_settings()
    mongo_ready = getattr(request.app.state, "mongo_database", None) is not None
    return {
        "mongodb_enabled": mongo_ready and settings.jwt_secret_ready,
        "google_enabled": settings.google_oauth_ready,
        "signup_enabled": mongo_ready and settings.jwt_secret_ready and settings.allow_public_signup,
    }


@router.post("/register", status_code=201)
def register(body: RegisterBody, request: Request):
    _check_origin(request)
    db = _database(request)
    email = body.email.strip().lower()
    invitation = None
    if body.invite_token:
        token_hash = hashlib.sha256(body.invite_token.encode()).hexdigest()
        invitation = db.team_invitations.find_one({"token_hash": token_hash, "email_normalized": email, "accepted_at": None, "expires_at": {"$gt": datetime.now(timezone.utc)}})
        if not invitation:
            raise api_error(400, "invite_invalid", "This team invitation is expired, already used, or belongs to another email address.")
    elif not get_settings().allow_public_signup:
        raise api_error(403, "invitation_required", "Ask a workspace owner for a team invitation before creating an account.")
    if db.users.find_one({"email_normalized": email}, {"id": 1}):
        raise api_error(409, "account_exists", "An account already exists for this email. Sign in or continue with Google to link it.")
    user = {"id": str(uuid.uuid4()), "email": email, "email_normalized": email, "name": body.name.strip(), "password_hash": _password_hash(body.password), "google_sub": None, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(), "is_active": True}
    try:
        db.users.insert_one(user)
    except Exception as exc:
        if getattr(exc, "code", None) == 11000:
            raise api_error(409, "account_exists", "An account already exists for this email. Sign in or continue with Google to link it.") from exc
        raise api_error(503, "account_create_failed", "The account could not be created. Check the MongoDB connection and retry.") from exc
    if invitation:
        db.organization_members.insert_one({"id": str(uuid.uuid4()), "org_id": invitation["org_id"], "user_id": user["id"], "role": invitation["role"], "user_email": email, "user_name": user["name"], "created_at": datetime.now(timezone.utc).isoformat()})
        if invitation.get("job_id"):
            db.job_reviewer_assignments.update_one({"job_id": invitation["job_id"], "user_id": user["id"]}, {"$set": {"id": str(uuid.uuid4()), "org_id": invitation["org_id"], "job_id": invitation["job_id"], "user_id": user["id"], "assigned_by": invitation["created_by"], "created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
        db.team_invitations.update_one({"_id": invitation["_id"]}, {"$set": {"accepted_at": datetime.now(timezone.utc)}})
    from fastapi.responses import JSONResponse
    response = JSONResponse({"user": _public_user(user)})
    _set_session(response, user)
    return response


@router.post("/login")
def login(body: Credentials, request: Request):
    _check_origin(request)
    db = _database(request)
    email = body.email.strip().lower()
    user = db.users.find_one({"email_normalized": email})
    if not user or not user.get("is_active", True) or not user.get("password_hash") or not _password_matches(body.password, user["password_hash"]):
        raise api_error(401, "invalid_credentials", "Email or password is incorrect.")
    from fastapi.responses import JSONResponse
    response = JSONResponse({"user": _public_user(user)})
    _set_session(response, user)
    return response


@router.get("/session")
def session(request: Request):
    settings = get_settings()
    db = _database(request)
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        return {"user": None}
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer=settings.jwt_issuer)
        user = db.users.find_one({"id": claims.get("sub"), "is_active": True})
        return {"user": _public_user(user) if user else None}
    except jwt.PyJWTError:
        return {"user": None}


@router.post("/logout")
def logout(request: Request):
    _check_origin(request)
    response = {"ok": True}
    from fastapi.responses import JSONResponse
    result = JSONResponse(response)
    result.delete_cookie(COOKIE_NAME, path="/", domain=get_settings().auth_cookie_domain or None, secure=get_settings().app_env == "production", httponly=True, samesite="none" if get_settings().app_env == "production" else "lax")
    return result


def _google_start(request: Request, intent: Literal["login", "link"], user_id: str | None = None):
    settings = get_settings()
    db = _database(request)
    if not settings.google_oauth_ready:
        raise api_error(503, "google_not_configured", "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API service to enable Google sign-in.")
    state = secrets.token_urlsafe(32)
    db.auth_oauth_states.insert_one({"state": state, "intent": intent, "user_id": user_id, "created_at": datetime.now(timezone.utc), "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10)})
    query = urlencode({"client_id": settings.google_client_id, "redirect_uri": settings.google_redirect_uri, "response_type": "code", "scope": "openid email profile", "state": state, "prompt": "select_account", "access_type": "online"})
    from fastapi.responses import RedirectResponse
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{query}", status_code=302)


@router.get("/google/start")
def google_start(request: Request):
    return _google_start(request, "login")


@router.get("/google/link")
def google_link(request: Request, ctx: AuthContext = Depends(get_context)):
    return _google_start(request, "link", ctx.user_id)


@router.get("/google/callback")
async def google_callback(request: Request, code: str, state: str):
    settings = get_settings()
    db = _database(request)
    state_doc = db.auth_oauth_states.find_one_and_delete({"state": state, "expires_at": {"$gt": datetime.now(timezone.utc)}})
    if not state_doc:
        raise api_error(400, "google_state_invalid", "Google sign-in expired or could not be verified. Try again.")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_response = await client.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret, "redirect_uri": settings.google_redirect_uri, "grant_type": "authorization_code"})
            token_response.raise_for_status()
            id_token = token_response.json().get("id_token")
            if not id_token:
                raise ValueError("No identity token received")
            identity_response = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": id_token})
            identity_response.raise_for_status()
            identity = identity_response.json()
        if identity.get("aud") != settings.google_client_id or identity.get("iss") not in {"accounts.google.com", "https://accounts.google.com"} or identity.get("email_verified") not in {True, "true"}:
            raise ValueError("Google identity did not pass audience and email verification checks")
        email = str(identity.get("email", "")).strip().lower()
        google_sub = str(identity.get("sub", ""))
        if not email or not google_sub:
            raise ValueError("Google profile is incomplete")
    except Exception as exc:
        raise api_error(401, "google_verification_failed", "Google could not verify this account. Try again or use email sign-in.") from exc

    if state_doc.get("intent") == "link":
        user = db.users.find_one({"id": state_doc.get("user_id"), "is_active": True})
        if not user:
            raise api_error(401, "link_session_expired", "Your sign-in expired. Sign in and try linking Google again.")
        other = db.users.find_one({"google_sub": google_sub, "id": {"$ne": user["id"]}})
        if other or (user.get("email_normalized") != email):
            raise api_error(409, "google_account_conflict", "This Google account is linked to another RecruitOS user or has a different email address.")
        db.users.update_one({"id": user["id"]}, {"$set": {"google_sub": google_sub, "google_email": email, "updated_at": datetime.now(timezone.utc).isoformat()}})
        user["google_sub"] = google_sub
    else:
        user = db.users.find_one({"google_sub": google_sub})
        if not user:
            user = db.users.find_one({"email_normalized": email})
            if user:
                # A verified Google address proves control of the matching email account.
                db.users.update_one({"id": user["id"]}, {"$set": {"google_sub": google_sub, "google_email": email, "updated_at": datetime.now(timezone.utc).isoformat()}})
                user["google_sub"] = google_sub
            else:
                if not settings.allow_public_signup:
                    raise api_error(403, "invitation_required", "Ask a workspace owner to create your account before linking Google.")
                user = {"id": str(uuid.uuid4()), "email": email, "email_normalized": email, "name": str(identity.get("name") or email.split("@")[0])[:100], "google_sub": google_sub, "google_email": email, "password_hash": None, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(), "is_active": True}
                db.users.insert_one(user)
    from fastapi.responses import RedirectResponse
    response = RedirectResponse(f"{settings.app_web_url.rstrip('/')}/?auth=complete", status_code=302)
    _set_session(response, user)
    return response
