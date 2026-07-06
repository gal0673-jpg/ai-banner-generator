"""Authentication routes."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import (
    create_access_token,
    get_current_user,
    get_password_hash,
    session_cookie_kwargs,
    verify_password,
)
from config import SUPERUSER_EMAIL
from database import get_db
from models import User
from schemas import RegisterRequest
from services import credits as credits_service

router = APIRouter(tags=["auth"])


@router.post("/auth/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email must not be empty")
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=email,
        hashed_password=get_password_hash(body.password),
        is_superuser=False,
    )
    db.add(user)
    db.flush()  # populate user.id before the credits grant references it
    credits_service.grant(
        db,
        user_id=user.id,
        amount=credits_service.SIGNUP_BONUS,
        reason="grant_signup",
    )
    db.commit()
    db.refresh(user)
    return {"id": str(user.id), "email": user.email}


@router.post("/auth/login")
def login(
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    email = form_data.username.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(subject=str(user.id))
    response.set_cookie(value=f"Bearer {token}", **session_cookie_kwargs())
    return {"message": "Login successful"}


@router.get("/auth/me")
def auth_me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return the current user and trigger a monthly credit refill if due (SPA bootstrap).

    Exposes two distinct admin flags so the SPA can decide what to render:

    - ``is_superuser`` — any user with ``users.is_superuser=true``. Can CRUD the
      catalog, grant/withdraw credits, view ``/admin/tasks``.
    - ``is_primary_admin`` — only the bootstrapped account (matches
      ``config.SUPERUSER_EMAIL``). Can download ``/admin/ai-banner-context``.

    Keeping the primary-admin identity server-side instead of as a hardcoded
    email constant on the client means the email never ships in the JS bundle.
    """
    balance = credits_service.apply_monthly_refill_if_due(db, current_user.id)
    db.commit()
    is_primary = current_user.email.strip().lower() == SUPERUSER_EMAIL
    return {
        "email": current_user.email,
        "is_superuser": current_user.is_superuser,
        "is_primary_admin": is_primary,
        "credits_balance": balance,
    }


@router.post("/auth/logout")
def logout_user(response: Response) -> dict[str, str]:
    # Browsers only honor a Set-Cookie deletion when path / domain / samesite /
    # secure match the original — so we mirror the login attributes here.
    response.delete_cookie(**session_cookie_kwargs(for_delete=True))
    return {"message": "Logged out"}


@router.get("/me/credits")
def me_credits(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return the current user's credit balance and the 20 most recent ledger entries."""
    from models import CreditLedger, UserCredits  # local import keeps router import light

    row = db.get(UserCredits, current_user.id)
    if row is None:
        balance = credits_service.get_balance(db, current_user.id)
        last_refill = None
    else:
        balance = int(row.balance)
        last_refill = row.last_refill_at

    entries = (
        db.execute(
            select(CreditLedger)
            .where(CreditLedger.user_id == current_user.id)
            .order_by(CreditLedger.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    return {
        "balance": balance,
        "last_refill_at": last_refill,
        "recent_entries": [
            {
                "id": e.id,
                "task_id": str(e.task_id) if e.task_id else None,
                "amount": e.amount,
                "reason": e.reason,
                "balance_after": e.balance_after,
                "created_at": e.created_at,
            }
            for e in entries
        ],
    }
