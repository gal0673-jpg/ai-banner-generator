"""
Elite marketing-agency banner: GPT-4o copy (any industry), DALL-E 3 background.

Requires:
  pip install openai requests tenacity
  Env: OPENAI_API_KEY

Inputs:  scraped_content.txt (UTF-8)
Outputs: creative_campaign.json, background.png

Final raster banner: run main.py (HTML + headless Chrome) or wire html_renderer yourself.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import requests
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
SCRAPED_PATH = BASE / "scraped_content.txt"
BACKGROUND_PNG_PATH = BASE / "background.png"
CAMPAIGN_JSON_PATH = BASE / "creative_campaign.json"

# Always appended to the model-written image_prompt when calling DALL·E 3 (strict enforcement).
DALLE_IMAGE_API_ENFORCEMENT = (
    "STRICT: The image MUST BE an empty environment, abstract background, or still-life object only. "
    "ABSOLUTELY NO humans, people, avatars, characters, body parts, or hands. "
    "CRITICAL: The image MUST be completely devoid of any text, letters, numbers, or UI gibberish. "
    "Use abstract, clean, or depth-of-field styles only; do not render fake text on screens, walls, or devices."
)

ELITE_AGENCY_SYSTEM = """You are an elite full-service marketing agency: sharp strategy, any vertical, any geography.

INPUTS YOU MUST COMBINE:
1) SCRAPED WEBSITE TEXT — titles, paragraphs, and on-page signals from the crawl (may include a trailing section).
2) OPTIONAL USER CAMPAIGN BRIEF — when the document contains a block titled "USER CAMPAIGN BRIEF (goals / target audience — provided by the user)", treat it as authoritative guidance for positioning, tone, and who we are speaking to. Weight it heavily: align headline, subhead, bullets, and CTA with those goals and that audience while staying truthful to the brand inferred from the site. If the brief is absent or empty, rely solely on the scraped site.

If the USER CAMPAIGN BRIEF contains specific hard data (like prices, discounts, numbers, or specific offers), you MUST inject them into the headline, subhead, or bullet_points — use whichever field carries the message most clearly (e.g. a percent-off or price in the headline or a bullet; a bundle or deadline in the subhead). Do not omit, round away, or replace user-supplied figures with vague language unless the brief itself is ambiguous.

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

- headline (string): A punchy Hebrew line for the main title. You may use a question or a bold statement; weave in the inferred brand or core service where it fits naturally. Default to hero headline length; if the brief includes prices, discounts, or concrete offers, you may extend modestly so those facts fit without feeling cramped (still one line of thought, not a paragraph).
- subhead (string): One short Hebrew sentence — the main solution, outcome, or differentiator. Confident and clear. If promotional specifics from the brief belong in the subhead, allow an extra short clause or slightly longer sentence so numbers and terms stay accurate and readable.
- bullet_points (array): Exactly three strings. Each is a concise Hebrew benefit or feature that is SPECIFIC to this scraped business (derive from real offerings, audience, proof signals, or explicit brief details — not generic filler). When the brief names a deal, metric, or guarantee, reflect it in at least one bullet even if that bullet is a bit longer than usual. No duplicates; each bullet adds a distinct angle.
- cta (string): Hebrew call to action, imperative, about 2–4 words.
- video_hook (string): EXACTLY 2 to 4 punchy Hebrew words (no punctuation beyond a single optional emphasis mark) for a fast ~2-second video intro title card. Must be distinct from the full headline — a teaser, hook, or bold fragment that stops the scroll. No English; no quotes in the string; keep under 40 characters if possible. This is generated in the same response as the banner copy — do not omit it.
- brand_color (string): A single CSS hex color for the brand accent, exactly 7 characters: "#" plus six hexadecimal digits (e.g. "#1D4ED8"). Infer the dominant brand color from the website copy and context (product category, named colors, industry cues). If the site gives no clear color signal, choose a vibrant, professional accent that fits the brand personality (still as valid hex).
- image_prompt (string): One detailed ENGLISH prompt for DALL-E 3. Describe a powerful, IMMERSIVE background photograph that matches the identified industry (examples: gleaming code on a dark monitor in a sleek workspace for tech/SaaS; artisan tools and materials in a workshop for trades; beautifully plated food in a restaurant setting; modern surgical or clinical equipment for healthcare; elegant law books and oak desk for legal; drone shot of construction site for real-estate — adapt precisely to the actual business). CRITICAL CONTEXT: this image will fill the LEFT HALF of a split-panel banner and will have a dark gradient overlay applied, so it needs RICH VISUAL DEPTH, strong contrast, and interesting textures that look compelling under a dark overlay. Use these sensibility keywords: "professional editorial photography", "dramatic depth of field", "cinematic lighting", "rich textures and detail", "bold composition", "studio-quality realism". Prefer real-world environments, materials, and objects that feel TACTILE and SPECIFIC to the industry — avoid generic grid patterns, flat-lay product shots, plain backgrounds, or anything overly minimalist. Avoid neon-heavy, cyberpunk, or cartoonish aesthetics. No requirement to reserve empty zones for text — HTML handles typography.

