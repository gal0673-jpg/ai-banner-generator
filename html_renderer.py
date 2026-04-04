"""
Render a responsive RTL split-screen banner as HTML (Tailwind CDN, Heebo, Font Awesome).
"""

from __future__ import annotations

import html
from pathlib import Path
from typing import Any, Mapping

DEFAULT_OUTPUT = Path(__file__).resolve().parent / "banner_temp.html"

# Font Awesome icon classes for the three bullets (placeholders)
_BULLET_ICONS = (
    "fa-solid fa-star",
    "fa-solid fa-bolt",
    "fa-solid fa-shield-halved",
)


def _asset_url(asset: Path, html_path: Path) -> str:
    """Path usable in HTML (relative to html file, or file URI if needed)."""
    import os

    asset = asset.resolve()
    html_dir = html_path.parent.resolve()
    try:
        rel = Path(os.path.relpath(asset, html_dir))
    except ValueError:
        return asset.as_uri()
    return rel.as_posix()


def render_banner_html(
    data: Mapping[str, Any],
    background_path: str | Path,
    logo_path: str | Path,
    output_path: str | Path | None = None,
) -> str:
    """
    Build responsive split-screen banner HTML and save to ``banner_temp.html`` by default.

    ``data`` must include: headline, subhead, bullet_points (3 strings), cta.
    Left column: full-bleed background image. Right column (RTL): logo, copy, bullets, CTA.
    """
    headline = html.escape(str(data["headline"]).strip())
    subhead = html.escape(str(data["subhead"]).strip())
    cta = html.escape(str(data["cta"]).strip())
    bullets = data["bullet_points"]
    if not isinstance(bullets, (list, tuple)) or len(bullets) != 3:
        raise ValueError("data['bullet_points'] must be a sequence of exactly 3 strings")

    bg = Path(background_path)
    logo = Path(logo_path)
    out = Path(output_path) if output_path else DEFAULT_OUTPUT
    out.parent.mkdir(parents=True, exist_ok=True)

    bg_url = html.escape(_asset_url(bg, out), quote=True)
    logo_url = html.escape(_asset_url(logo, out), quote=True)

    bullet_rows: list[str] = []
    for i, raw in enumerate(bullets):
        text = html.escape(str(raw).strip())
        icon = _BULLET_ICONS[i]
        bullet_rows.append(
            f"""<li class="flex min-w-0 flex-1 flex-col items-center gap-3 text-center">
      <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 shadow-sm" aria-hidden="true">
        <i class="{icon} text-2xl"></i>
      </span>
      <span class="text-sm font-medium leading-snug text-slate-700 md:text-base">{text}</span>
    </li>"""
        )
    bullets_html = "\n    ".join(bullet_rows)

    doc = f"""<!DOCTYPE html>
<html lang="he" dir="rtl" class="h-full antialiased">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Banner</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
  <script>
    tailwind.config = {{
      theme: {{
        extend: {{
          fontFamily: {{ sans: ["Heebo", "ui-sans-serif", "system-ui", "sans-serif"] }}
        }}
      }}
    }};
  </script>
</head>
<body class="h-full min-h-screen bg-slate-50 font-sans text-slate-800">
  <!-- RTL flex row: first column (content) is on the right; second (image) on the left -->
  <div class="flex min-h-screen flex-col-reverse md:flex-row md:min-h-screen">
    <div
      class="flex w-full flex-1 flex-col bg-slate-50 px-6 py-10 md:w-1/2 md:flex-none md:min-h-screen md:px-12 md:py-14 lg:px-16"
    >
      <div class="flex justify-center md:justify-end">
        <img
          src="{logo_url}"
          alt="לוגו"
          class="h-14 w-auto max-w-[220px] object-contain md:h-[4.5rem]"
          width="220"
          height="72"
          style="mix-blend-mode: multiply;"
        />
      </div>
      <header class="mt-8 space-y-4 text-center md:mt-10 md:text-right">
        <h1 class="text-3xl font-extrabold leading-tight tracking-tight text-slate-800 md:text-4xl lg:text-[2.25rem]">
          {headline}
        </h1>
        <p class="text-lg font-normal text-slate-600 md:text-xl">
          {subhead}
        </p>
      </header>
      <div class="mt-auto flex w-full flex-col gap-6 pt-10 md:pt-14">
        <ul class="mx-0 flex w-full list-none flex-row flex-wrap items-start justify-between gap-4 p-0 md:mx-0 md:flex-nowrap md:gap-6" role="list">
    {bullets_html}
        </ul>
        <div class="w-full">
          <a
            href="#"
            class="flex w-full items-center justify-center rounded-2xl bg-amber-500 px-8 py-4 text-lg font-bold text-white shadow-md shadow-amber-500/25 transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-50"
          >
            {cta}
          </a>
        </div>
      </div>
    </div>
    <div
      class="relative min-h-[42vh] w-full bg-slate-800 bg-cover bg-center md:min-h-0 md:w-1/2"
      style="background-image: url('{bg_url}');"
      role="img"
      aria-label="רקע"
    ></div>
  </div>
</body>
</html>
"""
    out.write_text(doc, encoding="utf-8")
    return doc
