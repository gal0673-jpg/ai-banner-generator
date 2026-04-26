"""HeyGen + audio-asset video generation."""

from __future__ import annotations

import logging
import os
import time

import requests

from services.ugc_composite_service import normalize_ugc_aspect_ratio

from services.ugc.audio import AudioProvider, ElevenLabsAudioProvider
from services.ugc.constants import (
    ELEVENLABS_DEFAULT_VOICE_ID,
    HEYGEN_ASSET_UPLOAD_URL,
    HEYGEN_VIDEO_GENERATE_URL,
    HEYGEN_VIDEO_STATUS_URL,
    MAX_POLL_ATTEMPTS,
    POLL_INTERVAL_SECONDS,
)
from services.ugc.exceptions import UGCServiceError
from services.ugc.http_retry import http_retry
from services.ugc.provider_base import BaseUgcProvider

logger = logging.getLogger(__name__)


def _heygen_post_video_generate_timeout() -> tuple[float, float]:
    read = 180.0
    raw = os.environ.get("HEYGEN_VIDEO_GENERATE_READ_TIMEOUT", "").strip()
    if raw:
        try:
            read = float(raw)
        except ValueError:
            read = 180.0
    read = max(60.0, min(read, 600.0))
    return (15.0, read)


def _heygen_dimension_for_aspect_ratio(aspect_ratio: str = "9:16") -> dict[str, int]:
    ar = normalize_ugc_aspect_ratio(aspect_ratio)
    if ar == "1:1":
        return {"width": 1080, "height": 1080}
    if ar == "16:9":
        return {"width": 1920, "height": 1080}
    return {"width": 1080, "height": 1920}


def _log_heygen_error_response(resp: requests.Response, context: str) -> None:
    if 200 <= resp.status_code < 300:
        return
    body = resp.text or ""
    print(f"[HeyGen] {context} HTTP {resp.status_code} body: {body}")


@http_retry
def _upload_heygen_audio_asset(audio_bytes: bytes, api_key: str) -> str:
    url = HEYGEN_ASSET_UPLOAD_URL
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "audio/mpeg",
    }
    print(f"[DEBUG] Full URL: {url}")
    print(f"[DEBUG] Headers: {{'X-API-KEY': '<redacted>', 'Content-Type': 'audio/mpeg'}}")
    print(f"[DEBUG] Body: raw bytes, len={len(audio_bytes)}")
    resp = requests.post(url, headers=headers, data=audio_bytes, timeout=120)
    if resp.status_code != 200:
        print(f"[DEBUG] HeyGen asset upload error response: {resp.text}")
    resp.raise_for_status()
    data = resp.json()

    if data.get("code") != 100:
        raise UGCServiceError(f"HeyGen asset upload returned error response: {data}")

    asset_id = data.get("data", {}).get("id")
    if not asset_id:
        raise UGCServiceError(
            f"HeyGen asset upload successful (code=100) but no asset ID in response: {data}"
        )
    return str(asset_id)


@http_retry
def _heygen_request_video(
    visual_id: str,
    audio_asset_id: str,
    api_key: str,
    *,
    character_type: str = "avatar",
    aspect_ratio: str = "9:16",
) -> str:
    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }
    if character_type == "talking_photo":
        character: dict = {
            "type": "talking_photo",
            "talking_photo_id": visual_id,
            "talking_photo_style": "normal",
        }
    else:
        character = {
            "type": "avatar",
            "avatar_id": visual_id,
            "avatar_style": "normal",
            "scale": 1.0,
        }
    payload = {
        "video_inputs": [
            {
                "character": character,
                "voice": {
                    "type": "audio",
                    "audio_asset_id": audio_asset_id,
                },
            }
        ],
        "dimension": _heygen_dimension_for_aspect_ratio(aspect_ratio),
    }
    print(
        f"Calling HeyGen: {HEYGEN_VIDEO_GENERATE_URL} "
        f"(character_type={character_type!r}, id={visual_id[:16]}…, "
        f"dimension={payload['dimension']})"
    )
    resp = requests.post(
        HEYGEN_VIDEO_GENERATE_URL,
        json=payload,
        headers=headers,
        timeout=_heygen_post_video_generate_timeout(),
    )
    _log_heygen_error_response(resp, "POST /v2/video/generate")
    resp.raise_for_status()
    data = resp.json()

    api_error = data.get("error")
    if api_error is not None:
        raise UGCServiceError(
            f"HeyGen /v2/video/generate returned an error: {api_error} | full response: {data}"
        )

    video_id = (data.get("data") or {}).get("video_id")
    if not video_id:
        raise UGCServiceError(
            f"HeyGen /v2/video/generate response missing video_id: {data}"
        )
    return str(video_id)


