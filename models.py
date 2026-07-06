"""ORM models: User, BannerTask (+ 1:1 creative / UGC rows), VoiceCatalog, AvatarCatalog."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from task_status import (
    BANNER_STATUS_CHECK_EXPR,
    BANNER_STATUS_CK,
    PROFILE_SCAN_STATUS_CHECK_EXPR,
    PROFILE_SCAN_STATUS_CK,
    TASK_KIND_CHECK_EXPR,
    TASK_KIND_CK,
    UGC_STATUS_CHECK_EXPR,
    UGC_STATUS_CK,
    VIDEO_STATUS_CHECK_EXPR,
    VIDEO_STATUS_CK,
)


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
    business_profiles: Mapped[list["BusinessProfile"]] = relationship(
        "BusinessProfile",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="BusinessProfile.created_at.desc()",
    )
    credits: Mapped["UserCredits | None"] = relationship(
        "UserCredits",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    credit_entries: Mapped[list["CreditLedger"]] = relationship(
        "CreditLedger",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="CreditLedger.created_at.desc()",
    )


class BusinessProfile(Base):
    """A customer's business, captured once and reused for every asset.

    This is the product's single source of truth for "who is this business":
    the user fills it in manually and/or triggers a one-time website scan that
    crawls the homepage and uses GPT to extract name / description / audience /
    tone / brand color / logo. ``context_text`` holds the canonical brief that
    seeds the creative pipelines, so generating a banner or a video no longer
    re-crawls the site each time — it reuses this profile.
    """

    __tablename__ = "business_profiles"
    __table_args__ = (
        CheckConstraint(PROFILE_SCAN_STATUS_CHECK_EXPR, name=PROFILE_SCAN_STATUS_CK),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    website_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    tone: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Key products / services / offers, free text — feeds the creative brief.
    offerings: Mapped[str | None] = mapped_column(Text, nullable=True)
    brand_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: Canonical brief that seeds the creative pipeline (built from the fields
    #: above plus any scraped content). Written in place of a fresh crawl.
    context_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: idle | scanning | ready | failed — see task_status.PROFILE_SCAN_STATUS.
    scan_status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    scan_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The user's active/primary profile — prefilled in the "create asset" flow.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="business_profiles")
    tasks: Mapped[list["BannerTask"]] = relationship(
        "BannerTask", back_populates="business_profile"
    )


class BannerTask(Base):
    """Core task identity and shared workflow fields.

    Static-banner assets, canvas, and banner MP4 URLs live in ``BannerCreativeData``.
    HeyGen / UGC / avatar-studio video pipeline fields live in ``UgcVideoData``.
    """

    __tablename__ = "banner_tasks"
    __table_args__ = (
        # CHECK constraints — allowed values come from ``task_status.py`` so the
        # ORM and the migration share one source of truth.
        CheckConstraint(BANNER_STATUS_CHECK_EXPR, name=BANNER_STATUS_CK),
        CheckConstraint(TASK_KIND_CHECK_EXPR, name=TASK_KIND_CK),
    )

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
    #: Optional link to a saved BusinessProfile. When set, the worker seeds the
    #: task's work_dir from the profile (context_text + logo) and SKIPS the crawl,
    #: so the "learn my business once" data drives every asset. SET NULL on delete
    #: so removing a profile never orphans the tasks it produced.
    business_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("business_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    user: Mapped["User"] = relationship("User", back_populates="tasks")
    business_profile: Mapped["BusinessProfile | None"] = relationship(
        "BusinessProfile", back_populates="tasks"
    )
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
    __table_args__ = (
        CheckConstraint(VIDEO_STATUS_CHECK_EXPR, name=VIDEO_STATUS_CK),
    )

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


class UgcRenderArtifact(Base):
    """Normalized UGC render output, keyed by ``(task_id, aspect_ratio, kind)``.

    Replaces the per-aspect denormalized columns on ``ugc_video_data`` (e.g.
    ``ugc_composited_video_url_1_1``, ``ugc_final_video_url_16_9``). For now we
    dual-write — the denormalized columns remain authoritative for reads so the
    API contract is unchanged. Once readers migrate, the legacy columns drop.

    Adding a new aspect (e.g. 4:5) becomes a data change, not a schema change.
    """

    __tablename__ = "ugc_renders"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('composited', 'final')", name="ck_ugc_renders_kind"
        ),
        CheckConstraint(
            "aspect_ratio IN ('9:16', '1:1', '16:9')",
            name="ck_ugc_renders_aspect_ratio",
        ),
    )

    banner_task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("banner_tasks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    aspect_ratio: Mapped[str] = mapped_column(String(8), primary_key=True)
    #: 'composited' (FFmpeg post-process output) or 'final' (Remotion + captions).
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False
    )


class UgcVideoData(Base):
    """One-to-one: UGC / avatar-studio HeyGen pipeline (script, provider URLs, composite, captions)."""

    __tablename__ = "ugc_video_data"
    __table_args__ = (
        CheckConstraint(UGC_STATUS_CHECK_EXPR, name=UGC_STATUS_CK),
    )

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
    # NOTE: ``ugc_video_fit_mode`` was removed in migration q4d5e6f7a8b9 — FFmpeg
    # always uses crop-to-fill in this codebase, so the column was permanent dead weight.

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


class UserCredits(Base):
    """One-to-one credit balance per user.

    1 credit == $0.01 of expected API cost (OpenAI / HeyGen / ElevenLabs / D-ID).
    See ``services.credits`` for the cost table and atomic debit/refund helpers.
    """

    __tablename__ = "user_credits"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Timestamp of the last monthly refill (used to throttle to one top-up per 30 days).
    last_refill_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="credits")


class CreditLedger(Base):
    """Append-only audit trail for every debit / refund / grant on ``user_credits``.

    ``amount`` is signed: negative for debits, positive for refunds/grants.
    ``balance_after`` records the resulting balance so disputes can be replayed.
    """

    __tablename__ = "credit_ledger"

    # SQLite only auto-increments INTEGER PKs (not BIGINT); use `with_variant`
    # so MySQL/Postgres still get BIGINT while tests on SQLite work transparently.
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"),
        primary_key=True,
        autoincrement=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    #: NULL for admin grants / monthly refills / signup bonus (no task context).
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("banner_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Free-form code, e.g. 'debit_generate_banner', 'refund_failed', 'grant_signup', 'refill_monthly', 'grant_admin'.
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False, index=True
    )

    user: Mapped["User"] = relationship("User", back_populates="credit_entries")
