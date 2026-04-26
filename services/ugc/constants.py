"""Shared constants for UGC HTTP providers."""

# ElevenLabs
ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
ELEVENLABS_DEFAULT_VOICE_ID = "Wuv1s5YTNCjL9mFJTqo4"

# HeyGen
HEYGEN_ASSET_UPLOAD_URL = "https://upload.heygen.com/v1/asset"
HEYGEN_VIDEO_GENERATE_URL = "https://api.heygen.com/v2/video/generate"
HEYGEN_VIDEO_STATUS_URL = "https://api.heygen.com/v1/video_status.get"

POLL_INTERVAL_SECONDS = 10
MAX_POLL_ATTEMPTS = 72  # ~12 minutes ceiling; HeyGen can be slow on first renders

# D-ID
DID_API_URL = "https://api.d-id.com/talks"
DID_AUDIOS_URL = "https://api.d-id.com/audios"
DID_POLL_URL = "https://api.d-id.com/talks/{talk_id}"

DID_POLL_INTERVAL_SECONDS = 5
DID_MAX_POLL_ATTEMPTS = 120  # 10-minute ceiling
