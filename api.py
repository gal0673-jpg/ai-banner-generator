"""
FastAPI backend for the banner generator React app.

Run: uvicorn api:app --reload --host 0.0.0.0 --port 8888

Requires: see requirements.txt (fastapi, uvicorn, sqlalchemy, auth libs, DB driver).
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal
import json
import os
import re
import secrets
import uuid

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from auth import create_access_token, get_current_superuser, get_current_user, get_password_hash, verify_password
from ai_banner_context import OUTPUT_FILENAME, build_document
from celery_app import celery_app
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


def _rendered_banner_urls_for_task(task_id: str) -> tuple[str | None, str | None]:
    """Resolve static URLs for Design 1 / Design 2 PNGs; fall back to legacy rendered_banner.png for v1."""
    work = TASKS_DIR / task_id
    u1: str | None = None
    u2: str | None = None
    if (work / "rendered_banner_1.png").is_file():
        u1 = f"/task-files/{task_id}/rendered_banner_1.png"
    elif (work / "rendered_banner.png").is_file():
        u1 = f"/task-files/{task_id}/rendered_banner.png"
    if (work / "rendered_banner_2.png").is_file():
        u2 = f"/task-files/{task_id}/rendered_banner_2.png"
    return u1, u2


def _banner_task_status_dict(task_id: str, row: BannerTask) -> dict[str, Any]:
    """Full task payload for REST status, SSE, and /banners/latest (includes url/brief for form restore)."""
    fs1, fs2 = _rendered_banner_urls_for_task(task_id)
    status_val: TaskStatus = row.status  # type: ignore[assignment]
    return {
        "task_id": task_id,
        "url": row.url,
        "brief": row.brief,
        "status": status_val,
        "error": row.error,
        "headline": row.headline,
        "subhead": row.subhead,
        "bullet_points": row.bullet_points,
        "cta": row.cta,
        "video_hook": row.video_hook,
        "brand_color": row.brand_color,
        "background_url": row.background_url,
        "logo_url": row.logo_url,
        "rendered_banner_1_url": row.rendered_banner_1_url or fs1,
        "rendered_banner_2_url": row.rendered_banner_2_url or fs2,
        "canvas_state": row.canvas_state,
        "video_url_1": row.video_url_1,
        "video_url_2": row.video_url_2,
        "rendered_banner_1_vertical_url": row.rendered_banner_1_vertical_url,
        "rendered_banner_2_vertical_url": row.rendered_banner_2_vertical_url,
        "video_url_1_vertical": row.video_url_1_vertical,
        "video_url_2_vertical": row.video_url_2_vertical,
    }


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

# With allow_credentials=True, browsers require explicit origins (not "*").
# Add comma-separated URLs in CORS_ORIGINS for LAN / custom Vite ports (e.g. http://192.168.1.5:5173).
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
    video_hook: str | None = Field(
        default=None,
        max_length=256,
        description="Optional custom video hook that overrides the AI-generated one",
    )


class RenderVideoRequest(BaseModel):
    """Which template to render (1 = split-panel, 2 = immersive) and which canvas slice to use."""

    design_type: Literal[1, 2] = 1
    aspect_ratio: Literal["1:1", "9:16"] = "1:1"

    @field_validator("design_type", mode="before")
    @classmethod
    def coerce_design_type(cls, v: Any) -> Any:
        if v is None:
            return 1
        try:
            n = int(v)
        except (TypeError, ValueError):
            return 1
        return 2 if n == 2 else 1

    @field_validator("aspect_ratio", mode="before")
    @classmethod
    def coerce_aspect_ratio(cls, v: Any) -> Any:
        if v is None:
            return "1:1"
        return "9:16" if str(v).strip() == "9:16" else "1:1"


class TaskPatchRequest(BaseModel):
    """Partial update for an editable completed banner task."""

    headline: str | None = Field(default=None, max_length=512)
    subhead: str | None = Field(default=None, max_length=1024)
    cta: str | None = Field(default=None, max_length=256)
    bullet_points: list[str] | None = None
    video_hook: str | None = Field(default=None, max_length=256)
    canvas_state: dict[str, Any] | None = None

    @field_validator("bullet_points")
    @classmethod
    def three_bullets(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if len(v) != 3:
            raise ValueError("bullet_points must contain exactly 3 strings")
        return [str(x).strip() for x in v]


def _public_api_base(request: Request) -> str:
    """Origin for turning /task-files/... into absolute URLs for the video microservice."""
    env = os.environ.get("PUBLIC_API_BASE_URL", "").strip()
    if env:
        return env.rstrip("/")
    return str(request.base_url).rstrip("/")


def _video_engine_render_url() -> str:
    base = os.environ.get("VIDEO_ENGINE_URL", "http://127.0.0.1:9000").rstrip("/")
    return f"{base}/render"


def _pick_canvas_slice(canvas_state: Any, design: int, aspect_ratio: str = "1:1") -> dict[str, Any]:
    if not isinstance(canvas_state, dict):
        return {}
    if aspect_ratio == "9:16":
        key = "design1_vertical" if design == 1 else "design2_vertical"
    else:
        key = "design1" if design == 1 else "design2"
    sl = canvas_state.get(key)
    return sl if isinstance(sl, dict) else {}


def _prefer_slice_str(sl: dict[str, Any], key: str, row_val: str | None) -> str:
    if key in sl:
        v = sl[key]
        if isinstance(v, str):
            return v.strip()
    if row_val is None:
        return ""
    return str(row_val).strip()


def _prefer_slice_bullets(sl: dict[str, Any], row_bullets: list | None) -> list[str]:
    raw = sl.get("bullets")
    if not isinstance(raw, list):
        raw = sl.get("bullet_points")
    if isinstance(raw, list) and all(isinstance(x, str) for x in raw):
        return [str(x).strip() for x in raw]
    if isinstance(row_bullets, list):
        return [str(x).strip() for x in row_bullets]
    return []


def _absolute_asset_url(public_base: str, path: str | None) -> str:
    if not path:
        return ""
    p = str(path).strip()
    if p.startswith("http://") or p.startswith("https://"):
        return p
    base = public_base.rstrip("/")
    if not p.startswith("/"):
        p = "/" + p
    return base + p


def _banner_video_payload(row: BannerTask, design: int, public_base: str, aspect_ratio: str = "1:1") -> dict[str, Any]:
    """Merge DB columns with canvas_state (design1/design2/vertical); slice wins when a key is present."""
    sl = _pick_canvas_slice(row.canvas_state, design, aspect_ratio)
    headline = _prefer_slice_str(sl, "headline", row.headline)
    subhead = _prefer_slice_str(sl, "subhead", row.subhead)
    cta = _prefer_slice_str(sl, "cta", row.cta)
    bullet_points = _prefer_slice_bullets(sl, row.bullet_points)
    bc_sl = sl.get("brand_color")
    if isinstance(bc_sl, str) and bc_sl.strip():
        brand_color = bc_sl.strip()
    else:
        brand_color = (row.brand_color or "#2563eb").strip() or "#2563eb"
    if not brand_color.startswith("#"):
        brand_color = "#" + brand_color

    background_url = _absolute_asset_url(public_base, row.background_url)
    logo_url = _absolute_asset_url(public_base, row.logo_url)
    video_hook = _prefer_slice_str(sl, "video_hook", row.video_hook)

    return {
        "headline": headline,
        "subhead": subhead,
        "cta": cta,
        "bullet_points": bullet_points,
        "brand_color": brand_color,
        "background_url": background_url,
        "logo_url": logo_url,
        "video_hook": video_hook,
    }


def _video_payload_for_engine(row: BannerTask, design_type: int, public_base: str, aspect_ratio: str = "1:1") -> dict[str, Any]:
    """Banner fields + explicit layout flags for the Node /render endpoint."""
    payload = _banner_video_payload(row, design_type, public_base, aspect_ratio)
    hook = (payload.get("video_hook") or "").strip()
    payload["video_hook"] = hook
    payload["videoHook"] = hook
    dt = 2 if int(design_type) == 2 else 1
    payload["design_type"] = dt
    payload["designTemplate"] = dt
    # Explicit string so Remotion never mis-reads template (split = עיצוב 1, immersive = עיצוב 2)
    payload["video_layout"] = "immersive" if dt == 2 else "split"
    payload["videoLayout"] = payload["video_layout"]
    payload["aspect_ratio"] = aspect_ratio
    payload["aspectRatio"] = aspect_ratio
    payload["isVertical"] = aspect_ratio == "9:16"
    return payload


def _merge_canvas_state(prev: Any, patch: dict[str, Any] | None) -> dict[str, Any] | None:
    """Merge partial canvas_state from PATCH; replace any known design key when provided."""
    if patch is None:
        return prev if isinstance(prev, dict) else None
    base: dict[str, Any] = dict(prev) if isinstance(prev, dict) else {}
    for key in ("v", "design1", "design2", "design1_vertical", "design2_vertical"):
        if key in patch:
            base[key] = patch[key]
    return base or None


@celery_app.task(name="run_banner_task")
def run_banner_task(task_id: str, url: str, brief: str | None, custom_video_hook: str | None = None) -> None:
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

        # video_hook: custom hook from the user overrides the AI-generated one;
        # fall back to creative_campaign.json; tolerate absence for legacy JSON.
        raw_hook = data.get("video_hook")
        ai_hook: str | None = str(raw_hook).strip()[:256] if raw_hook and str(raw_hook).strip() else None
        video_hook_val: str | None = custom_video_hook or ai_hook
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

        rb1, rb2 = _rendered_banner_urls_for_task(task_id)
        _persist_task(
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


@app.post("/auth/login")
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    # OAuth2PasswordRequestForm uses "username"; we treat it as the user's email.
    email = form_data.username.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(subject=str(user.id))
    response.set_cookie(
        key="access_token",
        value=f"Bearer {token}",
        httponly=True,
        samesite="lax",
        secure=False,   # set to True in production behind HTTPS
    )
    return {"message": "Login successful"}


@app.get("/auth/me")
def auth_me(current_user: Annotated[User, Depends(get_current_user)]) -> dict[str, str]:
    """Return the current user when the HttpOnly session cookie is valid (SPA bootstrap)."""
    return {"email": current_user.email}


@app.post("/auth/logout")
def logout_user(response: Response) -> dict[str, str]:
    response.delete_cookie("access_token")
    return {"message": "Logged out"}


@app.post("/generate")
def generate(
    body: GenerateRequest,
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
        video_hook=None,
        brand_color=None,
        background_url=None,
        logo_url=None,
        rendered_banner_1_url=None,
        rendered_banner_2_url=None,
        canvas_state=None,
        video_url_1=None,
        video_url_2=None,
        rendered_banner_1_vertical_url=None,
        rendered_banner_2_vertical_url=None,
        video_url_1_vertical=None,
        video_url_2_vertical=None,
    )
    db.add(row)
    db.commit()
    tid = str(task_id)
    try:
        run_banner_task.delay(tid, url, brief)
    except Exception as exc:
        _persist_task(task_id, status="failed", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail=(
                "לא ניתן לשלוח את המשימה לתור (Celery). ודא ש-Redis רץ (למשל ב-Laragon) "
                "ושה-worker פעיל."
            ),
        ) from exc
    return {"task_id": tid}


@app.get("/banners/latest")
def get_latest_banner(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Latest banner task for the current user (by created_at), or task_id null when none."""
    stmt = (
        select(BannerTask)
        .where(BannerTask.user_id == current_user.id)
        .order_by(BannerTask.created_at.desc())
        .limit(1)
    )
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        return {"task_id": None, "url": None, "brief": None}
    return _banner_task_status_dict(str(row.id), row)


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

    return _banner_task_status_dict(task_id, row)


