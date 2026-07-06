"""Tests for services.credits — debit / refund / refund_for_task / monthly refill."""

from __future__ import annotations

import pytest

from services import credits as credits_service


def test_grant_increments_balance_and_writes_ledger(db_session, make_user):
    u = make_user(email="grant@test.local")
    bal = credits_service.grant(db_session, user_id=u.id, amount=150, reason="grant_signup")
    db_session.commit()
    assert bal == 150

    from models import CreditLedger
    from sqlalchemy import select

    entries = db_session.execute(
        select(CreditLedger).where(CreditLedger.user_id == u.id)
    ).scalars().all()
    assert len(entries) == 1
    assert entries[0].amount == 150
    assert entries[0].reason == "grant_signup"
    assert entries[0].balance_after == 150


def test_debit_blocks_when_insufficient(db_session, make_user):
    u = make_user()
    credits_service.grant(db_session, user_id=u.id, amount=5, reason="grant_signup")
    db_session.commit()

    with pytest.raises(credits_service.InsufficientCreditsError) as exc_info:
        credits_service.debit(
            db_session, user=u, amount=10, reason="debit_generate_banner"
        )
    assert exc_info.value.balance == 5
    assert exc_info.value.required == 10
    # Balance unchanged after failed debit
    assert credits_service.get_balance(db_session, u.id) == 5


def test_debit_decrements_and_appends_ledger(db_session, make_user, make_task):
    u = make_user()
    credits_service.grant(db_session, user_id=u.id, amount=200, reason="grant_signup")
    task = make_task(u)

    bal = credits_service.debit(
        db_session,
        user=u,
        amount=credits_service.cost_for_banner(),
        reason="debit_generate_banner",
        task_id=task.id,
    )
    db_session.commit()
    assert bal == 200 - credits_service.cost_for_banner()


def test_superuser_bypasses_debit(db_session, make_user):
    su = make_user(email="root@test.local", is_superuser=True)
    credits_service.grant(db_session, user_id=su.id, amount=50, reason="grant_admin")
    db_session.commit()
    before = credits_service.get_balance(db_session, su.id)
    # Massive debit should NOT touch the balance for superusers.
    after = credits_service.debit(
        db_session, user=su, amount=10_000, reason="debit_generate_banner"
    )
    db_session.commit()
    assert before == after == 50

    # An audit row with amount=0 and the *_superuser suffix should exist.
    from models import CreditLedger
    from sqlalchemy import select

    audit = db_session.execute(
        select(CreditLedger).where(CreditLedger.user_id == su.id).order_by(CreditLedger.id.desc())
    ).scalars().first()
    assert audit is not None
    assert audit.amount == 0
    assert audit.reason.endswith("_superuser")


def test_refund_for_task_restores_most_recent_debit(db_session, make_user, make_task):
    u = make_user()
    credits_service.grant(db_session, user_id=u.id, amount=200, reason="grant_signup")
    task = make_task(u)
    credits_service.debit(
        db_session, user=u, amount=10, reason="debit_generate_banner", task_id=task.id
    )
    db_session.commit()
    assert credits_service.get_balance(db_session, u.id) == 190

    ok = credits_service.refund_for_task(task.id, reason="refund_failed")
    assert ok is True

    with db_session.begin_nested():  # fresh read
        pass
    assert credits_service.get_balance(db_session, u.id) == 200


def test_refund_for_task_is_idempotent(db_session, make_user, make_task):
    u = make_user()
    credits_service.grant(db_session, user_id=u.id, amount=200, reason="grant_signup")
    task = make_task(u)
    credits_service.debit(
        db_session, user=u, amount=10, reason="debit_generate_banner", task_id=task.id
    )
    db_session.commit()

    assert credits_service.refund_for_task(task.id) is True
    # Second call should detect the prior refund and do nothing.
    assert credits_service.refund_for_task(task.id) is False
    assert credits_service.get_balance(db_session, u.id) == 200


def test_refund_for_task_lifo_when_two_debits_attached(db_session, make_user, make_task):
    """A task with both a banner debit AND a render-video debit: the first
    failure should refund the *most recent* debit (LIFO), not the original."""
    u = make_user()
    credits_service.grant(db_session, user_id=u.id, amount=200, reason="grant_signup")
    task = make_task(u)

    # Two debits attached to the same task.
    credits_service.debit(
        db_session, user=u, amount=10, reason="debit_generate_banner", task_id=task.id
    )
    db_session.commit()
    credits_service.debit(
        db_session, user=u, amount=2, reason="debit_render_video", task_id=task.id
    )
    db_session.commit()
    assert credits_service.get_balance(db_session, u.id) == 188

    # First refund returns the most recent (2 credits).
    assert credits_service.refund_for_task(task.id) is True
    assert credits_service.get_balance(db_session, u.id) == 190

    # Second refund returns the older 10-credit debit.
    assert credits_service.refund_for_task(task.id) is True
    assert credits_service.get_balance(db_session, u.id) == 200

    # Third refund: nothing left.
    assert credits_service.refund_for_task(task.id) is False


def test_monthly_refill_tops_up_only_when_due(db_session, make_user):
    from datetime import datetime, timedelta, timezone

    from models import UserCredits

    u = make_user()
    # Start at 0 — first call should bump to MONTHLY_REFILL_AMOUNT.
    new_bal = credits_service.apply_monthly_refill_if_due(db_session, u.id)
    db_session.commit()
    assert new_bal == credits_service.MONTHLY_REFILL_AMOUNT

    # Second call within 30 days → unchanged.
    new_bal2 = credits_service.apply_monthly_refill_if_due(db_session, u.id)
    db_session.commit()
    assert new_bal2 == credits_service.MONTHLY_REFILL_AMOUNT

    # Wind ``last_refill_at`` back 31 days → next call should top up again.
    row = db_session.get(UserCredits, u.id)
    row.last_refill_at = datetime.now(timezone.utc) - timedelta(days=31)
    db_session.commit()

    new_bal3 = credits_service.apply_monthly_refill_if_due(db_session, u.id)
    db_session.commit()
    assert new_bal3 == min(
        credits_service.MONTHLY_REFILL_CEILING,
        credits_service.MONTHLY_REFILL_AMOUNT * 2,
    )


def test_cost_table_is_sane():
    """Lock in the cost contract — accidental tweaks below should fail loudly."""
    assert credits_service.cost_for_banner() == 10
    assert credits_service.cost_for_video_render() == 2
    assert credits_service.cost_for_re_render() == 5
    assert credits_service.cost_for_ugc("15s") == 50
    assert credits_service.cost_for_ugc("30s") == 100
    assert credits_service.cost_for_ugc("50s") == 150
    # Unknown length falls back to the default tier.
    assert credits_service.cost_for_ugc("bogus") == 100
    assert credits_service.cost_for_ugc(None) == 100
