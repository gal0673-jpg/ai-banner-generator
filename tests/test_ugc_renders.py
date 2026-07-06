"""Tests for the normalized ugc_renders table + dual-write mirror."""

from __future__ import annotations

import pytest

from services import banner_service
from services import ugc_renders as renders


def test_legacy_to_normalized_mapping_is_complete():
    """Every per-aspect URL column on UgcVideoData has a mapping."""
    expected_keys = {
        "ugc_composited_video_url",
        "ugc_composited_video_url_1_1",
        "ugc_composited_video_url_16_9",
        "ugc_final_video_url",
        "ugc_final_video_url_1_1",
        "ugc_final_video_url_16_9",
    }
    for k in expected_keys:
        mapping = renders.legacy_column_to_normalized(k)
        assert mapping is not None, k
        aspect, kind = mapping
        assert aspect in ("9:16", "1:1", "16:9")
        assert kind in ("composited", "final")

    # Non-URL UGC keys must NOT have a mapping.
    for k in ("ugc_status", "ugc_avatar_id", "ugc_speed_factor"):
        assert renders.legacy_column_to_normalized(k) is None


def test_set_render_url_inserts_when_absent(db_session, make_user, make_task):
    u = make_user()
    t = make_task(u)
    renders.set_render_url(
        db_session,
        task_id=t.id,
        aspect_ratio="9:16",
        kind="final",
        url="/task-files/x.mp4",
    )
    db_session.commit()

    from models import UgcRenderArtifact

    row = db_session.get(UgcRenderArtifact, (t.id, "9:16", "final"))
    assert row is not None
    assert row.url == "/task-files/x.mp4"


def test_set_render_url_updates_existing_row(db_session, make_user, make_task):
    u = make_user()
    t = make_task(u)
    renders.set_render_url(db_session, task_id=t.id, aspect_ratio="1:1", kind="composited", url="/v1.mp4")
    db_session.commit()
    renders.set_render_url(db_session, task_id=t.id, aspect_ratio="1:1", kind="composited", url="/v2.mp4")
    db_session.commit()

    from models import UgcRenderArtifact

    row = db_session.get(UgcRenderArtifact, (t.id, "1:1", "composited"))
    assert row is not None
    assert row.url == "/v2.mp4"


def test_set_render_url_empty_string_deletes_row(db_session, make_user, make_task):
    u = make_user()
    t = make_task(u)
    renders.set_render_url(db_session, task_id=t.id, aspect_ratio="16:9", kind="final", url="/v.mp4")
    db_session.commit()
    renders.set_render_url(db_session, task_id=t.id, aspect_ratio="16:9", kind="final", url="")
    db_session.commit()

    from models import UgcRenderArtifact

    assert db_session.get(UgcRenderArtifact, (t.id, "16:9", "final")) is None


def test_dual_write_via_persist_task(db_session, make_user, make_task):
    """When persist_task sets a per-aspect URL column, ugc_renders should also gain a row."""
    u = make_user()
    t = make_task(u)

    banner_service.persist_task(t.id, ugc_final_video_url_1_1="/final/1_1.mp4")

    db_session.expire_all()
    from models import UgcRenderArtifact, UgcVideoData

    # Legacy column still authoritative
    ugc = db_session.get(UgcVideoData, t.id)
    assert ugc is not None
    assert ugc.ugc_final_video_url_1_1 == "/final/1_1.mp4"

    # Mirror row in the normalized table
    mirror = db_session.get(UgcRenderArtifact, (t.id, "1:1", "final"))
    assert mirror is not None
    assert mirror.url == "/final/1_1.mp4"


def test_dual_write_ignores_non_url_ugc_keys(db_session, make_user, make_task):
    """Setting ``ugc_status`` should NOT create a ugc_renders row."""
    u = make_user()
    t = make_task(u)
    banner_service.persist_task(t.id, ugc_status="completed")
    db_session.expire_all()

    from models import UgcRenderArtifact
    from sqlalchemy import select

    rows = db_session.execute(
        select(UgcRenderArtifact).where(UgcRenderArtifact.banner_task_id == t.id)
    ).scalars().all()
    assert rows == []


def test_default_aspect_url_maps_to_9_16(db_session, make_user, make_task):
    """The legacy un-suffixed columns historically meant 9:16. Lock that in."""
    u = make_user()
    t = make_task(u)
    banner_service.persist_task(t.id, ugc_composited_video_url="/composited.mp4")
    db_session.expire_all()

    from models import UgcRenderArtifact

    mirror = db_session.get(UgcRenderArtifact, (t.id, "9:16", "composited"))
    assert mirror is not None
    assert mirror.url == "/composited.mp4"
