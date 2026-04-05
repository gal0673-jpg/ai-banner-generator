"""
Render a premium split-panel RTL marketing banner as HTML (1080×1080 square).
Optionally renders the HTML to PNG using Selenium headless Chrome.

Layout
──────
 ┌───────────────────────────────────────────────────────────────────┐
 │ LEFT PANEL (44%)              │ RIGHT PANEL (56%)                 │
 │                               │                                   │
 │  DALL-E background image      │  [Logo]                           │
 │  with dark + brand-colour     │  [Headline – large, bold]         │
 │  gradient overlay             │  [Subhead]                        │
 │                               │  ✓ Feature 1                      │
 │                               │  ✓ Feature 2                      │
 │                               │  ✓ Feature 3                      │
 │                               │  [CTA button – brand colour]      │
 ├───────────────────────────────┴───────────────────────────────────┤
 │              www.domain.co.il  >>  bottom brand strip             │
 └───────────────────────────────────────────────────────────────────┘
"""

from __future__ import annotations

import html
import io
import re
import time
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

BANNER_PX = 1080
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "banner_temp.html"

_DEFAULT_BRAND = "#4F46E5"
_HEX_RE = re.compile(r"^#?([0-9A-Fa-f]{6})$")


def _normalize_brand_hex(raw: Any) -> str:
    s = str(raw or "").strip()
    m = _HEX_RE.match(s)
    if not m:
        return _DEFAULT_BRAND
    return f"#{m.group(1).upper()}"


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (79, 70, 229)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _luminance(r: int, g: int, b: int) -> float:
    def _c(v: int) -> float:
        x = v / 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * _c(r) + 0.7152 * _c(g) + 0.0722 * _c(b)


def _cta_text_color(brand_hex: str) -> str:
    r, g, b = _hex_to_rgb(brand_hex)
    return "#0f172a" if _luminance(r, g, b) > 0.45 else "#ffffff"


def _asset_url(asset: Path, html_path: Path) -> str:
    """Relative POSIX path usable from the HTML file; falls back to file URI."""
    import os
    try:
        rel = Path(os.path.relpath(asset.resolve(), html_path.parent.resolve()))
        return rel.as_posix()
    except ValueError:
        return asset.resolve().as_uri()


def _extract_domain(url: str) -> str:
    """Return bare netloc, e.g. 'www.tsite.co.il'."""
    try:
        parsed = urlparse(url if "://" in url else "https://" + url)
        return parsed.netloc or url
    except Exception:
        return url


# ─────────────────────────────────────────────────────────────────────────────
# HTML builder
# ─────────────────────────────────────────────────────────────────────────────

