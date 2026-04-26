"""Abstract UGC video provider (Strategy)."""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseUgcProvider(ABC):
    """Strategy: produce a talking-avatar video URL from script + visual reference."""

    @abstractmethod
    def generate_video(
        self,
        script_text: str,
        visual_reference: str,
        *,
        voice_id: str | None = None,
        heygen_character_type: str | None = None,
        aspect_ratio: str = "9:16",
    ) -> str:
        """Return final CDN video URL."""
