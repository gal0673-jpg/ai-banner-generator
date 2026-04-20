"""ElevenLabs TTS and HeyGen talking-avatar API wrappers for the UGC pipeline.

Public API
----------
generate_elevenlabs_audio(text, voice_id) -> bytes
    Convert text to MP3 via ElevenLabs TTS (``eleven_v3`` + ``language_code: he`` + voice_settings).
    ``eleven_multilingual_v2`` does not list Hebrew; using it drops non-Latin script and only speaks e.g. brand acronyms.

generate_heygen_avatar_video(avatar_id, audio_bytes, character_type="avatar") -> str
    Upload audio, submit a HeyGen /v2/video/generate job, poll to completion,
    and return the final CDN video URL. Use character_type="talking_photo" when
    *avatar_id* is a HeyGen photo / talking-photo id from List Avatars V2.

generate_did_avatar_video(source_url, script_text, voice_id) -> str
    ElevenLabs TTS → POST /audios → POST /talks (static ``source_url`` + ``script.type: audio``),
    poll ``GET /talks/{id}`` to completion, return ``result_url``. Trial-safe (no /expressives).

dispatch_ugc_generation(provider, script_text, visual_reference, …) -> str
    Route to the correct provider pipeline and return the video URL.
    For HeyGen, optional *heygen_character_type* selects avatar vs talking_photo payload.

All HTTP calls are wrapped with tenacity for transient-failure resilience.
"""

from __future__ import annotations

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

from services.ugc_composite_service import normalize_ugc_aspect_ratio

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ElevenLabs endpoints
# ---------------------------------------------------------------------------
_ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

# Production UGC voice ID; TTS uses ``eleven_v3`` (Hebrew-capable) + ``language_code: he`` + voice_settings.
# Callers may pass any valid ElevenLabs voice_id.
_ELEVENLABS_DEFAULT_VOICE_ID = "Wuv1s5YTNCjL9mFJTqo4"

# ---------------------------------------------------------------------------
# HeyGen endpoints
# ---------------------------------------------------------------------------
# HeyGen base URLs.
# IMPORTANT: the asset upload endpoint lives on upload.heygen.com, not api.heygen.com.
_HEYGEN_ASSET_UPLOAD_URL = "https://upload.heygen.com/v1/asset"
_HEYGEN_VIDEO_GENERATE_URL = "https://api.heygen.com/v2/video/generate"
_HEYGEN_VIDEO_STATUS_URL = "https://api.heygen.com/v1/video_status.get"

_POLL_INTERVAL_SECONDS = 10
_MAX_POLL_ATTEMPTS = 72  # ~12 minutes ceiling; HeyGen can be slow on first renders


def _heygen_dimension_for_aspect_ratio(aspect_ratio: str = "9:16") -> dict[str, int]:
    """Match FFmpeg UGC canvas sizes (see ``ugc_composite_service._ugc_canvas_width_height``)."""
    ar = normalize_ugc_aspect_ratio(aspect_ratio)
    if ar == "1:1":
        return {"width": 1080, "height": 1080}
    if ar == "16:9":
        return {"width": 1920, "height": 1080}
    return {"width": 1080, "height": 1920}


def _log_heygen_error_response(resp: requests.Response, context: str) -> None:
    """Print full response body for non-2xx so upstream rejections are visible in worker logs."""
    if 200 <= resp.status_code < 300:
        return
    body = resp.text or ""
    print(f"[HeyGen] {context} HTTP {resp.status_code} body: {body}")


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
        "model_id": "eleven_v3",
        # eleven_multilingual_v2 has no Hebrew; without this, only Latin fragments (e.g. "TSITE") are spoken.
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


# ---------------------------------------------------------------------------
# ElevenLabs — public API
# ---------------------------------------------------------------------------


