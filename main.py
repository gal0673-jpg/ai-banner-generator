"""CLI entry for crawl + optional agency banner pipeline.

The pipeline implementation lives in ``services.banner_pipeline``; this module
is the human-driven entrypoint that prompts for a URL, runs the crawler, and
(if ``OPENAI_API_KEY`` is set) chains the post-crawl creative pipeline.

For backwards compatibility, ``BASE_DIR`` and ``run_agency_banner_pipeline``
are still importable from this module — they now re-export from
``config`` and ``services.banner_pipeline`` respectively.
"""

from __future__ import annotations

import os
import sys

# Re-exports so legacy code paths (e.g. third-party scripts) keep working.
from config import BASE_DIR  # noqa: F401 — re-export
from services.banner_pipeline import run_agency_banner_pipeline  # noqa: F401 — re-export


def main() -> None:
    from services.crawler_service import crawl_from_url

    raw_url = input("Enter a URL: ")
    if not raw_url.strip():
        print("Error: URL cannot be empty.", file=sys.stderr)
        return

    try:
        crawl_from_url(raw_url)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
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
