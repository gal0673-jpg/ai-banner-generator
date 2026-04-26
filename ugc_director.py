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
import re
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

VISUAL_LAYOUTS = frozenset(
    {"full_avatar", "avatar_with_bullets", "avatar_with_cta", "split_gallery"}
)

_DURATION_MAP: dict[str, int] = {"15s": 15, "30s": 30, "50s": 50}

# Scene-count guidance per video length — injected into the prompt so the model
# knows how dense to make the script without under- or over-shooting.
_SCENE_GUIDANCE: dict[str, str] = {
    "15s": "2 to 3 scenes (fast hook → single benefit → CTA).",
    "30s": "4 to 5 scenes (hook → 2-3 benefit scenes → CTA).",
    "50s": "6 to 8 scenes (hook → 4-5 benefit scenes → CTA).",
}

# ---------------------------------------------------------------------------
# LAYOUT_MODE — parsed from director notes / brief (no separate API field yet)
# ---------------------------------------------------------------------------

_LAYOUT_MODE_RE = re.compile(
    r"^\s*LAYOUT_MODE:\s*(\S+)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def parse_layout_mode(text: str) -> str:
    """Return 'split_gallery' or 'classic' (default) if LAYOUT_MODE is present in *text*."""
    if not text or not str(text).strip():
        return "classic"
    m = _LAYOUT_MODE_RE.search(str(text))
    if not m:
        return "classic"
    mode = m.group(1).strip().lower()
    if mode == "split_gallery":
        return "split_gallery"
    return "classic"


def strip_layout_mode_lines(text: str) -> str:
    """Remove LAYOUT_MODE: … lines (machine metadata; not for TTS or spoken copy)."""
    if not text:
        return ""
    cleaned = _LAYOUT_MODE_RE.sub("", str(text))
    return "\n".join(line for line in cleaned.splitlines() if line.strip()).strip()

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


def build_ugc_director_system(layout_mode: str = "classic") -> str:
    """Full system prompt; *layout_mode* is 'classic' or 'split_gallery'."""
    mode = (layout_mode or "classic").lower()
    if mode not in ("classic", "split_gallery"):
        mode = "classic"
    is_split = mode == "split_gallery"

    middle_layout_rule = (
        """\
• MIDDLE-SCENE LAYOUT (this run — split gallery): every middle scene (not first, not last) must \
set \"visual_layout\" to exactly \"split_gallery\" — a 2×2 grid where the live avatar occupies the \
one quadrant; the other three quadrants show stills. For EACH such scene you MUST include \
1) \"avatar_quadrant\" inside layout_data with an allowed value: TL | TR | BL | BR \
(default is BR if you are unsure), and you SHOULD vary it between consecutive split_gallery scenes \
to keep the video engaging.\n\
\n\
2) exactly **three** objects (not four cells — one cell is always the avatar), each with two keys:
    \"layout_data\": { \"images\": [
      {\"image_prompt\": \"...\", \"on_screen_caption\": \"...\"},
      {\"image_prompt\": \"...\", \"on_screen_caption\": \"...\"},
      {\"image_prompt\": \"...\", \"on_screen_caption\": \"...\"}
    ]}
  Order maps to the compositor as: the **three quadrants NOT occupied by the avatar**, in this \
fixed quadrant order (skipping the avatar quadrant): TL, TR, BL, BR.\n\
  Example: if avatar_quadrant is TL, then images[0]→TR, images[1]→BL, images[2]→BR.\n\
  Example: if avatar_quadrant is BR, then images[0]→TL, images[1]→TR, images[2]→BL.
  – image_prompt: a rich **English** visual description for OpenAI DALL·E 3 (subject, lighting, \
style, composition). Not spoken by TTS. No text or logos in the image. Match that scene's benefit.
  – on_screen_caption: a **very short** punchy **Hebrew** marketing phrase (roughly 2–5 words) \
shown on the video over each still — not the DALL·E prompt; keep it snappy like a TikTok caption.
• Do not use \"avatar_with_bullets\" in this run — middle scenes are always \"split_gallery\" with \
layout_data as above.
"""
        if is_split
        else """\
• visual_layout values for the BODY (middle scenes only): use \"avatar_with_bullets\" — one key \
  benefit per scene. Do not use \"split_gallery\" unless the LAYOUT_MODE instructions in the user \
  message say otherwise.
"""
    )

    body_arc = (
        """\
    2. Body (middle)      → \"split_gallery\" with layout_data.images (exactly **three** objects: \
image_prompt + on_screen_caption per slot, TL/TR/BL) — one key benefit per scene. Use pause \
markers in spoken_text.
"""
        if is_split
        else """\
    2. Body (middle)      → \"avatar_with_bullets\" — one key benefit per scene. \
Each scene is self-contained, punchy, and uses pause markers.
"""
    )

    layout_bullet_list = (
        """\
    – \"split_gallery\"     → For middle (body) scenes only: 2×2 grid — the avatar sits in the \
quadrant given by layout_data.avatar_quadrant (TL|TR|BL|BR); you supply stills for the other three \
cells. You MUST include \"layout_data\": { \"avatar_quadrant\": \"TL|TR|BL|BR\", \"images\": [<obj>, <obj>, <obj>] } — **exactly three** objects, each \
{\"image_prompt\": \"...\", \"on_screen_caption\": \"...\"}, order: top-left, top-right, \
bottom-left, bottom-right **skipping the avatar quadrant**. image_prompt = English DALL·E visual; \
on_screen_caption = short Hebrew on-video text. Never a fourth object — one grid cell is the avatar.
"""
        if is_split
        else """\
    – \"avatar_with_bullets\" → Avatar on one side, animated bullet points on the other. \
Use for benefit / feature explanation scenes (middle only).
"""
    )

    if is_split:
        output_scene_shape = """    {
      "scene_number": <integer, 1-indexed>,
      "spoken_text": "<natural Hebrew TTS transcript — no emojis, no markdown>",
      "on_screen_text": "<3-4 Hebrew words OR empty string>",
      "visual_layout": "split_gallery",
      "layout_data": {
        "avatar_quadrant": "<TL|TR|BL|BR>",
        "images": [
          {"image_prompt": "<English DALL·E 3 visual — slot 1 (see mapping rules)>", "on_screen_caption": "<2-5 Hebrew words>"},
          {"image_prompt": "<English DALL·E 3 visual — slot 2>", "on_screen_caption": "<2-5 Hebrew words>"},
          {"image_prompt": "<English DALL·E 3 visual — slot 3>", "on_screen_caption": "<2-5 Hebrew words>"}
        ]
      }
    }"""
    else:
        output_scene_shape = """    {
      "scene_number": <integer, 1-indexed>,
      "spoken_text": "<natural Hebrew TTS transcript — no emojis, no markdown>",
      "on_screen_text": "<3-4 Hebrew words OR empty string>",
      "visual_layout": "<full_avatar | avatar_with_bullets | avatar_with_cta — see position rules>"
    }"""

    extra_constraints = (
        """\
• Every middle scene must use \"split_gallery\" and MUST include \
\"layout_data\": { \"avatar_quadrant\": \"TL|TR|BL|BR\", \"images\": [object, object, object] } — exactly three objects, each with \
non-empty string fields \"image_prompt\" (English, for DALL·E) and \"on_screen_caption\" (Hebrew, \
for on-video labels). The avatar_quadrant chooses which grid cell is reserved for the avatar; the \
three image objects fill the remaining three cells in the fixed quadrant order TL,TR,BL,BR skipping \
the avatar cell.
• Scenes with \"split_gallery\" must not omit layout_data. First and last scenes must never use \
\"split_gallery\" or layout_data.
"""
        if is_split
        else """\
• Every middle scene must use \"avatar_with_bullets\".
• Do not include layout_data — omit it from all scenes.
"""
    )

    return f"""\
You are an elite UGC (User-Generated Content) commercial director specialising in TikTok and \
Instagram Reels ads for the Israeli market. You have an instinctive feel for the scroll-stopping \
hook, the emotionally resonant benefit reveal, and the urgency-driven CTA — all in native, \
street-level Hebrew that sounds like it came from a real Israeli creator filming on their phone, \
never from an AI or a corporate marketing department.

The user message may include a line: LAYOUT_MODE: classic | split_gallery. The effective mode for \
this run is: **{mode}** — follow the layout rules below for this mode. Do not speak the \
LAYOUT_MODE line aloud.

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
 VOICE & TONE — CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The spoken_text fields are fed to a HeyGen avatar via a TTS (text-to-speech) engine.
Natural-sounding Hebrew lip-sync depends entirely on how the text is written.
You MUST follow these rules or the video will sound robotic:

① CONVERSATIONAL ISRAELI OPENER — start the hook with an authentic, casual Israeli opener such as:
   "תקשיבו...", "מכירים את זה ש...?", "רגע, זה אמיתי?", "אני חייב לספר לכם משהו...",
   "אתם לא הולכים להאמין", "אוקיי, שנייה..."
   Choose whichever fits the brand. Never open with a stiff formal sentence.

② SENTENCE FRAGMENTS & PUNCHY BURSTS — break long sentences into very short, punchy fragments.
   Each fragment should feel like a separate breath or beat:
   ✓ GOOD: "המחיר? ... מצחיק. ... כי אתם שווים הרבה יותר."
   ✗ BAD:  "המחיר הוא זול מאוד ומתאים לכל אחד."

③ FORCED PAUSES VIA PUNCTUATION — use commas and ellipses deliberately to create breathing room
   for the TTS engine. This is what makes the avatar sound human, not robotic:
   – Use "..." (three dots) for a longer, dramatic pause — before a reveal, twist, or CTA.
   – Use "," for a brief natural breath mid-sentence.
   – Use "." to end a thought with finality.
   Never write a sentence longer than 12 words without at least one pause marker.

④ VARIED PACING — alternate between fast staccato beats and slower emotional moments:
   – Fast (hook/excitement): short words, 2-4 word bursts, lots of commas.
   – Slow (trust/emotion): slightly longer phrases, ellipses before key words.

⑤ NO FORMAL LANGUAGE — avoid formal or literary Hebrew constructions. Write exactly how a
   25-35 year old Israeli would speak naturally in a WhatsApp voice note:
   ✓ Casual: "באמת, אין דבר כזה בשוק"
   ✗ Formal: "מוצר זה הינו ייחודי בשוקהישראלי"

⑥ DIRECTOR TONE TAGS: The user may include tone tags in brackets (e.g., [דרמטי], [אנרגטי], \
[דחוף], [אמפתי]) within the DIRECTOR NOTES. You must translate these tags into the TTS \
pacing and phrasing of the spoken_text using ONLY punctuation and word choice. For [אנרגטי] use \
very short bursts and exclamation marks. For [דרמטי] use ellipses (...) for long pauses and slower \
buildup. For [אמפתי] use softer, inclusive words and gentle commas. NEVER speak the tags aloud. \
Apply the requested tone to the structural arc.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCRIPT CRAFT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Language: ALL spoken_text and on_screen_text must be in natural, conversational, punchy Hebrew. \
  No English words unless they are a universally known brand name or tech term that Israelis \
  themselves use (e.g., "אפליקציה", "קאשבק"). Never Anglicise unnecessarily.
• spoken_text is the exact transcript sent to a TTS voice engine. Rules:
    – Apply ALL six voice & tone rules above without exception.
    – No emojis, no asterisks, no markdown, no hashtags, no parenthetical stage directions.
    – Pure spoken Hebrew text only — punctuation (, . ...) is the only allowed formatting.
• on_screen_text is the graphic overlay. Rules:
    – Maximum 3-4 Hebrew words, OR an empty string "" if no overlay fits that scene.
    – Never repeat the spoken_text verbatim — it should amplify or contrast it.
• visual_layout controls the video compositor. Use these values according to **scene position** and \
LAYOUT_MODE (**{mode}**):
    – "full_avatar"         → Avatar fills the frame. **Scene 1 (hook) only.**
{layout_bullet_list}    – "avatar_with_cta"     → CTA / button overlay. **Last scene only.**
{middle_layout_rule}
• Structure every script with this arc:
    1. Hook (scene 1)     → "full_avatar" — one explosive opener that stops the scroll. \
                            Must begin with a casual Israeli opener (rule ①). \
                            Lead with a bold question, surprising stat, or relatable pain point.
{body_arc}    3. CTA (last scene)   → "avatar_with_cta" — clear imperative + urgency, with a dramatic \
                            ellipsis before the action word (e.g., "אז מה אתם מחכים... כנסו עכשיו!").

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OUTPUT FORMAT — STRICT JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Output ONLY valid JSON. No markdown fences, no commentary, no extra keys. \
Include layout_data only on middle scenes when LAYOUT_MODE is split_gallery (see example shape).

{{
  "estimated_duration_seconds": <integer matching the requested target duration>,
  "scenes": [
{output_scene_shape}
  ]
}}

Constraints:
• scenes must be a non-empty array.
• scene_number must be sequential starting at 1.
• The first scene must use "full_avatar" and must never use "split_gallery" or layout_data.
• The last scene must use "avatar_with_cta" and must never use "split_gallery" or layout_data.
{extra_constraints}• visual_layout is an ENUM — use only the values that apply to this LAYOUT_MODE.
• estimated_duration_seconds must equal exactly the integer target passed in the user message \
  (15, 30, or 50). Do not approximate or choose a different value.\
"""


UGC_DIRECTOR_SYSTEM = build_ugc_director_system("classic")


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
def _call_gpt(
    client: OpenAI,
    user_content: str,
    system_prompt: str | None = None,
) -> str:
    system = system_prompt if system_prompt is not None else UGC_DIRECTOR_SYSTEM
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system},
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


