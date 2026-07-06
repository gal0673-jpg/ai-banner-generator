"""Business profile CRUD + one-time "scan my website" enrichment.

A ``BusinessProfile`` is captured once and reused for every asset. Endpoints:

* ``GET    /business/profiles``        — list the current user's profiles
* ``POST   /business/profiles``        — create from manually entered fields
* ``GET    /business/profiles/{id}``   — fetch one (also used to poll scan status)
* ``PUT    /business/profiles/{id}``   — partial update
* ``DELETE /business/profiles/{id}``   — delete
* ``POST   /business/profiles/scan``   — crawl + GPT-extract into a profile (async)
"""

from __future__ import annotations

import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import (
    AvatarCatalog,
    BannerCreativeData,
    BannerTask,
    BusinessProfile,
    UgcVideoData,
    User,
    VoiceCatalog,
)
from schemas import (
    BusinessCopyRequest,
    BusinessCopyResponse,
    BusinessProfileCreate,
    BusinessProfileRead,
    BusinessProfileScanRequest,
    BusinessProfileUpdate,
    BusinessVideoRequest,
)
from services import credits as credits_service
from services.banner_service import persist_task
from services.business_profile import build_context_text, generate_marketing_copy
from worker_tasks import run_avatar_studio_task, scan_business_profile_task

router = APIRouter(prefix="/business", tags=["business"])

# Stored on BannerTask.url (required, non-null) — the video flow never crawls.
_VIDEO_URL_PLACEHOLDER = "https://business-profile.internal/no-crawl"


def _effective_context(profile: BusinessProfile) -> str:
    """The brief that seeds generation: cached scan context, else built from fields."""
    context = (profile.context_text or "").strip()
    if context:
        return context
    return build_context_text(
        name=profile.name,
        description=profile.description,
        audience=profile.audience,
        tone=profile.tone,
        offerings=profile.offerings,
        brand_color=profile.brand_color,
    ).strip()


def _get_owned_profile(db: Session, user: User, profile_id: uuid.UUID) -> BusinessProfile:
    profile = db.get(BusinessProfile, profile_id)
    if profile is None or (not user.is_superuser and profile.user_id != user.id):
        raise HTTPException(status_code=404, detail="Unknown business profile")
    return profile


def _clear_other_defaults(db: Session, user_id: uuid.UUID, keep_id: uuid.UUID) -> None:
    """Enforce a single default profile per user."""
    others = db.execute(
        select(BusinessProfile)
        .where(BusinessProfile.user_id == user_id)
        .where(BusinessProfile.is_default.is_(True))
        .where(BusinessProfile.id != keep_id)
    ).scalars()
    for other in others:
        other.is_default = False


