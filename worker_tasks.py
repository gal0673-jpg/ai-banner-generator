"""Celery task definitions (imported by the worker process; keep free of FastAPI app imports)."""

from __future__ import annotations

import atexit
import json
import logging
import os
import re
import signal
import threading
import uuid
from typing import Any

import requests
from celery import Task
from celery.exceptions import SoftTimeLimitExceeded

from celery_app import celery_app
from database import SessionLocal
from main import crawl_from_url, quit_all_active_drivers, run_agency_banner_pipeline
from models import BannerTask
from services.banner_service import TASKS_DIR, persist_task, rendered_banner_urls_for_task
from services.video_service import video_engine_render_url, video_payload_for_engine

logger = logging.getLogger(__name__)

# ── Chrome leak-prevention: guarantee cleanup on any exit path ────────────────
#
# Celery's *soft* time limit raises SoftTimeLimitExceeded inside the running task
# (catchable). The *hard* limit sends SIGKILL — uncatchable — but we register both
# SIGTERM (graceful shutdown) and atexit so we cover as many scenarios as possible.
# SIGKILL survivors (orphaned chrome/chromedriver processes) are the only remainder;
# those must be dealt with at the OS / container level.

_chrome_cleanup_lock = threading.Lock()


def _emergency_chrome_cleanup() -> None:
    """Kill every Chrome instance this process spawned. Idempotent and thread-safe."""
    with _chrome_cleanup_lock:
        try:
            quit_all_active_drivers()
        except Exception:
            pass


atexit.register(_emergency_chrome_cleanup)

# Override SIGTERM only in the main thread; Celery's prefork/gevent pools spawn
# additional threads where signal registration is a no-op or raises ValueError.
if threading.current_thread() is threading.main_thread():
    _prev_sigterm = signal.getsignal(signal.SIGTERM)

    def _sigterm_handler(signum: int, frame: object) -> None:  # noqa: ANN001
        _emergency_chrome_cleanup()
        if callable(_prev_sigterm):
            _prev_sigterm(signum, frame)  # type: ignore[arg-type]
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _sigterm_handler)

_BRAND_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class BannerPipelineFatalError(Exception):
    """Deterministic pipeline failure already written to ``banner_tasks``; Celery must not retry."""


