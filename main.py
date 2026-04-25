"""
CLI entry for crawl + optional agency banner pipeline (OpenAI / html_renderer).

Crawl implementation lives in ``services.crawler_service`` (httpx/BeautifulSoup +
undetected-chromedriver).  This module keeps ``BASE_DIR`` for path layout and
``run_agency_banner_pipeline`` for post-crawl creative generation.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def run_agency_banner_pipeline(
    work_dir: Path | None = None,
    site_url: str = "",
) -> None:
    """
    GPT-4o + DALL-E 3 (via creative_agent): writes creative_campaign.json,
    background.png, and uses existing logo.png.  After that it renders a
    two high-quality PNGs (``rendered_banner_1.png``, ``rendered_banner_2.png``) via html_renderer.

    If ``work_dir`` is set, all artifacts live under that directory (for API jobs).
    When ``work_dir`` is set, missing scraped content or logo raises ``RuntimeError``.
    """
    from openai import OpenAI

    from creative_agent import fetch_banner_payload, generate_background_dalle3
    from html_renderer import render_design_1_html, render_design_2_html, render_html_to_png

    root = work_dir if work_dir is not None else BASE_DIR
    output_file = root / "scraped_content.txt"
    logo_file = root / "logo.png"
    background_png = root / "background.png"
    campaign_json = root / "creative_campaign.json"
    banner_html_1 = root / "banner_temp_design1.html"
    banner_html_2 = root / "banner_temp_design2.html"
    rendered_banner_1 = root / "rendered_banner_1.png"
    rendered_banner_2 = root / "rendered_banner_2.png"

    if work_dir is not None:
        work_dir.mkdir(parents=True, exist_ok=True)

    if not output_file.is_file() or not output_file.read_text(encoding="utf-8").strip():
        msg = "Agency banner: skipped (no scraped content)."
        if work_dir is not None:
            raise RuntimeError(msg)
        print(msg, file=sys.stderr)
        return
    if not logo_file.is_file():
        msg = (
            "Agency banner: skipped (logo.png missing; homepage logo was not saved)."
        )
        if work_dir is not None:
            raise RuntimeError(msg)
        print(msg, file=sys.stderr)
        return

    print("Agency banner: requesting copy + generating background (OpenAI)...")
    client = OpenAI()
    user_content = output_file.read_text(encoding="utf-8")
    payload = fetch_banner_payload(client, user_content)
    generate_background_dalle3(
        client, str(payload["image_prompt"]), output_path=background_png
    )

    with campaign_json.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    if not background_png.is_file():
        err = "background.png was not created."
        if work_dir is not None:
            raise RuntimeError(err)
        print(f"[main] ERROR: {err}", file=sys.stderr)
        return

    print(f"Agency banner: saved {campaign_json.name} and {background_png.name}")

    print("Agency banner: rendering PNGs (html_renderer + headless Chrome)…")
    try:
        render_design_1_html(
            payload,
            background_path=background_png,
            logo_path=logo_file,
            output_path=banner_html_1,
            site_url=site_url,
        )
        render_design_2_html(
            payload,
            background_path=background_png,
            logo_path=logo_file,
            output_path=banner_html_2,
            site_url=site_url,
        )
        render_html_to_png(banner_html_1, rendered_banner_1)
        render_html_to_png(banner_html_2, rendered_banner_2)
        print(
            f"Agency banner: saved {rendered_banner_1.name} and {rendered_banner_2.name} "
            f"to {root}"
        )
    except Exception as exc:  # noqa: BLE001
        print(
            f"[main] WARNING: rendered banner PNGs failed ({exc}). Continuing without them.",
            file=sys.stderr,
        )


def main() -> None:
    from services.crawler_service import crawl_from_url

    raw_url = input("Enter a URL: ")
    if not raw_url.strip():
        print("Error: URL cannot be empty.")
        return

    try:
        crawl_from_url(raw_url)
    except ValueError as e:
        print(f"Error: {e}")
        return

    if os.environ.get("OPENAI_API_KEY"):
        run_agency_banner_pipeline(site_url=raw_url)
    else:
        print(
            "Tip: set OPENAI_API_KEY to generate creative_campaign.json and background.png "
            "after crawl (requires logo.png)."
        )


if __name__ == "__main__":
    main()
