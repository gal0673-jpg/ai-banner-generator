"""Banner task filesystem paths, DB persistence helpers, and status payloads."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any, Literal

from database import SessionLocal
from main import BASE_DIR
from models import BannerTask

TASKS_DIR: Path = BASE_DIR / "tasks"

TaskStatus = Literal["pending", "scraped", "generating_image", "completed", "failed"]


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


def banner_task_status_dict(task_id: str, row: BannerTask) -> dict[str, Any]:
    """Full task payload for REST status, SSE, and /banners/latest (includes url/brief for form restore)."""
    fs1, fs2 = rendered_banner_urls_for_task(task_id)
    status_val: TaskStatus = row.status  # type: ignore[assignment]
    return {
        "task_id": task_id,
        "task_kind": getattr(row, "task_kind", None) or "banner",
        "url": row.url,
        "brief": row.brief,
        "status": status_val,
        "error": row.error,
        "headline": row.headline,
        "subhead": row.subhead,
        "bullet_points": row.bullet_points,
        "cta": row.cta,
        "video_hook": row.video_hook,
        "brand_color": row.brand_color,
        "background_url": row.background_url,
        "logo_url": row.logo_url,
        "product_image_url": getattr(row, "product_image_url", None),
        "rendered_banner_1_url": row.rendered_banner_1_url or fs1,
        "rendered_banner_2_url": row.rendered_banner_2_url or fs2,
        "canvas_state": row.canvas_state,
        "video_url_1": row.video_url_1,
        "video_url_2": row.video_url_2,
        "rendered_banner_1_vertical_url": row.rendered_banner_1_vertical_url,
        "rendered_banner_2_vertical_url": row.rendered_banner_2_vertical_url,
        "video_url_1_vertical": row.video_url_1_vertical,
        "video_url_2_vertical": row.video_url_2_vertical,
        "video_status": row.video_status,
        "video_render_error": row.video_render_error,
        "ugc_script": row.ugc_script,
        "ugc_avatar_id": row.ugc_avatar_id,
        "ugc_raw_video_url": row.ugc_raw_video_url,
        "ugc_composited_video_url": row.ugc_composited_video_url,
        "ugc_composite_note": row.ugc_composite_note,
        "ugc_final_video_url": getattr(row, "ugc_final_video_url", None),
        "ugc_final_video_url_1_1": getattr(row, "ugc_final_video_url_1_1", None),
        "ugc_final_video_url_16_9": getattr(row, "ugc_final_video_url_16_9", None),
        "ugc_website_display": getattr(row, "ugc_website_display", None),
        "ugc_status": row.ugc_status,
        "ugc_error": row.ugc_error,
        "ugc_speed_factor": getattr(row, "ugc_speed_factor", None),
        "ugc_video_fit_mode": getattr(row, "ugc_video_fit_mode", None),
    }


def persist_task(task_uuid: uuid.UUID, **kwargs: Any) -> None:
    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None:
            return
        for key, value in kwargs.items():
            setattr(row, key, value)
        db.commit()


def merge_canvas_state(prev: Any, patch: dict[str, Any] | None) -> dict[str, Any] | None:
    """Merge partial canvas_state from PATCH; replace any known design key when provided."""
    if patch is None:
        return prev if isinstance(prev, dict) else None
    base: dict[str, Any] = dict(prev) if isinstance(prev, dict) else {}
    for key in ("v", "design1", "design2", "design1_vertical", "design2_vertical"):
        if key in patch:
            base[key] = patch[key]
    return base or None
