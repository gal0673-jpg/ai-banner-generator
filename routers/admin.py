"""Superuser admin routes."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ai_banner_context import OUTPUT_FILENAME, build_document
from auth import get_current_superuser
from database import get_db
from deps import require_primary_admin
from models import BannerTask, CreditLedger, User, UserCredits
from schemas import AdminGrantCreditsRequest
from services import credits as credits_service
from services.banner_service import rendered_banner_urls_for_task

router = APIRouter(tags=["admin"])


@router.get("/admin/tasks")
def admin_list_tasks(
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = (
        select(BannerTask)
        .options(
            joinedload(BannerTask.user),
            joinedload(BannerTask.creative),
            joinedload(BannerTask.ugc_video),
        )
        .order_by(BannerTask.id)
    )
    rows = db.scalars(stmt).unique().all()
    out: list[dict[str, Any]] = []
    for t in rows:
        tid = str(t.id)
        fs1, fs2 = rendered_banner_urls_for_task(tid)
        c = t.creative
        out.append(
            {
                "task_id": tid,
                "user_id": str(t.user_id),
                "user_email": t.user.email,
                "status": t.status,
                "url": t.url,
                "brief": t.brief,
                "error": t.error,
                "headline": c.headline if c else None,
                "subhead": c.subhead if c else None,
                "bullet_points": c.bullet_points if c else None,
                "cta": c.cta if c else None,
                "video_hook": c.video_hook if c else None,
                "brand_color": c.brand_color if c else None,
                "background_url": c.background_url if c else None,
                "logo_url": c.logo_url if c else None,
                "rendered_banner_1_url": (c.rendered_banner_1_url if c else None) or fs1,
                "rendered_banner_2_url": (c.rendered_banner_2_url if c else None) or fs2,
                "canvas_state": c.canvas_state if c else None,
                "video_url_1": c.video_url_1 if c else None,
                "video_url_2": c.video_url_2 if c else None,
                "rendered_banner_1_vertical_url": c.rendered_banner_1_vertical_url if c else None,
                "rendered_banner_2_vertical_url": c.rendered_banner_2_vertical_url if c else None,
                "video_url_1_vertical": c.video_url_1_vertical if c else None,
                "video_url_2_vertical": c.video_url_2_vertical if c else None,
                "video_status": c.video_status if c else None,
                "video_render_error": c.video_render_error if c else None,
            }
        )
    return out


@router.get("/admin/users")
def admin_list_users_with_credits(
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all users together with their credit balance — for an admin dashboard."""
    rows = db.execute(
        select(User, UserCredits)
        .outerjoin(UserCredits, UserCredits.user_id == User.id)
        .order_by(User.created_at)
    ).all()
    out: list[dict[str, Any]] = []
    for u, credits_row in rows:
        out.append(
            {
                "id": str(u.id),
                "email": u.email,
                "is_superuser": u.is_superuser,
                "created_at": u.created_at,
                "credits_balance": int(credits_row.balance) if credits_row else 0,
                "last_refill_at": credits_row.last_refill_at if credits_row else None,
            }
        )
    return out


@router.post("/admin/users/{user_id}/credits")
def admin_grant_credits(
    user_id: str,
    body: AdminGrantCreditsRequest,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Add (positive amount) or withdraw (negative amount) credits for a user.

    Withdrawals are capped at the current balance so the running total never
    goes negative. Every change is appended to ``credit_ledger``.
    """
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown user_id") from None

    target = db.get(User, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="Unknown user_id")

    if body.amount == 0:
        raise HTTPException(status_code=400, detail="amount must be non-zero")

    if body.amount > 0:
        new_balance = credits_service.grant(
            db,
            user_id=uid,
            amount=body.amount,
            reason=body.reason or "grant_admin",
        )
    else:
        # Negative amount → withdrawal. Use the debit path but clamp at current balance
        # so we never go below zero. (Admins correcting an over-grant should not turn
        # the user into a negative-balance debtor.)
        from services.credits import _append_ledger, _get_or_create_locked  # type: ignore[attr-defined]

        row = _get_or_create_locked(db, uid)
        current = int(row.balance)
        withdraw = min(-body.amount, current)
        if withdraw == 0:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot withdraw: user balance is already 0 (requested {-body.amount}).",
            )
        row.balance = current - withdraw
        _append_ledger(
            db,
            user_id=uid,
            amount=-withdraw,
            reason=body.reason or "withdraw_admin",
            balance_after=int(row.balance),
        )
        new_balance = int(row.balance)

    db.commit()
    return {
        "user_id": str(uid),
        "balance": new_balance,
        "delta": body.amount,
        "reason": body.reason,
    }


@router.get("/admin/users/{user_id}/credits/ledger")
def admin_user_credit_ledger(
    user_id: str,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Recent ledger entries for one user (most-recent first), up to ``limit`` rows."""
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown user_id") from None

    if db.get(User, uid) is None:
        raise HTTPException(status_code=404, detail="Unknown user_id")

    limit = max(1, min(limit, 500))
    entries = (
        db.execute(
            select(CreditLedger)
            .where(CreditLedger.user_id == uid)
            .order_by(CreditLedger.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": e.id,
            "task_id": str(e.task_id) if e.task_id else None,
            "amount": e.amount,
            "reason": e.reason,
            "balance_after": e.balance_after,
            "created_at": e.created_at,
        }
        for e in entries
    ]


@router.get("/admin/ai-banner-context")
def download_ai_banner_context(_: Annotated[User, Depends(require_primary_admin)]) -> Response:
    """Regenerate ai-banner-context.txt on disk and return it as a download (primary admin only)."""
    root = Path(__file__).resolve().parent.parent
    text = build_document(root)
    (root / OUTPUT_FILENAME).write_text(text, encoding="utf-8")
    return Response(
        content=text.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{OUTPUT_FILENAME}"',
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )
