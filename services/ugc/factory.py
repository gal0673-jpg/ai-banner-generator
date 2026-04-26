"""Factory for UGC video providers."""

from __future__ import annotations

from services.ugc.audio import AudioProvider, ElevenLabsAudioProvider
from services.ugc.did_provider import DidProvider
from services.ugc.heygen_provider import HeyGenProvider
from services.ugc.provider_base import BaseUgcProvider

_KNOWN_PROVIDERS = frozenset({"heygen_elevenlabs", "d-id"})


def get_ugc_provider(
    provider: str,
    *,
    audio: AudioProvider | None = None,
) -> BaseUgcProvider:
    """Instantiate the strategy for *provider* (shared optional :class:`AudioProvider`)."""
    key = (provider or "").strip().lower()
    if key == "heygen_elevenlabs":
        return HeyGenProvider(audio=audio or ElevenLabsAudioProvider())
    if key == "d-id":
        return DidProvider(audio=audio or ElevenLabsAudioProvider())
    raise ValueError(
        f"Unknown UGC provider {provider!r}. "
        f"Expected one of: {', '.join(sorted(_KNOWN_PROVIDERS))}."
    )


def dispatch_ugc_generation(
    provider: str,
    script_text: str,
    visual_reference: str,
    voice_id: str | None = None,
    heygen_character_type: str | None = None,
    aspect_ratio: str = "9:16",
) -> str:
    """Route UGC video generation via factory → strategy ``generate_video``."""
    shared_audio = ElevenLabsAudioProvider()
    impl = get_ugc_provider(provider, audio=shared_audio)
    return impl.generate_video(
        script_text,
        visual_reference,
        voice_id=voice_id,
        heygen_character_type=heygen_character_type,
        aspect_ratio=aspect_ratio,
    )
