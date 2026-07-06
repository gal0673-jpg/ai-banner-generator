"""Celery task definitions (imported by the worker process; keep free of FastAPI app imports)."""

from __future__ import annotations

import atexit
import json
import logging
import os
import signal
import threading
import uuid
from typing import Any

import requests
from celery import Task, chain
from celery.exceptions import SoftTimeLimitExceeded

from celery_app import celery_app
from database import SessionLocal
from models import BannerTask, BusinessProfile
from services import ugc_composite_service
from services.business_profile import build_context_text, extract_profile_fields
from services.creative_campaign import CreativeCampaignError, parse_creative_campaign
from services.banner_pipeline import run_agency_banner_pipeline
from services.banner_service import (
    TASKS_DIR,
    get_creative_for_write,
    persist_task,
    persist_video_task_state,
    rendered_banner_urls_for_task,
)
from services.crawler_service import crawl_from_url, quit_all_active_drivers
from services.video_service import video_engine_render_url, video_payload_for_engine

logger = logging.getLogger(__name__)


def _ugc_aspect_specific_column(aspect_ratio: str, *, kind: str) -> str:
    """Return DB column name for UGC URLs by aspect ratio.

    kind: "composited" | "final"
    """
    ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)
    if kind == "composited":
        if ar == "1:1":
            return "ugc_composited_video_url_1_1"
        if ar == "16:9":
            return "ugc_composited_video_url_16_9"
        return "ugc_composited_video_url"
    if kind == "final":
        if ar == "1:1":
            return "ugc_final_video_url_1_1"
        if ar == "16:9":
            return "ugc_final_video_url_16_9"
        return "ugc_final_video_url"
    raise ValueError(f"Unknown kind={kind!r}")


def _run_ffmpeg_stage(
    *,
    task_uuid: uuid.UUID,
    task_id: str,
    video_url: str,
    work_dir: Any,
    speed_factor: float,
    aspect_ratio: str,
) -> tuple[str | None, str]:
    """Run blurred-background composite; returns (composited_url, note)."""
    persist_task(task_uuid, ugc_status="processing_video")
    logger.info(
        "[_finalize_ugc] task_id=%s  running FFmpeg composite (aspect=%s)…",
        task_id,
        aspect_ratio,
    )
    composited, note = ugc_composite_service.try_composite_pip_blur(
        task_id=task_id,
        source_video_url=video_url,
        work_dir=work_dir,
        speed_factor=speed_factor,
        aspect_ratio=aspect_ratio,
    )
    if composited:
        logger.info(
            "[_finalize_ugc] task_id=%s  FFmpeg composite OK → %s", task_id, composited
        )
    else:
        logger.info(
            "[_finalize_ugc] task_id=%s  FFmpeg composite skipped/failed: %s", task_id, note
        )
    return composited, note or ""


def _flush_composite_urls(
    *,
    task_uuid: uuid.UUID,
    video_url: str,
    composited_url: str | None,
    note: str,
    aspect_ratio: str,
) -> None:
    """Persist raw provider URL and aspect-specific composited URL (if any)."""
    update: dict[str, Any] = {
        "ugc_raw_video_url": video_url,
        "ugc_composite_note": note,
    }
    update[_ugc_aspect_specific_column(aspect_ratio, kind="composited")] = composited_url
    persist_task(task_uuid, **update)


def _choose_best_remotion_input_url(
    *,
    task_id: str,
    work_dir: Any,
    aspect_ratio: str,
    provider_video_url: str,
) -> tuple[str, Any, Any]:
    """Pick the fastest/best Remotion input URL and return (url, composited_path, source_path)."""
    _api_base = os.environ.get("VITE_API_URL", "http://127.0.0.1:8888").rstrip("/")
    _composited_name = ugc_composite_service.composited_filename_for_aspect_ratio(aspect_ratio)
    _composited_path = work_dir / _composited_name
    _source_path = work_dir / "ugc_provider_source.mp4"

    if _composited_path.is_file() and _composited_path.stat().st_size > 1024:
        render_video_url = f"{_api_base}/task-files/{task_id}/{_composited_name}"
        logger.info(
            "[_finalize_ugc] task_id=%s  using FFmpeg-composited video for Remotion "
            "(%s, 1× decode): %s",
            task_id,
            aspect_ratio,
            render_video_url,
        )
        return render_video_url, _composited_path, _source_path

    if _source_path.is_file() and _source_path.stat().st_size > 1024:
        render_video_url = f"{_api_base}/task-files/{task_id}/ugc_provider_source.mp4"
        logger.info(
            "[_finalize_ugc] task_id=%s  composited not found, using raw source: %s",
            task_id,
            render_video_url,
        )
        return render_video_url, _composited_path, _source_path

    logger.info(
        "[_finalize_ugc] task_id=%s  no local file found — using CDN URL for Remotion.",
        task_id,
    )
    return provider_video_url, _composited_path, _source_path


