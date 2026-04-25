"""Superuser admin routes."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ai_banner_context import OUTPUT_FILENAME, build_document
from auth import get_current_superuser
from database import get_db
from deps import require_primary_admin
from models import BannerTask, User
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