def _validate_script(
    data: dict,
    expected_duration: int,
    layout_mode: str = "classic",
) -> None:
    """Raise ValueError with an actionable message if the script is malformed."""

    mode = (layout_mode or "classic").lower()
    if mode not in ("classic", "split_gallery"):
        mode = "classic"

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

    n = len(scenes)
    for i, scene in enumerate(scenes):
        idx = i + 1
        is_first = i == 0
        is_last = i == n - 1
        is_middle = not is_first and not is_last

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

        has_ld = scene.get("layout_data") is not None
        if has_ld and (is_first or is_last):
            raise ValueError(
                f"[ugc_director] Scene {idx} must not include layout_data (hook/CTA scenes only)."
            )

        if mode == "classic" and is_middle:
            if layout != "avatar_with_bullets":
                raise ValueError(
                    f"[ugc_director] Scene {idx} (middle) must use visual_layout "
                    f"'avatar_with_bullets' in classic mode; got {layout!r}."
                )
            if has_ld:
                raise ValueError(
                    f"[ugc_director] Scene {idx} must not include layout_data in classic mode."
                )

        if mode == "split_gallery" and is_middle:
            if layout != "split_gallery":
                raise ValueError(
                    f"[ugc_director] Scene {idx} (middle) must use visual_layout "
                    f"'split_gallery' in split_gallery mode; got {layout!r}."
                )
            ld = scene.get("layout_data")
            if not isinstance(ld, dict):
                raise ValueError(
                    f"[ugc_director] Scene {idx} 'layout_data' must be an object for split_gallery."
                )
            q = ld.get("avatar_quadrant", "BR")
            if not isinstance(q, str) or not q.strip():
                raise ValueError(
                    f"[ugc_director] Scene {idx} layout_data.avatar_quadrant must be a string "
                    "(TL|TR|BL|BR)."
                )
            qn = q.strip().upper()
            if qn not in ("TL", "TR", "BL", "BR"):
                raise ValueError(
                    f"[ugc_director] Scene {idx} layout_data.avatar_quadrant must be one of "
                    "TL, TR, BL, BR."
                )
            imgs = ld.get("images")
            if not isinstance(imgs, list) or len(imgs) != 3:
                raise ValueError(
                    f"[ugc_director] Scene {idx} layout_data.images must be a list of exactly "
                    f"three objects {{image_prompt, on_screen_caption}}; got {imgs!r}."
                )
            for j, slot in enumerate(imgs):
                if not isinstance(slot, dict):
                    raise ValueError(
                        f"[ugc_director] Scene {idx} layout_data.images[{j}] must be an object "
                        f"with 'image_prompt' and 'on_screen_caption'; got {slot!r}."
                    )
                ip = slot.get("image_prompt")
                cap = slot.get("on_screen_caption")
                if not isinstance(ip, str) or not str(ip).strip():
                    raise ValueError(
                        f"[ugc_director] Scene {idx} layout_data.images[{j}].image_prompt must be "
                        "a non-empty string."
                    )
                if not isinstance(cap, str) or not str(cap).strip():
                    raise ValueError(
                        f"[ugc_director] Scene {idx} layout_data.images[{j}].on_screen_caption must "
                        "be a non-empty string."
                    )

    # Structural arc enforcement (first = full avatar, last = CTA)
    if scenes[0]["visual_layout"] != "full_avatar":
        raise ValueError(
            "[ugc_director] The first scene must use visual_layout 'full_avatar'."
        )
    if scenes[-1]["visual_layout"] != "avatar_with_cta":
        raise ValueError(
            "[ugc_director] The last scene must use visual_layout 'avatar_with_cta'."
        )