def generate_elevenlabs_audio(
    text: str,
    voice_id: str = _ELEVENLABS_DEFAULT_VOICE_ID,
) -> bytes:
    """Convert *text* to MP3 via ElevenLabs text-to-speech (``eleven_v3``, Hebrew via ``language_code``).

    Args:
        text:     The spoken text to synthesise (``language_code`` is set to Hebrew for the API).
        voice_id: ElevenLabs voice ID.  Defaults to the configured UGC voice.

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
def _upload_heygen_audio_asset(audio_bytes: bytes, api_key: str) -> str:
    """Upload *audio_bytes* (MP3) to HeyGen and return the ``audio_asset_id``.

    Per HeyGen docs (upload.heygen.com/v1/asset):
      - Host:         upload.heygen.com   (NOT api.heygen.com)
      - Method:       POST
      - Auth header:  X-API-KEY
      - Content-Type: audio/mpeg          (NOT multipart/form-data)
      - Body:         raw binary bytes    (NOT files= / form fields)

    HeyGen signals success with ``{"code": 100, "data": {"id": "..."}}``.
    """
    url = _HEYGEN_ASSET_UPLOAD_URL
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


@_http_retry
def _heygen_request_video(
    visual_id: str,
    audio_asset_id: str,
    api_key: str,
    *,
    character_type: str = "avatar",
    aspect_ratio: str = "9:16",
) -> str:
    """Submit a HeyGen /v2/video/generate job and return the ``video_id``.

    *character_type* must be ``"avatar"`` (studio / instant avatar ``avatar_id``) or
    ``"talking_photo"`` (photo avatar ``talking_photo_id`` from List Avatars V2).

    The v2 endpoint returns ``{"error": null, "data": {"video_id": "..."}}`` on success —
    it does NOT include a ``code`` field like the v1 endpoints do.
    """
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
        f"Calling HeyGen: {_HEYGEN_VIDEO_GENERATE_URL} "
        f"(character_type={character_type!r}, id={visual_id[:16]}…, "
        f"dimension={payload['dimension']})"
    )
    resp = requests.post(
        _HEYGEN_VIDEO_GENERATE_URL, json=payload, headers=headers, timeout=60
    )
    _log_heygen_error_response(resp, "POST /v2/video/generate")
    resp.raise_for_status()
    data = resp.json()

    # v2 uses {"error": null, "data": {"video_id": "..."}} — no "code" field.
    # Treat any non-null "error" value as a failure.
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
    """Poll HeyGen status until the video is 'completed' or 'failed'.

    Returns the final CDN video URL on success.
    Raises UGCServiceError on failure or timeout.
    """
    headers = {"x-api-key": api_key}

    for attempt in range(1, _MAX_POLL_ATTEMPTS + 1):
        try:
            print(f"Calling HeyGen: {_HEYGEN_VIDEO_STATUS_URL}?video_id={video_id}")
            resp = requests.get(
                _HEYGEN_VIDEO_STATUS_URL,
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


def generate_heygen_avatar_video(
    avatar_id: str,
    audio_bytes: bytes,
    *,
    character_type: str = "avatar",
    aspect_ratio: str = "9:16",
) -> str:
    """Generate a HeyGen talking-avatar video from a pre-rendered audio track.

    Step A — Upload *audio_bytes* to HeyGen's asset endpoint → ``audio_asset_id``.
    Step B — POST to /v2/video/generate (avatar + audio asset, green-screen bg) → ``video_id``.
    Step C — Poll /v1/video_status.get every 10 s until status is 'completed' or 'failed'.

    Args:
        avatar_id:       HeyGen ``avatar_id`` or ``talking_photo_id`` (see *character_type*).
        character_type:  ``"avatar"`` or ``"talking_photo"`` — must match the ID kind from
                         `List All Avatars (V2) <https://docs.heygen.com/reference/list-avatars-v2>`_.
        aspect_ratio:    ``"9:16"``, ``"16:9"``, or ``"1:1"`` — forwarded to HeyGen ``dimension``.
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
        audio_asset_id = _upload_heygen_audio_asset(audio_bytes, api_key)
    except UGCServiceError:
        raise  # already descriptive; propagate as-is
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

    # ── Step B: request video generation ───────────────────────────────────
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
        raise  # already descriptive; propagate as-is
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


# ---------------------------------------------------------------------------
# D-ID endpoints (standard /talks — static image + uploaded audio; Trial-compatible)
# ---------------------------------------------------------------------------
_DID_API_URL = "https://api.d-id.com/talks"
_DID_AUDIOS_URL = "https://api.d-id.com/audios"
_DID_POLL_URL = "https://api.d-id.com/talks/{talk_id}"

_DID_POLL_INTERVAL_SECONDS = 5
_DID_MAX_POLL_ATTEMPTS = 120  # 10-minute ceiling


# ---------------------------------------------------------------------------
# D-ID — private helpers
# ---------------------------------------------------------------------------


