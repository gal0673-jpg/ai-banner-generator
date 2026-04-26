"""Pydantic request/response models for the API.

Task status payloads (``GET /status/{task_id}``, SSE, etc.) expose a single flat JSON
object. In the database those fields are split for clarity: ``BannerTask`` holds
identity and workflow (``status``, ``task_kind``, ``url``, ``brief``, ``error``),
``BannerCreativeData`` holds static-banner and video-render columns (including
``headline``, ``canvas_state``, ``video_status``), and ``UgcVideoData`` holds the
HeyGen / UGC pipeline. Request and response *keys* are unchanged for API clients.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class GenerateUGCRequest(BaseModel):
    url: str = Field(..., min_length=1, description="Site URL to crawl")
    brief: str | None = Field(
        default=None,
        max_length=12000,
        description="Optional campaign goal / target audience",
    )
    provider: Literal["heygen_elevenlabs", "d-id"] = Field(
        default="heygen_elevenlabs",
        description="Video generation provider to use",
    )
    avatar_id: str = Field(
        ...,
        min_length=1,
        description=(
            "HeyGen Avatar ID (if provider is 'heygen_elevenlabs'), "
            "or D-ID source image URL/Avatar ID (if provider is 'd-id')"
        ),
    )
    voice_id: str | None = Field(
        default=None,
        description=(
            "Optional: Specific voice ID to use. For D-ID, this would be their voice ID. "
            "If omitted, defaults are used."
        ),
    )
    video_length: Literal["15s", "30s", "50s"] = Field(
        default="30s",
        description="Target duration of the generated UGC video",
    )
    custom_script: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional script text; when set, skips AI script generation",
    )
    heygen_character_type: Literal["avatar", "talking_photo"] = Field(
        default="avatar",
        description=(
            "HeyGen only: 'avatar' for studio/instant avatar_id, "
            "'talking_photo' for photo avatar talking_photo_id (List Avatars V2). Ignored for d-id."
        ),
    )
    website_url: str | None = Field(
        default=None,
        max_length=512,
        description=(
            "Optional URL shown on the final UGC video (top-left, then animated to center at end). "
            "Stored without https:// and www."
        ),
    )
    aspect_ratio: Literal["9:16", "16:9", "1:1"] = Field(
        default="9:16",
        description="HeyGen render dimensions + FFmpeg/Remotion composite target aspect.",
    )


class GenerateAvatarStudioRequest(BaseModel):
    """Avatar marketing video without website crawl — prompts only."""

    script_source: Literal["from_brief_ai", "spoken_only"] = Field(
        ...,
        description="from_brief_ai: GPT builds scenes from brief + director notes; "
        "spoken_only: use spoken_script as the only dialogue (no GPT).",
    )
    creative_brief: str | None = Field(
        default=None,
        max_length=12000,
        description="Goals, product, audience, offer — used when script_source is from_brief_ai",
    )
    director_notes: str | None = Field(
        default=None,
        max_length=8000,
        description="Hook/pacing/CTA structure — guides GPT only; not read aloud by TTS",
    )
    spoken_script: str | None = Field(
        default=None,
        max_length=12000,
        description="Hebrew dialogue only — required when script_source is spoken_only",
    )
    provider: Literal["heygen_elevenlabs", "d-id"] = Field(
        default="heygen_elevenlabs",
        description="Video generation provider",
    )
    avatar_id: str = Field(
        ...,
        min_length=1,
        description="HeyGen avatar ID or D-ID source image URL",
    )
    voice_id: str | None = Field(default=None, description="Optional ElevenLabs voice ID")
    video_length: Literal["15s", "30s", "50s"] = Field(
        default="30s",
        description="Target video length for AI script pacing",
    )
    heygen_character_type: Literal["avatar", "talking_photo"] = Field(
        default="avatar",
        description=(
            "HeyGen only: 'avatar' vs 'talking_photo' id kind for /v2/video/generate. Ignored for d-id."
        ),
    )
    website_url: str | None = Field(
        default=None,
        max_length=512,
        description="Optional URL for on-video overlay (no https/www in render).",
    )
    logo_url: str | None = Field(
        default=None,
        max_length=1024,
        description="Optional direct image URL for the brand logo shown at the end card.",
    )
    product_image_url: str | None = Field(
        default=None,
        max_length=1024,
        description="Optional product image URL for Remotion (center / end card).",
    )
    aspect_ratio: Literal["9:16", "16:9", "1:1"] = Field(
        default="9:16",
        description="HeyGen render dimensions + FFmpeg/Remotion composite target aspect.",
    )
    custom_gallery_images: list[str] | None = Field(
        default=None,
        description="Optional user-supplied image URLs for split_gallery slots (reserved for a future upload flow).",
    )

    @field_validator("creative_brief", "director_notes", "spoken_script", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: Any) -> Any:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @model_validator(mode="after")
    def require_brief_or_spoken(self) -> "GenerateAvatarStudioRequest":
        if self.script_source == "from_brief_ai" and not (self.creative_brief or "").strip():
            raise ValueError("creative_brief is required when script_source is 'from_brief_ai'")
        if self.script_source == "spoken_only" and not (self.spoken_script or "").strip():
            raise ValueError("spoken_script is required when script_source is 'spoken_only'")
        return self


class UgcReRenderRequest(BaseModel):
    """Optional fields for POST /tasks/{task_id}/ugc/re-render (omit keys you do not change)."""

    model_config = ConfigDict(extra="forbid")

    ugc_script: dict[str, Any] | None = None
    brand_color: str | None = Field(default=None, max_length=32)
    logo_url: str | None = Field(default=None, max_length=1024)
    product_image_url: str | None = Field(default=None, max_length=1024)
    speed_factor: float | None = Field(
        default=None,
        ge=0.5,
        le=2.0,
        description="FFmpeg playback rate for composite (1.0 = normal). Stored on ``UgcVideoData``.",
    )
    caption_animation: Literal["pop", "fade", "typewriter"] | None = Field(
        default=None,
        description="Stored under ugc_script.style.animation (Remotion caption styling).",
    )
    caption_position: Literal["bottom", "center", "top"] | None = Field(
        default=None,
        description="Stored under ugc_script.style.position.",
    )
    caption_font: Literal["heebo", "rubik", "assistant"] | None = Field(
        default=None,
        description="Stored under ugc_script.style.font.",
    )
    aspect_ratio: Literal["9:16", "1:1", "16:9"] = Field(
        default="9:16",
        description="Output aspect for FFmpeg composite + Remotion (default 9:16 vertical).",
    )


# ── Catalog schemas ───────────────────────────────────────────────────────────

class VoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    gender: str
    provider: str
    external_id: str
    is_active: bool
    created_at: datetime


class VoiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    gender: str = Field(..., min_length=1, max_length=32)
    provider: str = Field(..., min_length=1, max_length=64)
    external_id: str = Field(..., min_length=1, max_length=128)
    is_active: bool = True


class VoiceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    gender: str | None = Field(default=None, max_length=32)
    provider: str | None = Field(default=None, max_length=64)
    external_id: str | None = Field(default=None, max_length=128)
    is_active: bool | None = None


class AvatarRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    gender: str
    aspect_ratio: str
    provider: str
    external_id: str
    heygen_character_type: str | None
    recommended_voice_id: str | None
    thumbnail_url: str | None
    is_active: bool
    created_at: datetime


class AvatarCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    gender: str = Field(..., min_length=1, max_length=32)
    aspect_ratio: str = Field(..., min_length=1, max_length=16)
    provider: str = Field(..., min_length=1, max_length=64)
    external_id: str = Field(..., min_length=1, max_length=1024)
    heygen_character_type: str | None = Field(default=None, max_length=64)
    recommended_voice_id: str | None = Field(default=None, max_length=128)
    thumbnail_url: str | None = Field(default=None, max_length=1024)
    is_active: bool = True


class AvatarUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    gender: str | None = Field(default=None, max_length=32)
    aspect_ratio: str | None = Field(default=None, max_length=16)
    provider: str | None = Field(default=None, max_length=64)
    external_id: str | None = Field(default=None, max_length=1024)
    heygen_character_type: str | None = Field(default=None, max_length=64)
    recommended_voice_id: str | None = Field(default=None, max_length=128)
    thumbnail_url: str | None = Field(default=None, max_length=1024)
    is_active: bool | None = None


class TaskPatchRequest(BaseModel):
    """Partial update for an editable completed banner task (persisted on ``BannerCreativeData``)."""

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