def render_banner_html(
    data: Mapping[str, Any],
    background_path: str | Path,
    logo_path: str | Path,
    output_path: str | Path | None = None,
    site_url: str = "",
) -> str:
    """
    Write the split-panel banner HTML to *output_path* (default: banner_temp.html)
    and return the full HTML string.

    ``data`` keys used: headline, subhead, bullet_points (3 strings), cta, brand_color.
    """
    headline_txt = str(data["headline"]).strip()
    subhead_txt  = str(data["subhead"]).strip()
    cta_txt      = str(data["cta"]).strip()
    bullets      = data["bullet_points"]
    if not isinstance(bullets, (list, tuple)) or len(bullets) != 3:
        raise ValueError("data['bullet_points'] must be exactly 3 strings")

    brand_hex  = _normalize_brand_hex(data.get("brand_color"))
    r, g, b    = _hex_to_rgb(brand_hex)
    cta_fg     = _cta_text_color(brand_hex)
    domain     = _extract_domain(site_url) if site_url else ""

    bg   = Path(background_path).resolve()
    logo = Path(logo_path).resolve()
    out  = Path(output_path).resolve() if output_path else DEFAULT_OUTPUT
    out.parent.mkdir(parents=True, exist_ok=True)

    bg_url   = html.escape(_asset_url(bg, out),   quote=True)
    logo_url = html.escape(_asset_url(logo, out), quote=True)

    # ── Feature cards ─────────────────────────────────────────────────────────
    feature_rows: list[str] = []
    for raw in bullets:
        text = html.escape(str(raw).strip())
        feature_rows.append(
            f'      <div class="feat-card" style="border-top-color:{brand_hex};">\n'
            f'        <div class="feat-icon" style="background-color:{brand_hex};color:{cta_fg};">✓</div>\n'
            f'        <span class="feat-text">{text}</span>\n'
            f'      </div>'
        )
    features_html = "\n".join(feature_rows)

    # ── Bottom strip text ────────────────────────────────────────────────────
    if domain:
        bottom_text = html.escape(domain)
    else:
        bottom_text = html.escape(cta_txt)

    doc = f"""<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="utf-8">
<title>Banner</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{margin:0;padding:0;box-sizing:border-box;}}
body{{
  width:{BANNER_PX}px;height:{BANNER_PX}px;
  overflow:hidden;
  font-family:'Heebo',Arial,sans-serif;
  direction:ltr;
  -webkit-font-smoothing:antialiased;
}}
.banner{{
  width:{BANNER_PX}px;height:{BANNER_PX}px;
  display:flex;flex-direction:column;
}}
/* ── Main row ── */
.banner-main{{
  flex:1;min-height:0;
  display:flex;flex-direction:row;
}}
/* ── Left: photo panel ── */
.left-panel{{
  width:44%;
  position:relative;overflow:hidden;
  flex-shrink:0;
}}
.left-bg{{
  position:absolute;inset:0;
  background-image:url('{bg_url}');
  background-size:cover;background-position:center;
}}
.left-overlay{{
  position:absolute;inset:0;
  background:linear-gradient(
    145deg,
    rgba(10,18,36,0.92) 0%,
    rgba({r},{g},{b},0.60) 45%,
    rgba(10,18,36,0.80) 100%
  );
}}
/* Brand accent bar between panels */
.panel-divider{{
  width:6px;
  background:{brand_hex};
  flex-shrink:0;
  box-shadow:2px 0 20px rgba({r},{g},{b},0.55);
}}
/* ── Right: content panel ── */
.right-panel{{
  flex:1;min-width:0;
  background:linear-gradient(155deg,#ffffff 0%,#f8fafc 55%,rgba({r},{g},{b},0.07) 100%);
  display:flex;flex-direction:column;
  padding:44px 52px 40px 48px;
  direction:rtl;
}}
.logo-row{{
  flex-shrink:0;
  margin-bottom:30px;
  display:flex;
  justify-content:flex-start;
}}
.logo-row img{{
  max-height:60px;max-width:200px;
  object-fit:contain;object-position:left center;
}}
.content{{
  flex:1;display:flex;flex-direction:column;justify-content:center;
  gap:0;
}}
.headline{{
  font-size:44px;font-weight:900;line-height:1.18;
  color:#0f172a;
  margin-bottom:14px;
  letter-spacing:-0.4px;
  word-break:break-word;
}}
.subhead{{
  font-size:19px;font-weight:500;line-height:1.55;
  color:#475569;
  margin-bottom:30px;
}}
.features{{
  display:flex;flex-direction:row;gap:14px;
  margin-bottom:34px;
  direction:rtl;
}}
.feat-card{{
  flex:1;min-width:0;
  background:#ffffff;
  border-radius:14px;
  padding:20px 16px 16px;
  box-shadow:0 2px 8px rgba(0,0,0,0.06),0 8px 24px rgba(0,0,0,0.06);
  border-top:4px solid;
  display:flex;flex-direction:column;gap:12px;
  direction:rtl;
}}
.feat-icon{{
  width:32px;height:32px;flex-shrink:0;
  border-radius:8px;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:800;
}}
.feat-text{{
  font-size:15px;font-weight:600;
  color:#1e293b;line-height:1.45;
  direction:rtl;text-align:right;
}}
.cta-btn{{
  display:inline-block;
  background-color:{brand_hex};
  color:{cta_fg};
  font-size:21px;font-weight:800;
  padding:16px 32px;
  border-radius:12px;
  text-align:center;
  box-shadow:0 8px 28px rgba({r},{g},{b},0.48);
  align-self:stretch;
  letter-spacing:0.2px;
}}
/* ── Bottom strip ── */
.bottom-strip{{
  height:70px;flex-shrink:0;
  background-color:{brand_hex};
  display:flex;align-items:center;justify-content:center;
  direction:ltr;
  box-shadow:0 -4px 24px rgba({r},{g},{b},0.35);
}}
.bottom-text{{
  font-size:23px;font-weight:700;
  color:{cta_fg};
  letter-spacing:0.5px;
}}
</style>
</head>
<body>
<div class="banner">
  <div class="banner-main">

    <!-- Left: DALL-E background -->
    <div class="left-panel">
      <div class="left-bg"></div>
      <div class="left-overlay"></div>
    </div>

    <!-- Brand accent divider -->
    <div class="panel-divider" aria-hidden="true"></div>

    <!-- Right: content -->
    <div class="right-panel">
      <div class="logo-row">
        <img src="{logo_url}" alt="לוגו" loading="eager" decoding="sync">
      </div>
      <div class="content">
        <div class="headline">{html.escape(headline_txt)}</div>
        <div class="subhead">{html.escape(subhead_txt)}</div>
        <div class="features" dir="rtl">
{features_html}
        </div>
        <div class="cta-btn">{html.escape(cta_txt)}</div>
      </div>
    </div>

  </div>
  <!-- Bottom brand strip -->
  <div class="bottom-strip">
    <span class="bottom-text">{bottom_text}</span>
  </div>
</div>
</body>
</html>"""

    out.write_text(doc, encoding="utf-8")
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# PNG renderer
# ─────────────────────────────────────────────────────────────────────────────

def render_html_to_png(
    html_path: str | Path,
    output_path: str | Path,
    width: int = BANNER_PX,
    height: int = BANNER_PX,
    font_wait_s: float = 4.0,
) -> Path:
    """
    Render *html_path* to a PNG using headless Chrome (Selenium).

    Raises ``RuntimeError`` on failure. Returns *output_path* as a Path.
    """
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from PIL import Image

    html_path   = Path(html_path).resolve()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument(f"--window-size={width},{height}")
    options.add_argument("--hide-scrollbars")
    options.add_argument("--force-device-scale-factor=1")

    driver = webdriver.Chrome(options=options)
    try:
        driver.get(html_path.as_uri())
        # Allow Google Fonts + images to load
        time.sleep(font_wait_s)
        # Ensure viewport matches exactly
        driver.set_window_size(width, height)
        time.sleep(0.5)
        raw_png = driver.get_screenshot_as_png()
    finally:
        driver.quit()

    # Crop to exact banner dimensions (removes any browser chrome artefacts)
    img = Image.open(io.BytesIO(raw_png))
    img = img.crop((0, 0, width, height))
    img.save(str(output_path), format="PNG")
    return output_path
