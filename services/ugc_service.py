"""ElevenLabs TTS and HeyGen talking-avatar API wrappers for the UGC pipeline.

Public API
----------
generate_elevenlabs_audio(text, voice_id) -> bytes
    Convert text to MP3 via ElevenLabs v1 text-to-speech.

generate_heygen_avatar_video(avatar_id, audio_bytes) -> str
    Upload audio, submit a HeyGen /v2/video/generate job, poll to completion,
    and return the final CDN video URL.

All HTTP calls are wrapped with tenacity for transient-failure resilience.
"""

from __future__ import annotations

import io
import logging
import os
import time

import requests
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ElevenLabs endpoints
# ---------------------------------------------------------------------------
_ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

# Default: "Daniel" — ElevenLabs multilingual v2 voice with strong Hebrew support.
# Callers may pass any valid ElevenLabs voice_id.
_ELEVENLABS_DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9"

# ---------------------------------------------------------------------------
# HeyGen endpoints
# ---------------------------------------------------------------------------
_HEYGEN_ASSET_UPLOAD_URL = "https://upload.heygen.com/v1/asset"
_HEYGEN_VIDEO_GENERATE_URL = "https://api.heygen.com/v2/video/generate"
_HEYGEN_VIDEO_STATUS_URL = "https://api.heygen.com/v1/video_status.get"

_POLL_INTERVAL_SECONDS = 10
_MAX_POLL_ATTEMPTS = 72  # ~12 minutes ceiling; HeyGen can be slow on first renders


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class UGCServiceError(Exception):
    """Raised on unrecoverable UGC API failures (after retries are exhausted)."""


# ---------------------------------------------------------------------------
# Tenacity retry helpers
# ---------------------------------------------------------------------------

_TRANSIENT_HTTP_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def _is_transient_http_error(exc: BaseException) -> bool:
    if isinstance(exc, requests.HTTPError):
        return exc.response is not None and exc.response.status_code in _TRANSIENT_HTTP_STATUS
    return isinstance(exc, (requests.ConnectionError, requests.Timeout))


_http_retry = retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception(_is_transient_http_error),
)


# ---------------------------------------------------------------------------
# ElevenLabs — private request (decorated so tenacity wraps only I/O)
# ---------------------------------------------------------------------------


@_http_retry
def _elevenlabs_tts_request(text: str, voice_id: str, api_key: str) -> bytes:
    url = _ELEVENLABS_TTS_URL.format(voice_id=voice_id)
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.50,
            "similarity_boost": 0.75,
            "style": 0.30,
            "use_speaker_boost": True,
        },
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=120)
    resp.raise_for_status()
    return resp.content


# ---------------------------------------------------------------------------
# ElevenLabs — public API
# ---------------------------------------------------------------------------


def generate_elevenlabs_audio(
    text: str,
    voice_id: str = _ELEVENLABS_DEFAULT_VOICE_ID,
) -> bytes:
    """Convert *text* to MP3 via ElevenLabs v1 text-to-speech.

    Args:
        text:     The spoken text to synthesise.  Hebrew and other languages
                  are handled by ``eleven_multilingual_v2``.
        voice_id: ElevenLabs voice ID.  Defaults to a multilingual voice with
                  strong Hebrew support.

    Returns:
        Raw MP3 bytes ready to upload to HeyGen or save to disk.

    Raises:
        UGCServiceError: API key missing, non-transient HTTP error, or all
                         tenacity retries exhausted.
    """
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise UGCServiceError("ELEVENLABS_API_KEY is not set in the environment.")

    logger.info(
        "[ugc_service] Synthesising %d chars via ElevenLabs (voice_id=%s).",
        len(text),
        voice_id,
    )

    try:
        audio_bytes = _elevenlabs_tts_request(text, voice_id, api_key)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text[:400] if exc.response is not None else "") or ""
        raise UGCServiceError(
            f"ElevenLabs TTS request failed with HTTP {status}: {body}"
        ) from exc
    except requests.RequestException as exc:
        raise UGCServiceError(f"ElevenLabs TTS network error: {exc}") from exc

    logger.info(
        "[ugc_service] ElevenLabs returned %d bytes of audio.", len(audio_bytes)
    )
    return audio_bytes


# ---------------------------------------------------------------------------
# HeyGen — private helpers (each decorated so tenacity wraps only the I/O)
# ---------------------------------------------------------------------------


@_http_retry
def _heygen_upload_asset(audio_bytes: bytes, api_key: str) -> str:
    """Upload *audio_bytes* (MP3) to HeyGen and return the ``audio_asset_id``."""
    headers = {"X-Api-Key": api_key}
    files = {"file": ("audio.mp3", io.BytesIO(audio_bytes), "audio/mpeg")}
    resp = requests.post(
        _HEYGEN_ASSET_UPLOAD_URL, headers=headers, files=files, timeout=120
    )
    resp.raise_for_status()
    data = resp.json()

    # Accept several key aliases HeyGen has used across API versions.
    asset_id = (
        data.get("data", {}).get("id")
        or data.get("data", {}).get("asset_id")
        or data.get("asset_id")
        or data.get("id")
    )
    if not asset_id:
        raise UGCServiceError(
            f"HeyGen asset upload succeeded but returned no asset ID. Response: {data}"
        )
    return str(asset_id)


