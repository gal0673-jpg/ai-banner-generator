"""ORM models: User and BannerTask."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, Uuid
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
    url: Mapped[str] = mapped_column(Text, nullable=False)
    brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    headline: Mapped[str | None] = mapped_column(String(512), nullable=True)
    subhead: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    bullet_points: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cta: Mapped[str | None] = mapped_column(String(256), nullable=True)
    video_hook: Mapped[str | None] = mapped_column(String(256), nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    background_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    rendered_banner_1_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    rendered_banner_2_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    canvas_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    video_url_1: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_url_2: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # 9:16 vertical / Shorts format columns
    rendered_banner_1_vertical_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    rendered_banner_2_vertical_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_url_1_vertical: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    video_url_2_vertical: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # Async video render: null | "processing" | "failed" (cleared on success)
    video_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_render_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # UGC AI video columns (HeyGen / talking-avatar pipeline)
    ugc_script: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ugc_avatar_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ugc_raw_video_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    ugc_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ugc_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="tasks")