def _maybe_override_script_duration_with_probe(
    *,
    task_id: str,
    ugc_script: dict,
    composited_path: Any,
    source_path: Any,
) -> dict:
    """Override estimated_duration_seconds with measured duration if possible."""
    _estimated_dur = ugc_script.get("estimated_duration_seconds")
    _probe_path = composited_path if composited_path.is_file() else source_path
    if _probe_path.is_file():
        _actual_dur = ugc_composite_service.get_video_duration_seconds(_probe_path)
        if _actual_dur and _actual_dur > 1:
            logger.info(
                "[_finalize_ugc] task_id=%s  measured duration=%.1fs "
                "(estimated was %ss) — Remotion will use measured value",
                task_id,
                _actual_dur,
                _estimated_dur,
            )
            return {**ugc_script, "estimated_duration_seconds": round(_actual_dur, 2)}
        logger.info(
            "[_finalize_ugc] task_id=%s  ffprobe unavailable or failed; "
            "keeping estimated_duration_seconds=%ss",
            task_id,
            _estimated_dur,
        )
    return ugc_script


def _load_ugc_brand_assets(task_uuid: uuid.UUID) -> tuple[str | None, str | None, str | None, str | None]:
    """Load optional overlay assets from DB (website_display, logo_url, product_image_url, brand_color)."""
    website_display: str | None = None
    logo_url: str | None = None
    product_image_url: str | None = None
    brand_color: str | None = None
    with SessionLocal() as db:
        db_row = db.get(BannerTask, task_uuid)
        if db_row is not None:
            ugc_row = db_row.ugc_video
            w = (ugc_row.ugc_website_display if ugc_row else None) or ""
            website_display = w.strip() or None
            cr = db_row.creative
            lu = cr.logo_url if cr else None
            logo_url = (str(lu).strip() or None) if lu else None
            pi = (cr.product_image_url if cr else None) or ""
            product_image_url = pi.strip() or None
            bc = ((cr.brand_color if cr else None) or "").strip()
            brand_color = bc or None
    return website_display, logo_url, product_image_url, brand_color


def _best_available_ugc_video_url(
    *,
    provider_video_url: str,
    composited_url: str | None,
) -> str:
    """Prefer composited when available, else raw provider URL."""
    return (composited_url or "").strip() or provider_video_url


def _persist_ugc_final_url(
    *,
    task_uuid: uuid.UUID,
    aspect_ratio: str,
    final_url: str | None,
    composite_note: str | None = None,
    ugc_error: str | None = None,
) -> None:
    update: dict[str, Any] = {
        "ugc_status": "completed",
        "ugc_error": ugc_error,
    }
    if composite_note is not None:
        update["ugc_composite_note"] = composite_note
    update[_ugc_aspect_specific_column(aspect_ratio, kind="final")] = final_url
    persist_task(task_uuid, **update)


def cleanup_task_assets(task_id: str) -> None:
    """Delete large temporary files from a UGC task directory.

    Intended to be called after a successful finalize, to reclaim disk space.
    """
    work_dir = TASKS_DIR / task_id
    if not work_dir.exists():
        return

    # Always safe to delete: raw provider download (we persist remote URLs in the DB).
    candidates = [
        work_dir / "ugc_provider_source.mp4",
    ]

    for p in candidates:
        try:
            if p.is_file():
                p.unlink()
                logger.info("[cleanup_task_assets] task_id=%s  deleted %s", task_id, p.name)
        except Exception as exc:
            logger.warning(
                "[cleanup_task_assets] task_id=%s  failed deleting %s: %s",
                task_id,
                p.name,
                exc,
            )


def _enrich_ugc_script_split_gallery_dalle(
    ugc_script: dict,
    task_id: str,
    work_dir: str | os.PathLike[str],
    log_name: str,
    custom_gallery_images: list[str] | None = None,
) -> None:
    """Fill ``layout_data.image_urls`` for ``split_gallery`` scenes; mutates *ugc_script* in place.

    On API/disk errors, logs and leaves ``layout_data.images`` unchanged (same behavior as
    ``task_crawl_and_script``).
    """
    from services.ugc_service import generate_split_gallery_images

    PLACEHOLDER_BRAND_COLOR = "PLACEHOLDER_BRAND_COLOR"

    try:
        for scene in ugc_script.get("scenes") or []:
            if scene.get("visual_layout") != "split_gallery":
                continue
            layout_data = scene.get("layout_data")
            if not isinstance(layout_data, dict):
                continue
            raw_imgs = layout_data.get("images")
            if not isinstance(raw_imgs, list) or len(raw_imgs) != 3:
                continue
            all_dict = all(isinstance(x, dict) for x in raw_imgs)
            all_str = all(isinstance(x, str) for x in raw_imgs)
            dalle_prompts: list[str] = []
            refine = False
            if all_dict:
                for item in raw_imgs:
                    p = item.get("image_prompt") if isinstance(item, dict) else None
                    if isinstance(p, str) and p.strip():
                        dalle_prompts.append(p.strip())
                    else:
                        dalle_prompts = []
                        break
                refine = False
            elif all_str:
                dalle_prompts = [str(x).strip() for x in raw_imgs if str(x).strip()]
                refine = True
            else:
                logger.warning(
                    "[%s] task_id=%s  split_gallery scene=%s  layout_data.images must be 3 objects "
                    "or 3 strings; skipping DALL·E",
                    log_name,
                    task_id,
                    scene.get("scene_number"),
                )
                continue
            if len(dalle_prompts) != 3:
                continue
            sn = scene.get("scene_number")
            stem = f"split_gallery_s{sn}" if isinstance(sn, int) else "split_gallery"
            try:
                image_urls = generate_split_gallery_images(
                    dalle_prompts,
                    task_id,
                    work_dir,
                    name_prefix=stem,
                    refine_prompts_with_gpt=refine,
                    custom_image_urls=custom_gallery_images,
                )
                layout_data["image_urls"] = image_urls
                if any(u == PLACEHOLDER_BRAND_COLOR for u in (image_urls or [])):
                    layout_data["is_placeholder"] = True
            except Exception as one_scene_exc:
                logger.warning(
                    "[%s] task_id=%s  split_gallery scene=%s  "
                    "image generation failed (keeping Hebrew labels only): %s",
                    log_name,
                    task_id,
                    sn,
                    one_scene_exc,
                )
    except Exception as exc:
        logger.warning(
            "[%s] task_id=%s  split_gallery image pass failed: %s",
            log_name,
            task_id,
            exc,
        )


