"""
Composite headline and CTA onto background.png using banner_data.json.
Requires: pip install pillow arabic-reshaper python-bidi
"""

import json
import sys
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
BACKGROUND_PATH = BASE / "background.png"
BANNER_JSON_PATH = BASE / "banner_data.json"
OUTPUT_PATH = BASE / "final_banner.png"
ARIAL_PATH = Path(r"C:\Windows\Fonts\arial.ttf")

HEADLINE_SIZE = 56
CTA_SIZE = 38
MARGIN = 48
HEADLINE_FILL = (255, 255, 255)
CTA_FILL = (255, 236, 60)
STROKE_FILL = (0, 0, 0)
STROKE_WIDTH = 3
SHADOW_OFFSET = (3, 3)
SHADOW_ALPHA = 180


def prepare_hebrew(text: str) -> str:
    reshaped = arabic_reshaper.reshape(text)
    return get_display(reshaped)


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if ARIAL_PATH.is_file():
        return ImageFont.truetype(str(ARIAL_PATH), size=size)
    return ImageFont.load_default()


def main() -> None:
    if not BACKGROUND_PATH.is_file():
        print(f"Error: {BACKGROUND_PATH} not found.", file=sys.stderr)
        sys.exit(1)
    if not BANNER_JSON_PATH.is_file():
        print(f"Error: {BANNER_JSON_PATH} not found.", file=sys.stderr)
        sys.exit(1)

    with BANNER_JSON_PATH.open(encoding="utf-8") as f:
        data = json.load(f)

    try:
        headline_raw = data["headline"]
        cta_raw = data["cta"]
    except KeyError as e:
        print(f"Error: banner JSON missing key {e.args[0]!r}.", file=sys.stderr)
        sys.exit(1)

    headline = prepare_hebrew(str(headline_raw))
    cta = prepare_hebrew(str(cta_raw))

    image = Image.open(BACKGROUND_PATH).convert("RGBA")
    width, height = image.size

    headline_font = load_font(HEADLINE_SIZE)
    cta_font = load_font(CTA_SIZE)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Headline: top center (with stroke + soft shadow for contrast)
    hb = draw.textbbox(
        (0, 0), headline, font=headline_font, stroke_width=STROKE_WIDTH
    )
    hw = hb[2] - hb[0]
    hh = hb[3] - hb[1]
    hx = (width - hw) // 2 - hb[0]
    hy = MARGIN - hb[1]

    sx, sy = SHADOW_OFFSET
    shadow_color = (*STROKE_FILL, SHADOW_ALPHA)
    draw.text((hx + sx, hy + sy), headline, font=headline_font, fill=shadow_color)
    draw.text(
        (hx, hy),
        headline,
        font=headline_font,
        fill=HEADLINE_FILL,
        stroke_width=STROKE_WIDTH,
        stroke_fill=STROKE_FILL,
    )

    # CTA: bottom right
    cta_stroke = max(2, STROKE_WIDTH - 1)
    cb = draw.textbbox((0, 0), cta, font=cta_font, stroke_width=cta_stroke)
    cw = cb[2] - cb[0]
    ch = cb[3] - cb[1]
    cx = width - MARGIN - cw - cb[0]
    cy = height - MARGIN - ch - cb[1]

    draw.text((cx + sx, cy + sy), cta, font=cta_font, fill=shadow_color)
    draw.text(
        (cx, cy),
        cta,
        font=cta_font,
        fill=CTA_FILL,
        stroke_width=cta_stroke,
        stroke_fill=STROKE_FILL,
    )

    composed = Image.alpha_composite(image, overlay).convert("RGB")
    composed.save(OUTPUT_PATH, format="PNG")
    print(f"Success: wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
