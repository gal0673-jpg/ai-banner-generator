"""Banner generation, status, editing, and video render queue routes."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from auth import get_current_user
from database import SessionLocal, get_db
from models import BannerTask, User
from schemas import GenerateRequest, GenerateUGCRequest, RenderVideoRequest, TaskPatchRequest
from services.banner_service import (
    banner_task_status_dict,
    merge_canvas_state,
    persist_task,
    rendered_banner_urls_for_task,
)
from services.url_display import normalize_website_display
from services.video_service import public_api_base, video_payload_for_engine
from worker_tasks import persist_video_task_state, render_video_task, run_banner_task, run_ugc_task

router = APIRouter(tags=["banners"])


@router.post("/generate")
def generate(
    body: GenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url must not be empty")

    brief = (body.brief or "").strip() or None

    task_id = uuid.uuid4()
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        task_kind="banner",
        url=url,
        brief=brief,
        error=None,
        headline=None,
        subhead=None,
        bullet_points=None,
        cta=None,
        video_hook=None,
        brand_color=None,
        background_url=None,
        logo_url=None,
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
        run_banner_task.apply_async(
            args=[tid, url, brief, body.video_hook],
            queue="banner_queue",
        )
    except Exception as exc:
        persist_task(task_id, status="failed", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail=(
                "לא ניתן לשלוח את המשימה לתור (Celery). ודא ש-Redis רץ (למשל ב-Laragon) "
                "ושה-worker פעיל."
            ),
        ) from exc
    return {"task_id": tid}


@router.post("/generate-ugc")
def generate_ugc(
    body: GenerateUGCRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Create a UGC avatar-video generation task and enqueue it to Celery.

    Returns ``{"task_id": "<uuid>"}`` immediately; callers poll ``/status/{task_id}``
    and inspect the ``ugc_status`` / ``ugc_raw_video_url`` fields.
    """
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url must not be empty")

    brief = (body.brief or "").strip() or None
    custom_script = (body.custom_script or "").strip() or None
    voice_id = (body.voice_id or "").strip() or None
    avatar_id = body.avatar_id.strip()
    if not avatar_id:
        raise HTTPException(status_code=400, detail="avatar_id must not be empty")

    website_disp = normalize_website_display(body.website_url)

    task_id = uuid.uuid4()
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        task_kind="ugc_legacy",
        url=url,
        brief=brief,
        ugc_avatar_id=avatar_id,
        ugc_website_display=website_disp,
        ugc_status="pending",
        # Banner-pipeline fields are not used for UGC tasks; left null.
        error=None,
        headline=None,
        subhead=None,
        bullet_points=None,
        cta=None,
        video_hook=None,
        brand_color=None,
        background_url=None,
        logo_url=None,
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
        run_ugc_task.apply_async(
            args=[tid, url, brief, avatar_id, body.video_length],
            kwargs={
                "provider": body.provider,
                "custom_script": custom_script,
                "voice_id": voice_id,
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
                "לא ניתן לשלוח את משימת UGC לתור (Celery). "
                "ודא ש-Redis רץ וה-worker פעיל."
            ),
        ) from exc

    return {"task_id": tid}


