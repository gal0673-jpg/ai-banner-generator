"""
UGC AI video script generation using GPT-4o for the Israeli market.

Produces a structured Hebrew JSON screenplay for the HeyGen / ElevenLabs pipeline.

Requires:
  pip install openai tenacity python-dotenv
  Env: OPENAI_API_KEY
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    InternalServerError,
    OpenAI,
    RateLimitError,
)
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")

# ---------------------------------------------------------------------------
# Allowed values — kept as module-level constants so callers can validate too
# ---------------------------------------------------------------------------

VISUAL_LAYOUTS = frozenset({"full_avatar", "avatar_with_bullets", "avatar_with_cta"})

_DURATION_MAP: dict[str, int] = {"15s": 15, "30s": 30, "50s": 50}

# Scene-count guidance per video length — injected into the prompt so the model
# knows how dense to make the script without under- or over-shooting.
_SCENE_GUIDANCE: dict[str, str] = {
    "15s": "2 to 3 scenes (fast hook → single benefit → CTA).",
    "30s": "4 to 5 scenes (hook → 2-3 benefit scenes → CTA).",
    "50s": "6 to 8 scenes (hook → 4-5 benefit scenes → CTA).",
}

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

UGC_DIRECTOR_SYSTEM = """\
You are an elite UGC (User-Generated Content) commercial director specialising in TikTok and \
Instagram Reels ads for the Israeli market. You have an instinctive feel for the scroll-stopping \
hook, the emotionally resonant benefit reveal, and the urgency-driven CTA — all in native, \
street-level Hebrew that feels like it was written by a real Israeli content creator, never by a \
machine.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 INPUTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You will receive a user message that contains two sections:

1. SCRAPED WEBSITE TEXT — raw text crawled from the brand's website. Extract:
   • The real brand / business name (how customers refer to it).
   • The core product or service.
   • Specific prices, offers, proof points, or differentiators.
   • Tone and personality (premium, playful, professional, etc.).

2. USER CAMPAIGN BRIEF (optional) — when present, treat it as authoritative direction for \
positioning, tone, target audience, and any specific messages to include. Weight it heavily and \
weave its specifics (numbers, offers, audience pain points) into the script.

If the brief is absent or empty, rely solely on the scraped website content.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCRIPT CRAFT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Language: ALL spoken_text and on_screen_text must be in natural, conversational, punchy Hebrew. \
  No English words unless they are a universally known brand name or tech term that Israelis \
  themselves use (e.g., "אפליקציה", "קאשבק"). Never Anglicise unnecessarily.
• spoken_text is the exact transcript sent to a TTS voice engine. Rules:
    – Natural speech rhythm — short bursts, pauses implied by punctuation (comma, dash, ellipsis).
    – No emojis, no asterisks, no markdown, no hashtags, no parenthetical stage directions.
    – Pure spoken Hebrew text only.
• on_screen_text is the graphic overlay. Rules:
    – Maximum 3-4 Hebrew words, OR an empty string "" if no overlay fits that scene.
    – Never repeat the spoken_text verbatim — it should amplify or contrast it.
• visual_layout controls the video compositor. Use ONLY one of these three values:
    – "full_avatar"         → Avatar fills the frame. Use for the opening hook scene only.
    – "avatar_with_bullets" → Avatar on one side, animated bullet points on the other. \
                              Use for benefit / feature explanation scenes.
    – "avatar_with_cta"    → Avatar with a prominent CTA button overlay. \
                              Use for the final scene only.
• Structure every script with this arc:
    1. Hook (scene 1)     → "full_avatar" — one explosive sentence that stops the scroll. \
                            Lead with a bold question, surprising stat, or relatable pain point.
    2. Body (middle)      → "avatar_with_bullets" — one key benefit per scene. \
                            Each scene is self-contained and punchy.
    3. CTA (last scene)   → "avatar_with_cta" — clear imperative action + urgency or value.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OUTPUT FORMAT — STRICT JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Output ONLY valid JSON. No markdown fences, no commentary, no extra keys.

{
  "estimated_duration_seconds": <integer matching the requested target duration>,
  "scenes": [
    {
      "scene_number": <integer, 1-indexed>,
      "spoken_text": "<natural Hebrew TTS transcript — no emojis, no markdown>",
      "on_screen_text": "<3-4 Hebrew words OR empty string>",
      "visual_layout": "<full_avatar | avatar_with_bullets | avatar_with_cta>"
    }
  ]
}

Constraints:
• scenes must be a non-empty array.
• scene_number must be sequential starting at 1.
• The first scene must use "full_avatar".
• The last scene must use "avatar_with_cta".
• Every middle scene must use "avatar_with_bullets".
• visual_layout is an ENUM — any value outside the three above is invalid.
• estimated_duration_seconds must equal exactly the integer target passed in the user message \
  (15, 30, or 50). Do not approximate or choose a different value.\
