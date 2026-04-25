"""Video microservice payload building (Remotion /render contract)."""

from __future__ import annotations

import os
from typing import Any

from fastapi import Request

from models import BannerTask


def public_api_base(request: Request) -> str:
    """Origin for turning /task-files/... into absolute URLs for the video microservice."""
    env = os.environ.get("PUBLIC_API_BASE_URL", "").strip()
    if env:
        return env.rstrip("/")
    return str(request.base_url).rstrip("/")


def video_engine_render_url() -> str:
    base = os.environ.get("VIDEO_ENGINE_URL", "http://127.0.0.1:9000").rstrip("/")
    return f"{base}/render"


def pick_canvas_slice(canvas_state: Any, design: int, aspect_ratio: str = "1:1") -> dict[str, Any]:
    if not isinstance(canvas_state, dict):
        return {}
    if aspect_ratio == "9:16":
        key = "design1_vertical" if design == 1 else "design2_vertical"
    else:
        key = "design1" if design == 1 else "design2"
    sl = canvas_state.get(key)
    return sl if isinstance(sl, dict) else {}


def _prefer_slice_str(sl: dict[str, Any], key: str, row_val: str | None) -> str:
    if key in sl:
        v = sl[key]
        if isinstance(v, str):
            return v.strip()
    if row_val is None:
        return ""
    return str(row_val).strip()


def _prefer_slice_bullets(sl: dict[str, Any], row_bullets: list | None) -> list[str]:
    raw = sl.get("bullets")
    if not isinstance(raw, list):
        raw = sl.get("bullet_points")
    if isinstance(raw, list) and all(isinstance(x, str) for x in raw):
        return [str(x).strip() for x in raw]
    if isinstance(row_bullets, list):
        return [str(x).strip() for x in row_bullets]
    return []


def absolute_asset_url(public_base: str, path: str | None) -> str:
    if not path:
        return ""
    p = str(path).strip()
    if p.startswith("http://") or p.startswith("https://"):
        return p
    base = public_base.rstrip("/")
    if not p.startswith("/"):
        p = "/" + p
    return base + p


def banner_video_payload(row: BannerTask, design: int, public_base: str, aspect_ratio: str = "1:1") -> dict[str, Any]:
    """Merge DB columns with canvas_state (design1/design2/vertical); slice wins when a key is present."""
    c = row.creative
    canvas_state = c.canvas_state if c else None
    sl = pick_canvas_slice(canvas_state, design, aspect_ratio)
    headline = _prefer_slice_str(sl, "headline", c.headline if c else None)
    subhead = _prefer_slice_str(sl, "subhead", c.subhead if c else None)
    cta = _prefer_slice_str(sl, "cta", c.cta if c else None)
    bullet_points = _prefer_slice_bullets(sl, c.bullet_points if c else None)
    bc_sl = sl.get("brand_color")
    if isinstance(bc_sl, str) and bc_sl.strip():
        brand_color = bc_sl.strip()
    else:
        brand_color = ((c.brand_color if c else None) or "#2563eb").strip() or "#2563eb"
    if not brand_color.startswith("#"):
        brand_color = "#" + brand_color

    background_url = absolute_asset_url(public_base, c.background_url if c else None)
    logo_url = absolute_asset_url(public_base, c.logo_url if c else None)
    video_hook = _prefer_slice_str(sl, "video_hook", c.video_hook if c else None)

    return {
        "headline": headline,
        "subhead": subhead,
        "cta": cta,
        "bullet_points": bullet_points,
        "brand_color": brand_color,
        "background_url": background_url,
        "logo_url": logo_url,
        "video_hook": video_hook,
    }


def video_payload_for_engine(
    row: BannerTask, design_type: int, public_base: str, aspect_ratio: str = "1:1"
) -> dict[str, Any]:
    """Banner fields + explicit layout flags for the Node /render endpoint."""
    payload = banner_video_payload(row, design_type, public_base, aspect_ratio)
    hook = (payload.get("video_hook") or "").strip()
    payload["video_hook"] = hook
    payload["videoHook"] = hook
    dt = 2 if int(design_type) == 2 else 1
    payload["design_type"] = dt
    payload["designTemplate"] = dt
    payload["video_layout"] = "immersive" if dt == 2 else "split"
    payload["videoLayout"] = payload["video_layout"]
    payload["aspect_ratio"] = aspect_ratio
    payload["aspectRatio"] = aspect_ratio
    payload["isVertical"] = aspect_ratio == "9:16"
    return payload
