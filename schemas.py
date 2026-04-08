"""Pydantic request/response models for the API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


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
