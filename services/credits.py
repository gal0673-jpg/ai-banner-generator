"""User credit ledger: cost table, atomic debit/refund/grant, monthly refill.

1 credit == $0.01 of expected API spend (OpenAI / HeyGen / ElevenLabs / D-ID).
Balances live in ``user_credits``; every change is appended to ``credit_ledger``
for audit and refund correctness.

Concurrency model: every helper uses ``SELECT … FOR UPDATE`` inside a single
transaction, so debits / refunds running in parallel never go negative or skew
``balance_after``. Superusers bypass debit but still get a ledger row with
amount=0 (so the audit trail captures every paid action).

Public surface used by routers / workers:
    - cost_for_banner(), cost_for_ugc(), cost_for_video_render(), cost_for_re_render()
    - InsufficientCreditsError
    - debit(db, user, amount, reason, task_id) -> (balance, ledger_id)
    - refund(user_id, amount, reason, task_id) -> int balance
    - refund_for_task(task_uuid, reason="refund_failed") -> bool
    - grant(db, user_id, amount, reason) -> int balance
    - get_balance(db, user_id) -> int
    - apply_monthly_refill_if_due(db, user_id) -> int balance
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import SessionLocal
from models import CreditLedger, User, UserCredits

logger = logging.getLogger(__name__)

# ── Tunables (move to settings/.env later if you want per-env overrides) ──────

#: Signup bonus and per-month refill ceiling.
SIGNUP_BONUS: int = 200
MONTHLY_REFILL_AMOUNT: int = 50
MONTHLY_REFILL_CEILING: int = 200
MONTHLY_REFILL_INTERVAL_DAYS: int = 30

# ── Cost table ────────────────────────────────────────────────────────────────

#: 1 credit = $0.01 of expected API cost. Includes a safety margin for upstream
#: price drift; tweak after you observe a few weeks of real usage.
COST_BANNER: int = 10  # /generate
COST_VIDEO_RENDER: int = 2  # /tasks/{id}/render-video (Remotion compute only)
COST_UGC_RE_RENDER: int = 5  # /tasks/{id}/ugc/re-render (FFmpeg + Remotion)

# UGC / avatar-studio costs scale with HeyGen+ElevenLabs duration:
_UGC_COSTS: dict[str, int] = {
    "15s": 50,
    "30s": 100,
    "50s": 150,
}


def cost_for_banner() -> int:
    return COST_BANNER


def cost_for_video_render() -> int:
    return COST_VIDEO_RENDER


def cost_for_re_render() -> int:
    return COST_UGC_RE_RENDER


def cost_for_ugc(video_length: str | None) -> int:
    """Return credit cost for a UGC / avatar-studio job by ``video_length`` string."""
    key = (video_length or "30s").strip().lower()
    if key not in _UGC_COSTS:
        key = "30s"
    return _UGC_COSTS[key]


# ── Exception ─────────────────────────────────────────────────────────────────


class InsufficientCreditsError(Exception):
    """Raised when a debit would push the balance below zero."""

    def __init__(self, balance: int, required: int) -> None:
        super().__init__(f"insufficient credits: have {balance}, need {required}")
        self.balance = balance
        self.required = required


def insufficient_credits_http(exc: InsufficientCreditsError) -> HTTPException:
    """Translate :class:`InsufficientCreditsError` into a 402 Payment Required."""
    return HTTPException(
        status_code=402,
        detail={
            "error": "insufficient_credits",
            "balance": exc.balance,
            "required": exc.required,
            "message": (
                f"אין מספיק קרדיטים: יש לך {exc.balance}, נדרשים {exc.required}. "
                "פנה למנהל לתוספת קרדיטים."
            ),
        },
    )


# ── Internal helpers ──────────────────────────────────────────────────────────


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _get_or_create_locked(db: Session, user_id: uuid.UUID) -> UserCredits:
    """Lock the user's credit row for the current transaction; create it on the fly.

    Uses ``SELECT … FOR UPDATE`` (no-op on SQLite, real lock on MySQL/Postgres).
    """
    row = (
        db.execute(
            select(UserCredits).where(UserCredits.user_id == user_id).with_for_update()
        )
        .scalars()
        .first()
    )
    if row is not None:
        return row
    row = UserCredits(user_id=user_id, balance=0)
    db.add(row)
    db.flush()
    return row


def _append_ledger(
    db: Session,
    *,
    user_id: uuid.UUID,
    amount: int,
    reason: str,
    balance_after: int,
    task_id: uuid.UUID | None = None,
) -> CreditLedger:
    entry = CreditLedger(
        user_id=user_id,
        task_id=task_id,
        amount=amount,
        reason=reason,
        balance_after=balance_after,
    )
    db.add(entry)
    db.flush()
    return entry


# ── Public API ────────────────────────────────────────────────────────────────


def get_balance(db: Session, user_id: uuid.UUID) -> int:
    """Return the current balance, creating a zero row lazily for legacy users."""
    row = db.get(UserCredits, user_id)
    if row is None:
        row = UserCredits(user_id=user_id, balance=0)
        db.add(row)
        db.commit()
        db.refresh(row)
    return int(row.balance)


def grant(
    db: Session,
    *,
    user_id: uuid.UUID,
    amount: int,
    reason: str,
    task_id: uuid.UUID | None = None,
) -> int:
    """Add ``amount`` credits (positive) to ``user_id``; returns new balance.

    ``reason`` examples: ``'grant_signup'``, ``'grant_admin'``, ``'refill_monthly'``.
    Caller owns commit (so admin endpoints can wrap multiple users in one txn).
    """
    if amount <= 0:
        raise ValueError("grant amount must be positive")
    row = _get_or_create_locked(db, user_id)
    row.balance = int(row.balance) + amount
    _append_ledger(
        db,
        user_id=user_id,
        amount=amount,
        reason=reason,
        balance_after=int(row.balance),
        task_id=task_id,
    )
    return int(row.balance)


def debit(
    db: Session,
    *,
    user: User,
    amount: int,
    reason: str,
    task_id: uuid.UUID | None = None,
) -> int:
    """Atomically debit ``amount`` from ``user``; raises :class:`InsufficientCreditsError`.

    - Superusers are exempt: balance untouched, ledger row with amount=0 is appended
      (so superuser activity is still auditable).
    - Caller is responsible for ``db.commit()``. The row lock holds until commit
      or rollback, so a failed enqueue can rollback the debit cleanly.

    Returns the new balance.
    """
    if amount < 0:
        raise ValueError("debit amount must be non-negative")

    if user.is_superuser:
        # Audit row only; do not touch balance.
        bal = get_balance(db, user.id)
        _append_ledger(
            db,
            user_id=user.id,
            amount=0,
            reason=f"{reason}_superuser",
            balance_after=bal,
            task_id=task_id,
        )
        return bal

    if amount == 0:
        return get_balance(db, user.id)

    row = _get_or_create_locked(db, user.id)
    current = int(row.balance)
    if current < amount:
        raise InsufficientCreditsError(balance=current, required=amount)
    row.balance = current - amount
    _append_ledger(
        db,
        user_id=user.id,
        amount=-amount,
        reason=reason,
        balance_after=int(row.balance),
        task_id=task_id,
    )
    return int(row.balance)


def refund(
    user_id: uuid.UUID,
    amount: int,
    *,
    reason: str = "refund_failed",
    task_id: uuid.UUID | None = None,
) -> int:
    """Refund ``amount`` to ``user_id`` in its own transaction. Returns new balance.

    Designed for worker / lifecycle code that does not own a Session.
    """
    if amount <= 0:
        return 0
    with SessionLocal() as db:
        row = _get_or_create_locked(db, user_id)
        row.balance = int(row.balance) + amount
        _append_ledger(
            db,
            user_id=user_id,
            amount=amount,
            reason=reason,
            balance_after=int(row.balance),
            task_id=task_id,
        )
        db.commit()
        return int(row.balance)


def refund_for_task(
    task_uuid: uuid.UUID,
    *,
    reason: str = "refund_failed",
) -> bool:
    """Auto-refund the most recent debit attached to ``task_uuid``.

    Used by :func:`services.banner_service.persist_task` when a task transitions
    into ``failed``. Only the LAST not-yet-refunded debit row is reversed, so
    repeated calls (idempotent failure handlers) don't double-refund.

    Returns ``True`` if a refund was applied, ``False`` otherwise.
    """
    with SessionLocal() as db:
        debit_rows: Iterable[CreditLedger] = (
            db.execute(
                select(CreditLedger)
                .where(CreditLedger.task_id == task_uuid)
                .where(CreditLedger.amount < 0)
                .order_by(CreditLedger.created_at.desc())
            )
            .scalars()
            .all()
        )
        refund_rows: list[CreditLedger] = list(
            db.execute(
                select(CreditLedger)
                .where(CreditLedger.task_id == task_uuid)
                .where(CreditLedger.amount > 0)
                .where(CreditLedger.reason.like("refund_%"))
            )
            .scalars()
            .all()
        )

        # Cancel out debit-refund pairs by absolute amount (greedy, oldest debit first).
        unrefunded: list[CreditLedger] = []
        refunded_total = sum(int(r.amount) for r in refund_rows)
        for d in debit_rows:
            amt = -int(d.amount)
            if refunded_total >= amt:
                refunded_total -= amt
            else:
                unrefunded.append(d)
        if not unrefunded:
            return False

        target = unrefunded[0]
        amount = -int(target.amount)
        user_id = target.user_id
        row = _get_or_create_locked(db, user_id)
        row.balance = int(row.balance) + amount
        _append_ledger(
            db,
            user_id=user_id,
            amount=amount,
            reason=reason,
            balance_after=int(row.balance),
            task_id=task_uuid,
        )
        db.commit()
        logger.info(
            "[credits] refunded %d credits to user=%s for task=%s (reason=%s)",
            amount,
            user_id,
            task_uuid,
            reason,
        )
        return True


def apply_monthly_refill_if_due(db: Session, user_id: uuid.UUID) -> int:
    """Top up by ``MONTHLY_REFILL_AMOUNT`` if 30+ days passed since last refill.

    Capped at ``MONTHLY_REFILL_CEILING``; if the user is already at or above the
    ceiling, only the ``last_refill_at`` stamp is bumped (no extra credits). Caller
    owns commit. Returns the current balance after refill (or unchanged).
    """
    row = _get_or_create_locked(db, user_id)
    now = _utc_now()
    last = row.last_refill_at
    # SQLite (and some MySQL configs) return naive datetimes for tz-aware columns;
    # normalize to UTC before subtracting so the comparison never crashes.
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    due = last is None or (now - last) >= timedelta(days=MONTHLY_REFILL_INTERVAL_DAYS)
    if not due:
        return int(row.balance)

    current = int(row.balance)
    if current >= MONTHLY_REFILL_CEILING:
        row.last_refill_at = now
        return current

    delta = min(MONTHLY_REFILL_AMOUNT, MONTHLY_REFILL_CEILING - current)
    row.balance = current + delta
    row.last_refill_at = now
    _append_ledger(
        db,
        user_id=user_id,
        amount=delta,
        reason="refill_monthly",
        balance_after=int(row.balance),
    )
    return int(row.balance)