*** image_prompt — NON-NEGOTIABLE (highest priority) ***
""" + DALLE_IMAGE_API_ENFORCEMENT + """
You MUST bake the above into image_prompt: the scene is NEVER allowed to include people, faces, silhouettes, crowds, workers, customers, hands, or any living figures—only empty spaces, props, food/drink/plants/objects without holders, or fully abstract backdrops. Prefer compositions where pseudo-text cannot appear — abstract textures, nature, architecture without signs, heavily blurred backgrounds, macro details, empty/minimal surfaces, or depth-of-field that keeps screens/devices out of focus. Avoid prompts that invite laptops, phones, monitors, whiteboards, posters, books with visible pages, or wall art with glyphs. Reiterate in your own words: NO text, NO numbers, NO UI gibberish, NO logos, watermarks, or readable signage anywhere."""


_TRANSIENT_HTTP_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def _is_transient_openai_error(exc: BaseException) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError, RateLimitError, InternalServerError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code in _TRANSIENT_HTTP_STATUS
    return False


def _is_transient_requests_error(exc: BaseException) -> bool:
    if isinstance(
        exc,
        (
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.ChunkedEncodingError,
        ),
    ):
        return True
    if isinstance(exc, requests.exceptions.HTTPError):
        resp = exc.response
        return resp is not None and resp.status_code in _TRANSIENT_HTTP_STATUS
    return False


def _is_transient_dalle_step(exc: BaseException) -> bool:
    return _is_transient_openai_error(exc) or _is_transient_requests_error(exc)


_OPENAI_CHAT_RETRY = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception(_is_transient_openai_error),
)


_OPENAI_DALLE_RETRY = retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception(_is_transient_dalle_step),
)


@_OPENAI_CHAT_RETRY
def _chat_completions_create_banner(client: OpenAI, user_content: str):
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": ELITE_AGENCY_SYSTEM},
            {"role": "user", "content": user_content[:16000]},
        ],
        response_format={"type": "json_object"},
    )


@_OPENAI_DALLE_RETRY
def _images_generate_and_store(client: OpenAI, combined_prompt: str, dest: Path) -> None:
    img_response = client.images.generate(
        model="dall-e-3",
        prompt=combined_prompt,
        size="1024x1024",
    )
    image_url = img_response.data[0].url
    if not image_url:
        raise RuntimeError("[creative_agent] ERROR: DALL-E returned no image URL.")
    print("[creative_agent] Step 2/3: Downloading image from OpenAI URL…")
    img_req = requests.get(image_url, timeout=120)
    img_req.raise_for_status()
    dest.write_bytes(img_req.content)


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
        raise RuntimeError(f"[creative_agent] ERROR: {SCRAPED_PATH} not found.")
    text = SCRAPED_PATH.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError("[creative_agent] ERROR: scraped content is empty.")
    return text


def fetch_banner_payload(client: OpenAI, user_content: str) -> dict:
    print("[creative_agent] Step 1/3: Requesting copy + image brief from GPT-4o (Elite Marketing Agency)…")
    response = _chat_completions_create_banner(client, user_content)
    text = response.choices[0].message.content
    if not text:
        raise RuntimeError("[creative_agent] ERROR: Empty response from GPT-4o.")
    print("[creative_agent] Step 1/3: Parsing JSON…")
    data = json.loads(text)
    for key in ("headline", "subhead", "cta", "video_hook", "image_prompt", "brand_color"):
        if key not in data or not str(data[key]).strip():
            raise RuntimeError(f"[creative_agent] ERROR: Missing or empty JSON key {key!r}.")
    bullets = data.get("bullet_points")
    if not isinstance(bullets, list):
        raise RuntimeError(
            "[creative_agent] ERROR: JSON key 'bullet_points' must be an array of exactly 3 strings."
        )
    if len(bullets) != 3:
        raise RuntimeError(
            f"[creative_agent] ERROR: 'bullet_points' must contain exactly 3 items, got {len(bullets)}."
        )
    normalized: list[str] = []
    for i, item in enumerate(bullets):
        if not isinstance(item, str) or not item.strip():
            raise RuntimeError(
                f"[creative_agent] ERROR: 'bullet_points'[{i}] must be a non-empty string."
            )
        normalized.append(item.strip())
    data["bullet_points"] = normalized

    hex_color = str(data["brand_color"]).strip()
    if not hex_color.startswith("#"):
        hex_color = "#" + hex_color
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", hex_color):
        raise RuntimeError(
            f"[creative_agent] ERROR: 'brand_color' must be #RRGGBB hex, got {data['brand_color']!r}."
        )
    data["brand_color"] = hex_color.upper()

    hook_raw = str(data["video_hook"]).strip()
    if len(hook_raw) > 256:
        hook_raw = hook_raw[:256].rstrip()
    word_count = len(hook_raw.split())
    if word_count < 2 or word_count > 5:
        raise RuntimeError(
            f"[creative_agent] ERROR: 'video_hook' must be 2–4 punchy Hebrew words "
            f"(allow up to 5 tokens); got {word_count} token(s): {hook_raw!r}."
        )
    data["video_hook"] = hook_raw

    print(
        "[creative_agent] Step 1/3: OK — headline, subhead, bullet_points (3), cta, video_hook, "
        "brand_color, image_prompt received."
    )
    return data


def generate_background_dalle3(
    client: OpenAI, image_prompt: str, *, output_path: Path | None = None
) -> Path:
    dest = Path(output_path) if output_path is not None else BACKGROUND_PNG_PATH
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("[creative_agent] Step 2/3: Generating background with DALL-E 3 (1024×1024)…")
    combined_prompt = f"{image_prompt.strip()}\n\n{DALLE_IMAGE_API_ENFORCEMENT}"
    _images_generate_and_store(client, combined_prompt, dest)
    print(f"[creative_agent] Step 2/3: Wrote {dest}.")
    return dest


def main() -> None:
    _require_api_key()
    try:
        user_content = _read_scraped()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    client = OpenAI()

    try:
        payload = fetch_banner_payload(client, user_content)
        generate_background_dalle3(client, str(payload["image_prompt"]))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    print(f"[creative_agent] Step 3/3: Saving payload to {CAMPAIGN_JSON_PATH}…")
    with CAMPAIGN_JSON_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(
        "[creative_agent] Done — creative_campaign.json and background.png ready. "
        "Run main.py with OPENAI_API_KEY for background.png + creative_campaign.json (live editor / client export)."
    )


if __name__ == "__main__":
    main()
