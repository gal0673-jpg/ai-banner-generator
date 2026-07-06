"""Post-crawl creative pipeline: GPT-4o copy + DALL-E 3 background + HTML→PNG.

Moved out of ``main.py`` (which was doing double duty as CLI + library) so
``services/banner_service.py`` and ``worker_tasks.py`` can pull the pipeline
helpers without dragging the CLI's stdin/stdout side effects with them.

The CLI entrypoint in ``main.py`` re-exports ``run_agency_banner_pipeline``
for backwards compatibility, so existing shell snippets like
``python -c "from main import run_agency_banner_pipeline"`` keep working.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from config import BASE_DIR

logger = logging.getLogger(__name__)


def run_agency_banner_pipeline(
    work_dir: Path | None = None,
    site_url: str = "",
) -> None:
    """GPT-4o + DALL-E 3 + HTML→PNG renderer for one banner task.

    Writes ``creative_campaign.json``, ``background.png``, and renders two
    high-quality PNGs (``rendered_banner_1.png``, ``rendered_banner_2.png``)
    next to the existing ``logo.png`` and ``scraped_content.txt``.

    Args:
        work_dir: When set, every artifact lives under that directory (used by
            the API per-task ``tasks/<uuid>/`` flow). When set, missing scraped
            content or logo raises ``RuntimeError`` instead of silently skipping.
        site_url: Optional site URL passed through to the HTML renderer's
            footer/link slot.
    """
    # Local imports keep ``import services.banner_pipeline`` light — OpenAI's
    # heavy import chain only runs when the pipeline is actually invoked.
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
        logger.warning(msg)
        return
    if not logo_file.is_file():
        msg = (
            "Agency banner: skipped (logo.png missing; homepage logo was not saved)."
        )
        if work_dir is not None:
            raise RuntimeError(msg)
        logger.warning(msg)
        return

    logger.info("Agency banner: requesting copy + generating background (OpenAI)…")
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
        logger.error("[banner_pipeline] %s", err)
        return

    logger.info("Agency banner: saved %s and %s", campaign_json.name, background_png.name)

    logger.info("Agency banner: rendering PNGs (html_renderer + headless Chrome)…")
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
        logger.info(
            "Agency banner: saved %s and %s to %s",
            rendered_banner_1.name,
            rendered_banner_2.name,
            root,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[banner_pipeline] rendered banner PNGs failed (%s). Continuing without them.",
            exc,
        )