"""

# ---------------------------------------------------------------------------
# Tenacity retry helpers (identical pattern to creative_agent.py)
# ---------------------------------------------------------------------------

_TRANSIENT_HTTP_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def _is_transient_openai_error(exc: BaseException) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError, InternalServerError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code in _TRANSIENT_HTTP_STATUS
    return False


_OPENAI_CHAT_RETRY = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception(_is_transient_openai_error),
)

# ---------------------------------------------------------------------------
# Private API call (decorated separately so tenacity wraps only I/O)
# ---------------------------------------------------------------------------


@_OPENAI_CHAT_RETRY
def _call_gpt(client: OpenAI, user_content: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": UGC_DIRECTOR_SYSTEM},
            {"role": "user", "content": user_content[:16_000]},
        ],
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("[ugc_director] ERROR: GPT-4o returned an empty response.")
    return content

# ---------------------------------------------------------------------------
# Validation helper
# ---------------------------------------------------------------------------


def _validate_script(data: dict, expected_duration: int) -> None:
    """Raise ValueError with an actionable message if the script is malformed."""

    if not isinstance(data.get("estimated_duration_seconds"), int):
        raise ValueError(
            "[ugc_director] 'estimated_duration_seconds' must be an integer; "
            f"got {data.get('estimated_duration_seconds')!r}."
        )
    if data["estimated_duration_seconds"] != expected_duration:
        raise ValueError(
            f"[ugc_director] 'estimated_duration_seconds' must be {expected_duration}; "
            f"got {data['estimated_duration_seconds']}."
        )

    scenes = data.get("scenes")
    if not isinstance(scenes, list) or len(scenes) == 0:
        raise ValueError("[ugc_director] 'scenes' must be a non-empty array.")

    for i, scene in enumerate(scenes):
        idx = i + 1
        for field in ("scene_number", "spoken_text", "on_screen_text", "visual_layout"):
            if field not in scene:
                raise ValueError(
                    f"[ugc_director] Scene {idx} is missing required field {field!r}."
                )

        if scene["scene_number"] != idx:
            raise ValueError(
                f"[ugc_director] Scene at position {idx} has scene_number "
                f"{scene['scene_number']}; expected {idx}."
            )

        layout = scene["visual_layout"]
        if layout not in VISUAL_LAYOUTS:
            raise ValueError(
                f"[ugc_director] Scene {idx} has invalid visual_layout {layout!r}. "
                f"Must be one of {sorted(VISUAL_LAYOUTS)}."
            )

        if not isinstance(scene["spoken_text"], str) or not scene["spoken_text"].strip():
            raise ValueError(
                f"[ugc_director] Scene {idx} 'spoken_text' must be a non-empty string."
            )

        if not isinstance(scene["on_screen_text"], str):
            raise ValueError(
                f"[ugc_director] Scene {idx} 'on_screen_text' must be a string (or empty string)."
            )

    # Structural arc enforcement
    if scenes[0]["visual_layout"] != "full_avatar":
        raise ValueError(
            "[ugc_director] The first scene must use visual_layout 'full_avatar'."
        )
    if scenes[-1]["visual_layout"] != "avatar_with_cta":
        raise ValueError(
            "[ugc_director] The last scene must use visual_layout 'avatar_with_cta'."
        )

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_ugc_script(
    scraped_text: str,
    brief: str | None,
    video_length: str,
) -> dict:
    """
    Generate a Hebrew UGC video script using GPT-4o.

    Args:
        scraped_text:  Raw text crawled from the brand's website.
        brief:         Optional campaign goal / target audience from the user.
        video_length:  One of '15s', '30s', '50s'.

    Returns:
        Validated dict with keys 'estimated_duration_seconds' and 'scenes'.

    Raises:
        ValueError:   If video_length is invalid or GPT output fails validation.
        RuntimeError: On empty API response (propagated from _call_gpt).
        openai.*:     Re-raised after exhausting tenacity retries.
    """
    if video_length not in _DURATION_MAP:
        raise ValueError(
            f"[ugc_director] video_length must be one of {list(_DURATION_MAP)}; "
            f"got {video_length!r}."
        )

    target_seconds = _DURATION_MAP[video_length]
    scene_guidance = _SCENE_GUIDANCE[video_length]

    brief_section = (
        f"\n\nUSER CAMPAIGN BRIEF (goals / target audience — provided by the user):\n{brief.strip()}"
        if brief and brief.strip()
        else "\n\nUSER CAMPAIGN BRIEF: (none provided — rely solely on the scraped website text)"
    )

    user_content = (
        f"TARGET VIDEO LENGTH: {video_length} ({target_seconds} seconds). "
        f"Use exactly {scene_guidance}\n\n"
        f"SCRAPED WEBSITE TEXT:\n{scraped_text.strip()}"
        f"{brief_section}"
    )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "[ugc_director] ERROR: OPENAI_API_KEY environment variable is not set."
        )

    print(
        f"[ugc_director] Requesting {video_length} UGC script from GPT-4o "
        f"({target_seconds}s, {scene_guidance})"
    )

    client = OpenAI(api_key=api_key)
    raw = _call_gpt(client, user_content)

    print("[ugc_director] Parsing and validating JSON response…")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"[ugc_director] ERROR: GPT-4o returned invalid JSON — {exc}"
        ) from exc

    _validate_script(data, target_seconds)

    print(
        f"[ugc_director] OK — {len(data['scenes'])} scene(s) validated for "
        f"{data['estimated_duration_seconds']}s UGC video."
    )
    return data