class BannerGenerationTask(Task):
    """Auto-retry transient failures (timeouts, upstream 5xx); fatal errors skip retries."""

    autoretry_for = (Exception,)
    dont_autoretry_for = (BannerPipelineFatalError,)
    retry_backoff = True
    max_retries = 3

    def on_failure(
        self,
        exc: Exception,
        task_id: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        einfo: Any,
    ) -> None:
        if isinstance(exc, BannerPipelineFatalError):
            return
        if not args:
            return
        try:
            task_uuid = uuid.UUID(str(args[0]))
            persist_task(task_uuid, status="failed", error=str(exc))
        except Exception:
            pass


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="run_banner_task",
    queue="banner_queue",
)
def run_banner_task(
    self: BannerGenerationTask,
    task_id: str,
    url: str,
    brief: str | None,
    custom_video_hook: str | None = None,
) -> None:
    task_uuid = uuid.UUID(task_id)
    work_dir = TASKS_DIR / task_id
    work_dir.mkdir(parents=True, exist_ok=True)
    # Move off "pending" as soon as the worker picks up the job — crawl can take minutes.
    persist_task(task_uuid, status="scraped")
    print(f"[run_banner_task] task_id={task_id} status=scraped (crawl starting)", flush=True)

    try:
        crawl_from_url(url, work_dir=work_dir, campaign_brief=brief)
    except SoftTimeLimitExceeded:
        # Celery soft time limit fired inside the crawl.  Chrome may still be alive —
        # kill it before Celery's hard limit sends SIGKILL and leaves orphans.
        _emergency_chrome_cleanup()
        persist_task(
            task_uuid,
            status="failed",
            error="Crawl timed out (Celery soft time limit exceeded).",
        )
        raise  # re-raise so Celery records the exception and stops retrying

    if not os.environ.get("OPENAI_API_KEY"):
        persist_task(task_uuid, status="failed", error="OPENAI_API_KEY is not set")
        raise BannerPipelineFatalError("OPENAI_API_KEY is not set")

    persist_task(task_uuid, status="generating_image")
    run_agency_banner_pipeline(work_dir=work_dir, site_url=url)

    campaign_path = work_dir / "creative_campaign.json"
    background = work_dir / "background.png"
    logo = work_dir / "logo.png"
    if not campaign_path.is_file() or not background.is_file() or not logo.is_file():
        persist_task(
            task_uuid,
            status="failed",
            error="Missing creative_campaign.json, background.png, or logo.png after pipeline.",
        )
        raise BannerPipelineFatalError("Missing creative output files after pipeline.")

    with campaign_path.open(encoding="utf-8") as f:
        data = json.load(f)

    for key in ("headline", "subhead", "cta"):
        if key not in data or not str(data[key]).strip():
            persist_task(
                task_uuid,
                status="failed",
                error=f"Invalid creative_campaign.json: missing or empty {key!r}",
            )
            raise BannerPipelineFatalError(f"Invalid creative_campaign.json: missing or empty {key!r}")

    raw_hook = data.get("video_hook")
    ai_hook: str | None = str(raw_hook).strip()[:256] if raw_hook and str(raw_hook).strip() else None
    video_hook_val: str | None = custom_video_hook or ai_hook
    bullets = data.get("bullet_points")
    if not isinstance(bullets, list) or len(bullets) != 3:
        persist_task(
            task_uuid,
            status="failed",
            error="Invalid creative_campaign.json: bullet_points must be 3 strings.",
        )
        raise BannerPipelineFatalError("Invalid creative_campaign.json: bullet_points must be 3 strings.")

    bc_raw = data.get("brand_color")
    if not isinstance(bc_raw, str) or not bc_raw.strip():
        persist_task(
            task_uuid,
            status="failed",
            error="Invalid creative_campaign.json: missing or empty brand_color.",
        )
        raise BannerPipelineFatalError("Invalid creative_campaign.json: missing or empty brand_color.")
    bc = bc_raw.strip()
    if not bc.startswith("#"):
        bc = "#" + bc
    if not _BRAND_HEX.match(bc):
        persist_task(
            task_uuid,
            status="failed",
            error="Invalid creative_campaign.json: brand_color must be #RRGGBB hex.",
        )
        raise BannerPipelineFatalError("Invalid creative_campaign.json: brand_color must be #RRGGBB hex.")

    rb1, rb2 = rendered_banner_urls_for_task(task_id)
    persist_task(
        task_uuid,
        status="completed",
        error=None,
        headline=str(data["headline"]).strip(),
        subhead=str(data["subhead"]).strip(),
        bullet_points=[str(b).strip() for b in bullets],
        cta=str(data["cta"]).strip(),
        video_hook=video_hook_val,
        brand_color=bc.upper(),
        background_url=f"/task-files/{task_id}/background.png",
        logo_url=f"/task-files/{task_id}/logo.png",
        rendered_banner_1_url=rb1,
        rendered_banner_2_url=rb2,
    )


def persist_video_task_state(task_uuid: uuid.UUID, **kwargs: Any) -> None:
    """Update banner_tasks row fields (video_status, URLs, errors, etc.)."""
    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None:
            return
        for key, value in kwargs.items():
            setattr(row, key, value)
        db.commit()


