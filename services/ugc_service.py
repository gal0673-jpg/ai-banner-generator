"""ElevenLabs TTS and HeyGen / D-ID UGC wrappers — facade over :mod:`services.ugc`.

Orchestration for the legacy website-crawl UGC flow is split into a Celery ``chain``
in ``worker_tasks`` (``task_crawl_and_script`` → ``task_generate_avatar_video`` →
``task_finalize_ugc_video``) so Remotion retries do not re-invoke HeyGen/D-ID.

Implementation lives in ``services/ugc/`` (Strategy + Factory). Import from here
or from ``services.ugc`` interchangeably.

Public API
----------
generate_elevenlabs_audio, generate_heygen_avatar_video, generate_did_avatar_video
dispatch_ugc_generation
combined_spoken_text_from_script
generate_split_gallery_images
UGCServiceError

All HTTP calls that used tenacity in the monolith remain decorated in the provider modules.
"""

from __future__ import annotations

from services.ugc.constants import ELEVENLABS_DEFAULT_VOICE_ID
from services.ugc import (
    UGCServiceError,
    AudioProvider,
    BaseUgcProvider,
    DidProvider,
    ElevenLabsAudioProvider,
    HeyGenProvider,
    combined_spoken_text_from_script,
    dispatch_ugc_generation,
    generate_did_avatar_video,
    generate_elevenlabs_audio,
    generate_heygen_avatar_video,
    generate_split_gallery_images,
    get_ugc_provider,
)

_ELEVENLABS_DEFAULT_VOICE_ID = ELEVENLABS_DEFAULT_VOICE_ID

__all__ = [
    "AudioProvider",
    "BaseUgcProvider",
    "DidProvider",
    "ELEVENLABS_DEFAULT_VOICE_ID",
    "ElevenLabsAudioProvider",
    "HeyGenProvider",
    "UGCServiceError",
    "_ELEVENLABS_DEFAULT_VOICE_ID",
    "combined_spoken_text_from_script",
    "dispatch_ugc_generation",
    "generate_did_avatar_video",
    "generate_elevenlabs_audio",
    "generate_heygen_avatar_video",
    "generate_split_gallery_images",
    "get_ugc_provider",
]
