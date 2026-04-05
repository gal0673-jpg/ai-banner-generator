"""
FastAPI backend for the banner generator React app.

Run: uvicorn api:app --reload --host 0.0.0.0 --port 8000

Requires: see requirements.txt (fastapi, uvicorn, sqlalchemy, auth libs, DB driver).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal
import json
import os
import re
import secrets
import uuid

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from auth import create_access_token, get_current_superuser, get_current_user, get_password_hash, verify_password
from ai_banner_context import OUTPUT_FILENAME, build_document
from database import Base, SessionLocal, engine, get_db
from main import BASE_DIR, crawl_from_url, run_agency_banner_pipeline
from models import BannerTask, User

TASKS_DIR = BASE_DIR / "tasks"
TASKS_DIR.mkdir(parents=True, exist_ok=True)

TaskStatus = Literal["pending", "scraped", "generating_image", "completed", "failed"]

SUPERUSER_EMAIL = "gal0673@gmail.com".lower()


def require_primary_admin(user: Annotated[User, Depends(get_current_superuser)]) -> User:
    """Only the bootstrapped primary admin (gal0673@gmail.com) may export AI context."""
    if user.email.strip().lower() != SUPERUSER_EMAIL:
        raise HTTPException(
            status_code=403,
            detail="ייצוא הקשר ל-AI זמין רק לחשבון האדמין הראשי.",
        )
    return user


_BRAND_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _persist_task(task_uuid: uuid.UUID, **kwargs: Any) -> None:
    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None:
            return
        for key, value in kwargs.items():
            setattr(row, key, value)
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",    # <-- הוספנו את זה
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/task-files", StaticFiles(directory=str(TASKS_DIR)), name="task_files")


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class GenerateRequest(BaseModel):
    url: str = Field(..., min_length=1, description="Site URL to crawl")
    brief: str | None = Field(
        default=None,
        max_length=12000,
        description="Optional campaign goal / target audience for the creative model",
    )


def run_banner_task(task_id: str, url: str, brief: str | None) -> None:
    task_uuid = uuid.UUID(task_id)
    work_dir = TASKS_DIR / task_id
    try:
        crawl_from_url(url, work_dir=work_dir, campaign_brief=brief)
        _persist_task(task_uuid, status="scraped")

        if not os.environ.get("OPENAI_API_KEY"):
            _persist_task(task_uuid, status="failed", error="OPENAI_API_KEY is not set")
            return

        _persist_task(task_uuid, status="generating_image")
        run_agency_banner_pipeline(work_dir=work_dir, site_url=url)

        campaign_path = work_dir / "creative_campaign.json"
        background = work_dir / "background.png"
        logo = work_dir / "logo.png"
        if not campaign_path.is_file() or not background.is_file() or not logo.is_file():
            _persist_task(
                task_uuid,
                status="failed",
                error="Missing creative_campaign.json, background.png, or logo.png after pipeline.",
            )
            return

        with campaign_path.open(encoding="utf-8") as f:
            data = json.load(f)

        for key in ("headline", "subhead", "cta"):
            if key not in data or not str(data[key]).strip():
                _persist_task(
                    task_uuid,
                    status="failed",
                    error=f"Invalid creative_campaign.json: missing or empty {key!r}",
                )
                return
        bullets = data.get("bullet_points")
        if not isinstance(bullets, list) or len(bullets) != 3:
            _persist_task(
                task_uuid,
                status="failed",
                error="Invalid creative_campaign.json: bullet_points must be 3 strings.",
            )
            return

        bc_raw = data.get("brand_color")
        if not isinstance(bc_raw, str) or not bc_raw.strip():
            _persist_task(
                task_uuid,
                status="failed",
                error="Invalid creative_campaign.json: missing or empty brand_color.",
            )
            return
        bc = bc_raw.strip()
        if not bc.startswith("#"):
            bc = "#" + bc
        if not _BRAND_HEX.match(bc):
            _persist_task(
                task_uuid,
                status="failed",
                error="Invalid creative_campaign.json: brand_color must be #RRGGBB hex.",
            )
            return

        _persist_task(
            task_uuid,
            status="completed",
            error=None,
            headline=str(data["headline"]).strip(),
            subhead=str(data["subhead"]).strip(),
            bullet_points=[str(b).strip() for b in bullets],
            cta=str(data["cta"]).strip(),
            brand_color=bc.upper(),
            background_url=f"/task-files/{task_id}/background.png",
            logo_url=f"/task-files/{task_id}/logo.png",
        )
    except Exception as exc:  # noqa: BLE001 — surface any pipeline failure to the client
        _persist_task(task_uuid, status="failed", error=str(exc))


@app.post("/auth/register", status_code=201)
def register(body: RegisterRequest, db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email must not be empty")
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=email,
        hashed_password=get_password_hash(body.password),
        is_superuser=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": str(user.id), "email": user.email}


@app.post("/auth/login", response_model=TokenResponse)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    # OAuth2PasswordRequestForm uses "username"; we treat it as the user's email.
    email = form_data.username.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(subject=str(user.id))
    return TokenResponse(access_token=token)


@app.post("/generate")
def generate(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url must not be empty")

    brief = (body.brief or "").strip() or None

    task_id = uuid.uuid4()
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        url=url,
        brief=brief,
        error=None,
        headline=None,
        subhead=None,
        bullet_points=None,
        cta=None,
        brand_color=None,
        background_url=None,
        logo_url=None,
    )
    db.add(row)
    db.commit()
    tid = str(task_id)
    background_tasks.add_task(run_banner_task, tid, url, brief)
    return {"task_id": tid}


@app.get("/status/{task_id}")
def get_status(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
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

    status_val: TaskStatus = row.status  # type: ignore[assignment]

    rendered_banner_path = TASKS_DIR / task_id / "rendered_banner.png"
    rendered_banner_url = (
        f"/task-files/{task_id}/rendered_banner.png"
        if rendered_banner_path.is_file()
        else None
    )

    return {
        "task_id": task_id,
        "status": status_val,
        "error": row.error,
        "headline": row.headline,
        "subhead": row.subhead,
        "bullet_points": row.bullet_points,
        "cta": row.cta,
        "brand_color": row.brand_color,
        "background_url": row.background_url,
        "logo_url": row.logo_url,
        "rendered_banner_url": rendered_banner_url,
    }


@app.get("/admin/tasks")
def admin_list_tasks(
    _: Annotated[User, Depends(get_current_superuser)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict[str, Any]]:
    stmt = select(BannerTask).options(joinedload(BannerTask.user)).order_by(BannerTask.id)
    rows = db.scalars(stmt).unique().all()
    out: list[dict[str, Any]] = []
    for t in rows:
        tid = str(t.id)
        rendered_path = TASKS_DIR / tid / "rendered_banner.png"
        out.append(
            {
                "task_id": tid,
                "user_id": str(t.user_id),
                "user_email": t.user.email,
                "status": t.status,
                "url": t.url,
                "brief": t.brief,
                "error": t.error,
                "headline": t.headline,
                "subhead": t.subhead,
                "bullet_points": t.bullet_points,
                "cta": t.cta,
                "brand_color": t.brand_color,
                "background_url": t.background_url,
                "logo_url": t.logo_url,
                "rendered_banner_url": f"/task-files/{tid}/rendered_banner.png" if rendered_path.is_file() else None,
            }
        )
    return out


@app.get("/admin/ai-banner-context")
def download_ai_banner_context(_: Annotated[User, Depends(require_primary_admin)]) -> Response:
    """Regenerate ai-banner-context.txt on disk and return it as a download (primary admin only)."""
    root = Path(__file__).resolve().parent
    text = build_document(root)
    (root / OUTPUT_FILENAME).write_text(text, encoding="utf-8")
    return Response(
        content=text.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{OUTPUT_FILENAME}"'},
    )
