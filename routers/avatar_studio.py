"""Avatar studio: marketing talking-head videos from prompts only (no site crawl)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import BannerTask, User
from schemas import GenerateAvatarStudioRequest
from services.banner_service import persist_task
from services.url_display import normalize_website_display
from worker_tasks import run_avatar_studio_task

router = APIRouter(tags=["avatar-studio"])

# Stored on BannerTask.url (required non-null) — not used for crawling in this flow.
AVATAR_STUDIO_URL_PLACEHOLDER = "https://avatar-studio.internal/no-crawl"


@router.post("/avatar-studio/generate")
def generate_avatar_studio(
    body: GenerateAvatarStudioRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Enqueue avatar studio job. Poll ``/status/{task_id}`` for ``ugc_*`` fields."""
    avatar_id = body.avatar_id.strip()
    if not avatar_id:
        raise HTTPException(status_code=400, detail="avatar_id must not be empty")

    voice_id = (body.voice_id or "").strip() or None

    summary_brief: str | None = None
    if body.script_source == "from_brief_ai":
        summary_brief = (body.creative_brief or "").strip() or None
    else:
        summary_brief = (body.spoken_script or "").strip() or None
    if summary_brief and len(summary_brief) > 12000:
        summary_brief = summary_brief[:12000]

    website_disp = normalize_website_display(body.website_url)

    task_id = uuid.uuid4()
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        task_kind="avatar_studio",
        url=AVATAR_STUDIO_URL_PLACEHOLDER,
        brief=summary_brief,
        ugc_avatar_id=avatar_id,
        ugc_website_display=website_disp,
        ugc_status="pending",
        error=None,
        headline=None,
        subhead=None,
        bullet_points=None,
        cta=None,
        video_hook=None,
        brand_color=None,
        background_url=None,
        logo_url=body.logo_url,
        product_image_url=body.product_image_url,
        rendered_banner_1_url=None,
        rendered_banner_2_url=None,
        canvas_state=None,
        video_url_1=None,
        video_url_2=None,
        rendered_banner_1_vertical_url=None,
        rendered_banner_2_vertical_url=None,
        video_url_1_vertical=None,
        video_url_2_vertical=None,
    )
    db.add(row)
    db.commit()

    tid = str(task_id)
    try:
        run_avatar_studio_task.apply_async(
            args=[tid, avatar_id, body.video_length],
            kwargs={
                "provider": body.provider,
                "voice_id": voice_id,
                "script_source": body.script_source,
                "creative_brief": body.creative_brief,
                "director_notes": body.director_notes,
                "spoken_script": body.spoken_script,
                "heygen_character_type": body.heygen_character_type,
            },
            queue="video_queue",
        )
    except Exception as exc:
        persist_task(
            task_id,
            ugc_status="failed",
            ugc_error=str(exc),
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "לא ניתן לשלוח את משימת סטודיו האווטאר לתור (Celery). "
                "ודא ש-Redis רץ וה-worker פעיל."
            ),
        ) from exc

    return {"task_id": tid}
