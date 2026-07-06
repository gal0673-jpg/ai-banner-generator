"""Banner generation, status, editing, and video render queue routes."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from auth import get_current_user
from database import SessionLocal, get_db
from models import BannerTask, BusinessProfile, UgcVideoData, User
from schemas import (
    GenerateRequest,
    GenerateUGCRequest,
    RenderVideoRequest,
    TaskPatchRequest,
    UgcReRenderRequest,
)
from services import credits as credits_service
from services.banner_service import (
    TASKS_DIR,
    banner_task_status_dict,
    ensure_tasks_dir,
    get_creative_for_write,
    get_ugc_for_write,
    merge_canvas_state,
    persist_task,
    persist_video_task_state,
    rendered_banner_urls_for_task,
)
from services.upload_validation import validate_upload_content
from services.url_display import normalize_website_display
from services.video_service import public_api_base, video_payload_for_engine
from worker_tasks import re_render_ugc_task, render_video_task, run_banner_task, run_ugc_task

router = APIRouter(tags=["banners"])

_BRAND_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MAX_TEMP_UPLOAD_BYTES = 20 * 1024 * 1024
_ALLOWED_TEMP_SUFFIXES = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".mp4", ".webm", ".mov"}
)


@router.post("/generate")
def generate(
    body: GenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    # When a saved BusinessProfile is referenced, the worker seeds the job from
    # its cached context + logo and skips the crawl — so url becomes optional.
    profile_id = body.business_profile_id
    profile: BusinessProfile | None = None
    if profile_id is not None:
        profile = db.get(BusinessProfile, profile_id)
        if profile is None or (
            not current_user.is_superuser and profile.user_id != current_user.id
        ):
            raise HTTPException(status_code=404, detail="Unknown business profile")

    url = (body.url or "").strip()
    if not url and profile is not None:
        url = (profile.website_url or "").strip() or "https://business-profile.internal/no-crawl"
    if not url:
        raise HTTPException(status_code=400, detail="url must not be empty")

    brief = (body.brief or "").strip() or None

    # Atomic: create task row + debit credits in the same transaction. If the
    # debit fails (insufficient credits) we never touch banner_tasks.
    task_id = uuid.uuid4()
    cost = credits_service.cost_for_banner()
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        task_kind="banner",
        url=url,
        brief=brief,
        error=None,
        business_profile_id=profile.id if profile is not None else None,
    )
    db.add(row)
    db.flush()  # make task_id visible to ledger FK before debit
    try:
        credits_service.debit(
            db,
            user=current_user,
            amount=cost,
            reason="debit_generate_banner",
            task_id=task_id,
        )
    except credits_service.InsufficientCreditsError as exc:
        db.rollback()
        raise credits_service.insufficient_credits_http(exc) from None
    db.commit()

    tid = str(task_id)
    try:
        run_banner_task.apply_async(
            args=[tid, url, brief, body.video_hook],
            kwargs={"business_profile_id": str(profile.id) if profile is not None else None},
            queue="banner_queue",
        )
    except Exception as exc:
        # Enqueue failed → refund and mark task failed so the user isn't charged.
        credits_service.refund(
            current_user.id, cost, reason="refund_enqueue_failed", task_id=task_id
        )
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
    cost = credits_service.cost_for_ugc(body.video_length)
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        task_kind="ugc_legacy",
        url=url,
        brief=brief,
        error=None,
    )
    ugc_row = UgcVideoData(
        banner_task_id=task_id,
        ugc_avatar_id=avatar_id,
        ugc_website_display=website_disp,
        ugc_status="pending",
    )
    row.ugc_video = ugc_row
    db.add(row)
    db.flush()
    try:
        credits_service.debit(
            db,
            user=current_user,
            amount=cost,
            reason=f"debit_generate_ugc_{body.video_length}",
            task_id=task_id,
        )
    except credits_service.InsufficientCreditsError as exc:
        db.rollback()
        raise credits_service.insufficient_credits_http(exc) from None
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
                "aspect_ratio": body.aspect_ratio,
            },
            queue="video_queue",
        )
    except Exception as exc:
        credits_service.refund(
            current_user.id, cost, reason="refund_enqueue_failed", task_id=task_id
        )
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


@router.post("/upload-temp-asset")
async def upload_temp_asset(
    _current_user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = File(...),
) -> dict[str, str]:
    """Save a generic asset under ``tasks/temp/`` for use as logo/product URL.

    Two-stage validation:
      1. Suffix must be in ``_ALLOWED_TEMP_SUFFIXES`` (cheap pre-check).
      2. Bytes must match a real header for that suffix — see
         ``services.upload_validation.validate_upload_content`` for the magic-byte
         rules (PIL for images, ISO-BMFF / EBML for video, scrubbed SVG).

    Without (2) anyone could rename ``evil.html`` to ``evil.png`` and have it
    served back as a same-origin static file.
    """
    ensure_tasks_dir()
    temp_dir = TASKS_DIR / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    raw_name = (file.filename or "upload").replace("\\", "/").split("/")[-1]
    suffix = Path(raw_name).suffix.lower()
    if suffix not in _ALLOWED_TEMP_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file extension {suffix or '(missing)'}. "
                   "Allowed: PNG, JPG, JPEG, WEBP, GIF, SVG, AVIF, MP4, WEBM, MOV.",
        )

    body = await file.read()
    if len(body) > _MAX_TEMP_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20MB).")
    if not body:
        raise HTTPException(status_code=400, detail="Empty file.")

    # Magic-byte check — raises HTTPException(415) on mismatch.
    validated_suffix = validate_upload_content(body, suffix)

    name = f"{uuid.uuid4().hex}{validated_suffix}"
    dest = temp_dir / name
    dest.write_bytes(body)

    return {"url": f"/task-files/temp/{name}"}


@router.post("/tasks/{task_id}/ugc/re-render")
def ugc_re_render(
    task_id: str,
    body: UgcReRenderRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Re-run FFmpeg composite + Remotion using ``ugc_raw_video_url`` (no provider re-gen)."""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    row = db.get(BannerTask, tid)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    if not current_user.is_superuser and row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Unknown task_id")

    ugc = row.ugc_video
    raw = ((ugc.ugc_raw_video_url if ugc else None) or "").strip()
    if not raw:
        raise HTTPException(
            status_code=400,
            detail="No ugc_raw_video_url on this task; nothing to re-render from.",
        )
    if ugc and ugc.ugc_status == "rendering_captions":
        raise HTTPException(
            status_code=409,
            detail="A caption render is already in progress for this task.",
        )

    ugc_w = get_ugc_for_write(db, row)
    creative = get_creative_for_write(db, row)

    patch = body.model_dump(exclude_unset=True)
    if "ugc_script" in patch:
        ugc_w.ugc_script = patch["ugc_script"]
    if "brand_color" in patch:
        bc = patch["brand_color"]
        if bc is None or (isinstance(bc, str) and not str(bc).strip()):
            creative.brand_color = None
        else:
            s = str(bc).strip()
            if not _BRAND_HEX.match(s):
                raise HTTPException(status_code=400, detail="brand_color must be #RRGGBB hex.")
            creative.brand_color = s.upper()
    if "logo_url" in patch:
        lu = patch["logo_url"]
        creative.logo_url = (str(lu).strip() or None) if lu is not None else None
    if "product_image_url" in patch:
        pi = patch["product_image_url"]
        creative.product_image_url = (str(pi).strip() or None) if pi is not None else None
    if "speed_factor" in patch:
        ugc_w.ugc_speed_factor = patch["speed_factor"]

    _style_patch_keys = ("caption_animation", "caption_position", "caption_font")
    if any(k in patch for k in _style_patch_keys):
        base = ugc_w.ugc_script if isinstance(ugc_w.ugc_script, dict) else {}
        style = dict(base.get("style") or {})
        if "caption_animation" in patch:
            v = patch["caption_animation"]
            if v is not None:
                style["animation"] = v
        if "caption_position" in patch:
            v = patch["caption_position"]
            if v is not None:
                style["position"] = v
        if "caption_font" in patch:
            v = patch["caption_font"]
            if v is not None:
                style["font"] = v
        ugc_w.ugc_script = {**base, "style": style}

    ugc_w.ugc_status = "rendering_captions"
    ugc_w.ugc_error = None

    cost = credits_service.cost_for_re_render()
    try:
        credits_service.debit(
            db,
            user=current_user,
            amount=cost,
            reason="debit_ugc_re_render",
            task_id=tid,
        )
    except credits_service.InsufficientCreditsError as exc:
        db.rollback()
        raise credits_service.insufficient_credits_http(exc) from None
    db.commit()

    try:
        re_render_ugc_task.apply_async(
            args=[task_id, body.aspect_ratio], queue="video_queue"
        )
    except Exception as exc:
        credits_service.refund(
            current_user.id, cost, reason="refund_enqueue_failed", task_id=tid
        )
        persist_task(tid, ugc_status="failed", ugc_error=f"Could not queue UGC re-render: {exc}")
        raise HTTPException(
            status_code=503,
            detail="לא ניתן לשלוח את עריכת ה-UGC לתור (Celery). ודא ש-Redis רץ וה-worker פעיל.",
        ) from exc

    return {"status": "queued", "task_id": task_id}


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


