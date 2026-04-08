"""Celery application instance for the banner generator pipeline.

Start a worker locally (Windows requires gevent or solo pool):
    celery -A celery_app worker --loglevel=info -P gevent
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
