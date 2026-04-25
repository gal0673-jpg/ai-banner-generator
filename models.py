"""ORM models: User, BannerTask (+ 1:1 creative / UGC rows), VoiceCatalog, AvatarCatalog."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )

    tasks: Mapped[list["BannerTask"]] = relationship(
        "BannerTask", back_populates="user", cascade="all, delete-orphan"
    )


class BannerTask(Base):
    """Core task identity and shared workflow fields.

    Static-banner assets, canvas, and banner MP4 URLs live in ``BannerCreativeData``.
    HeyGen / UGC / avatar-studio video pipeline fields live in ``UgcVideoData``.
    """

    __tablename__ = "banner_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )
    status: Mapped[str] = mapped_column(String(64), nullable=False)
    #: banner | ugc_legacy (crawl + UGC) | avatar_studio (prompt-only avatar)
    task_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="banner")
    url: Mapped[str] = mapped_column(Text, nullable=False)
    brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="tasks")
    creative: Mapped["BannerCreativeData | None"] = relationship(
        "BannerCreativeData",
        back_populates="task",
        uselist=False,
        cascade="all, delete-orphan",
    )
    ugc_video: Mapped["UgcVideoData | None"] = relationship(
        "UgcVideoData",
        back_populates="task",
        uselist=False,
        cascade="all, delete-orphan",
    )


class BannerCreativeData(Base):
    """One-to-one: static banner copy, assets, canvas editor state, rendered PNGs, banner MP4s."""

    __tablename__ = "banner_creative_data"

    banner_task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("banner_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    headline: Mapped[str | None] = mapped_column(String(512), nullable=True)
    subhead: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    bullet_points: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cta: Mapped[str | None] = mapped_column(String(256), nullable=True)
    video_hook: Mapped[str | None] = mapped_column(String(256), nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    background_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    product_image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    rendered_banner_1_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    rendered_banner_2_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    canvas_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    video_url_1: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_url_2: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    rendered_banner_1_vertical_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    rendered_banner_2_vertical_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_url_1_vertical: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_url_2_vertical: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    video_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_render_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    task: Mapped["BannerTask"] = relationship("BannerTask", back_populates="creative")


class UgcVideoData(Base):
    """One-to-one: UGC / avatar-studio HeyGen pipeline (script, provider URLs, composite, captions)."""

    __tablename__ = "ugc_video_data"

    banner_task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("banner_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    ugc_script: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ugc_avatar_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ugc_raw_video_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: Local /task-files/... MP4 after optional FFmpeg crop-to-fill polish; null if skipped/failed.
    ugc_composited_video_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: Non-fatal composite message (e.g. ffmpeg missing, fallback to raw only).
    ugc_composite_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Final Remotion-rendered MP4 with animated Hebrew captions from the video engine; null if skipped/failed.
    ugc_final_video_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    ugc_composited_video_url_1_1: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    ugc_final_video_url_1_1: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    ugc_composited_video_url_16_9: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    ugc_final_video_url_16_9: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: Normalized site URL for Remotion overlay (no https/www), e.g. ``example.co.il``; optional.
    ugc_website_display: Mapped[str | None] = mapped_column(Text, nullable=True)
    ugc_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ugc_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Last FFmpeg / Remotion playback rate for UGC composite (1.0 = normal); optional.
    ugc_speed_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Legacy column (unused); FFmpeg always uses crop-to-fill.
    ugc_video_fit_mode: Mapped[str | None] = mapped_column(String(32), default="crop", nullable=True)

    task: Mapped["BannerTask"] = relationship("BannerTask", back_populates="ugc_video")


class VoiceCatalog(Base):
    """TTS voice entries available for avatar videos."""

    __tablename__ = "voice_catalog"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    gender: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )


class AvatarCatalog(Base):
    """Avatar entries available for avatar video generation."""

    __tablename__ = "avatar_catalog"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    gender: Mapped[str] = mapped_column(String(32), nullable=False)
    aspect_ratio: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(1024), nullable=False)
    heygen_character_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recommended_voice_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )
