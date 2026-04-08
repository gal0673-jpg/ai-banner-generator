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
    stmt = select(BannerTask).options(joinedload(BannerTask.user)).order_by(BannerTask.id)
    rows = db.scalars(stmt).unique().all()
    out: list[dict[str, Any]] = []
    for t in rows:
        tid = str(t.id)
        fs1, fs2 = rendered_banner_urls_for_task(tid)
        out.append(
            {
                "task_id": tid,
                "user_id": str(t.user_id),
                "user_email": t.user.email,
                "status": t.status,
                "url": t.url,
                "brief": t.brief,
                "error": t.error,
                "headline": t.headline,
                "subhead": t.subhead,
                "bullet_points": t.bullet_points,
                "cta": t.cta,
                "video_hook": t.video_hook,
                "brand_color": t.brand_color,
                "background_url": t.background_url,
                "logo_url": t.logo_url,
                "rendered_banner_1_url": t.rendered_banner_1_url or fs1,
                "rendered_banner_2_url": t.rendered_banner_2_url or fs2,
                "canvas_state": t.canvas_state,
                "video_url_1": t.video_url_1,
                "video_url_2": t.video_url_2,
                "rendered_banner_1_vertical_url": t.rendered_banner_1_vertical_url,
                "rendered_banner_2_vertical_url": t.rendered_banner_2_vertical_url,
                "video_url_1_vertical": t.video_url_1_vertical,
                "video_url_2_vertical": t.video_url_2_vertical,
                "video_status": t.video_status,
                "video_render_error": t.video_render_error,
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
