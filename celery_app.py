"""Celery application instance for the banner generator pipeline.

Start a worker locally (Windows requires gevent or solo pool):
    celery -A celery_app worker --loglevel=info -P gevent

Banner pipeline task (`run_banner_task` in api.py) uses bind=True with
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

celery_app = Celery(
    "banner_generator",
    broker="redis://127.0.0.1:6379/0",
    backend="redis://127.0.0.1:6379/0",
    include=['api']
)

celery_app.conf.update(
    broker_connection_retry_on_startup=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)