def execute_video_render_worker(
    task_id: str,
    design_type: int,
    aspect_ratio: str,
    public_base: str,
) -> None:
    """Call the video engine and persist the resulting URL (runs inside Celery worker)."""
    tid = uuid.UUID(task_id)
    render_url = video_engine_render_url()

    with SessionLocal() as db:
        row = db.get(BannerTask, tid)
        if row is None:
            return
        if row.status != "completed":
            row.video_status = "failed"
            row.video_render_error = "Task is not completed; cannot render video."
            db.commit()
            return
        payload = video_payload_for_engine(row, design_type, public_base, aspect_ratio)
        payload["task_id"] = task_id
        if not payload["headline"]:
            row.video_status = "failed"
            row.video_render_error = "headline is required for video render."
            db.commit()
            return
        if not payload["background_url"]:
            row.video_status = "failed"
            row.video_render_error = "background_url is missing for this task."
            db.commit()
            return

    try:
        r = requests.post(render_url, json=payload, timeout=600)
    except requests.RequestException as exc:
        persist_video_task_state(
            tid,
            video_status="failed",
            video_render_error=f"Video engine unreachable ({render_url}): {exc}",
        )
        return

    if r.status_code >= 400:
        detail = r.text[:500] if r.text else r.reason
        try:
            err_json = r.json()
            if isinstance(err_json, dict):
                raw_d = err_json.get("details") or err_json.get("error") or detail
                if isinstance(raw_d, list):
                    detail = " ".join(str(x) for x in raw_d)
                else:
                    detail = str(raw_d)
        except (json.JSONDecodeError, ValueError):
            pass
        persist_video_task_state(
            tid,
            video_status="failed",
            video_render_error=f"Video engine error: {detail}",
        )
        return

    try:
        data = r.json()
    except json.JSONDecodeError:
        persist_video_task_state(
            tid,
            video_status="failed",
            video_render_error="Video engine returned invalid JSON.",
        )
        return

    if not data.get("success"):
        fail = data.get("error") or data.get("details") or "Video render failed"
        if isinstance(fail, list):
            fail = " ".join(str(x) for x in fail)
        persist_video_task_state(tid, video_status="failed", video_render_error=str(fail))
        return

    video_url = data.get("videoUrl") or data.get("video_url")
    if not video_url or not isinstance(video_url, str):
        persist_video_task_state(
            tid,
            video_status="failed",
            video_render_error="Video engine response missing videoUrl.",
        )
        return

    cleaned = video_url.strip()
    is_vertical = aspect_ratio == "9:16"
    with SessionLocal() as db:
        row = db.get(BannerTask, tid)
        if row is None:
            return
        if design_type == 2:
            if is_vertical:
                row.video_url_2_vertical = cleaned
            else:
                row.video_url_2 = cleaned
        else:
            if is_vertical:
                row.video_url_1_vertical = cleaned
            else:
                row.video_url_1 = cleaned
        row.video_status = None
        row.video_render_error = None
        db.commit()


@celery_app.task(name="render_video_task", queue="video_queue")
def render_video_task(
    task_id: str,
    design_type: int,
    aspect_ratio: str,
    public_base: str,
) -> None:
    execute_video_render_worker(task_id, design_type, aspect_ratio, public_base)