@router.get("/profiles", response_model=list[BusinessProfileRead])
def list_profiles(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[BusinessProfile]:
    return list(
        db.execute(
            select(BusinessProfile)
            .where(BusinessProfile.user_id == current_user.id)
            .order_by(BusinessProfile.is_default.desc(), BusinessProfile.created_at.desc())
        ).scalars()
    )


@router.post("/profiles", response_model=BusinessProfileRead, status_code=201)
def create_profile(
    body: BusinessProfileCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> BusinessProfile:
    profile = BusinessProfile(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=body.name.strip(),
        website_url=(body.website_url or "").strip() or None,
        description=(body.description or "").strip() or None,
        audience=(body.audience or "").strip() or None,
        tone=(body.tone or "").strip() or None,
        offerings=(body.offerings or "").strip() or None,
        brand_color=body.brand_color,
        logo_url=(body.logo_url or "").strip() or None,
        scan_status="idle",
        is_default=body.is_default,
    )
    db.add(profile)
    db.flush()
    if profile.is_default:
        _clear_other_defaults(db, current_user.id, profile.id)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/profiles/{profile_id}", response_model=BusinessProfileRead)
def get_profile(
    profile_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> BusinessProfile:
    return _get_owned_profile(db, current_user, profile_id)


@router.put("/profiles/{profile_id}", response_model=BusinessProfileRead)
def update_profile(
    profile_id: uuid.UUID,
    body: BusinessProfileUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> BusinessProfile:
    profile = _get_owned_profile(db, current_user, profile_id)
    patch = body.model_dump(exclude_unset=True)

    _text_fields = ("website_url", "description", "audience", "tone", "offerings", "logo_url")
    if "name" in patch and patch["name"] is not None:
        profile.name = str(patch["name"]).strip() or profile.name
    for field in _text_fields:
        if field in patch:
            value = patch[field]
            setattr(profile, field, (str(value).strip() or None) if value is not None else None)
    if "brand_color" in patch:
        profile.brand_color = patch["brand_color"]  # already normalized by the schema
    if patch.get("is_default"):
        profile.is_default = True
        db.flush()
        _clear_other_defaults(db, current_user.id, profile.id)
    elif "is_default" in patch and patch["is_default"] is False:
        profile.is_default = False

    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(
    profile_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> None:
    profile = _get_owned_profile(db, current_user, profile_id)
    db.delete(profile)
    db.commit()


def _pick_default_avatar_and_voice(db: Session) -> tuple[AvatarCatalog, str | None]:
    """Choose a sensible default avatar + voice so the customer picks neither.

    Preference: the oldest active avatar (stable/curated first), then its
    ``recommended_voice_id``; else an active voice matching the avatar's gender;
    else any active voice. Raises 400 when no active avatar exists.
    """
    avatar = db.execute(
        select(AvatarCatalog)
        .where(AvatarCatalog.is_active.is_(True))
        .order_by(AvatarCatalog.created_at)
    ).scalars().first()
    if avatar is None:
        raise HTTPException(
            status_code=400,
            detail="אין אווטארים פעילים בקטלוג. פנה למנהל המערכת כדי להוסיף אווטאר.",
        )

    voice_id = (avatar.recommended_voice_id or "").strip() or None
    if voice_id is None:
        voice = db.execute(
            select(VoiceCatalog)
            .where(VoiceCatalog.is_active.is_(True))
            .where(VoiceCatalog.gender == avatar.gender)
        ).scalars().first()
        if voice is None:
            voice = db.execute(
                select(VoiceCatalog).where(VoiceCatalog.is_active.is_(True))
            ).scalars().first()
        voice_id = voice.external_id if voice is not None else None
    return avatar, voice_id


@router.post("/video")
def generate_video(
    body: BusinessVideoRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Enqueue a marketing video from a saved profile with smart defaults.

    Reuses the avatar-studio pipeline: picks a default avatar/voice, builds the
    script brief from the profile + goal, and links the task to the profile.
    Poll ``GET /status/{task_id}`` and read ``ugc_status`` / ``ugc_final_video_url``.
    """
    profile = _get_owned_profile(db, current_user, body.business_profile_id)
    context = _effective_context(profile)
    if not context:
        raise HTTPException(
            status_code=400,
            detail="לפרופיל אין תוכן. סרוק אתר או מלא תיאור/קהל יעד לפני יצירת סרטון.",
        )

    avatar, voice_id = _pick_default_avatar_and_voice(db)

    brief = context
    if body.goal and body.goal.strip():
        brief = f"{context}\n\nמטרת הקמפיין: {body.goal.strip()}"
    brief = brief[:12000]

    aspect_ratio = (avatar.aspect_ratio or "9:16").strip() or "9:16"

    task_id = uuid.uuid4()
    cost = credits_service.cost_for_ugc(body.video_length)
    row = BannerTask(
        id=task_id,
        user_id=current_user.id,
        status="pending",
        task_kind="avatar_studio",
        url=_VIDEO_URL_PLACEHOLDER,
        brief=brief,
        error=None,
        business_profile_id=profile.id,
    )
    row.creative = BannerCreativeData(banner_task_id=task_id, logo_url=profile.logo_url)
    row.ugc_video = UgcVideoData(
        banner_task_id=task_id,
        ugc_avatar_id=avatar.external_id,
        ugc_status="pending",
    )
    db.add(row)
    db.flush()
    try:
        credits_service.debit(
            db,
            user=current_user,
            amount=cost,
            reason=f"debit_business_video_{body.video_length}",
            task_id=task_id,
        )
    except credits_service.InsufficientCreditsError as exc:
        db.rollback()
        raise credits_service.insufficient_credits_http(exc) from None
    db.commit()

    tid = str(task_id)
    try:
        run_avatar_studio_task.apply_async(
            args=[tid, avatar.external_id, body.video_length],
            kwargs={
                "provider": avatar.provider,
                "voice_id": voice_id,
                "script_source": "from_brief_ai",
                "creative_brief": brief,
                "heygen_character_type": avatar.heygen_character_type or "avatar",
                "aspect_ratio": aspect_ratio,
            },
            queue="video_queue",
        )
    except Exception as exc:
        credits_service.refund(
            current_user.id, cost, reason="refund_enqueue_failed", task_id=task_id
        )
        persist_task(task_id, ugc_status="failed", ugc_error=str(exc))
        raise HTTPException(
            status_code=503,
            detail="לא ניתן לשלוח את משימת הסרטון לתור (Celery). ודא ש-Redis רץ וה-worker פעיל.",
        ) from exc

    return {"task_id": tid}


@router.post("/copy", response_model=BusinessCopyResponse)
def generate_copy(
    body: BusinessCopyRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict:
    """Instant marketing copy from a saved profile — no crawl, no render.

    Runs the same validated GPT-4o copy step the banner pipeline uses, returning
    only the text fields, so it's fast and cheap.
    """
    profile = _get_owned_profile(db, current_user, body.business_profile_id)
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured on the server.")

    context = _effective_context(profile)
    if not context:
        raise HTTPException(
            status_code=400,
            detail="לפרופיל אין תוכן. סרוק אתר או מלא תיאור/קהל יעד לפני יצירת טקסטים.",
        )

    from openai import OpenAI

    try:
        return generate_marketing_copy(OpenAI(), context, body.goal)
    except Exception as exc:  # noqa: BLE001 — surface a clean 502 to the client
        raise HTTPException(status_code=502, detail=f"יצירת הטקסטים נכשלה: {exc}") from exc


@router.post("/profiles/scan", response_model=BusinessProfileRead, status_code=202)
def scan_profile(
    body: BusinessProfileScanRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> BusinessProfile:
    """Crawl ``website_url`` and GPT-extract a profile, asynchronously.

    Creates a new profile (or targets ``profile_id``), sets it to
    ``scan_status='scanning'``, enqueues the worker, and returns immediately.
    Poll ``GET /business/profiles/{id}`` until ``scan_status`` is ``ready`` or
    ``failed``.
    """
    website = body.website_url.strip()
    if not website:
        raise HTTPException(status_code=400, detail="website_url must not be empty")

    if body.profile_id is not None:
        profile = _get_owned_profile(db, current_user, body.profile_id)
        profile.website_url = website
        if body.name and body.name.strip():
            profile.name = body.name.strip()
    else:
        profile = BusinessProfile(
            id=uuid.uuid4(),
            user_id=current_user.id,
            name=(body.name or website).strip()[:255],
            website_url=website,
        )
        db.add(profile)

    profile.scan_status = "scanning"
    profile.scan_error = None
    db.flush()
    profile_id = str(profile.id)
    db.commit()
    db.refresh(profile)

    try:
        scan_business_profile_task.apply_async(
            args=[profile_id, website],
            queue="banner_queue",
        )
    except Exception as exc:
        profile.scan_status = "failed"
        profile.scan_error = (
            "לא ניתן לשלוח את סריקת האתר לתור (Celery). ודא ש-Redis רץ וה-worker פעיל."
        )
        db.commit()
        db.refresh(profile)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return profile