def _finalize_ugc_with_composite(
    task_uuid: uuid.UUID,
    task_id: str,
    video_url: str,
    ugc_script: dict | None = None,
    speed_factor: float = 1.15,
    aspect_ratio: str = "9:16",
) -> None:
    """Persist provider URL, run optional FFmpeg polish, then drive Remotion caption render.

    Pipeline (each step degrades gracefully on failure):

    1. FFmpeg composite — converts the raw avatar video to the requested aspect
       (default 9:16 vertical) using blurred full-frame background + letterbox-fit foreground.
       Saves a local composited MP4 and sets the matching ``ugc_composited_video_url``
       column for that aspect.  Skipped/failed → that column stays None and a note is
       recorded; pipeline continues.

    2. Remotion caption render — POSTs ``raw_video_url`` + ``ugc_script`` to the Node.js
       video engine's ``/render-ugc`` endpoint.  Remotion overlays animated Hebrew captions
       and writes a finished MP4.  The URL is persisted on the aspect-specific ``ugc_final_*``
       columns.  Skipped (no script) / failed → that aspect's final URL remains None; pipeline still
       completes successfully using whichever earlier step produced the best video.

    Status transitions:
      processing_video → rendering_captions  (after FFmpeg + before Remotion)
      rendering_captions → completed  (normal path)
      rendering_captions → completed  (fallback: Remotion unavailable, best existing URL kept)
    """
    ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)
    work_dir = TASKS_DIR / task_id
    work_dir.mkdir(parents=True, exist_ok=True)

    # ── Step 1: FFmpeg blurred-background composite ─────────────────────────
    composited, note = _run_ffmpeg_stage(
        task_uuid=task_uuid,
        task_id=task_id,
        video_url=video_url,
        work_dir=work_dir,
        speed_factor=speed_factor,
        aspect_ratio=ar,
    )
    _flush_composite_urls(
        task_uuid=task_uuid,
        video_url=video_url,
        composited_url=composited,
        note=note,
        aspect_ratio=ar,
    )

    # ── Step 2: Remotion caption render ──────────────────────────────────────
    scenes = (ugc_script or {}).get("scenes") or []
    has_captions = any(
        (s.get("on_screen_text") or "").strip() for s in scenes
    )

    if not ugc_script or not has_captions:
        logger.info(
            "[_finalize_ugc] task_id=%s  skipping Remotion render "
            "(no ugc_script or no on_screen_text in any scene).",
            task_id,
        )
        best_url = _best_available_ugc_video_url(
            provider_video_url=video_url,
            composited_url=composited,
        )
        _persist_ugc_final_url(
            task_uuid=task_uuid,
            aspect_ratio=ar,
            final_url=best_url,
            composite_note=note or None,
            ugc_error=None,
        )
        return

    # ── Choose best local video for Remotion input ────────────────────────────
    # Priority:
    #   1. ugc_composited.mp4  — FFmpeg output: already target aspect (blur bg + fit fg).
    #                            Remotion only needs to add captions (1 OffthreadVideo decode
    #                            per frame instead of 2 → roughly half the render time).
    #   2. ugc_provider_source.mp4 — raw provider download; still local so fast.
    #   3. video_url (CDN)     — last resort if nothing was downloaded locally.
    render_video_url, _composited_path, _source_path = _choose_best_remotion_input_url(
        task_id=task_id,
        work_dir=work_dir,
        aspect_ratio=ar,
        provider_video_url=video_url,
    )

    # ── Measure actual video duration ────────────────────────────────────────
    # GPT estimates duration; HeyGen/D-ID may produce a slightly longer/shorter file.
    # Remotion uses estimated_duration_seconds for durationInFrames — if the estimate
    # is too short, the render cuts off mid-sentence.  Override with the measured value.
    ugc_script = _maybe_override_script_duration_with_probe(
        task_id=task_id,
        ugc_script=ugc_script,
        composited_path=_composited_path,
        source_path=_source_path,
    )

    # Signal to the UI that captions are being rendered.
    persist_task(task_uuid, ugc_status="rendering_captions")
    website_display, logo_url, product_image_url, brand_color = _load_ugc_brand_assets(
        task_uuid
    )

    logger.info(
        "[_finalize_ugc] task_id=%s  calling Remotion /render-ugc  "
        "scenes=%d  duration=%ss  video_url=%s  website_display=%s",
        task_id,
        len(scenes),
        ugc_script.get("estimated_duration_seconds", "?"),
        render_video_url,
        website_display or "(none)",
    )

    try:
        final_url, render_err = ugc_composite_service.call_video_engine_render_ugc(
            task_id=task_id,
            raw_video_url=render_video_url,
            ugc_script=ugc_script,
            website_display=website_display,
            logo_url=logo_url,
            product_image_url=product_image_url,
            brand_color=brand_color,
            aspect_ratio=ar,
        )
    except Exception as exc:
        final_url = None
        render_err = str(exc)

    if final_url:
        logger.info(
            "[_finalize_ugc] task_id=%s  Remotion render OK → %s",
            task_id,
            final_url,
        )
        _persist_ugc_final_url(
            task_uuid=task_uuid,
            aspect_ratio=ar,
            final_url=final_url,
            composite_note=None,
            ugc_error=None,
        )
    else:
        # Non-fatal: the task still completes; fall back to the best available video.
        best_url = _best_available_ugc_video_url(
            provider_video_url=video_url,
            composited_url=composited,
        )
        render_note = (
            f"Video Engine failed: {render_err}. "
            f"Showing best available video instead: {best_url}"
        )
        combined_note = f"{note}  |  {render_note}" if note else render_note
        logger.warning(
            "[_finalize_ugc] task_id=%s  Remotion render failed — persisting note: %s",
            task_id,
            render_note,
        )
        _persist_ugc_final_url(
            task_uuid=task_uuid,
            aspect_ratio=ar,
            final_url=best_url,
            composite_note=combined_note,
            ugc_error=None,
        )