def _validate_script_studio_spoken_only(data: dict, expected_duration: int) -> None:
    """Validate a multi-scene spoken_only script (avatar studio, no CTA arc required)."""
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
        raise ValueError("[ugc_director] studio spoken_only expects at least one scene.")
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
        if scene["visual_layout"] != "full_avatar":
            raise ValueError(
                f"[ugc_director] studio spoken_only scene {idx} must use visual_layout 'full_avatar'."
            )
        if not isinstance(scene["spoken_text"], str) or not scene["spoken_text"].strip():
            raise ValueError(
                f"[ugc_director] Scene {idx} 'spoken_text' must be a non-empty string."
            )
        if not isinstance(scene["on_screen_text"], str):
            raise ValueError(
                f"[ugc_director] Scene {idx} 'on_screen_text' must be a string."
            )


def _chunk_spoken_text(text: str, max_words: int = 6) -> list[str]:
    """Split *text* into short caption chunks without any AI processing.

    Strategy (pure Python / regex, no external calls):
    1. Split at clause boundaries — after ``.``, ``!``, ``?``, or ``,`` followed
       by whitespace.  Each piece keeps its trailing punctuation so the TTS
       engine receives the correct prosody cues.
    2. Any resulting piece that is still longer than *max_words* words is further
       chopped into word-count chunks of at most *max_words*.
    3. If the entire input contains no split points the whole text is returned as
       a single-element list so the pipeline always gets at least one scene.
    """
    raw_parts = re.split(r'(?<=[.!?,])\s+', text.strip())
    chunks: list[str] = []
    for part in raw_parts:
        part = part.strip()
        if not part:
            continue
        words = part.split()
        if len(words) <= max_words:
            chunks.append(part)
        else:
            for i in range(0, len(words), max_words):
                sub = " ".join(words[i : i + max_words])
                if sub:
                    chunks.append(sub)
    return chunks if chunks else [text.strip()]


