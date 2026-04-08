"""Celery task definitions (imported by the worker process; keep free of FastAPI app imports)."""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any

import requests
from celery import Task

from celery_app import celery_app
from database import SessionLocal
from main import crawl_from_url, run_agency_banner_pipeline
from models import BannerTask
from services.banner_service import TASKS_DIR, persist_task, rendered_banner_urls_for_task
from services.video_service import video_engine_render_url, video_payload_for_engine

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


@celery_app.task(bind=True, base=BannerGenerationTask, name="run_banner_task")
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
    # Move off "pending" as soon as the worker picks up the job — crawl (Selenium) can take minutes.
    persist_task(task_uuid, status="scraped")
    print(f"[run_banner_task] task_id={task_id} status=scraped (crawl starting)", flush=True)
    crawl_from_url(url, work_dir=work_dir, campaign_brief=brief)

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


@celery_app.task(name="render_video_task")
def render_video_task(
    task_id: str,
    design_type: int,
    aspect_ratio: str,
    public_base: str,
) -> None:
    execute_video_render_worker(task_id, design_type, aspect_ratio, public_base)
