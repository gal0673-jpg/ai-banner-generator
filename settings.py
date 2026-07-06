"""Centralized configuration with eager validation.

Why a separate module from ``config.py``?
- ``config.py`` holds *compile-time* constants (e.g. the primary admin email).
- ``settings.py`` validates and exposes *environment-driven* config: secrets,
  service URLs, feature toggles.

Design choices:

1. **Tiered validation.** ``CRITICAL`` env vars (DB URL, JWT secret, Redis broker)
   are required and missing them raises at startup. Provider API keys (OpenAI,
   HeyGen, ElevenLabs, D-ID) are *feature-required*: missing one disables the
   feature with a clear warning, but the API still boots so admins can fix the
   issue without the whole service being down.

2. **No silent fallbacks.** A misconfigured DATABASE_URL must crash on startup,
   not silently fall back to a default that points at the wrong DB.

3. **Existing ``os.environ.get`` calls keep working.** This module is additive —
   it doesn't force a refactor of the 30+ existing call sites. New code can
   import ``from settings import settings`` for a typed accessor; for now its
   main job is the startup readiness check.

4. **Cached.** ``get_settings()`` memoizes the parsed object so test fixtures
   can patch ``os.environ`` and call ``reload_settings()`` to refresh.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


_PROJECT_ROOT = Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Typed snapshot of environment configuration.

    Loaded once at startup from ``.env`` (project root) plus the OS environment.
    Subsequent reads go through the cached instance (see ``get_settings()``).
    """

    model_config = SettingsConfigDict(
        env_file=_PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        # Allow unrelated env vars (we have many: VITE_*, UGC_*, UC_*, etc.)
        # to coexist without raising — only listed fields are validated.
        extra="ignore",
    )

    # ── Critical (required) ───────────────────────────────────────────────────

    DATABASE_URL: str = Field(
        ...,
        min_length=1,
        description="SQLAlchemy URL, e.g. mysql+pymysql://user:pass@host/dbname",
    )
    JWT_SECRET_KEY: str = Field(
        ...,
        min_length=16,
        description="HMAC signing key for session JWTs. Generate with `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`",
    )
    REDIS_URL: str = Field(
        default="redis://127.0.0.1:6379/0",
        description="Celery broker + Pub/Sub channel. Default matches Laragon's bundled Redis.",
    )

    # ── JWT / auth tuning ─────────────────────────────────────────────────────

    JWT_ALGORITHM: Literal["HS256", "HS384", "HS512"] = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=10080, gt=0, le=525600)

    # ── Session cookie behavior (already validated in auth.py; mirrored here
    #    so the startup report covers it too) ──────────────────────────────────

    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    COOKIE_DOMAIN: str | None = None

    # ── CORS ─────────────────────────────────────────────────────────────────

    CORS_ORIGINS: str = ""  # comma-separated, parsed by api.py at startup

    # ── Provider keys (feature-required, validated separately) ────────────────

    OPENAI_API_KEY: str = ""
    HEYGEN_API_KEY: str = ""
    ELEVENLABS_API_KEY: str = ""
    D_ID_API_KEY: str = ""

    # ── Render pipeline tunables ──────────────────────────────────────────────

    UGC_FFMPEG_BINARY: str = ""
    MAX_CONCURRENT_RENDERS: int = Field(default=2, gt=0, le=16)
    UGC_RENDER_TIMEOUT_MS: int = Field(default=180_000, gt=0)
    VIDEO_ENGINE_RENDER_UGC_TIMEOUT: int = Field(default=240, gt=0)
    VIDEO_ENGINE_URL: str = "http://127.0.0.1:9000"

    # ── Cross-validation ──────────────────────────────────────────────────────

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def _reject_obvious_placeholders(cls, v: str) -> str:
        placeholders = {
            "", "changeme", "change-me", "secret", "your_secret_key",
            "your-secret-key", "TODO", "FIXME",
        }
        if v.strip().lower() in placeholders:
            raise ValueError(
                "JWT_SECRET_KEY looks like a placeholder. Generate a real one "
                "with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return v


# ── Feature-required provider keys ────────────────────────────────────────────


_FEATURES: dict[str, list[str]] = {
    "Banner generation (POST /generate)": ["OPENAI_API_KEY"],
    "UGC video (POST /generate-ugc, HeyGen path)": ["HEYGEN_API_KEY", "ELEVENLABS_API_KEY"],
    "UGC video (POST /generate-ugc, D-ID path)":   ["D_ID_API_KEY", "ELEVENLABS_API_KEY"],
    "Avatar studio (POST /avatar-studio/generate)": ["OPENAI_API_KEY", "HEYGEN_API_KEY", "ELEVENLABS_API_KEY"],
}


#: Module-level memoization for the report so the import chain doesn't double-log.
_validation_report_cache: dict[str, list[str]] | None = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Build (and cache) the validated Settings object."""
    return Settings()  # type: ignore[call-arg]


def reload_settings() -> Settings:
    """Drop the cache (useful for tests that mutate ``os.environ``)."""
    global _validation_report_cache
    get_settings.cache_clear()
    _validation_report_cache = None
    return get_settings()


def validate_startup_config(*, strict_required: bool = True) -> dict[str, list[str]]:
    """Validate env at startup. Returns a report and (in strict mode) raises on critical errors.

    Output shape::

        {
            "ok":              [...features enabled, with all keys present],
            "disabled":        [...features missing one or more API keys],
            "warnings":        [...non-fatal config quirks (e.g. dev cookie in prod-shaped env)],
        }

    Behavior:
    - Critical fields (DATABASE_URL, JWT_SECRET_KEY) → ``Settings()`` raises
      ``ValidationError`` and we re-raise as ``RuntimeError`` with a human message.
    - Feature keys missing → logged as WARNING, added to ``disabled`` list,
      returned to caller. The API keeps booting.

    Memoized: in the API process the import chain triggers this once via
    ``celery_app.py`` and again via ``api.lifespan``; the cached report is
    returned on the second call so the feature list isn't double-logged.
    Call ``reload_settings()`` (which also clears the report cache) in tests.
    """
    global _validation_report_cache
    if _validation_report_cache is not None:
        return _validation_report_cache

    try:
        s = get_settings()
    except ValidationError as exc:
        lines = ["[startup] FATAL: environment is not valid. Fix .env and retry."]
        for err in exc.errors():
            loc = ".".join(str(x) for x in err.get("loc", ()))
            lines.append(f"  - {loc}: {err.get('msg')}")
        msg = "\n".join(lines)
        logger.error(msg)
        if strict_required:
            raise RuntimeError(msg) from exc
        return {"ok": [], "disabled": [], "warnings": [msg]}

    enabled: list[str] = []
    disabled: list[str] = []
    warnings: list[str] = []

    for feature, required_keys in _FEATURES.items():
        missing = [k for k in required_keys if not (getattr(s, k, "") or "").strip()]
        if missing:
            disabled.append(f"{feature} — missing: {', '.join(missing)}")
        else:
            enabled.append(feature)

    # Spot a common foot-gun: prod-shaped CORS list but cookie still insecure.
    cross_origin = any(o.strip().startswith("https://") for o in s.CORS_ORIGINS.split(","))
    if cross_origin and not s.COOKIE_SECURE:
        warnings.append(
            "CORS_ORIGINS contains an https:// origin but COOKIE_SECURE=false — "
            "browsers will refuse the session cookie. Set COOKIE_SECURE=true."
        )

    if disabled:
        logger.warning(
            "[startup] %d feature(s) disabled by missing API keys:\n  - %s",
            len(disabled),
            "\n  - ".join(disabled),
        )
    if enabled:
        logger.info(
            "[startup] %d feature(s) enabled:\n  - %s",
            len(enabled),
            "\n  - ".join(enabled),
        )
    for w in warnings:
        logger.warning("[startup] %s", w)

    _validation_report_cache = {"ok": enabled, "disabled": disabled, "warnings": warnings}
    return _validation_report_cache


# Convenience: top-level ``settings`` for ``from settings import settings`` patterns
# in new code. Trampolines through the cache, so test mutations via
# ``reload_settings()`` are visible.

def __getattr__(name: str):  # PEP 562 module-level __getattr__
    if name == "settings":
        return get_settings()
    raise AttributeError(f"module 'settings' has no attribute {name!r}")