def build_studio_spoken_only_script(spoken_text: str, video_length: str) -> dict:
    """Build a multi-scene validated dict for TTS (avatar studio, no GPT).

    The spoken text is auto-chunked into short phrases so each scene drives a
    single Remotion caption card.  No AI or external API is involved — the
    splitting is done purely with regex / Python string manipulation.
    """
    if video_length not in _DURATION_MAP:
        raise ValueError(
            f"[ugc_director] video_length must be one of {list(_DURATION_MAP)}; "
            f"got {video_length!r}."
        )
    target_seconds = _DURATION_MAP[video_length]
    chunks = _chunk_spoken_text(spoken_text.strip())
    scenes = [
        {
            "scene_number": i + 1,
            "spoken_text": chunk,
            "on_screen_text": chunk,
            "visual_layout": "full_avatar",
        }
        for i, chunk in enumerate(chunks)
    ]
    data = {
        "estimated_duration_seconds": target_seconds,
        "scenes": scenes,
    }
    _validate_script_studio_spoken_only(data, target_seconds)
    return data


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
    layout_mode = parse_layout_mode(f"{brief or ''}\n{scraped_text or ''}")

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
        f"({target_seconds}s, {scene_guidance}, LAYOUT_MODE={layout_mode})"
    )

    client = OpenAI(api_key=api_key)
    raw = _call_gpt(
        client,
        user_content,
        build_ugc_director_system(layout_mode),
    )

    print("[ugc_director] Parsing and validating JSON response…")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"[ugc_director] ERROR: GPT-4o returned invalid JSON — {exc}"
        ) from exc

    _validate_script(data, target_seconds, layout_mode)

    print(
        f"[ugc_director] OK — {len(data['scenes'])} scene(s) validated for "
        f"{data['estimated_duration_seconds']}s UGC video."
    )
    return data