@app.get("/status/{task_id}/stream")
async def stream_task_status(
    task_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """Stream live task-status updates as Server-Sent Events (text/event-stream)."""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown task_id") from None

    # Authorisation check before opening the stream.
    with SessionLocal() as db:
        row = db.get(BannerTask, tid)
        if row is None or (not current_user.is_superuser and row.user_id != current_user.id):
            raise HTTPException(status_code=404, detail="Unknown task_id")

    async def event_generator():
        # Emit the first snapshot immediately on connect, then only when status changes
        # (reconnect / refresh still get one fresh frame).
        last_emitted_status: str | None = None
        while True:
            event_payload: dict[str, Any] | None = None
            current_status: str | None = None

            # Open a fresh short-lived session on every tick so we always
            # read the latest committed state from the database.
            with SessionLocal() as db:
                row = db.get(BannerTask, tid)
                if row is None:
                    break
                current_status = row.status  # type: ignore[assignment]
                if last_emitted_status is None or current_status != last_emitted_status:
                    last_emitted_status = current_status
                    event_payload = _banner_task_status_dict(task_id, row)

            if event_payload is not None:
                yield f"data: {json.dumps(event_payload)}\n\n"

            if current_status in ("completed", "failed"):
                break  # close the stream; client will receive the final event

            await asyncio.sleep(1.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # prevent Nginx / proxy buffering
        },
    )


