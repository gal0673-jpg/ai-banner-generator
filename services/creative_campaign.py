"""Pure validation of the ``creative_campaign.json`` payload.

Extracted from ``worker_tasks.run_banner_task`` so the parsing/validation rules
are unit-testable without a Celery worker, a DB, or the filesystem. The worker
maps ``CreativeCampaignError`` to a task-failed status + ``BannerPipelineFatalError``.

The error messages are kept byte-identical to the previous inline checks so the
persisted ``banner_tasks.error`` text (which clients may display) is unchanged.
"""

from __future__ import annotations

import re
from typing import Any

_BRAND_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class CreativeCampaignError(ValueError):
    """The ``creative_campaign.json`` payload is missing or malformed."""


def parse_creative_campaign(
    data: dict[str, Any], *, custom_video_hook: str | None = None
) -> dict[str, Any]:
    """Validate the pipeline's campaign JSON and return the cleaned banner fields.

    Returns a dict with ``headline``, ``subhead``, ``cta``, ``bullet_points``
    (3 strings), ``video_hook`` (custom override wins over the AI hook), and
    ``brand_color`` (normalized ``#RRGGBB`` uppercase). Raises
    ``CreativeCampaignError`` on the first validation failure.
    """
    for key in ("headline", "subhead", "cta"):
        if key not in data or not str(data[key]).strip():
            raise CreativeCampaignError(
                f"Invalid creative_campaign.json: missing or empty {key!r}"
            )

    bullets = data.get("bullet_points")
    if not isinstance(bullets, list) or len(bullets) != 3:
        raise CreativeCampaignError(
            "Invalid creative_campaign.json: bullet_points must be 3 strings."
        )

    bc_raw = data.get("brand_color")
    if not isinstance(bc_raw, str) or not bc_raw.strip():
        raise CreativeCampaignError(
            "Invalid creative_campaign.json: missing or empty brand_color."
        )
    bc = bc_raw.strip()
    if not bc.startswith("#"):
        bc = "#" + bc
    if not _BRAND_HEX.match(bc):
        raise CreativeCampaignError(
            "Invalid creative_campaign.json: brand_color must be #RRGGBB hex."
        )

    raw_hook = data.get("video_hook")
    ai_hook: str | None = (
        str(raw_hook).strip()[:256] if raw_hook and str(raw_hook).strip() else None
    )

    return {
        "headline": str(data["headline"]).strip(),
        "subhead": str(data["subhead"]).strip(),
        "cta": str(data["cta"]).strip(),
        "bullet_points": [str(b).strip() for b in bullets],
        "video_hook": custom_video_hook or ai_hook,
        "brand_color": bc.upper(),
    }