@router.get("/banners/latest")
def get_latest_banner(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Latest banner task for the current user (by created_at), or task_id null when none."""
    stmt = (
        select(BannerTask)
        .where(BannerTask.user_id == current_user.id)
        .where(BannerTask.task_kind == "banner")
        .order_by(BannerTask.created_at.desc())
        .limit(1)
    )
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        return {"task_id": None, "url": None, "brief": None}
    return banner_task_status_dict(str(row.id), row)


@router.get("/status/{task_id}")
def get_status(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    row = db.get(BannerTask, tid)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if not current_user.is_superuser and row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Unknown task_id")

    return banner_task_status_dict(task_id, row)


@router.get("/status/{task_id}/stream")
async def stream_task_status(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """Stream live task-status updates as Server-Sent Events (text/event-stream)."""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    with SessionLocal() as db:
        row = db.get(BannerTask, tid)
        if row is None or (not current_user.is_superuser and row.user_id != current_user.id):
            raise HTTPException(status_code=404, detail="Unknown task_id")

    async def event_generator():
        last_payload_json: str | None = None
        while True:
            with SessionLocal() as db:
                row = db.get(BannerTask, tid)
                if row is None:
                    break
                payload = banner_task_status_dict(task_id, row)
                blob = json.dumps(payload, sort_keys=True, default=str)

            if blob != last_payload_json:
                last_payload_json = blob
                yield f"data: {blob}\n\n"

            current_status = payload["status"]
            video_st = payload.get("video_status")

            if current_status == "failed":
                break
            if current_status == "completed" and video_st != "processing":
                break

            await asyncio.sleep(1.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.patch("/tasks/{task_id}")
def patch_task(
    task_id: str,
    body: TaskPatchRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    row = db.get(BannerTask, tid)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if not current_user.is_superuser and row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if row.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Task can only be edited after it is completed.",
        )

    if body.headline is not None:
        row.headline = body.headline.strip() or None
    if body.subhead is not None:
        row.subhead = body.subhead.strip() or None
    if body.cta is not None:
        row.cta = body.cta.strip() or None
    if body.bullet_points is not None:
        row.bullet_points = body.bullet_points
    if body.video_hook is not None:
        row.video_hook = body.video_hook.strip() or None

    if body.canvas_state is not None:
        row.canvas_state = merge_canvas_state(row.canvas_state, body.canvas_state)

    db.commit()
    db.refresh(row)

    return {
        "task_id": task_id,
        "headline": row.headline,
        "subhead": row.subhead,
        "bullet_points": row.bullet_points,
        "cta": row.cta,
        "video_hook": row.video_hook,
        "canvas_state": row.canvas_state,
    }


@router.post("/tasks/{task_id}/render-video")
def render_task_video(
    task_id: str,
    body: RenderVideoRequest,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    row = db.get(BannerTask, tid)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if not current_user.is_superuser and row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if row.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Task must be completed before rendering video.",
        )
    if row.video_status == "processing":
        raise HTTPException(
            status_code=409,
            detail="Video render is already in progress for this task.",
        )

    public_base = public_api_base(request)
    payload = video_payload_for_engine(row, body.design_type, public_base, body.aspect_ratio)
    payload["task_id"] = task_id
    if not payload["headline"]:
        raise HTTPException(status_code=400, detail="headline is required for video render.")
    if not payload["background_url"]:
        raise HTTPException(status_code=400, detail="background_url is missing for this task.")

    row.video_status = "processing"
    row.video_render_error = None
    db.commit()

    try:
        render_video_task.apply_async(
            args=[task_id, int(body.design_type), str(body.aspect_ratio), public_base],
            queue="video_queue",
        )
    except Exception as exc:
        persist_video_task_state(
            tid,
            video_status="failed",
            video_render_error=f"Could not queue video render: {exc}",
        )
        raise HTTPException(
            status_code=503,
            detail="לא ניתן לשלוח ייצור וידאו לתור (Celery). ודא ש-Redis רץ וה-worker פעיל.",
        ) from exc

    return {"status": "processing"}


@router.post("/tasks/{task_id}/video-render/reset")
def reset_stuck_video_render(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Clear ``video_status=processing`` when the worker stopped or the job is stuck."""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    row = db.get(BannerTask, tid)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if not current_user.is_superuser and row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if row.status != "completed":
        raise HTTPException(status_code=409, detail="Task must be completed.")
    if row.video_status != "processing":
        raise HTTPException(
            status_code=409,
            detail="Video render is not marked as processing; nothing to reset.",
        )

    row.video_status = None
    row.video_render_error = None
    db.commit()
    db.refresh(row)
    return banner_task_status_dict(task_id, row)
