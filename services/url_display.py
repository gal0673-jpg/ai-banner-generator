"""Normalize user-supplied URLs for on-screen display (UGC / Remotion overlays)."""

from __future__ import annotations

import re


def normalize_website_display(raw: str | None) -> str | None:
    """Strip ``https://``, ``http://``, and leading ``www.``; keep host (and port if any).

    Returns ``None`` when the result would be empty. Does not validate DNS.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = re.sub(r"^https?://", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^www\.", "", s, flags=re.IGNORECASE)
    s = s.split("/")[0].split("?")[0].split("#")[0].strip()
    s = s.rstrip(".")
    return s or None