# ── Chrome leak-prevention: guarantee cleanup on any exit path ────────────────
#
# Celery's *soft* time limit raises SoftTimeLimitExceeded inside the running task
# (catchable). The *hard* limit sends SIGKILL — uncatchable — but we register both
# SIGTERM (graceful shutdown), ``worker_process_shutdown`` (see celery_app.py), and
# atexit so we cover as many scenarios as possible.
# ``quit_all_active_drivers`` uses psutil (when installed) to reap trees and optionally
# sweep Chrome-family descendants of this worker PID.
# SIGKILL survivors (true orphans whose parent is no longer the worker) may still
# require a container restart or external supervisor.

_chrome_cleanup_lock = threading.Lock()


def _emergency_chrome_cleanup() -> None:
    """Kill every Chrome instance this process spawned. Idempotent and thread-safe."""
    with _chrome_cleanup_lock:
        try:
            # Includes psutil tree kill + optional descendant sweep (see crawler_service).
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


def _seed_banner_work_dir_from_profile(
    business_profile_id: str, work_dir: Any, brief: str | None
) -> bool:
    """Seed a banner job from a saved profile instead of crawling.

    Writes the profile's cached ``context_text`` to ``scraped_content.txt`` (with
    the user brief appended in the block the creative prompt looks for) and copies
    the profile's logo to ``logo.png``. Returns ``True`` only when BOTH context and
    logo were seeded — the caller then skips the crawl. Returns ``False`` (missing
    context or logo) so the caller falls back to a normal crawl and the job still
    succeeds.
    """
    with SessionLocal() as db:
        profile = db.get(BusinessProfile, uuid.UUID(business_profile_id))
        if profile is None:
            return False
        context = (profile.context_text or "").strip()
        logo_url = (profile.logo_url or "").strip()

    if not context:
        return False

    # Resolve the profile's logo file from its /task-files/... URL.
    logo_src = None
    if logo_url.startswith("/task-files/"):
        candidate = TASKS_DIR / logo_url[len("/task-files/"):]
        if candidate.is_file():
            logo_src = candidate
    if logo_src is None:
        return False  # no usable logo → fall back to crawl (banner needs a logo)

    doc = context
    if brief and brief.strip():
        doc = (
            f"{context}\n\n"
            "USER CAMPAIGN BRIEF (goals / target audience — provided by the user)\n"
            f"{brief.strip()}"
        )
    (work_dir / "scraped_content.txt").write_text(doc, encoding="utf-8")
    (work_dir / "logo.png").write_bytes(logo_src.read_bytes())
    return True


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
    business_profile_id: str | None = None,
) -> None:
    task_uuid = uuid.UUID(task_id)
    work_dir = TASKS_DIR / task_id
    work_dir.mkdir(parents=True, exist_ok=True)
    # Move off "pending" as soon as the worker picks up the job — crawl can take minutes.
    persist_task(task_uuid, status="scraped")

    seeded = False
    if business_profile_id:
        try:
            seeded = _seed_banner_work_dir_from_profile(business_profile_id, work_dir, brief)
        except Exception as exc:  # noqa: BLE001 — seeding is best-effort; fall back to crawl
            logger.warning("[run_banner_task] profile seed failed (%s); crawling instead", exc)
    if seeded:
        print(f"[run_banner_task] task_id={task_id} seeded from profile (crawl skipped)", flush=True)
    else:
        print(f"[run_banner_task] task_id={task_id} status=scraped (crawl starting)", flush=True)

    try:
        if not seeded:
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

    try:
        parsed = parse_creative_campaign(data, custom_video_hook=custom_video_hook)
    except CreativeCampaignError as exc:
        persist_task(task_uuid, status="failed", error=str(exc))
        raise BannerPipelineFatalError(str(exc)) from exc

    rb1, rb2 = rendered_banner_urls_for_task(task_id)
    persist_task(
        task_uuid,
        status="completed",
        error=None,
        headline=parsed["headline"],
        subhead=parsed["subhead"],
        bullet_points=parsed["bullet_points"],
        cta=parsed["cta"],
        video_hook=parsed["video_hook"],
        brand_color=parsed["brand_color"],
        background_url=f"/task-files/{task_id}/background.png",
        logo_url=f"/task-files/{task_id}/logo.png",
        rendered_banner_1_url=rb1,
        rendered_banner_2_url=rb2,
    )