# ─────────────────────────────────────────────────────────────────────────────
# UGC video pipeline task
# ─────────────────────────────────────────────────────────────────────────────


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="run_ugc_task",
    queue="video_queue",
)
def run_ugc_task(
    self: BannerGenerationTask,
    task_id: str,
    url: str,
    brief: str | None,
    avatar_id: str,
    video_length: str,
    provider: str = "heygen_elevenlabs",
    custom_script: str | None = None,
) -> None:
    """End-to-end UGC video pipeline.

    1. Crawl *url* → scraped_content.txt
    2. Generate Hebrew script via GPT-4o (ugc_director), or use *custom_script*
       when provided (skips AI).
    3 & 4. Dispatch video generation to the chosen provider:
           - "heygen_elevenlabs": ElevenLabs TTS → HeyGen avatar video
           - "d-id":             D-ID all-in-one (TTS + video in a single call)
    5. Persist final URL and mark ugc_status='completed'

    All errors set ugc_status='failed' and ugc_error before re-raising as
    BannerPipelineFatalError so the base class does not trigger banner-status
    retries and the on_failure handler skips its status='failed' write.
    """
    from services.ugc_service import (
        UGCServiceError,
        dispatch_ugc_generation,
    )
    import ugc_director

    task_uuid = uuid.UUID(task_id)
    work_dir = TASKS_DIR / task_id
    work_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "[run_ugc_task] task_id=%s  url=%s  avatar=%s  length=%s  provider=%s",
        task_id, url, avatar_id, video_length, provider,
    )

    try:
        # ── Step 1: crawl ────────────────────────────────────────────────────
        try:
            crawl_from_url(url, work_dir=work_dir, campaign_brief=brief)
        except SoftTimeLimitExceeded:
            persist_task(
                task_uuid,
                ugc_status="failed",
                ugc_error="Crawl timed out (Celery soft time limit exceeded).",
            )
            raise

        scraped_path = work_dir / "scraped_content.txt"
        if not scraped_path.is_file():
            msg = "scraped_content.txt not found after crawl."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[run_ugc_task] {msg}")

        scraped_text = scraped_path.read_text(encoding="utf-8").strip()
        if not scraped_text:
            msg = "scraped_content.txt is empty after crawl."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[run_ugc_task] {msg}")

        persist_task(task_uuid, ugc_status="scraped")
        logger.info("[run_ugc_task] task_id=%s  crawl complete (%d chars).", task_id, len(scraped_text))

        # ── Step 2: generate UGC script (or use caller-provided text) ────────
        persist_task(task_uuid, ugc_status="generating_script")
        script_override = (custom_script or "").strip()
        if script_override:
            logger.info(
                "[run_ugc_task] task_id=%s  using custom_script (%d chars); skipping AI script.",
                task_id,
                len(script_override),
            )
            _dur_map = {"15s": 15, "30s": 30, "50s": 50}
            ugc_script = {
                "estimated_duration_seconds": _dur_map.get(video_length, 30),
                "scenes": [
                    {
                        "scene_number": 1,
                        "spoken_text": script_override,
                        "on_screen_text": "",
                        "visual_layout": "full_avatar",
                    }
                ],
            }
        else:
            logger.info("[run_ugc_task] task_id=%s  generating UGC script…", task_id)
            try:
                ugc_script = ugc_director.generate_ugc_script(
                    scraped_text=scraped_text,
                    brief=brief,
                    video_length=video_length,
                )
            except Exception as exc:
                msg = f"UGC script generation failed: {exc}"
                logger.error("[run_ugc_task] task_id=%s  %s", task_id, msg)
                persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
                raise BannerPipelineFatalError(f"[run_ugc_task] {msg}") from exc

        persist_task(task_uuid, ugc_script=ugc_script)
        logger.info(
            "[run_ugc_task] task_id=%s  script saved (%d scenes).",
            task_id,
            len(ugc_script.get("scenes", [])),
        )

        # ── Steps 3 & 4: build script text, then dispatch to provider ────────
        scenes = ugc_script.get("scenes") or []
        combined_spoken_text = " ".join(
            scene.get("spoken_text", "").strip() for scene in scenes
        ).strip()

        if not combined_spoken_text:
            msg = "UGC script has no spoken text in any scene."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[run_ugc_task] {msg}")

        persist_task(task_uuid, ugc_status="generating_video")
        logger.info(
            "[run_ugc_task] task_id=%s  dispatching %d chars to provider=%r…",
            task_id,
            len(combined_spoken_text),
            provider,
        )

        try:
            video_url = dispatch_ugc_generation(
                provider=provider,
                script_text=combined_spoken_text,
                visual_reference=avatar_id,
            )
        except (UGCServiceError, ValueError) as exc:
            msg = f"Video generation failed ({provider}): {exc}"
            logger.error("[run_ugc_task] task_id=%s  %s", task_id, msg)
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[run_ugc_task] {msg}") from exc

        # ── Step 5: persist completed state ──────────────────────────────────
        persist_task(
            task_uuid,
            ugc_raw_video_url=video_url,
            ugc_status="completed",
            ugc_error=None,
        )
        logger.info(
            "[run_ugc_task] task_id=%s  COMPLETED. video_url=%s",
            task_id,
            video_url,
        )
    finally:
        _emergency_chrome_cleanup()
