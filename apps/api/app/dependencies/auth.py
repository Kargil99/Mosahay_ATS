from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import Depends, Header, Request

from app.core.config import get_settings
from app.core.errors import api_error
from app.core.mongo import MongoDatabase
COOKIE_NAME = "recruitos_session"


@dataclass
class AuthContext:
    user_id: str
    email: str | None
    token: str
    db: MongoDatabase


async def get_context(request: Request, authorization: str | None = Header(default=None)) -> AuthContext:
    settings = get_settings()
    database = getattr(request.app.state, "mongo_database", None)
    if database is None:
        raise api_error(503, "mongodb_not_configured", "Configure MongoDB before using team workspace APIs.")
    if not settings.jwt_secret_ready:
        raise api_error(503, "auth_secret_not_configured", "JWT_SECRET must be set to a random value with at least 32 characters.")
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        raise api_error(401, "unauthorized", "Sign in to continue.")
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer=settings.jwt_issuer)
        user = database.users.find_one({"id": claims.get("sub"), "is_active": True}, {"id": 1, "email": 1})
        if not user:
            raise ValueError("Inactive or missing user")
        return AuthContext(user_id=user["id"], email=user.get("email"), token=token, db=MongoDatabase(database, user["id"]))
    except jwt.PyJWTError as exc:
        raise api_error(401, "invalid_session", "Your session is invalid or expired. Sign in again.") from exc
    except Exception as exc:
        if getattr(exc, "status_code", None):
            raise
        raise api_error(401, "invalid_session", "Your session is invalid or expired. Sign in again.") from exc


def get_member_role(ctx: AuthContext, org_id: str) -> str:
    result = ctx.db.table("organization_members").select("role").eq("org_id", org_id).eq("user_id", ctx.user_id).maybe_single().execute()
    if not result.data:
        raise api_error(403, "workspace_forbidden", "You do not have access to this workspace.")
    return result.data["role"]


def require_roles(ctx: AuthContext, org_id: str, roles: set[str] | None = None) -> str:
    role = get_member_role(ctx, org_id)
    if roles and role not in roles:
        raise api_error(403, "role_forbidden", "Your workspace role cannot perform this action.")
    return role


def row_or_404(ctx: AuthContext, table: str, row_id: str) -> dict[str, Any]:
    result = ctx.db.table(table).select("*").eq("id", row_id).single().execute()
    if not result.data:
        raise api_error(404, "not_found", "The requested record was not found.")
    return result.data


CurrentUser = Depends(get_context)