@celery_app.task(name="scan_business_profile_task", queue="banner_queue")
def scan_business_profile_task(profile_id: str, website_url: str) -> None:
    """One-time enrichment: crawl the site + GPT-extract into a BusinessProfile.

    Fills only fields the user left empty (never clobbers manual edits) and
    always rebuilds ``context_text`` — the canonical brief that later seeds the
    creative pipeline in place of a fresh crawl. Failures are recorded on the
    profile (``scan_status='failed'``) rather than re-raised, so a bad crawl
    never triggers a Celery retry storm; the profile stays usable as entered.
    """
    pid = uuid.UUID(profile_id)
    work_dir = TASKS_DIR / f"profile-{profile_id}"
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        scraped_text = ""
        try:
            crawl_from_url(website_url, work_dir=work_dir)
        except SoftTimeLimitExceeded:
            _emergency_chrome_cleanup()
            raise
        except Exception as exc:  # noqa: BLE001 — crawl is best-effort here
            logger.warning("[scan_business_profile] crawl failed for %s: %s", website_url, exc)

        scraped_path = work_dir / "scraped_content.txt"
        if scraped_path.is_file():
            scraped_text = scraped_path.read_text(encoding="utf-8").strip()

        extracted: dict[str, str | None] = {}
        if scraped_text and os.environ.get("OPENAI_API_KEY"):
            try:
                from openai import OpenAI

                extracted = extract_profile_fields(OpenAI(), scraped_text)
            except Exception as exc:  # noqa: BLE001 — extraction is best-effort
                logger.warning("[scan_business_profile] GPT extraction failed: %s", exc)

        if not scraped_text and not extracted:
            with SessionLocal() as db:
                profile = db.get(BusinessProfile, pid)
                if profile is not None:
                    profile.scan_status = "failed"
                    profile.scan_error = (
                        "לא הצלחנו לקרוא תוכן מהאתר. בדוק את הכתובת או מלא את הפרטים ידנית."
                    )
                    db.commit()
            return

        with SessionLocal() as db:
            profile = db.get(BusinessProfile, pid)
            if profile is None:
                return

            # Fill only empty fields — manual edits win over extraction.
            for field in ("name", "description", "audience", "tone", "offerings", "brand_color"):
                value = extracted.get(field)
                if value and not (getattr(profile, field) or "").strip():
                    setattr(profile, field, value)

            logo_path = work_dir / "logo.png"
            if logo_path.is_file() and not (profile.logo_url or "").strip():
                profile.logo_url = f"/task-files/profile-{profile_id}/logo.png"

            profile.context_text = build_context_text(
                name=profile.name,
                description=profile.description,
                audience=profile.audience,
                tone=profile.tone,
                offerings=profile.offerings,
                brand_color=profile.brand_color,
                scraped_text=scraped_text,
            )
            profile.scan_status = "ready"
            profile.scan_error = None
            db.commit()
    except SoftTimeLimitExceeded:
        with SessionLocal() as db:
            profile = db.get(BusinessProfile, pid)
            if profile is not None:
                profile.scan_status = "failed"
                profile.scan_error = "סריקת האתר חרגה מהזמן המוקצב."
                db.commit()
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("[scan_business_profile] unexpected failure")
        with SessionLocal() as db:
            profile = db.get(BusinessProfile, pid)
            if profile is not None:
                profile.scan_status = "failed"
                profile.scan_error = str(exc)[:2000]
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
        creative = get_creative_for_write(db, row)
        if row.status != "completed":
            creative.video_status = "failed"
            creative.video_render_error = "Task is not completed; cannot render video."
            db.commit()
            return
        payload = video_payload_for_engine(row, design_type, public_base, aspect_ratio)
        payload["task_id"] = task_id
        if not payload["headline"]:
            creative.video_status = "failed"
            creative.video_render_error = "headline is required for video render."
            db.commit()
            return
        if not payload["background_url"]:
            creative.video_status = "failed"
            creative.video_render_error = "background_url is missing for this task."
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
        creative = get_creative_for_write(db, row)
        if design_type == 2:
            if is_vertical:
                creative.video_url_2_vertical = cleaned
            else:
                creative.video_url_2 = cleaned
        else:
            if is_vertical:
                creative.video_url_1_vertical = cleaned
            else:
                creative.video_url_1 = cleaned
        creative.video_status = None
        creative.video_render_error = None
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
# UGC legacy pipeline — Celery chain (crawl+script → HeyGen/D-ID → FFmpeg/Remotion)
# ─────────────────────────────────────────────────────────────────────────────


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="task_crawl_and_script",
    queue="video_queue",
)
def task_crawl_and_script(
    self: BannerGenerationTask,
    task_id: str,
    url: str,
    brief: str | None,
    avatar_id: str,
    video_length: str,
    provider: str,
    custom_script: str | None,
    voice_id: str | None,
    heygen_character_type: str | None,
    aspect_ratio: str,
) -> None:
    """Crawl site, build UGC script (or custom_script), persist ``ugc_script`` to the DB.

    ``provider`` / ``voice_id`` / ``heygen_character_type`` are accepted for a stable
    chain signature from ``run_ugc_task``; they are not used here (next link reads DB).
    """
    import ugc_director
    from services.ugc_service import combined_spoken_text_from_script

    task_uuid = uuid.UUID(task_id)
    work_dir = TASKS_DIR / task_id
    work_dir.mkdir(parents=True, exist_ok=True)
    _ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)

    logger.info(
        "[task_crawl_and_script] task_id=%s  url=%s  avatar=%s  length=%s  provider=%s  voice_id=%s  aspect=%s",
        task_id,
        url,
        avatar_id,
        video_length,
        provider,
        voice_id or "(default)",
        _ar,
    )

    try:
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
            raise BannerPipelineFatalError(f"[task_crawl_and_script] {msg}")

        scraped_text = scraped_path.read_text(encoding="utf-8").strip()
        if not scraped_text:
            msg = "scraped_content.txt is empty after crawl."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[task_crawl_and_script] {msg}")

        persist_task(task_uuid, ugc_status="scraped")
        logger.info(
            "[task_crawl_and_script] task_id=%s  crawl complete (%d chars).",
            task_id,
            len(scraped_text),
        )

        persist_task(task_uuid, ugc_status="generating_script")
        script_override = (custom_script or "").strip()
        if script_override:
            logger.info(
                "[task_crawl_and_script] task_id=%s  using custom_script (%d chars); skipping AI script.",
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
            logger.info("[task_crawl_and_script] task_id=%s  generating UGC script…", task_id)
            try:
                ugc_script = ugc_director.generate_ugc_script(
                    scraped_text=scraped_text,
                    brief=brief,
                    video_length=video_length,
                )
            except Exception as exc:
                msg = f"UGC script generation failed: {exc}"
                logger.error("[task_crawl_and_script] task_id=%s  %s", task_id, msg)
                persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
                raise BannerPipelineFatalError(f"[task_crawl_and_script] {msg}") from exc

        _enrich_ugc_script_split_gallery_dalle(
            ugc_script,
            task_id,
            work_dir,
            "task_crawl_and_script",
        )

        persist_task(task_uuid, ugc_script=ugc_script)
        logger.info(
            "[task_crawl_and_script] task_id=%s  script saved (%d scenes).",
            task_id,
            len(ugc_script.get("scenes", [])),
        )

        combined = combined_spoken_text_from_script(ugc_script)
        if not combined:
            msg = "UGC script has no spoken text in any scene."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[task_crawl_and_script] {msg}")
    finally:
        _emergency_chrome_cleanup()


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="task_generate_avatar_video",
    queue="video_queue",
)
def task_generate_avatar_video(
    self: BannerGenerationTask,
    task_id: str,
    avatar_id: str,
    provider: str,
    voice_id: str | None,
    heygen_character_type: str | None,
    aspect_ratio: str,
) -> None:
    """Call HeyGen / D-ID using ``ugc_script`` from the DB; persist ``ugc_raw_video_url``."""
    from services.ugc_service import (
        UGCServiceError,
        combined_spoken_text_from_script,
        dispatch_ugc_generation,
    )

    task_uuid = uuid.UUID(task_id)
    _ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)

    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None or row.ugc_video is None:
            msg = "BannerTask or UgcVideoData row missing before provider dispatch."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[task_generate_avatar_video] {msg}")
        ugc_script = row.ugc_video.ugc_script

    combined_spoken_text = combined_spoken_text_from_script(ugc_script)
    if not combined_spoken_text:
        msg = "UGC script has no spoken text (DB); cannot dispatch provider."
        persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
        raise BannerPipelineFatalError(f"[task_generate_avatar_video] {msg}")

    persist_task(task_uuid, ugc_status="generating_video")
    logger.info(
        "[task_generate_avatar_video] task_id=%s  dispatching %d chars to provider=%r…",
        task_id,
        len(combined_spoken_text),
        provider,
    )

    try:
        video_url = dispatch_ugc_generation(
            provider=provider,
            script_text=combined_spoken_text,
            visual_reference=avatar_id,
            voice_id=voice_id,
            heygen_character_type=heygen_character_type,
            aspect_ratio=_ar,
        )
    except (UGCServiceError, ValueError) as exc:
        msg = f"Video generation failed ({provider}): {exc}"
        logger.error("[task_generate_avatar_video] task_id=%s  %s", task_id, msg)
        persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
        raise BannerPipelineFatalError(f"[task_generate_avatar_video] {msg}") from exc

    persist_task(task_uuid, ugc_raw_video_url=video_url)
    logger.info(
        "[task_generate_avatar_video] task_id=%s  provider URL persisted (len=%d).",
        task_id,
        len(video_url or ""),
    )


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="task_finalize_ugc_video",
    queue="video_queue",
)
def task_finalize_ugc_video(
    self: BannerGenerationTask,
    task_id: str,
    aspect_ratio: str,
) -> None:
    """FFmpeg composite + Remotion captions from ``ugc_raw_video_url`` + ``ugc_script`` in DB."""
    task_uuid = uuid.UUID(task_id)
    _ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)

    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None or row.ugc_video is None:
            msg = "BannerTask or UgcVideoData row missing before finalize."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[task_finalize_ugc_video] {msg}")
        ugc = row.ugc_video
        raw = ((ugc.ugc_raw_video_url or "") or "").strip()
        script = ugc.ugc_script

    if not raw:
        msg = "ugc_raw_video_url is missing before finalize (provider step did not persist?)."
        persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
        raise BannerPipelineFatalError(f"[task_finalize_ugc_video] {msg}")

    _finalize_ugc_with_composite(
        task_uuid,
        task_id,
        raw,
        ugc_script=script,
        aspect_ratio=_ar,
    )

    # Cleanup big temporary assets only after a successful finalize completion.
    try:
        with SessionLocal() as db:
            row2 = db.get(BannerTask, task_uuid)
            ugc2 = row2.ugc_video if row2 else None
            if ugc2 and (ugc2.ugc_status or "").strip() == "completed":
                cleanup_task_assets(task_id)
    except Exception as exc:
        logger.warning(
            "[task_finalize_ugc_video] task_id=%s  cleanup failed (non-fatal): %s",
            task_id,
            exc,
        )
    logger.info("[task_finalize_ugc_video] task_id=%s  pipeline finalize finished.", task_id)


