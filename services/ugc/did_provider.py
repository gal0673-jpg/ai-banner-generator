"""D-ID /talks video generation (static image + uploaded audio)."""

from __future__ import annotations

import logging
import os
import time

import requests

from services.ugc.audio import AudioProvider, ElevenLabsAudioProvider
from services.ugc.constants import (
    DID_API_URL,
    DID_AUDIOS_URL,
    DID_MAX_POLL_ATTEMPTS,
    DID_POLL_INTERVAL_SECONDS,
    DID_POLL_URL,
    ELEVENLABS_DEFAULT_VOICE_ID,
)
from services.ugc.exceptions import UGCServiceError
from services.ugc.http_retry import http_retry
from services.ugc.provider_base import BaseUgcProvider

logger = logging.getLogger(__name__)


@http_retry
def _did_upload_audio(audio_bytes: bytes, api_key: str) -> str:
    headers = {"Authorization": f"Basic {api_key}"}
    files = {"audio": ("speech.mp3", audio_bytes, "audio/mpeg")}
    resp = requests.post(DID_AUDIOS_URL, headers=headers, files=files, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    url = data.get("url")
    if not url:
        raise UGCServiceError(f"D-ID /audios response missing 'url': {data}")
    return str(url)


@http_retry
def _did_create_talk_with_audio(
    source_url: str,
    audio_url: str,
    api_key: str,
) -> str:
    headers = {
        "Authorization": f"Basic {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "source_url": source_url,
        "script": {"type": "audio", "audio_url": audio_url},
    }
    resp = requests.post(DID_API_URL, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    talk_id = data.get("id")
    if not talk_id:
        raise UGCServiceError(f"D-ID /talks response missing 'id': {data}")
    return str(talk_id)


def _did_poll_status(talk_id: str, api_key: str) -> str:
    url = DID_POLL_URL.format(talk_id=talk_id)
    headers = {"Authorization": f"Basic {api_key}"}

    for attempt in range(1, DID_MAX_POLL_ATTEMPTS + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            logger.warning(
                "[ugc_service] D-ID poll attempt %d/%d failed (%s). Retrying in %ds…",
                attempt,
                DID_MAX_POLL_ATTEMPTS,
                exc,
                DID_POLL_INTERVAL_SECONDS,
            )
            time.sleep(DID_POLL_INTERVAL_SECONDS)
            continue

        status = data.get("status", "")
        logger.info(
            "[ugc_service] D-ID talk %s — status=%r (poll %d/%d).",
            talk_id,
            status,
            attempt,
            DID_MAX_POLL_ATTEMPTS,
        )

        if status == "done":
            result_url = data.get("result_url")
            if not result_url:
                raise UGCServiceError(
                    f"D-ID talk {talk_id!r} is 'done' but response contains no result_url."
                    f" Full response: {data}"
                )
            return str(result_url)

        if status == "error":
            error_msg = data.get("error", {})
            raise UGCServiceError(
                f"D-ID talk generation failed for talk_id={talk_id!r}: {error_msg}"
            )

        if status == "rejected":
            raise UGCServiceError(
                f"D-ID talk {talk_id!r} was rejected: {data.get('error', data)}"
            )

        time.sleep(DID_POLL_INTERVAL_SECONDS)

    raise UGCServiceError(
        f"D-ID talk {talk_id!r} did not complete within "
        f"{DID_MAX_POLL_ATTEMPTS * DID_POLL_INTERVAL_SECONDS}s "
        f"({DID_MAX_POLL_ATTEMPTS} polls)."
    )


def generate_did_avatar_video(
    source_url: str,
    script_text: str,
    voice_id: str | None = None,
    *,
    audio: AudioProvider | None = None,
) -> str:
    """D-ID /talks flow; *audio* defaults to :class:`ElevenLabsAudioProvider`."""
    api_key = os.environ.get("D_ID_API_KEY", "").strip()
    if not api_key:
        raise UGCServiceError("D_ID_API_KEY is not set in the environment.")

    tts = audio or ElevenLabsAudioProvider()
    el_voice_id = voice_id if voice_id else ELEVENLABS_DEFAULT_VOICE_ID
    logger.info(
        "[ugc_service] D-ID path: ElevenLabs TTS (voice=%s) then /audios + /talks "
        "(source_url=%s, chars=%d).",
        el_voice_id,
        source_url,
        len(script_text),
    )

    audio_bytes = tts.synthesize(script_text, voice_id=el_voice_id)

    try:
        did_audio_url = _did_upload_audio(audio_bytes, api_key)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text[:400] if exc.response is not None else "") or ""
        raise UGCServiceError(
            f"D-ID /audios upload failed with HTTP {status}: {body}"
        ) from exc
    except requests.RequestException as exc:
        raise UGCServiceError(f"D-ID /audios network error: {exc}") from exc

    logger.info("[ugc_service] D-ID audio uploaded; temporary url present (len=%d).", len(did_audio_url))

    try:
        talk_id = _did_create_talk_with_audio(source_url, did_audio_url, api_key)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        body = (exc.response.text[:400] if exc.response is not None else "") or ""
        raise UGCServiceError(
            f"D-ID /talks request failed with HTTP {status}: {body}"
        ) from exc
    except requests.RequestException as exc:
        raise UGCServiceError(f"D-ID /talks network error: {exc}") from exc

    logger.info("[ugc_service] D-ID talk_id=%s — polling GET /talks/{id}…", talk_id)
    result_url = _did_poll_status(talk_id, api_key)
    logger.info("[ugc_service] D-ID talk completed: %s", result_url)
    return result_url


class DidProvider(BaseUgcProvider):
    """D-ID pipeline using an :class:`AudioProvider` for TTS before /audios + /talks."""

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
        _ = heygen_character_type, aspect_ratio  # unused for D-ID
        logger.info("[ugc_service] dispatch → d-id pipeline (/audios + /talks audio).")
        return generate_did_avatar_video(
            visual_reference,
            script_text,
            voice_id=voice_id,
            audio=self._audio,
        )
