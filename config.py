"""Application constants (avoid import cycles between api, routers, and workers).

This module is intentionally tiny and dependency-free: it must be importable
from anywhere (services, routers, workers, alembic env) without pulling in
heavy modules like FastAPI, SQLAlchemy, or OpenAI.

Use ``settings`` (env-driven config with pydantic validation) for anything that
varies between dev / staging / prod.
"""

from __future__ import annotations

from pathlib import Path

#: Directory that contains api.py, alembic.ini, the tasks/ output tree, etc.
#: Used by services/banner_service.py + worker_tasks.py to anchor filesystem paths.
BASE_DIR: Path = Path(__file__).resolve().parent

#: Primary admin email — bootstrapped on first API startup if missing.
SUPERUSER_EMAIL = "gal0673@gmail.com".lower()