@_http_retry
def _did_upload_audio(audio_bytes: bytes, api_key: str) -> str:
    """POST MP3/WAV to D-ID /audios; return temporary ``url`` for use in /talks."""
    headers = {"Authorization": f"Basic {api_key}"}
    files = {"audio": ("speech.mp3", audio_bytes, "audio/mpeg")}
    resp = requests.post(_DID_AUDIOS_URL, headers=headers, files=files, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    url = data.get("url")
    if not url:
        raise UGCServiceError(f"D-ID /audios response missing 'url': {data}")
    return str(url)


@_http_retry
def _did_create_talk_with_audio(
    source_url: str,
    audio_url: str,
    api_key: str,
) -> str:
    """POST to D-ID /talks with a pre-uploaded audio URL; return the talk_id."""
    headers = {
        "Authorization": f"Basic {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "source_url": source_url,
        "script": {"type": "audio", "audio_url": audio_url},
    }
    resp = requests.post(_DID_API_URL, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    talk_id = data.get("id")
    if not talk_id:
        raise UGCServiceError(f"D-ID /talks response missing 'id': {data}")
    return str(talk_id)


def _did_poll_status(talk_id: str, api_key: str) -> str:
    """Poll GET /talks/{talk_id} every 5 s until status is 'done'. Return result_url."""
    url = _DID_POLL_URL.format(talk_id=talk_id)
    headers = {"Authorization": f"Basic {api_key}"}

    for attempt in range(1, _DID_MAX_POLL_ATTEMPTS + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            logger.warning(
                "[ugc_service] D-ID poll attempt %d/%d failed (%s). Retrying in %ds…",
                attempt,
                _DID_MAX_POLL_ATTEMPTS,
                exc,
                _DID_POLL_INTERVAL_SECONDS,
            )
            time.sleep(_DID_POLL_INTERVAL_SECONDS)
            continue

        status = data.get("status", "")
        logger.info(
            "[ugc_service] D-ID talk %s — status=%r (poll %d/%d).",
            talk_id,
            status,
            attempt,
            _DID_MAX_POLL_ATTEMPTS,
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

        time.sleep(_DID_POLL_INTERVAL_SECONDS)

    raise UGCServiceError(
        f"D-ID talk {talk_id!r} did not complete within "
        f"{_DID_MAX_POLL_ATTEMPTS * _DID_POLL_INTERVAL_SECONDS}s "
        f"({_DID_MAX_POLL_ATTEMPTS} polls)."
    )


# ---------------------------------------------------------------------------
# D-ID — public API
# ---------------------------------------------------------------------------


def generate_did_avatar_video(
    source_url: str,
    script_text: str,
    voice_id: str | None = None,
) -> str:
    """Animate a static image on D-ID's standard ``/talks`` API (Trial-friendly).

    Flow: ElevenLabs TTS (same stack as HeyGen path) → ``POST /audios`` →
    ``POST /talks`` with ``script: {type: audio, audio_url}`` → poll
    ``GET /talks/{id}`` until ``done``.

    Args:
        source_url:  Public HTTPS URL to a face image (jpg/png) D-ID can fetch.
        script_text: Spoken text; rendered to audio via ElevenLabs.
        voice_id:    Optional ElevenLabs voice ID. When ``None``, the default
                     UGC ElevenLabs voice is used.

    Returns:
        Final CDN URL of the rendered video (``str``).

    Raises:
        UGCServiceError: API key missing, upload/talk HTTP failure, talk error,
                         or polling timeout.
    """
    api_key = os.environ.get("D_ID_API_KEY", "").strip()
    if not api_key:
        raise UGCServiceError("D_ID_API_KEY is not set in the environment.")

    el_voice_id = voice_id if voice_id else _ELEVENLABS_DEFAULT_VOICE_ID
    logger.info(
        "[ugc_service] D-ID path: ElevenLabs TTS (voice=%s) then /audios + /talks "
        "(source_url=%s, chars=%d).",
        el_voice_id,
        source_url,
        len(script_text),
    )

    audio_bytes = generate_elevenlabs_audio(script_text, voice_id=el_voice_id)

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


# ---------------------------------------------------------------------------
# Provider dispatcher
# ---------------------------------------------------------------------------


def dispatch_ugc_generation(
    provider: str,
    script_text: str,
    visual_reference: str,
    voice_id: str | None = None,
    heygen_character_type: str | None = None,
    aspect_ratio: str = "9:16",
) -> str:
    """Route UGC video generation to the correct provider pipeline.

    Args:
        provider:         ``"heygen_elevenlabs"`` or ``"d-id"``.
        script_text:      The spoken script text.
        visual_reference: HeyGen avatar ID (heygen_elevenlabs) or D-ID source
                          image URL / Avatar ID (d-id).
        voice_id:         Optional ElevenLabs voice ID for both audio-based
                          providers. Forwarded to ``generate_elevenlabs_audio`` /
                          ``generate_did_avatar_video`` when supplied.
        heygen_character_type: For ``heygen_elevenlabs`` only: ``"avatar"`` (default)
                          or ``"talking_photo"``. Must match the kind of id in
                          *visual_reference*. Ignored for ``d-id``.
        aspect_ratio: For ``heygen_elevenlabs`` only: output frame aspect for HeyGen
                          ``dimension`` (``"9:16"``, ``"16:9"``, ``"1:1"``). Ignored for ``d-id``.

    Returns:
        Final CDN video URL (``str``).

    Raises:
        ValueError:      Unknown provider string.
        UGCServiceError: Any unrecoverable API failure from the chosen provider.
    """
    if provider == "heygen_elevenlabs":
        logger.info("[ugc_service] dispatch → heygen_elevenlabs pipeline.")
        ct = (heygen_character_type or "avatar").strip().lower()
        if ct not in ("avatar", "talking_photo"):
            raise ValueError(
                f"heygen_character_type must be 'avatar' or 'talking_photo', not {ct!r}."
            )
        el_voice_id = voice_id if voice_id else _ELEVENLABS_DEFAULT_VOICE_ID
        audio_bytes = generate_elevenlabs_audio(script_text, voice_id=el_voice_id)
        return generate_heygen_avatar_video(
            visual_reference,
            audio_bytes,
            character_type=ct,
            aspect_ratio=aspect_ratio,
        )

    if provider == "d-id":
        logger.info("[ugc_service] dispatch → d-id pipeline (/audios + /talks audio).")
        return generate_did_avatar_video(
            source_url=visual_reference,
            script_text=script_text,
            voice_id=voice_id,
        )

    raise ValueError(
        f"Unknown UGC provider {provider!r}. "
        "Expected 'heygen_elevenlabs' or 'd-id'."
    )