def generate_avatar_studio_script(
    creative_brief: str,
    director_notes: str | None,
    video_length: str,
) -> dict:
    """
    Hebrew UGC screenplay from creative brief only (no website crawl).

    director_notes guides structure; must not appear verbatim as stage directions in spoken_text.
    """
    if video_length not in _DURATION_MAP:
        raise ValueError(
            f"[ugc_director] video_length must be one of {list(_DURATION_MAP)}; "
            f"got {video_length!r}."
        )

    target_seconds = _DURATION_MAP[video_length]
    scene_guidance = _SCENE_GUIDANCE[video_length]

    raw_notes = director_notes or ""
    layout_mode = parse_layout_mode(raw_notes)
    stripped = strip_layout_mode_lines(raw_notes)
    notes_block = (
        stripped
        if stripped
        else "(None — infer hook, body, and CTA structure from the creative brief alone.)"
    )

    user_content = (
        "NO SCRAPED WEBSITE TEXT IS AVAILABLE. "
        "Build the entire script ONLY from the CREATIVE BRIEF and DIRECTOR NOTES below.\n\n"
        f"TARGET VIDEO LENGTH: {video_length} ({target_seconds} seconds). "
        f"Use exactly {scene_guidance}\n\n"
        f"CREATIVE BRIEF:\n{creative_brief.strip()}\n\n"
        f"DIRECTOR / STRUCTURE NOTES (for planning the arc only — output Hebrew spoken_text "
        f"that sounds natural; never speak labels, English directions, or markdown aloud):\n"
        f"{notes_block}\n"
    )

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "[ugc_director] ERROR: OPENAI_API_KEY environment variable is not set."
        )

    print(
        f"[ugc_director] Avatar studio: requesting {video_length} script from GPT-4o "
        f"({target_seconds}s, {scene_guidance}, LAYOUT_MODE={layout_mode})"
    )

    client = OpenAI(api_key=api_key)
    raw = _call_gpt(
        client,
        user_content,
        build_ugc_director_system(layout_mode),
    )

    print("[ugc_director] Avatar studio: parsing and validating JSON response…")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"[ugc_director] ERROR: GPT-4o returned invalid JSON — {exc}"
        ) from exc

    _validate_script(data, target_seconds, layout_mode)

    print(
        f"[ugc_director] Avatar studio OK — {len(data['scenes'])} scene(s) validated."
    )
    return data