def _heygen_poll_status(video_id: str, api_key: str) -> str:
    headers = {"x-api-key": api_key}

    for attempt in range(1, MAX_POLL_ATTEMPTS + 1):
        try:
            print(f"Calling HeyGen: {HEYGEN_VIDEO_STATUS_URL}?video_id={video_id}")
            resp = requests.get(
                HEYGEN_VIDEO_STATUS_URL,
                params={"video_id": video_id},
                headers=headers,
                timeout=30,
            )
            _log_heygen_error_response(resp, "GET video_status.get")
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            logger.warning(
                "[ugc_service] HeyGen status poll attempt %d/%d failed (%s). Retrying in %ds…",
                attempt,
                MAX_POLL_ATTEMPTS,
                exc,
                POLL_INTERVAL_SECONDS,
            )
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        video_data = data.get("data") or {}
        status = video_data.get("status", "")

        logger.info(
            "[ugc_service] HeyGen video %s — status=%r (poll %d/%d).",
            video_id,
            status,
            attempt,
            MAX_POLL_ATTEMPTS,
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

        time.sleep(POLL_INTERVAL_SECONDS)

    raise UGCServiceError(
        f"HeyGen video {video_id!r} did not complete within "
        f"{MAX_POLL_ATTEMPTS * POLL_INTERVAL_SECONDS}s ({MAX_POLL_ATTEMPTS} polls)."
    )


def generate_heygen_avatar_video(
    avatar_id: str,
    audio_bytes: bytes,
    *,
    character_type: str = "avatar",
    aspect_ratio: str = "9:16",
) -> str:
    """Generate a HeyGen talking-avatar video from a pre-rendered audio track."""
    api_key = os.environ.get("HEYGEN_API_KEY", "").strip()
    if not api_key:
        raise UGCServiceError("HEYGEN_API_KEY is not set in the environment.")

    logger.info("[ugc_service] Uploading %d bytes of audio to HeyGen.", len(audio_bytes))
    try:
        audio_asset_id = _upload_heygen_audio_asset(audio_bytes, api_key)
    except UGCServiceError:
        raise
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text[:400] if exc.response is not None else "") or ""
        raise UGCServiceError(
            f"HeyGen asset upload failed with HTTP {status}: {body}"
        ) from exc
    except requests.RequestException as exc:
        raise UGCServiceError(f"HeyGen asset upload network error: {exc}") from exc

    logger.info("[ugc_service] HeyGen audio_asset_id=%s", audio_asset_id)
    print(
        f"[DEBUG] generate_heygen_avatar_video: using asset id from upload "
        f"as voice.audio_asset_id={audio_asset_id!r} for POST /v2/video/generate "
        f"(character_type={character_type!r})"
    )

    logger.info(
        "[ugc_service] Submitting HeyGen video generate (id=%s, character_type=%s).",
        avatar_id,
        character_type,
    )
    try:
        video_id = _heygen_request_video(
            avatar_id,
            audio_asset_id,
            api_key,
            character_type=character_type,
            aspect_ratio=aspect_ratio,
        )
    except UGCServiceError:
        raise
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

    logger.info("[ugc_service] HeyGen video_id=%s — polling for completion…", video_id)
    video_url = _heygen_poll_status(video_id, api_key)
    logger.info("[ugc_service] HeyGen video completed: %s", video_url)
    return video_url


class HeyGenProvider(BaseUgcProvider):
    """HeyGen video pipeline driven by an :class:`AudioProvider` for TTS."""

    def __init__(self, audio: AudioProvider | None = None) -> None:
        self._audio = audio or ElevenLabsAudioProvider()

    def generate_video(
        self,
        script_text: str,
        visual_reference: str,
        *,
        voice_id: str | None = None,
        heygen_character_type: str | None = None,
        aspect_ratio: str = "9:16",
    ) -> str:
        ct = (heygen_character_type or "avatar").strip().lower()
        if ct not in ("avatar", "talking_photo"):
            raise ValueError(
                f"heygen_character_type must be 'avatar' or 'talking_photo', not {ct!r}."
            )
        el_voice_id = voice_id if voice_id else ELEVENLABS_DEFAULT_VOICE_ID
        logger.info("[ugc_service] dispatch → heygen_elevenlabs pipeline.")
        audio_bytes = self._audio.synthesize(script_text, voice_id=el_voice_id)
        return generate_heygen_avatar_video(
            visual_reference,
            audio_bytes,
            character_type=ct,
            aspect_ratio=aspect_ratio,
        )
