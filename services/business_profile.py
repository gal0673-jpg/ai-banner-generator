"""Business-profile helpers: build the canonical creative brief and extract
structured business facts from crawled website text via GPT.

Two pieces, deliberately separated so the pure text assembly is unit-testable
without any network calls:

* ``build_context_text`` — pure function. Turns the profile's structured fields
  (+ optional scraped site text) into the single brief that seeds the creative
  pipeline. This is written to ``scraped_content.txt`` in a task's work_dir in
  place of a fresh crawl, so ``creative_agent`` / ``ugc_director`` consume it
  unchanged.
* ``extract_profile_fields`` — GPT-4o call. Reads raw crawled text and returns a
  structured dict (name, description, audience, tone, offerings, brand_color).
  Used by the one-time "scan my website" flow to prefill a profile.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")

# Keys we ask GPT to return; all optional so a sparse site still yields a profile.
_EXTRACT_KEYS = ("name", "description", "audience", "tone", "offerings", "brand_color")

_EXTRACT_SYSTEM = """You are a brand strategist. You will be given the raw text crawled from a
business's website. Extract a concise business profile.

Return ONLY valid JSON (no markdown, no commentary) with exactly these keys:

- name (string): the business/brand name as customers recognize it. If unclear, use "".
- description (string): 1-2 sentences, in Hebrew, on what the business does and its core value.
- audience (string): one short Hebrew sentence describing the target customer.
- tone (string): 2-4 Hebrew words describing the brand voice (e.g. "מקצועי וחם", "צעיר ואנרגטי").
- offerings (string): a short Hebrew list of the main products/services/offers, comma-separated.
- brand_color (string): the dominant brand accent as a #RRGGBB hex (e.g. "#1D4ED8"). If no
  clear signal, pick a professional accent that fits the brand. Always return valid hex.

Ignore legal boilerplate, cookie/privacy notices, and accessibility statements. Base every
field on the real customer-facing content. Never invent facts that contradict the site.
Write Hebrew fields in natural, marketing-grade Hebrew."""


def _clean(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:limit]


def build_context_text(
    *,
    name: str | None = None,
    description: str | None = None,
    audience: str | None = None,
    tone: str | None = None,
    offerings: str | None = None,
    brand_color: str | None = None,
    scraped_text: str | None = None,
) -> str:
    """Assemble the canonical creative brief for the pipeline (pure, no I/O).

    The output mirrors what the crawler writes to ``scraped_content.txt`` plus a
    clearly labeled brief block, so the existing GPT creative step treats it the
    same way it treats a real crawl + user brief.
    """
    lines: list[str] = ["BUSINESS PROFILE (provided by the customer)", "-" * 40]
    if name and name.strip():
        lines.append(f"Business name: {name.strip()}")
    if description and description.strip():
        lines.append(f"What the business does: {description.strip()}")
    if offerings and offerings.strip():
        lines.append(f"Key offerings: {offerings.strip()}")
    if audience and audience.strip():
        lines.append(f"Target audience: {audience.strip()}")
    if tone and tone.strip():
        lines.append(f"Brand tone / voice: {tone.strip()}")
    if brand_color and brand_color.strip():
        lines.append(f"Brand color: {brand_color.strip()}")

    brief = "\n".join(lines).strip()

    scraped = (scraped_text or "").strip()
    if scraped:
        return f"{brief}\n\nCRAWLED WEBSITE TEXT\n{'-' * 40}\n{scraped}".strip()
    return brief


_COPY_KEYS = ("headline", "subhead", "bullet_points", "cta", "video_hook")


def generate_marketing_copy(
    client: Any, context_text: str, goal: str | None = None
) -> dict[str, Any]:
    """Return ready-to-publish marketing copy (headline/subhead/bullets/cta/hook).

    Reuses ``creative_agent.fetch_banner_payload`` — the same GPT-4o call the
    banner pipeline uses — but returns only the text fields (no image prompt /
    DALL-E), so copy is instant and cheap. ``goal`` is appended in the block the
    creative prompt treats as authoritative user guidance.
    """
    from creative_agent import fetch_banner_payload

    content = context_text.strip()
    if goal and goal.strip():
        content = (
            f"{content}\n\n"
            "USER CAMPAIGN BRIEF (goals / target audience — provided by the user)\n"
            f"{goal.strip()}"
        )
    payload = fetch_banner_payload(client, content)
    return {key: payload.get(key) for key in _COPY_KEYS}


def extract_profile_fields(client: Any, scraped_text: str) -> dict[str, str | None]:
    """Ask GPT-4o to turn raw crawled text into structured profile fields.

    ``client`` is an ``openai.OpenAI`` instance (injected so tests can pass a
    fake). Returns a dict with the ``_EXTRACT_KEYS``; values may be ``None`` when
    the site gives no signal. Reuses ``creative_agent``'s transient-retry wrapper.
    """
    from creative_agent import _OPENAI_CHAT_RETRY  # reuse the tenacity policy

    @_OPENAI_CHAT_RETRY
    def _call() -> Any:
        return client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": (scraped_text or "")[:16000]},
            ],
            response_format={"type": "json_object"},
        )

    response = _call()
    text = response.choices[0].message.content
    if not text:
        raise RuntimeError("Empty response from GPT-4o during profile extraction.")
    data = json.loads(text)

    out: dict[str, str | None] = {}
    for key in _EXTRACT_KEYS:
        out[key] = _clean(data.get(key), 8000 if key in ("description", "offerings") else 1000)

    color = out.get("brand_color")
    if color:
        if not color.startswith("#"):
            color = "#" + color
        out["brand_color"] = color.upper() if _HEX.match(color) else None
    return out