@_http_retry
def _heygen_request_video(
    avatar_id: str,
    audio_asset_id: str,
    api_key: str,
) -> str:
    """Submit a HeyGen /v2/video/generate job and return the ``video_id``."""
    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "video_inputs": [
            {
                "character": {
                    "type": "avatar",
                    "avatar_id": avatar_id,
                    "avatar_style": "normal",
                },
                "voice": {
                    "type": "audio",
                    "audio_asset_id": audio_asset_id,
                },
                "background": {
                    # Solid green screen; use "color" type since HeyGen only
                    # supports transparent backgrounds in their Studio product.
                    "type": "color",
                    "value": "#00FF00",
                },
            }
        ],
        "dimension": {"width": 1280, "height": 720},
        "test": False,
    }
    resp = requests.post(
        _HEYGEN_VIDEO_GENERATE_URL, json=payload, headers=headers, timeout=60
    )
    resp.raise_for_status()
    data = resp.json()

    video_id = (
        data.get("data", {}).get("video_id")
        or data.get("video_id")
    )
    if not video_id:
        raise UGCServiceError(
            f"HeyGen /v2/video/generate succeeded but returned no video_id. Response: {data}"
        )
    return str(video_id)


def _heygen_poll_status(video_id: str, api_key: str) -> str:
    """Poll HeyGen status until the video is 'completed' or 'failed'.

    Returns the final CDN video URL on success.
    Raises UGCServiceError on failure or timeout.
    """
    headers = {"X-Api-Key": api_key}

    for attempt in range(1, _MAX_POLL_ATTEMPTS + 1):
        try:
            resp = requests.get(
                _HEYGEN_VIDEO_STATUS_URL,
                params={"video_id": video_id},
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            logger.warning(
                "[ugc_service] HeyGen status poll attempt %d/%d failed (%s). Retrying in %ds…",
                attempt,
                _MAX_POLL_ATTEMPTS,
                exc,
                _POLL_INTERVAL_SECONDS,
            )
            time.sleep(_POLL_INTERVAL_SECONDS)
            continue

        video_data = data.get("data") or {}
        status = video_data.get("status", "")

        logger.info(
            "[ugc_service] HeyGen video %s — status=%r (poll %d/%d).",
            video_id,
            status,
            attempt,
            _MAX_POLL_ATTEMPTS,
        )

        if status == "completed":
            video_url = video_data.get("video_url") or video_data.get("url")
            if not video_url:
                raise UGCServiceError(
                    f"HeyGen video {video_id!r} completed but response contains no video_url."
                    f" Full response: {data}"
                )
            return str(video_url)

        if status == "failed":
            error_msg = (
                video_data.get("error")
                or video_data.get("message")
                or data.get("message")
                or "unknown error"
            )
            raise UGCServiceError(
                f"HeyGen video generation failed for video_id={video_id!r}: {error_msg}"
            )

        time.sleep(_POLL_INTERVAL_SECONDS)

    raise UGCServiceError(
        f"HeyGen video {video_id!r} did not complete within "
        f"{_MAX_POLL_ATTEMPTS * _POLL_INTERVAL_SECONDS}s ({_MAX_POLL_ATTEMPTS} polls)."
    )


# ---------------------------------------------------------------------------
# HeyGen — public API
# ---------------------------------------------------------------------------


def generate_heygen_avatar_video(avatar_id: str, audio_bytes: bytes) -> str:
    """Generate a HeyGen talking-avatar video from a pre-rendered audio track.

    Step A — Upload *audio_bytes* to HeyGen's asset endpoint → ``audio_asset_id``.
    Step B — POST to /v2/video/generate (avatar + audio asset, green-screen bg) → ``video_id``.
    Step C — Poll /v1/video_status.get every 10 s until status is 'completed' or 'failed'.

    Args:
        avatar_id:   HeyGen avatar ID (must be accessible under the caller's API key).
        audio_bytes: MP3 audio bytes (e.g. from :func:`generate_elevenlabs_audio`).

    Returns:
        Final CDN URL of the rendered video (``str``).

    Raises:
        UGCServiceError: API key missing, upload/generate/poll failure.
    """
    api_key = os.environ.get("HEYGEN_API_KEY", "").strip()
    if not api_key:
        raise UGCServiceError("HEYGEN_API_KEY is not set in the environment.")

    # ── Step A: upload audio ────────────────────────────────────────────────
    logger.info(
        "[ugc_service] Uploading %d bytes of audio to HeyGen.", len(audio_bytes)
    )
    try:
        audio_asset_id = _heygen_upload_asset(audio_bytes, api_key)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text[:400] if exc.response is not None else "") or ""
        raise UGCServiceError(
            f"HeyGen asset upload failed with HTTP {status}: {body}"
        ) from exc
    except requests.RequestException as exc:
        raise UGCServiceError(f"HeyGen asset upload network error: {exc}") from exc

    logger.info("[ugc_service] HeyGen audio_asset_id=%s", audio_asset_id)

    # ── Step B: request video generation ───────────────────────────────────
    logger.info(
        "[ugc_service] Submitting HeyGen video generate (avatar_id=%s).", avatar_id
    )
    try:
        video_id = _heygen_request_video(avatar_id, audio_asset_id, api_key)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text[:400] if exc.response is not None else "") or ""
        raise UGCServiceError(
            f"HeyGen /v2/video/generate failed with HTTP {status}: {body}"
        ) from exc
    except requests.RequestException as exc:
        raise UGCServiceError(
            f"HeyGen /v2/video/generate network error: {exc}"
        ) from exc

    logger.info(
        "[ugc_service] HeyGen video_id=%s — polling for completion…", video_id
    )

    # ── Step C: poll until done ─────────────────────────────────────────────
    video_url = _heygen_poll_status(video_id, api_key)
    logger.info("[ugc_service] HeyGen video completed: %s", video_url)
    return video_url
