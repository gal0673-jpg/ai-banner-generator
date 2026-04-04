"""
Elite marketing-agency banner: GPT-4o copy (any industry), DALL-E 3 background.

Requires:
  pip install openai requests
  Env: OPENAI_API_KEY

Inputs:  scraped_content.txt (UTF-8)
Outputs: creative_campaign.json, background.png

Final raster banner: run main.py (HTML + headless Chrome) or wire html_renderer yourself.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from openai import OpenAI

BASE = Path(__file__).resolve().parent
SCRAPED_PATH = BASE / "scraped_content.txt"
BACKGROUND_PNG_PATH = BASE / "background.png"
CAMPAIGN_JSON_PATH = BASE / "creative_campaign.json"

ELITE_AGENCY_SYSTEM = """You are an elite full-service marketing agency: sharp strategy, any vertical, any geography.

Your job is to read the scraped website text and DYNAMICALLY infer:
• The ACTUAL brand or business name (how customers would recognize them).
• The CORE business or service (e.g. SaaS, plumbing, law firm, restaurant, publisher, clinic, e-commerce, agency, nonprofit — whatever truly matches the source).

STRICT RULES — IGNORE and do NOT let these steer the brand story:
• Legal boilerplate, terms of service, cookie notices, disclaimers.
• Privacy policy content.
• Accessibility statements-only pages (unless they are the sole signal — prefer product/service pages).
Focus on real value propositions, offerings, and customer-facing copy.

Then identify the prospect’s main PAIN POINT and the brand’s main SOLUTION or benefit.

The deliverable feeds an HTML-based marketing layout (not a baked-in image overlay). Copy will be placed in the page as structured text; the image is a separate hero/background asset.

LANGUAGE: Write headline, subhead, bullet_points, and cta entirely in natural, marketing-grade Hebrew. image_prompt must be in English (for DALL-E 3).

Output ONLY valid JSON (no markdown, no commentary, no extra keys) with exactly these keys:

- headline (string): A punchy Hebrew line for the main title. You may use a question or a bold statement; weave in the inferred brand or core service where it fits naturally. Keep it short (hero headline length).
- subhead (string): One short Hebrew sentence — the main solution, outcome, or differentiator. Confident and clear.
- bullet_points (array): Exactly three strings. Each is a very short Hebrew benefit or feature that is SPECIFIC to this scraped business (derive from real offerings, audience, or proof signals in the source — not generic filler). No duplicates; each bullet adds a distinct angle.
- cta (string): Hebrew call to action, imperative, about 2–4 words.
- image_prompt (string): One detailed ENGLISH prompt for DALL-E 3. Describe a strong hero/background image that matches the identified industry (e.g. workshop and tools for trades; professional office for legal; appetizing setting for food; calm space for wellness; modern workspace for software — adapt to the actual business). The prompt MUST always weave in these exact sensibility keywords/phrases (or very close equivalents): "bright daylight lighting", "clean white or light-gray background", "airy modern aesthetic", "optimistic vibe". Avoid dark, moody, low-key, neon-heavy, or "cyberpunk" tech visuals — no dramatic night scenes, heavy shadows as the dominant look, or dystopian/futuristic noir; the image must harmonize with a light-themed web layout. No requirement to reserve empty zones for text — HTML handles typography. Absolutely NO text, letters, numbers, logos, watermarks, or readable signage in the image."""


def _require_api_key() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        print(
            "[creative_agent] ERROR: Set OPENAI_API_KEY "
            "(e.g. PowerShell: $env:OPENAI_API_KEY='your-key').",
            file=sys.stderr,
        )
        sys.exit(1)


def _read_scraped() -> str:
    if not SCRAPED_PATH.is_file():
        print(f"[creative_agent] ERROR: {SCRAPED_PATH} not found.", file=sys.stderr)
        sys.exit(1)
    text = SCRAPED_PATH.read_text(encoding="utf-8").strip()
    if not text:
        print("[creative_agent] ERROR: scraped content is empty.", file=sys.stderr)
        sys.exit(1)
    return text


def fetch_banner_payload(client: OpenAI, user_content: str) -> dict:
    print("[creative_agent] Step 1/3: Requesting copy + image brief from GPT-4o (Elite Marketing Agency)…")
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": ELITE_AGENCY_SYSTEM},
            {"role": "user", "content": user_content[:16000]},
        ],
        response_format={"type": "json_object"},
    )
    text = response.choices[0].message.content
    if not text:
        print("[creative_agent] ERROR: Empty response from GPT-4o.", file=sys.stderr)
        sys.exit(1)
    print("[creative_agent] Step 1/3: Parsing JSON…")
    data = json.loads(text)
    for key in ("headline", "subhead", "cta", "image_prompt"):
        if key not in data or not str(data[key]).strip():
            print(f"[creative_agent] ERROR: Missing or empty JSON key {key!r}.", file=sys.stderr)
            sys.exit(1)
    bullets = data.get("bullet_points")
    if not isinstance(bullets, list):
        print(
            "[creative_agent] ERROR: JSON key 'bullet_points' must be an array of exactly 3 strings.",
            file=sys.stderr,
        )
        sys.exit(1)
    if len(bullets) != 3:
        print(
            f"[creative_agent] ERROR: 'bullet_points' must contain exactly 3 items, got {len(bullets)}.",
            file=sys.stderr,
        )
        sys.exit(1)
    normalized: list[str] = []
    for i, item in enumerate(bullets):
        if not isinstance(item, str) or not item.strip():
            print(
                f"[creative_agent] ERROR: 'bullet_points'[{i}] must be a non-empty string.",
                file=sys.stderr,
            )
            sys.exit(1)
        normalized.append(item.strip())
    data["bullet_points"] = normalized
    print(
        "[creative_agent] Step 1/3: OK — headline, subhead, bullet_points (3), cta, image_prompt received."
    )
    return data


def generate_background_dalle3(client: OpenAI, image_prompt: str) -> None:
    print("[creative_agent] Step 2/3: Generating background with DALL-E 3 (1024×1024)…")
    img_response = client.images.generate(
        model="dall-e-3",
        prompt=image_prompt,
        size="1024x1024",
    )
    image_url = img_response.data[0].url
    if not image_url:
        print("[creative_agent] ERROR: DALL-E returned no image URL.", file=sys.stderr)
        sys.exit(1)
    print("[creative_agent] Step 2/3: Downloading image from OpenAI URL…")
    img_req = requests.get(image_url, timeout=120)
    img_req.raise_for_status()
    BACKGROUND_PNG_PATH.write_bytes(img_req.content)
    print(f"[creative_agent] Step 2/3: Wrote {BACKGROUND_PNG_PATH}.")


def main() -> None:
    _require_api_key()
    user_content = _read_scraped()
    client = OpenAI()

    payload = fetch_banner_payload(client, user_content)
    generate_background_dalle3(client, str(payload["image_prompt"]))

    print(f"[creative_agent] Step 3/3: Saving payload to {CAMPAIGN_JSON_PATH}…")
    with CAMPAIGN_JSON_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(
        "[creative_agent] Done — creative_campaign.json and background.png ready. "
        "Run main.py with OPENAI_API_KEY for HTML + final_agency_banner.png, or use html_renderer + Selenium."
    )


if __name__ == "__main__":
    main()
