"""UGC provider strategies (video + audio) and orchestration."""

from services.ugc.audio import AudioProvider, ElevenLabsAudioProvider, generate_elevenlabs_audio
from services.ugc.constants import ELEVENLABS_DEFAULT_VOICE_ID
from services.ugc.did_provider import DidProvider, generate_did_avatar_video
from services.ugc.exceptions import UGCServiceError
from services.ugc.factory import dispatch_ugc_generation, get_ugc_provider
from services.ugc.heygen_provider import HeyGenProvider, generate_heygen_avatar_video
from services.ugc.provider_base import BaseUgcProvider
from services.ugc.script_utils import combined_spoken_text_from_script
from services.ugc.split_gallery import generate_split_gallery_images

__all__ = [
    "AudioProvider",
    "BaseUgcProvider",
    "DidProvider",
    "ElevenLabsAudioProvider",
    "ELEVENLABS_DEFAULT_VOICE_ID",
    "HeyGenProvider",
    "UGCServiceError",
    "combined_spoken_text_from_script",
    "dispatch_ugc_generation",
    "generate_did_avatar_video",
    "generate_elevenlabs_audio",
    "generate_heygen_avatar_video",
    "generate_split_gallery_images",
    "get_ugc_provider",
]
