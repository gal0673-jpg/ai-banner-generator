"""Text-to-speech providers (Strategy for audio synthesis)."""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod

import requests

from services.ugc.constants import ELEVENLABS_DEFAULT_VOICE_ID, ELEVENLABS_TTS_URL
from services.ugc.exceptions import UGCServiceError
from services.ugc.http_retry import http_retry

logger = logging.getLogger(__name__)


class AudioProvider(ABC):
    """Strategy interface for turning spoken script text into audio bytes (e.g. MP3)."""

    @abstractmethod
    def synthesize(self, text: str, *, voice_id: str) -> bytes:
        """Return raw audio bytes suitable for the video provider (e.g. MP3)."""


@http_retry
def _elevenlabs_tts_request(text: str, voice_id: str, api_key: str) -> bytes:
    url = ELEVENLABS_TTS_URL.format(voice_id=voice_id)
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": "eleven_v3",
        "language_code": "he",
        "voice_settings": {
            "stability": 0.50,
            "similarity_boost": 0.75,
            "style": 0.30,
            "use_speaker_boost": True,
        },
    }
    preview = text[:100] if text else ""
    print(f"[ugc_service] ElevenLabs TTS text preview (first 100 chars): {preview}")
    resp = requests.post(url, json=payload, headers=headers, timeout=120)
    resp.raise_for_status()
    return resp.content


class ElevenLabsAudioProvider(AudioProvider):
    """ElevenLabs TTS (``eleven_v3`` + Hebrew ``language_code``)."""

    def synthesize(self, text: str, *, voice_id: str) -> bytes:
        return generate_elevenlabs_audio(text, voice_id=voice_id)


def generate_elevenlabs_audio(
    text: str,
    voice_id: str = ELEVENLABS_DEFAULT_VOICE_ID,
) -> bytes:
    """Convert *text* to MP3 via ElevenLabs (same behavior as legacy ``ugc_service``)."""
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

    logger.info("[ugc_service] ElevenLabs returned %d bytes of audio.", len(audio_bytes))
    return audio_bytes