# SSE safety caps. Without these, a stuck-in-pending task plus a quiet client
# can pin one connection + DB session per browser tab indefinitely.
_SSE_POLL_INTERVAL_S = 1.5      # how often we re-check the DB
_SSE_HEARTBEAT_INTERVAL_S = 15   # SSE comment frame to keep proxies / clients alive
_SSE_MAX_DURATION_S = 600        # hard cap; client should reconnect (or use WS)


@router.get("/status/{task_id}/stream")
async def stream_task_status(
    task_id: str,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """Stream live task-status updates as Server-Sent Events (text/event-stream).

    Three safety caps protect against the pre-fix bug where a stuck task could
    leak DB connections forever:

    1. ``_SSE_MAX_DURATION_S`` — hard cap (10 min) per connection. Clients are
       expected to reconnect, or to use ``/ws/task/{id}`` (the WebSocket path is
       cheaper and supports multi-hour render jobs).
    2. ``_SSE_HEARTBEAT_INTERVAL_S`` — every 15 s we emit an SSE comment so
       reverse proxies (nginx, ALB) don't reap the connection as idle, AND so
       ``request.is_disconnected()`` has a chance to surface client closes.
    3. ``request.is_disconnected()`` — checked on every loop iteration; if the
       client has gone away, we exit instead of polling the DB forever.
    """
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
        deadline = asyncio.get_running_loop().time() + _SSE_MAX_DURATION_S
        last_heartbeat = asyncio.get_running_loop().time()

        while True:
            now = asyncio.get_running_loop().time()

            # ── (1) Hard duration cap — signal client + exit cleanly ──────────
            if now >= deadline:
                yield (
                    "event: timeout\n"
                    f"data: {json.dumps({'reason': 'max-duration', 'after_s': _SSE_MAX_DURATION_S})}\n\n"
                )
                break

            # ── (2) Client gone — stop polling the DB ─────────────────────────
            if await request.is_disconnected():
                break

            # ── (3) Poll DB and yield only on changes ─────────────────────────
            with SessionLocal() as db:
                row = db.get(BannerTask, tid)
                if row is None:
                    break
                payload = banner_task_status_dict(task_id, row)
                blob = json.dumps(payload, sort_keys=True, default=str)

            if blob != last_payload_json:
                last_payload_json = blob
                yield f"data: {blob}\n\n"
                last_heartbeat = now  # real data counts as a keepalive
            elif (now - last_heartbeat) >= _SSE_HEARTBEAT_INTERVAL_S:
                # SSE comments (lines starting with ":") are ignored by EventSource
                # but keep proxies happy and unblock the await below to re-check
                # is_disconnected promptly.
                yield ": heartbeat\n\n"
                last_heartbeat = now

            current_status = payload["status"]
            video_st = payload.get("video_status")
            if current_status == "failed":
                break
            if current_status == "completed" and video_st != "processing":
                break

            await asyncio.sleep(_SSE_POLL_INTERVAL_S)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
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

    creative = get_creative_for_write(db, row)
    if body.headline is not None:
        creative.headline = body.headline.strip() or None
    if body.subhead is not None:
        creative.subhead = body.subhead.strip() or None
    if body.cta is not None:
        creative.cta = body.cta.strip() or None
    if body.bullet_points is not None:
        creative.bullet_points = body.bullet_points
    if body.video_hook is not None:
        creative.video_hook = body.video_hook.strip() or None

    if body.canvas_state is not None:
        creative.canvas_state = merge_canvas_state(creative.canvas_state, body.canvas_state)

    db.commit()
    db.refresh(row)

    return {
        "task_id": task_id,
        "headline": creative.headline,
        "subhead": creative.subhead,
        "bullet_points": creative.bullet_points,
        "cta": creative.cta,
        "video_hook": creative.video_hook,
        "canvas_state": creative.canvas_state,
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
    creative = get_creative_for_write(db, row)
    if creative.video_status == "processing":
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

    creative.video_status = "processing"
    creative.video_render_error = None

    cost = credits_service.cost_for_video_render()
    try:
        credits_service.debit(
            db,
            user=current_user,
            amount=cost,
            reason="debit_render_video",
            task_id=tid,
        )
    except credits_service.InsufficientCreditsError as exc:
        db.rollback()
        raise credits_service.insufficient_credits_http(exc) from None
    db.commit()

    try:
        render_video_task.apply_async(
            args=[task_id, int(body.design_type), str(body.aspect_ratio), public_base],
            queue="video_queue",
        )
    except Exception as exc:
        credits_service.refund(
            current_user.id, cost, reason="refund_enqueue_failed", task_id=tid
        )
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
    creative = get_creative_for_write(db, row)
    if creative.video_status != "processing":
        raise HTTPException(
            status_code=409,
            detail="Video render is not marked as processing; nothing to reset.",
        )

    creative.video_status = None
    creative.video_render_error = None
    db.commit()
    db.refresh(row)
    return banner_task_status_dict(task_id, row)