@celery_app.task(name="run_ugc_task", queue="video_queue")
def run_ugc_task(
    task_id: str,
    url: str,
    brief: str | None,
    avatar_id: str,
    video_length: str,
    provider: str = "heygen_elevenlabs",
    custom_script: str | None = None,
    voice_id: str | None = None,
    heygen_character_type: str | None = None,
    aspect_ratio: str = "9:16",
) -> Any:
    """Enqueue the UGC legacy pipeline as a Celery chain.

    Splitting crawl/script, provider video, and FFmpeg/Remotion means Celery retries
    on the final step do not re-bill HeyGen/D-ID — state is read from the DB between links.
    """
    return chain(
        task_crawl_and_script.s(
            task_id,
            url,
            brief,
            avatar_id,
            video_length,
            provider,
            custom_script,
            voice_id,
            heygen_character_type,
            aspect_ratio,
        ),
        task_generate_avatar_video.si(
            task_id,
            avatar_id,
            provider,
            voice_id,
            heygen_character_type,
            aspect_ratio,
        ),
        task_finalize_ugc_video.si(task_id, aspect_ratio),
    ).apply_async()


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="re_render_ugc_task",
    queue="video_queue",
)
def re_render_ugc_task(
    self: BannerGenerationTask, task_id: str, aspect_ratio: str = "9:16"
) -> None:
    """Re-run FFmpeg composite + Remotion from ``ugc_raw_video_url`` (no HeyGen/D-ID)."""
    task_uuid = uuid.UUID(task_id)
    # Read UGC fields while the ORM session is open — ``ugc_video`` is lazy-loaded
    # and will raise DetachedInstanceError if accessed after ``with`` exits.
    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None:
            logger.warning("[re_render_ugc_task] unknown task_id=%s", task_id)
            return
        ugc = row.ugc_video
        raw = ((ugc.ugc_raw_video_url if ugc else None) or "").strip()
        sf = float(ugc.ugc_speed_factor) if ugc and ugc.ugc_speed_factor is not None else 1.15
        _script = ugc.ugc_script if ugc else None

    if not raw:
        persist_task(
            task_uuid,
            ugc_status="failed",
            ugc_error="re_render_ugc_task: ugc_raw_video_url is missing.",
        )
        return
    ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)
    logger.info(
        "[re_render_ugc_task] task_id=%s  aspect_ratio=%s  speed_factor=%s  scenes=%d",
        task_id,
        ar,
        sf,
        len((_script or {}).get("scenes") or []),
    )
    _finalize_ugc_with_composite(
        task_uuid,
        task_id,
        raw,
        ugc_script=_script,
        speed_factor=sf,
        aspect_ratio=ar,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Avatar studio — prompt-only UGC (no website crawl)
# ─────────────────────────────────────────────────────────────────────────────


@celery_app.task(
    bind=True,
    base=BannerGenerationTask,
    name="run_avatar_studio_task",
    queue="video_queue",
)
def run_avatar_studio_task(
    self: BannerGenerationTask,
    task_id: str,
    avatar_id: str,
    video_length: str,
    provider: str = "heygen_elevenlabs",
    voice_id: str | None = None,
    script_source: str = "from_brief_ai",
    creative_brief: str | None = None,
    director_notes: str | None = None,
    spoken_script: str | None = None,
    heygen_character_type: str | None = None,
    aspect_ratio: str = "9:16",
    custom_gallery_images: list[str] | None = None,
) -> None:
    """Avatar marketing video from creative prompts only (no crawl)."""
    from services.ugc_service import (
        UGCServiceError,
        dispatch_ugc_generation,
    )
    import ugc_director

    task_uuid = uuid.UUID(task_id)
    _ar = ugc_composite_service.normalize_ugc_aspect_ratio(aspect_ratio)

    logger.info(
        "[run_avatar_studio_task] task_id=%s  avatar=%s  length=%s  provider=%s  "
        "script_source=%s  voice_id=%s  aspect=%s",
        task_id,
        avatar_id,
        video_length,
        provider,
        script_source,
        voice_id or "(default)",
        _ar,
    )

    try:
        persist_task(task_uuid, ugc_status="generating_script")

        if script_source == "spoken_only":
            text = (spoken_script or "").strip()
            if not text:
                msg = "spoken_script is empty."
                persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
                raise BannerPipelineFatalError(f"[run_avatar_studio_task] {msg}")
            logger.info(
                "[run_avatar_studio_task] task_id=%s  spoken_only (%d chars).",
                task_id,
                len(text),
            )
            try:
                ugc_script = ugc_director.build_studio_spoken_only_script(
                    text, video_length
                )
            except ValueError as exc:
                msg = f"Script validation failed: {exc}"
                persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
                raise BannerPipelineFatalError(f"[run_avatar_studio_task] {msg}") from exc
        else:
            brief = (creative_brief or "").strip()
            if not brief:
                msg = "creative_brief is empty."
                persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
                raise BannerPipelineFatalError(f"[run_avatar_studio_task] {msg}")
            logger.info(
                "[run_avatar_studio_task] task_id=%s  GPT script from brief (%d chars).",
                task_id,
                len(brief),
            )
            try:
                ugc_script = ugc_director.generate_avatar_studio_script(
                    creative_brief=brief,
                    director_notes=director_notes,
                    video_length=video_length,
                )
            except Exception as exc:
                msg = f"Avatar studio script generation failed: {exc}"
                logger.error("[run_avatar_studio_task] task_id=%s  %s", task_id, msg)
                persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
                raise BannerPipelineFatalError(f"[run_avatar_studio_task] {msg}") from exc

        work_dir = TASKS_DIR / task_id
        work_dir.mkdir(parents=True, exist_ok=True)
        _enrich_ugc_script_split_gallery_dalle(
            ugc_script,
            task_id,
            work_dir,
            "run_avatar_studio_task",
            custom_gallery_images=custom_gallery_images,
        )

        persist_task(task_uuid, ugc_script=ugc_script)
        logger.info(
            "[run_avatar_studio_task] task_id=%s  script saved (%d scenes).",
            task_id,
            len(ugc_script.get("scenes", [])),
        )

        scenes = ugc_script.get("scenes") or []
        combined_spoken_text = " ".join(
            scene.get("spoken_text", "").strip() for scene in scenes
        ).strip()

        if not combined_spoken_text:
            msg = "UGC script has no spoken text in any scene."
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[run_avatar_studio_task] {msg}")

        persist_task(task_uuid, ugc_status="generating_video")
        logger.info(
            "[run_avatar_studio_task] task_id=%s  dispatching %d chars to provider=%r…",
            task_id,
            len(combined_spoken_text),
            provider,
        )

        try:
            video_url = dispatch_ugc_generation(
                provider=provider,
                script_text=combined_spoken_text,
                visual_reference=avatar_id,
                voice_id=voice_id,
                heygen_character_type=heygen_character_type,
                aspect_ratio=_ar,
            )
        except (UGCServiceError, ValueError) as exc:
            msg = f"Video generation failed ({provider}): {exc}"
            logger.error("[run_avatar_studio_task] task_id=%s  %s", task_id, msg)
            persist_task(task_uuid, ugc_status="failed", ugc_error=msg)
            raise BannerPipelineFatalError(f"[run_avatar_studio_task] {msg}") from exc

        _finalize_ugc_with_composite(
            task_uuid,
            task_id,
            video_url,
            ugc_script=ugc_script,
            aspect_ratio=_ar,
        )
        logger.info(
            "[run_avatar_studio_task] task_id=%s  COMPLETED. video_url=%s",
            task_id,
            video_url,
        )
    except Exception as exc:
        # Ensure UI always stops (status -> failed) even on unexpected exceptions.
        logger.exception(
            "[run_avatar_studio_task] task_id=%s  unhandled error: %s",
            task_id,
            exc,
        )
        persist_task(task_uuid, ugc_status="failed", ugc_error=str(exc))
        raise
    finally:
        _emergency_chrome_cleanup()