@app.patch("/tasks/{task_id}")
def patch_task(
    task_id: str,
    body: TaskPatchRequest,
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
    if row.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Task can only be edited after it is completed.",
        )

    if body.headline is not None:
        row.headline = body.headline.strip() or None
    if body.subhead is not None:
        row.subhead = body.subhead.strip() or None
    if body.cta is not None:
        row.cta = body.cta.strip() or None
    if body.bullet_points is not None:
        row.bullet_points = body.bullet_points
    if body.video_hook is not None:
        row.video_hook = body.video_hook.strip() or None

    if body.canvas_state is not None:
        row.canvas_state = _merge_canvas_state(row.canvas_state, body.canvas_state)

    db.commit()
    db.refresh(row)

    return {
        "task_id": task_id,
        "headline": row.headline,
        "subhead": row.subhead,
        "bullet_points": row.bullet_points,
        "cta": row.cta,
        "video_hook": row.video_hook,
        "canvas_state": row.canvas_state,
    }


@app.post("/tasks/{task_id}/render-video")
def render_task_video(
    task_id: str,
    body: RenderVideoRequest,
    request: Request,
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
    if row.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Task must be completed before rendering video.",
        )

    public_base = _public_api_base(request)
    payload = _video_payload_for_engine(row, body.design_type, public_base, body.aspect_ratio)
    payload["task_id"] = task_id
    if not payload["headline"]:
        raise HTTPException(status_code=400, detail="headline is required for video render.")
    if not payload["background_url"]:
        raise HTTPException(status_code=400, detail="background_url is missing for this task.")

    render_url = _video_engine_render_url()
    try:
        r = requests.post(render_url, json=payload, timeout=600)
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Video engine unreachable ({render_url}): {exc}",
        ) from exc

    if r.status_code >= 400:
        detail = r.text[:500] if r.text else r.reason
        try:
            err_json = r.json()
            if isinstance(err_json, dict):
                raw_d = err_json.get("details") or err_json.get("error") or detail
                if isinstance(raw_d, list):
                    detail = " ".join(str(x) for x in raw_d)
                else:
                    detail = raw_d
        except (json.JSONDecodeError, ValueError):
            pass
        raise HTTPException(status_code=502, detail=f"Video engine error: {detail}")

    try:
        data = r.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="Video engine returned invalid JSON.",
        ) from exc

    if not data.get("success"):
        fail = data.get("error") or data.get("details") or "Video render failed"
        if isinstance(fail, list):
            fail = " ".join(str(x) for x in fail)
        raise HTTPException(status_code=502, detail=str(fail))

    video_url = data.get("videoUrl") or data.get("video_url")
    if not video_url or not isinstance(video_url, str):
        raise HTTPException(
            status_code=502,
            detail="Video engine response missing videoUrl.",
        )

    cleaned = video_url.strip()
    is_vertical = body.aspect_ratio == "9:16"
    if body.design_type == 2:
        if is_vertical:
            row.video_url_2_vertical = cleaned
        else:
            row.video_url_2 = cleaned
    else:
        if is_vertical:
            row.video_url_1_vertical = cleaned
        else:
            row.video_url_1 = cleaned
    db.commit()
    db.refresh(row)

    return {
        "task_id": task_id,
        "design_type": body.design_type,
        "aspect_ratio": body.aspect_ratio,
        "video_url": cleaned,
        "video_url_1": row.video_url_1,
        "video_url_2": row.video_url_2,
        "video_url_1_vertical": row.video_url_1_vertical,
        "video_url_2_vertical": row.video_url_2_vertical,
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
        fs1, fs2 = _rendered_banner_urls_for_task(tid)
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
                "video_hook": t.video_hook,
                "brand_color": t.brand_color,
                "background_url": t.background_url,
                "logo_url": t.logo_url,
                "rendered_banner_1_url": t.rendered_banner_1_url or fs1,
                "rendered_banner_2_url": t.rendered_banner_2_url or fs2,
                "canvas_state": t.canvas_state,
                "video_url_1": t.video_url_1,
                "video_url_2": t.video_url_2,
                "rendered_banner_1_vertical_url": t.rendered_banner_1_vertical_url,
                "rendered_banner_2_vertical_url": t.rendered_banner_2_vertical_url,
                "video_url_1_vertical": t.video_url_1_vertical,
                "video_url_2_vertical": t.video_url_2_vertical,
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
        headers={
            "Content-Disposition": f'attachment; filename="{OUTPUT_FILENAME}"',
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )
