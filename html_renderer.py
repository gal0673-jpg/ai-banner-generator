"""
Render marketing banners as HTML (1080×1080) and optionally to PNG (Selenium headless Chrome).

Design 1: split-panel RTL layout. Design 2: full-bleed immersive layout with vignette
(mirrors BannerCanvas2).

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


def _cta_text_color_immersive(brand_hex: str) -> str:
    """Match BannerCanvas2.jsx contrastingTextColor (threshold 0.55)."""
    r, g, b = _hex_to_rgb(brand_hex)
    return "#0f172a" if _luminance(r, g, b) > 0.55 else "#ffffff"


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

def render_design_1_html(
    data: Mapping[str, Any],
    background_path: str | Path,
    logo_path: str | Path,
    output_path: str | Path | None = None,
    site_url: str = "",
) -> str:
    """
    Design 1 — split-panel RTL layout (matches BannerCanvas / legacy banner).

    Write HTML to *output_path* (default: banner_temp.html) and return the full document.

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
  display:flex;flex-direction:row;gap:10px;
  margin-bottom:34px;
  direction:rtl;
  align-items:stretch;
}}
.feat-card{{
  flex:1;min-width:0;min-height:132px;
  background:#ffffff;
  border-radius:14px;
  padding:24px 14px 26px;
  box-shadow:0 2px 8px rgba(0,0,0,0.06),0 8px 24px rgba(0,0,0,0.06);
  border-top:4px solid;
  display:flex;flex-direction:column;gap:12px;align-items:stretch;
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
  color:#1e293b;line-height:1.52;
  direction:rtl;text-align:right;
  flex:1 1 auto;min-height:2.8em;
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


def render_banner_html(
    data: Mapping[str, Any],
    background_path: str | Path,
    logo_path: str | Path,
    output_path: str | Path | None = None,
    site_url: str = "",
) -> str:
    """Backward-compatible alias for :func:`render_design_1_html`."""
    return render_design_1_html(
        data,
        background_path=background_path,
        logo_path=logo_path,
        output_path=output_path,
        site_url=site_url,
    )


# Design 2 layout constants (BannerCanvas2.jsx / BannerCanvas2.css)
_D2_STRIP_H = 64
_D2_ACCENT_W = 6
_D2_CONTENT_PAD = 64
_D2_CONTENT_W = BANNER_PX - _D2_CONTENT_PAD * 2  # 952


def render_design_2_html(
    data: Mapping[str, Any],
    background_path: str | Path,
    logo_path: str | Path,
    output_path: str | Path | None = None,
    site_url: str = "",
) -> str:
    """
    Design 2 — full-bleed background with dark vignette (matches BannerCanvas2).

    Default layer geometry matches DEFAULT_* boxes in BannerCanvas2.jsx.
    """
    headline_txt = str(data["headline"]).strip()
    subhead_txt = str(data["subhead"]).strip()
    cta_txt = str(data["cta"]).strip()
    bullets = data["bullet_points"]
    if not isinstance(bullets, (list, tuple)) or len(bullets) != 3:
        raise ValueError("data['bullet_points'] must be exactly 3 strings")

    brand_hex = _normalize_brand_hex(data.get("brand_color"))
    r, g, b = _hex_to_rgb(brand_hex)
    cta_fg = _cta_text_color_immersive(brand_hex)
    cta_label_color = cta_fg
    domain = _extract_domain(site_url) if site_url else ""

    bg = Path(background_path).resolve()
    logo = Path(logo_path).resolve()
    out = Path(output_path).resolve() if output_path else DEFAULT_OUTPUT
    out.parent.mkdir(parents=True, exist_ok=True)

    bg_url = html.escape(_asset_url(bg, out), quote=True)
    logo_url = html.escape(_asset_url(logo, out), quote=True)

    strip_h = _D2_STRIP_H
    accent_h = BANNER_PX - strip_h
    # DEFAULT_* from BannerCanvas2.jsx (capture root is LTR)
    logo_l = BANNER_PX - _D2_CONTENT_PAD - 210
    logo_t, logo_w, logo_h = 50, 210, 78
    hl_l, hl_t, hl_w, hl_h = _D2_CONTENT_PAD, 210, _D2_CONTENT_W, 230
    sh_l, sh_t, sh_w, sh_h = _D2_CONTENT_PAD, 456, _D2_CONTENT_W, 110
    bu_l, bu_t, bu_w, bu_h = _D2_CONTENT_PAD, 580, _D2_CONTENT_W, 252
    cta_l = _D2_CONTENT_PAD + 80
    cta_t, cta_w, cta_h = 846, _D2_CONTENT_W - 160, 88

    feat_rows: list[str] = []
    for raw in bullets:
        text = html.escape(str(raw).strip())
        feat_rows.append(
            f'      <div class="bc2-feat-pill" style="border-top-color:{brand_hex};">\n'
            f'        <div class="bc2-feat-icon" style="background-color:{brand_hex};color:{cta_fg};">✓</div>\n'
            f'        <span class="bc2-feat-text">{text}</span>\n'
            f'      </div>'
        )
    features_html = "\n".join(feat_rows)

    bottom_inner = html.escape(domain) if domain else ""

    doc = f"""<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="utf-8">
<title>Banner Design 2</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{margin:0;padding:0;box-sizing:border-box;}}
body{{
  width:{BANNER_PX}px;height:{BANNER_PX}px;
  overflow:hidden;
  font-family:'Heebo','Segoe UI','Helvetica Neue',Arial,sans-serif;
  direction:ltr;
  -webkit-font-smoothing:antialiased;
  color-scheme:light;
}}
.bc2-canvas{{
  position:relative;
  width:{BANNER_PX}px;height:{BANNER_PX}px;
  overflow:hidden;
  background:#0f172a;
}}
.bc2-bg{{
  position:absolute;inset:0;
  background-image:url('{bg_url}');
  background-size:cover;background-position:center;background-repeat:no-repeat;
}}
.bc2-vignette{{
  position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse at 70% 40%, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 90%),
    linear-gradient(165deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 100%);
}}
.bc2-glow{{
  position:absolute;pointer-events:none;
  width:500px;height:500px;border-radius:50%;
  top:-150px;right:-100px;
  background:radial-gradient(circle, rgba({r},{g},{b},0.28) 0%, transparent 70%);
}}
.bc2-accent-left{{
  position:absolute;left:0;top:0;pointer-events:none;
  width:{_D2_ACCENT_W}px;height:{accent_h}px;
  background-color:{brand_hex};
}}
.bc2-bottom-strip{{
  position:absolute;left:0;right:0;bottom:0;pointer-events:none;
  height:{strip_h}px;
  background-color:{brand_hex};
  display:flex;align-items:center;justify-content:center;
}}
.bc2-bottom-strip span{{
  color:{cta_label_color};
  font-family:system-ui,Arial,sans-serif;
  font-size:22px;font-weight:700;
  direction:ltr;
  letter-spacing:0.4px;
}}
.bc2-layer{{position:absolute;box-sizing:border-box;}}
.bc2-logo-img{{
  display:block;max-width:100%;max-height:100%;width:auto;height:auto;
  object-fit:contain;object-position:right center;
  filter:drop-shadow(0 2px 16px rgba(0,0,0,0.55)) brightness(1.08);
}}
.bc2-text-shell{{
  box-sizing:border-box;direction:rtl;text-align:right;unicode-bidi:isolate;
  display:block;width:100%;height:100%;
}}
.bc2-headline{{
  font-size:66px;font-weight:900;letter-spacing:-0.025em;line-height:1.12;
  color:#ffffff;text-align:right;direction:rtl;
  word-break:break-word;
  text-shadow:0 2px 24px rgba(0,0,0,0.70),0 0 2px rgba(0,0,0,0.90);
}}
.bc2-subhead{{
  font-size:26px;font-weight:400;line-height:1.55;
  color:rgba(255,255,255,0.88);text-align:right;direction:rtl;
  word-break:break-word;
  text-shadow:0 1px 12px rgba(0,0,0,0.60);
}}
.bc2-feat-grid{{
  display:flex;flex-direction:row;gap:10px;direction:rtl;
  width:100%;height:100%;align-items:stretch;
}}
.bc2-feat-pill{{
  flex:1;min-width:0;min-height:128px;
  background:rgba(10,15,30,0.65);
  border:1px solid rgba(255,255,255,0.18);
  border-top:3px solid;
  border-radius:16px;
  padding:24px 14px 26px;
  display:flex;flex-direction:column;gap:12px;align-items:stretch;
  direction:rtl;
}}
.bc2-feat-icon{{
  width:32px;height:32px;border-radius:8px;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:800;flex-shrink:0;
}}
.bc2-feat-text{{
  font-size:18px;font-weight:500;color:rgba(255,255,255,0.90);
  line-height:1.52;direction:rtl;text-align:right;
  flex:1 1 auto;min-height:2.8em;word-break:break-word;
  display:block;width:100%;
}}
.bc2-cta-wrap{{
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
  box-sizing:border-box;
}}
.bc2-cta{{
  display:inline-flex;align-items:center;justify-content:center;
  text-align:center;direction:rtl;
  font-size:31px;font-weight:800;border-radius:14px;
  padding:0.45em 0.9em;
  background-color:{brand_hex};
  color:{cta_label_color};
  box-shadow:0 12px 40px rgba({r},{g},{b},0.55);
  white-space:nowrap;max-width:100%;
}}
</style>
</head>
<body>
<div class="bc2-canvas">
  <div class="bc2-bg" aria-hidden="true"></div>
  <div class="bc2-vignette" aria-hidden="true"></div>
  <div class="bc2-glow" aria-hidden="true"></div>
  <div class="bc2-accent-left" aria-hidden="true"></div>
  <div class="bc2-bottom-strip" aria-hidden="true">
    <span>{bottom_inner}</span>
  </div>

  <div class="bc2-layer bc2-layer-logo" style="left:{logo_l}px;top:{logo_t}px;width:{logo_w}px;height:{logo_h}px;">
    <img class="bc2-logo-img" src="{logo_url}" alt="" loading="eager" decoding="sync">
  </div>
  <div class="bc2-layer" style="left:{hl_l}px;top:{hl_t}px;width:{hl_w}px;height:{hl_h}px;">
    <div class="bc2-text-shell">
      <div class="bc2-headline">{html.escape(headline_txt)}</div>
    </div>
  </div>
  <div class="bc2-layer" style="left:{sh_l}px;top:{sh_t}px;width:{sh_w}px;height:{sh_h}px;">
    <div class="bc2-text-shell">
      <div class="bc2-subhead">{html.escape(subhead_txt)}</div>
    </div>
  </div>
  <div class="bc2-layer" style="left:{bu_l}px;top:{bu_t}px;width:{bu_w}px;height:{bu_h}px;">
    <div class="bc2-feat-grid">
{features_html}
    </div>
  </div>
  <div class="bc2-layer" style="left:{cta_l}px;top:{cta_t}px;width:{cta_w}px;height:{cta_h}px;">
    <div class="bc2-cta-wrap">
      <span class="bc2-cta">{html.escape(cta_txt)}</span>
    </div>
  </div>
</div>
</body>
</html>"""

    out.write_text(doc, encoding="utf-8")
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# Design 3 layout constants (BannerCanvas3.jsx / BannerCanvas3.css)
# Card sits at x=140 y=140, w=800 h=800, padding=56px (1080×1080 canvas).
# ─────────────────────────────────────────────────────────────────────────────
_D3_CARD_X   = 140
_D3_CARD_Y   = 140
_D3_CARD_W   = 800
_D3_CARD_H   = 800
_D3_PAD      = 56
_D3_CONTENT_X = _D3_CARD_X + _D3_PAD          # 196
_D3_CONTENT_W = _D3_CARD_W - _D3_PAD * 2      # 688
_D3_CARD_RADIUS = 28


def render_design_3_html(
    data: Mapping[str, Any],
    background_path: str | Path,   # unused — kept for API parity with D1/D2
    logo_path: str | Path,
    output_path: str | Path | None = None,
    site_url: str = "",
) -> str:
    """
    Design 3 — Minimalist Card (matches BannerCanvas3).

    Solid brand-colour background; all copy rendered inside a centred white
    floating card.  ``background_path`` is accepted but not rendered — it is
    kept so callers can use a uniform three-asset signature across all designs.

    Default layer geometry mirrors DESIGN3_SQUARE_BOXES in BannerCanvas3.jsx:
      logo     x=660 y=168  w=220 h=72
      headline x=196 y=260  w=688 h=220
      subhead  x=196 y=492  w=688 h=108
      bullets  x=196 y=614  w=688 h=220
      cta      x=276 y=844  w=528 h=88
    """
    headline_txt = str(data["headline"]).strip()
    subhead_txt  = str(data["subhead"]).strip()
    cta_txt      = str(data["cta"]).strip()
    bullets      = data["bullet_points"]
    if not isinstance(bullets, (list, tuple)) or len(bullets) != 3:
        raise ValueError("data['bullet_points'] must be exactly 3 strings")

    brand_hex = _normalize_brand_hex(data.get("brand_color"))
    r, g, b   = _hex_to_rgb(brand_hex)
    cta_fg    = _cta_text_color(brand_hex)
    # domain is shown at bottom-right of the card as a small attribution
    domain    = _extract_domain(site_url) if site_url else ""

    logo = Path(logo_path).resolve()
    out  = Path(output_path).resolve() if output_path else DEFAULT_OUTPUT
    out.parent.mkdir(parents=True, exist_ok=True)

    logo_url = html.escape(_asset_url(logo, out), quote=True)

    # Layer geometry (absolute coords in 1080×1080 canvas)
    logo_l, logo_t, logo_w, logo_h = 660, 168, 220, 72
    hl_l, hl_t, hl_w, hl_h         = 196, 260, 688, 220
    sh_l, sh_t, sh_w, sh_h         = 196, 492, 688, 108
    bu_l, bu_t, bu_w, bu_h         = 196, 614, 688, 220
    cta_l, cta_t, cta_w, cta_h     = 276, 844, 528, 88

    # Card outer geometry
    cx, cy, cw, ch = _D3_CARD_X, _D3_CARD_Y, _D3_CARD_W, _D3_CARD_H

    # Feature rows — simple horizontal row: icon + text
    feat_rows: list[str] = []
    for raw in bullets:
        text = html.escape(str(raw).strip())
        feat_rows.append(
            f'      <div class="d3-feat-row">\n'
            f'        <div class="d3-feat-icon" style="background-color:{brand_hex};color:{cta_fg};">✓</div>\n'
            f'        <span class="d3-feat-text">{text}</span>\n'
            f'      </div>'
        )
    features_html = "\n".join(feat_rows)

    doc = f"""<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="utf-8">
<title>Banner Design 3</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{margin:0;padding:0;box-sizing:border-box;}}
body{{
  width:{BANNER_PX}px;height:{BANNER_PX}px;
  overflow:hidden;
  font-family:'Heebo','Segoe UI','Helvetica Neue',Arial,sans-serif;
  direction:ltr;
  -webkit-font-smoothing:antialiased;
  color-scheme:light;
}}
/* ── Brand-colour background with depth gradient ── */
.d3-canvas{{
  position:relative;
  width:{BANNER_PX}px;height:{BANNER_PX}px;
  overflow:hidden;
  background-color:{brand_hex};
}}
.d3-bg-depth{{
  position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse 70% 60% at 18% 18%, rgba(255,255,255,0.18) 0%, transparent 55%),
    radial-gradient(ellipse 60% 50% at 82% 82%, rgba(0,0,0,0.14) 0%, transparent 52%);
}}
/* ── White floating card ── */
.d3-card{{
  position:absolute;
  left:{cx}px;top:{cy}px;
  width:{cw}px;height:{ch}px;
  border-radius:{_D3_CARD_RADIUS}px;
  background-color:#ffffff;
  box-shadow:0 32px 80px rgba(0,0,0,0.22),0 8px 24px rgba(0,0,0,0.14);
}}
/* ── Absolute layers (same coordinate space as canvas) ── */
.d3-layer{{position:absolute;box-sizing:border-box;}}
/* ── Logo ── */
.d3-logo-img{{
  display:block;max-width:100%;max-height:100%;
  width:auto;height:auto;
  object-fit:contain;object-position:right center;
}}
/* ── Text shells ── */
.d3-text-shell{{
  box-sizing:border-box;direction:rtl;text-align:right;
  unicode-bidi:isolate;display:block;width:100%;height:100%;
}}
.d3-headline{{
  font-size:52px;font-weight:900;letter-spacing:-0.02em;line-height:1.12;
  color:#0f172a;text-align:right;direction:rtl;
  word-break:break-word;
}}
.d3-subhead{{
  font-size:22px;font-weight:400;line-height:1.55;
  color:#475569;text-align:right;direction:rtl;
  word-break:break-word;
}}
/* ── Feature list (vertical simple rows) ── */
.d3-feat-list{{
  display:flex;flex-direction:column;gap:14px;
  direction:rtl;width:100%;height:100%;
  align-items:stretch;
}}
.d3-feat-row{{
  display:flex;flex-direction:row;align-items:center;gap:14px;
  background:#f8fafc;
  border:1.5px solid #e2e8f0;
  border-radius:12px;
  padding:12px 18px;
  direction:rtl;
}}
.d3-feat-icon{{
  width:28px;height:28px;flex-shrink:0;
  border-radius:8px;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:800;
}}
.d3-feat-text{{
  font-size:16px;font-weight:500;
  color:#1e293b;line-height:1.52;
  direction:rtl;text-align:right;
  flex:1 1 auto;
}}
/* ── CTA ── */
.d3-cta-wrap{{
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
}}
.d3-cta{{
  display:inline-flex;align-items:center;justify-content:center;
  text-align:center;direction:rtl;
  font-size:26px;font-weight:800;border-radius:14px;
  padding:0.45em 0.9em;
  background-color:{brand_hex};color:{cta_fg};
  box-shadow:0 10px 32px rgba({r},{g},{b},0.48);
  white-space:nowrap;max-width:100%;
}}
</style>
</head>
<body>
<div class="d3-canvas">
  <div class="d3-bg-depth" aria-hidden="true"></div>
  <div class="d3-card" aria-hidden="true"></div>

  <!-- Logo — top-right of card -->
  <div class="d3-layer" style="left:{logo_l}px;top:{logo_t}px;width:{logo_w}px;height:{logo_h}px;">
    <img class="d3-logo-img" src="{logo_url}" alt="" loading="eager" decoding="sync">
  </div>

  <!-- Headline -->
  <div class="d3-layer" style="left:{hl_l}px;top:{hl_t}px;width:{hl_w}px;height:{hl_h}px;">
    <div class="d3-text-shell">
      <div class="d3-headline">{html.escape(headline_txt)}</div>
    </div>
  </div>

  <!-- Subhead -->
  <div class="d3-layer" style="left:{sh_l}px;top:{sh_t}px;width:{sh_w}px;height:{sh_h}px;">
    <div class="d3-text-shell">
      <div class="d3-subhead">{html.escape(subhead_txt)}</div>
    </div>
  </div>

  <!-- Feature list -->
  <div class="d3-layer" style="left:{bu_l}px;top:{bu_t}px;width:{bu_w}px;height:{bu_h}px;">
    <div class="d3-feat-list">
{features_html}
    </div>
  </div>

  <!-- CTA button -->
  <div class="d3-layer" style="left:{cta_l}px;top:{cta_t}px;width:{cta_w}px;height:{cta_h}px;">
    <div class="d3-cta-wrap">
      <span class="d3-cta">{html.escape(cta_txt)}</span>
    </div>
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
