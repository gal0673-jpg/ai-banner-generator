"""Banner task filesystem paths, DB persistence helpers, and status payloads."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.orm import Session

from database import SessionLocal
from main import BASE_DIR
from models import BannerCreativeData, BannerTask, UgcVideoData

logger = logging.getLogger(__name__)

TASKS_DIR: Path = BASE_DIR / "tasks"

TaskStatus = Literal["pending", "scraped", "generating_image", "completed", "failed"]

# Keys routed to ``BannerCreativeData`` (was denormalized on ``banner_tasks``).
_CREATIVE_KEYS: frozenset[str] = frozenset(
    {
        "headline",
        "subhead",
        "bullet_points",
        "cta",
        "video_hook",
        "brand_color",
        "background_url",
        "logo_url",
        "product_image_url",
        "rendered_banner_1_url",
        "rendered_banner_2_url",
        "canvas_state",
        "video_url_1",
        "video_url_2",
        "rendered_banner_1_vertical_url",
        "rendered_banner_2_vertical_url",
        "video_url_1_vertical",
        "video_url_2_vertical",
        "video_status",
        "video_render_error",
    }
)

# Keys routed to ``UgcVideoData``.
_UGC_KEYS: frozenset[str] = frozenset(
    {
        "ugc_script",
        "ugc_avatar_id",
        "ugc_raw_video_url",
        "ugc_composited_video_url",
        "ugc_composite_note",
        "ugc_final_video_url",
        "ugc_composited_video_url_1_1",
        "ugc_final_video_url_1_1",
        "ugc_composited_video_url_16_9",
        "ugc_final_video_url_16_9",
        "ugc_website_display",
        "ugc_status",
        "ugc_error",
        "ugc_speed_factor",
        "ugc_video_fit_mode",
    }
)


def ensure_tasks_dir() -> None:
    TASKS_DIR.mkdir(parents=True, exist_ok=True)


def rendered_banner_urls_for_task(task_id: str) -> tuple[str | None, str | None]:
    """Resolve static URLs for Design 1 / Design 2 PNGs; fall back to legacy rendered_banner.png for v1."""
    work = TASKS_DIR / task_id
    u1: str | None = None
    u2: str | None = None
    if (work / "rendered_banner_1.png").is_file():
        u1 = f"/task-files/{task_id}/rendered_banner_1.png"
    elif (work / "rendered_banner.png").is_file():
        u1 = f"/task-files/{task_id}/rendered_banner.png"
    if (work / "rendered_banner_2.png").is_file():
        u2 = f"/task-files/{task_id}/rendered_banner_2.png"
    return u1, u2


def get_creative_for_write(db: Session, row: BannerTask) -> BannerCreativeData:
    """Return the 1:1 creative row, inserting an empty one when missing."""
    existing = db.get(BannerCreativeData, row.id)
    if existing is not None:
        return existing
    child = BannerCreativeData(banner_task_id=row.id)
    db.add(child)
    db.flush()
    return child


def get_ugc_for_write(db: Session, row: BannerTask) -> UgcVideoData:
    """Return the 1:1 UGC row, inserting an empty one when missing."""
    existing = db.get(UgcVideoData, row.id)
    if existing is not None:
        return existing
    child = UgcVideoData(banner_task_id=row.id)
    db.add(child)
    db.flush()
    return child


def banner_task_status_dict(task_id: str, row: BannerTask) -> dict[str, Any]:
    """Full task payload for REST status, SSE, and /banners/latest (includes url/brief for form restore)."""
    fs1, fs2 = rendered_banner_urls_for_task(task_id)
    status_val: TaskStatus = row.status  # type: ignore[assignment]
    c = row.creative
    u = row.ugc_video
    return {
        "task_id": task_id,
        "task_kind": getattr(row, "task_kind", None) or "banner",
        "url": row.url,
        "brief": row.brief,
        "status": status_val,
        "error": row.error,
        "headline": c.headline if c else None,
        "subhead": c.subhead if c else None,
        "bullet_points": c.bullet_points if c else None,
        "cta": c.cta if c else None,
        "video_hook": c.video_hook if c else None,
        "brand_color": c.brand_color if c else None,
        "background_url": c.background_url if c else None,
        "logo_url": c.logo_url if c else None,
        "product_image_url": c.product_image_url if c else None,
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
        "ugc_script": u.ugc_script if u else None,
        "ugc_avatar_id": u.ugc_avatar_id if u else None,
        "ugc_raw_video_url": u.ugc_raw_video_url if u else None,
        "ugc_composited_video_url": u.ugc_composited_video_url if u else None,
        "ugc_composite_note": u.ugc_composite_note if u else None,
        "ugc_final_video_url": u.ugc_final_video_url if u else None,
        "ugc_final_video_url_1_1": u.ugc_final_video_url_1_1 if u else None,
        "ugc_final_video_url_16_9": u.ugc_final_video_url_16_9 if u else None,
        "ugc_website_display": u.ugc_website_display if u else None,
        "ugc_status": u.ugc_status if u else None,
        "ugc_error": u.ugc_error if u else None,
        "ugc_speed_factor": u.ugc_speed_factor if u else None,
    }


def _apply_task_field_updates(db: Session, row: BannerTask, kwargs: dict[str, Any]) -> None:
    creative: BannerCreativeData | None = None
    ugc: UgcVideoData | None = None
    for key, value in kwargs.items():
        if key in _CREATIVE_KEYS:
            if creative is None:
                creative = get_creative_for_write(db, row)
            setattr(creative, key, value)
        elif key in _UGC_KEYS:
            if ugc is None:
                ugc = get_ugc_for_write(db, row)
            setattr(ugc, key, value)
        else:
            setattr(row, key, value)


def _publish_safe(task_id: str, payload: dict[str, Any]) -> None:
    """Publish a task-status snapshot to Redis Pub/Sub, swallowing all errors."""
    try:
        from services.redis_pubsub import publish_task_update  # local import avoids circular deps

        publish_task_update(task_id, payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[banner_service] pub/sub publish failed for %s: %s", task_id, exc)


def persist_task(task_uuid: uuid.UUID, **kwargs: Any) -> None:
    """Persist field updates to the DB, then broadcast the new status via Redis Pub/Sub."""
    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None:
            return
        _apply_task_field_updates(db, row, kwargs)
        db.commit()
        # Reload the row (and its relationships) while the session is still open
        # so we can build the full status snapshot for Pub/Sub broadcast.
        db.refresh(row)
        _ = row.creative    # trigger lazy-load of the one-to-one relationship
        _ = row.ugc_video
        payload = banner_task_status_dict(str(task_uuid), row)

    _publish_safe(str(task_uuid), payload)


def persist_video_task_state(task_uuid: uuid.UUID, **kwargs: Any) -> None:
    """Update creative-row fields used by the banner Remotion video render (``video_status``, URLs, errors)."""
    persist_task(task_uuid, **kwargs)


def merge_canvas_state(prev: Any, patch: dict[str, Any] | None) -> dict[str, Any] | None:
    """Merge partial canvas_state from PATCH; replace any known design key when provided."""
    if patch is None:
        return prev if isinstance(prev, dict) else None
    base: dict[str, Any] = dict(prev) if isinstance(prev, dict) else {}
    for key in ("v", "design1", "design2", "design1_vertical", "design2_vertical"):
        if key in patch:
            base[key] = patch[key]
    return base or None
