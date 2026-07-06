"""Tests for services.banner_service helpers — status payload + auto-refund hook."""

from __future__ import annotations

from services import banner_service
from services import credits as credits_service


def test_status_dict_minimum_contract(db_session, make_user, make_task):
    """The status payload must always carry the keys that clients depend on."""
    u = make_user()
    t = make_task(u)

    payload = banner_service.banner_task_status_dict(str(t.id), t)

    # Identity + workflow keys
    assert payload["task_id"] == str(t.id)
    assert payload["task_kind"] == "banner"
    assert payload["url"] == "https://example.com"
    assert payload["status"] == "pending"
    assert payload["error"] is None

    # Creative slots (all start NULL because we didn't write a creative row)
    assert payload["headline"] is None
    assert payload["bullet_points"] is None
    assert payload["rendered_banner_1_url"] is None

    # UGC slots (no ugc row)
    assert payload["ugc_status"] is None
    assert payload["ugc_script"] is None


def test_persist_task_writes_creative_keys(db_session, make_user, make_task):
    """persist_task should route headline/subhead to BannerCreativeData and url back to BannerTask."""
    u = make_user()
    t = make_task(u)

    banner_service.persist_task(
        t.id,
        status="scraped",
        headline="Hello World",
        subhead="A subhead",
    )

    db_session.expire_all()
    from models import BannerCreativeData, BannerTask

    refreshed = db_session.get(BannerTask, t.id)
    creative = db_session.get(BannerCreativeData, t.id)
    assert refreshed.status == "scraped"
    assert creative is not None
    assert creative.headline == "Hello World"
    assert creative.subhead == "A subhead"


def test_persist_task_triggers_refund_on_failure(db_session, make_user, make_task):
    """Marking a task as ``failed`` should auto-refund the most recent debit."""
    u = make_user()
    credits_service.grant(db_session, user_id=u.id, amount=200, reason="grant_signup")
    t = make_task(u)
    credits_service.debit(
        db_session,
        user=u,
        amount=credits_service.cost_for_banner(),
        reason="debit_generate_banner",
        task_id=t.id,
    )
    db_session.commit()
    assert credits_service.get_balance(db_session, u.id) == 200 - credits_service.cost_for_banner()

    # Worker reports failure → status="failed" → auto-refund kicks in.
    banner_service.persist_task(t.id, status="failed", error="something broke")

    db_session.expire_all()
    assert credits_service.get_balance(db_session, u.id) == 200


def test_merge_canvas_state_only_replaces_known_keys():
    prev = {"v": 1, "design1": {"x": 1}, "design2": {"x": 2}}
    patch = {"design1": {"x": 9}}
    merged = banner_service.merge_canvas_state(prev, patch)
    assert merged == {"v": 1, "design1": {"x": 9}, "design2": {"x": 2}}


def test_merge_canvas_state_handles_none():
    assert banner_service.merge_canvas_state(None, None) is None
    assert banner_service.merge_canvas_state({"v": 1}, None) == {"v": 1}
    assert banner_service.merge_canvas_state(None, {"design1": {}}) == {"design1": {}}
