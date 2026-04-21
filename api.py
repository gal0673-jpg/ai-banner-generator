"""
FastAPI application entrypoint.

Run: uvicorn api:app --reload --host 0.0.0.0 --port 8888

Route handlers live under ``routers/``; Celery tasks in ``worker_tasks.py``;
shared logic in ``services/``.
"""

from __future__ import annotations

import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

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
from routers import catalog as catalog_router  # noqa: E402
from services.banner_service import TASKS_DIR, ensure_tasks_dir  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_tasks_dir()
    if not os.environ.get("JWT_SECRET_KEY"):
        print(
            "[startup] WARNING: JWT_SECRET_KEY is not set; login and protected routes will fail until it is set."
        )

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
            print(
                f"[bootstrap] Created superuser {SUPERUSER_EMAIL}; "
                f"initial password (rotate after first login): {initial_password}"
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
app.include_router(admin_router.router)
app.include_router(catalog_router.router)
