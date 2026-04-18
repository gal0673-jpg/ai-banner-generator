"""Celery application instance for the banner generator pipeline.

Start a worker locally (Windows requires gevent or solo pool):
    celery -A celery_app worker --loglevel=info -P gevent

After changing task code, restart the worker so it reloads ``worker_tasks``.

Banner pipeline task (`run_banner_task` in worker_tasks.py) uses bind=True with
``autoretry_for=(Exception,)``, ``retry_backoff=True``, and ``max_retries=3`` so
transient failures (OpenAI, crawl, disk) can recover; deterministic failures use
``BannerPipelineFatalError`` (no Celery retry). OpenAI calls in ``creative_agent``
use tenacity (3 attempts per call site) before surfacing an error to the task.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from celery import Celery
from kombu import Queue

celery_app = Celery(
    "banner_generator",
    broker="redis://127.0.0.1:6379/0",
    backend="redis://127.0.0.1:6379/0",
    include=["worker_tasks"],
)

# Explicit resource-isolated queues.
banner_queue = "banner_queue"
video_queue = "video_queue"

celery_app.conf.update(
    broker_connection_retry_on_startup=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_queues=(
        Queue(banner_queue),
        Queue(video_queue),
    ),
    task_routes={
        "run_banner_task": {"queue": banner_queue},
        "render_video_task": {"queue": video_queue},
        "run_ugc_task": {"queue": video_queue},
        "run_avatar_studio_task": {"queue": video_queue},
        "re_render_ugc_task": {"queue": video_queue},
    },
)

# ``include=`` alone does not import task modules when this file is loaded; the worker
# must register tasks before consuming. Eager import avoids "unregistered task" for
# e.g. ``render_video_task`` while ``run_banner_task`` might still appear registered
# via other import paths.
import worker_tasks  # noqa: E402, F401
