"""Password hashing, JWT helpers, and FastAPI auth dependencies."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "")
ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))


# ── Session-cookie configuration ──────────────────────────────────────────────
#
# These read once at module import time so /auth/login and /auth/logout see
# identical attributes (browsers only honor cookie deletion when the deletion
# matches the original set call exactly on path / domain / samesite / secure).
#
# Env vars (all optional; safe dev defaults):
#   COOKIE_SECURE   = true | false  (default: false → set true in HTTPS prod)
#   COOKIE_SAMESITE = lax | strict | none  (default: lax)
#   COOKIE_DOMAIN   = .example.com   (default: unset → host-only cookie)
#
# Cross-origin SPA over HTTPS (Vite UI on one origin, API on another)
# requires the pair  SameSite=None + Secure=true,  otherwise browsers drop the
# cookie. We validate that combination explicitly below.

COOKIE_NAME = "access_token"


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_samesite_env(name: str, default: Literal["lax", "strict", "none"]) -> Literal["lax", "strict", "none"]:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw in {"lax", "strict", "none"}:
        return raw  # type: ignore[return-value]
    if raw:
        logger.warning(
            "[auth] invalid %s=%r; falling back to %r", name, raw, default
        )
    return default


COOKIE_SECURE: bool = _parse_bool_env("COOKIE_SECURE", False)
COOKIE_SAMESITE: Literal["lax", "strict", "none"] = _parse_samesite_env("COOKIE_SAMESITE", "lax")
COOKIE_DOMAIN: str | None = (os.environ.get("COOKIE_DOMAIN") or "").strip() or None

if COOKIE_SAMESITE == "none" and not COOKIE_SECURE:
    # Browsers silently drop SameSite=None cookies that are not also Secure.
    # Auto-correct so production deploys can't end up with users who can never
    # stay logged in, and log loudly so the env is fixed at the next deploy.
    logger.error(
        "[auth] COOKIE_SAMESITE=none requires COOKIE_SECURE=true; "
        "forcing secure=True for this process (fix the env)."
    )
    COOKIE_SECURE = True


def session_cookie_kwargs(*, for_delete: bool = False) -> dict[str, Any]:
    """Common kwargs for ``response.set_cookie`` / ``response.delete_cookie``.

    ``for_delete=True`` strips ``httponly`` / ``value`` arguments that
    ``delete_cookie`` doesn't accept, but keeps the attributes that browsers
    match against (path / domain / samesite / secure).
    """
    base: dict[str, Any] = {
        "key": COOKIE_NAME,
        "path": "/",
        "samesite": COOKIE_SAMESITE,
        "secure": COOKIE_SECURE,
    }
    if COOKIE_DOMAIN:
        base["domain"] = COOKIE_DOMAIN
    if not for_delete:
        base["httponly"] = True
    return base


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    if not SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY is not set in the environment.")
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta is not None else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> str:
    if not SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY is not set in the environment.")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not isinstance(sub, str) or not sub:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )
        return sub
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None


def get_current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> User:
    cookie_val = request.cookies.get("access_token")
    if not cookie_val:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Cookie is stored as "Bearer <token>"; strip the scheme prefix.
    token = cookie_val.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id_str = decode_access_token(token)
    try:
        user_uuid = UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        ) from None
    user = db.get(User, user_uuid)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


def get_current_superuser(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser privileges required",
        )
    return current_user
