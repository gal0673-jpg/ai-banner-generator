"""
FastAPI application entrypoint.

Run: uvicorn api:app --reload --host 0.0.0.0 --port 8888

Route handlers live under ``routers/``; Celery tasks in ``worker_tasks.py``;
shared logic in ``services/``.
"""

from __future__ import annotations

import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import sqlalchemy as sa
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

load_dotenv(Path(__file__).resolve().parent / ".env")

from auth import get_password_hash  # noqa: E402 — after load_dotenv
from config import SUPERUSER_EMAIL  # noqa: E402
from database import Base, SessionLocal, engine  # noqa: E402
from models import User  # noqa: E402
from routers import admin as admin_router  # noqa: E402
from routers import auth as auth_router  # noqa: E402
from routers import avatar_studio as avatar_studio_router  # noqa: E402
from routers import banners as banners_router  # noqa: E402
from routers import business as business_router  # noqa: E402
from routers import catalog as catalog_router  # noqa: E402
from routers import ws as ws_router  # noqa: E402
from services.banner_service import TASKS_DIR, ensure_tasks_dir  # noqa: E402
from settings import validate_startup_config  # noqa: E402

logger = logging.getLogger(__name__)


def _ensure_schema_ready() -> None:
    """Schema lifecycle policy — replaces the old ``Base.metadata.create_all()``.

    Three branches:

    1. **Totally empty DB** (no tables) → bootstrap once: ``create_all`` builds
       every table from the current ORM models, then ``alembic stamp head``
       registers them as up-to-date. This keeps fresh dev installs zero-config.
    2. **Tables exist but no ``alembic_version`` row** → legacy DB from before
       Alembic was wired in. Log an actionable warning (don't crash). The
       operator runs ``alembic stamp <revision>`` once.
    3. **DB revision != latest local revision** → log an actionable warning and
       keep serving requests with the existing schema. The operator runs
       ``alembic upgrade head`` to roll forward.

    Concurrency note: when multiple uvicorn workers start at once, only the
    *first* one that finds an empty DB will run the bootstrap. Subsequent
    workers will see the tables and skip the create_all path — that's why we
    don't crash on "tables already exist" race conditions.
    """
    insp = sa.inspect(engine)
    table_names = set(insp.get_table_names())

    project_root = Path(__file__).resolve().parent
    alembic_ini = project_root / "alembic.ini"
    if not alembic_ini.is_file():
        logger.warning(
            "[startup] alembic.ini not found at %s — skipping schema readiness check",
            alembic_ini,
        )
        return

    # Local import: alembic isn't always installed in stripped-down environments
    # (e.g. lightweight worker containers that only run Celery, never the API).
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    cfg = AlembicConfig(str(alembic_ini))
    script_dir = ScriptDirectory.from_config(cfg)
    head_rev = script_dir.get_current_head()

    if not table_names:
        logger.info(
            "[startup] empty database detected — bootstrapping schema via "
            "create_all + alembic stamp head=%s",
            head_rev,
        )
        Base.metadata.create_all(bind=engine)
        command.stamp(cfg, "head")
        return

    if "alembic_version" not in table_names:
        logger.warning(
            "[startup] %d tables exist but `alembic_version` is missing — this "
            "looks like a legacy schema. Run `alembic stamp head` once to register "
            "the current schema with Alembic (head=%s).",
            len(table_names),
            head_rev,
        )
        return

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        db_rev = ctx.get_current_revision()

    if db_rev != head_rev:
        logger.warning(
            "[startup] DB revision is %r but the latest local revision is %r. "
            "Run `alembic upgrade head` to apply pending migrations.",
            db_rev,
            head_rev,
        )
        return

    logger.info("[startup] schema is current (alembic revision=%s).", head_rev)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validate env first — fails fast on missing critical vars (DATABASE_URL,
    # JWT_SECRET_KEY). Feature-flagged keys (OPENAI_API_KEY etc.) only log a
    # warning so the API can still boot for auth/admin endpoints.
    validate_startup_config(strict_required=True)
    _ensure_schema_ready()
    ensure_tasks_dir()

    with SessionLocal() as db:
        existing = db.execute(select(User).where(User.email == SUPERUSER_EMAIL)).scalar_one_or_none()
        if existing is None:
            initial_password = secrets.token_urlsafe(24)
            su = User(
                email=SUPERUSER_EMAIL,
                hashed_password=get_password_hash(initial_password),
                is_superuser=True,
            )
            db.add(su)
            db.commit()
            # Superusers bypass credit debits in services.credits.debit(), so no
            # balance grant is needed — they can use every paid endpoint freely.
            logger.warning(
                "[bootstrap] Created superuser %s; initial password "
                "(ROTATE AFTER FIRST LOGIN): %s",
                SUPERUSER_EMAIL,
                initial_password,
            )
    yield


app = FastAPI(title="Banner generator API", lifespan=lifespan)

_default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://[::1]:5173",
    "http://[::1]:5174",
]
_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
_cors_allow = list(dict.fromkeys(_default_cors_origins + _extra))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# StaticFiles checks the directory at construction time (import), which runs
# before ``lifespan`` — so create it here, or a fresh clone crashes on startup.
ensure_tasks_dir()
app.mount("/task-files", StaticFiles(directory=str(TASKS_DIR)), name="task_files")


@app.get("/")
def api_root() -> dict[str, str]:
    """Opening :8888 in a browser hits ``/``; the UI lives on Vite (e.g. :5173)."""
    return {
        "service": "banner-generator-api",
        "docs": "/docs",
        "redoc": "/redoc",
        "ui": "http://127.0.0.1:5173",
        "message": "This port serves the JSON API only. Use /docs or the React dev server.",
    }


app.include_router(auth_router.router)
app.include_router(banners_router.router)
app.include_router(avatar_studio_router.router)
app.include_router(business_router.router)
app.include_router(admin_router.router)
app.include_router(catalog_router.router)
app.include_router(ws_router.router)
