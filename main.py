"""
Crawl up to 10 unique internal pages; save title and <p> text to scraped_content.txt.
Skips legal/accessibility junk links; downloads homepage logo to logo.png.
Uses Selenium (headless Chrome) for JS-rendered sites (WordPress, Shopify, SPAs, custom stacks).
Requires: pip install selenium requests pillow openai
Chrome must be installed; Selenium Manager resolves ChromeDriver automatically.
After crawl, if OPENAI_API_KEY is set and logo.png exists, runs creative_agent: OpenAI JSON,
DALL-E background.png, and creative_campaign.json (no HTML/screenshot step).
"""
from __future__ import annotations

import io
import json
import os
import random
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse, urlunparse

import requests
from PIL import Image, UnidentifiedImageError
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

BASE_DIR = Path(__file__).resolve().parent
MAX_PAGES = 10
OUTPUT_FILE = BASE_DIR / "scraped_content.txt"
LOGO_FILE = BASE_DIR / "logo.png"
SEPARATOR = "=" * 80
RENDER_WAIT_SECONDS = 10

# Case-insensitive for ASCII; Hebrew phrases matched as literal substrings.
JUNK_KEYWORDS = (
    "privacy",
    "terms",
    "policy",
    "accessibility",
    "cookie",
    "תקנון",
    "פרטיות",
    "נגישות",
    "תנאי שימוש",
)

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}


def normalize_url(url: str) -> str:
    """Add https:// when no scheme is given."""
    url = url.strip()
    if not url:
        return url
    parsed = urlparse(url)
    if not parsed.scheme:
        return "https://" + url
    return url


def strip_fragment(url: str) -> str:
    """Remove #fragment for stable deduplication."""
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path or "/", p.params, p.query, ""))


def same_site(url: str, base_netloc: str) -> bool:
    """True if url is http(s) and host matches the crawl root (internal link)."""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        return False
    return p.netloc.lower() == base_netloc.lower()


def link_contains_junk(url: str, anchor_text: str) -> bool:
    """
    True if URL (decoded) or visible anchor/label text should be excluded from crawl.
    English keywords: case-insensitive. Hebrew: substring match on decoded URL and anchor.
    """
    decoded_url = unquote(url)
    haystacks = (
        decoded_url.lower(),
        anchor_text.lower(),
        decoded_url,
        anchor_text,
    )
    for kw in JUNK_KEYWORDS:
        if not kw:
            continue
        ascii_kw = kw.isascii()
        for h in haystacks:
            if ascii_kw:
                if kw in h.lower():
                    return True
            else:
                if kw in h:
                    return True
    return False


def format_page_block(page_url: str, title: str, paragraphs: list[str]) -> str:
    """One nicely separated section for the output file."""
    lines = [
        SEPARATOR,
        f"URL: {page_url}",
        SEPARATOR,
        f"Title: {title}",
        "",
        "Paragraphs (<p>):",
    ]
    if paragraphs:
        lines.append("")
        lines.append("\n\n".join(paragraphs))
    else:
        lines.append("(no <p> tags with text found)")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


def build_headless_chrome() -> webdriver.Chrome:
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
    return webdriver.Chrome(options=options)


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

    # ── High-quality PNGs (Design 1 + Design 2 HTML → PNG) ─────────────────────
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


def extract_title_and_paragraphs(driver: webdriver.Chrome) -> tuple[str, list[str]]:
    """Return document title and non-empty stripped text from all <p> elements in the live DOM."""
    title_text = (driver.title or "").strip()
    if not title_text:
        title_text = "(no title found)"

    paras = driver.find_elements(By.TAG_NAME, "p")
    texts: list[str] = []
    for p in paras:
        t = (p.text or "").strip()
        if t:
            texts.append(t)
    return title_text, texts


def _anchor_label(el) -> str:
    parts = [
        (el.text or "").strip(),
        (el.get_attribute("aria-label") or "").strip(),
        (el.get_attribute("title") or "").strip(),
    ]
    return " ".join(p for p in parts if p)


def discover_internal_links(driver: webdriver.Chrome, base_host: str) -> list[str]:
    """Same-site http(s) hrefs only; skip junk URLs and junk anchor text (blocklist)."""
    current = driver.current_url
    found: list[str] = []
    for el in driver.find_elements(By.CSS_SELECTOR, "a[href]"):
        href = el.get_attribute("href")
        if not href:
            continue
        absolute = strip_fragment(urljoin(current, href))
        if not same_site(absolute, base_host):
            continue
        label = _anchor_label(el)
        if link_contains_junk(absolute, label):
            continue
        found.append(absolute)
    return found


def _resolve_img_url(driver: webdriver.Chrome, img) -> str | None:
    """Best-effort absolute image URL from src, lazy attrs, or srcset."""
    base = driver.current_url
    src = (img.get_attribute("src") or "").strip()
    if src.startswith("data:"):
        src = ""
    if not src:
        for attr in ("data-src", "data-lazy-src", "data-original", "data-srcset"):
            v = (img.get_attribute(attr) or "").strip()
            if v and not v.startswith("data:"):
                src = v
                break
    if not src:
        srcset = (img.get_attribute("srcset") or "").strip()
        if srcset:
            first = srcset.split(",")[0].strip()
            src = first.split()[0] if first else ""
    if not src or src.startswith("data:"):
        return None
    return urljoin(base, src)


def _img_element_priority(img) -> int:
    """Higher = stronger logo candidate."""
    score = 0
    try:
        if img.find_elements(By.XPATH, "./ancestor::header"):
            score += 100
        if img.find_elements(By.XPATH, "./ancestor::nav"):
            score += 90
    except WebDriverException:
        pass

    cls = (img.get_attribute("class") or "").lower()
    eid = (img.get_attribute("id") or "").lower()
    alt = (img.get_attribute("alt") or "").lower()
    src = (img.get_attribute("src") or "").lower()
    blob = f"{cls} {eid} {alt} {src}"
    if "custom-logo" in cls or "site-logo" in cls:
        score += 85
    if "logo" in blob:
        score += 50

    try:
        w = img.size.get("width", 0)
        h = img.size.get("height", 0)
        if w >= 80 and h >= 24:
            score += 20
        elif w < 16 or h < 16:
            score -= 50
    except WebDriverException:
        pass

    return score


def extract_and_save_homepage_logo(driver: webdriver.Chrome, logo_file: Path) -> bool:
    """
    Heuristic logo detection (header/nav, logo in attributes, custom-logo / site-logo).
    Download with requests; save as RGBA PNG for correct transparency.
    """
    imgs: list = []
    seen_ids: set[str] = set()

    xpaths = [
        "//header//img",
        "//nav//img",
        "//*[contains(translate(@class,'LOGO','logo'),'logo')]//img",
        "//img[contains(translate(@class,'LOGO','logo'),'logo')]",
        "//*[contains(@class,'custom-logo')]//img",
        "//img[contains(@class,'custom-logo')]",
        "//*[contains(@class,'site-logo')]//img",
        "//img[contains(@class,'site-logo')]",
    ]
    for xp in xpaths:
        try:
            for img in driver.find_elements(By.XPATH, xp):
                eid = img.id
                if eid in seen_ids:
                    continue
                seen_ids.add(eid)
                imgs.append(img)
        except WebDriverException:
            continue

    for img in driver.find_elements(By.TAG_NAME, "img"):
        eid = img.id
        if eid in seen_ids:
            continue
        attrs = " ".join(
            filter(
                None,
                [
                    img.get_attribute("class"),
                    img.get_attribute("id"),
                    img.get_attribute("src"),
                    img.get_attribute("alt"),
                ],
            )
        ).lower()
        if "logo" in attrs:
            seen_ids.add(eid)
            imgs.append(img)

    scored: list[tuple[int, object]] = [(_img_element_priority(im), im) for im in imgs]
    scored.sort(key=lambda x: -x[0])

    tried_urls: set[str] = set()
    for _pri, img in scored:
        url = _resolve_img_url(driver, img)
        if not url:
            continue
        if urlparse(url).scheme not in ("http", "https"):
            continue
        if url in tried_urls:
            continue
        tried_urls.add(url)
        try:
            r = requests.get(url, timeout=45, headers=REQUEST_HEADERS)
            r.raise_for_status()
            if len(r.content) < 80:
                continue
            try:
                im = Image.open(io.BytesIO(r.content))
                im = im.convert("RGBA")
                im.save(logo_file, format="PNG", optimize=True)
                print(f"Saved homepage logo to {logo_file}")
                return True
            except (UnidentifiedImageError, OSError, ValueError):
                continue
        except requests.RequestException:
            continue

    print("Warning: could not detect or download a homepage logo (logo.png not written).")
    return False


def crawl_from_url(
    raw_url: str,
    *,
    work_dir: Path | None = None,
    campaign_brief: str | None = None,
) -> None:
    """
    Crawl up to MAX_PAGES internal pages; write scraped_content.txt and best-effort logo.png.
    If ``work_dir`` is set, files are written there (isolated API jobs); otherwise BASE_DIR.
    If ``campaign_brief`` is non-empty, it is appended to scraped_content.txt for the creative step.
    """
    output_file = work_dir / "scraped_content.txt" if work_dir else OUTPUT_FILE
    logo_file = work_dir / "logo.png" if work_dir else LOGO_FILE
    if work_dir is not None:
        work_dir.mkdir(parents=True, exist_ok=True)

    start_url = strip_fragment(normalize_url(raw_url))
    base_host = urlparse(start_url).netloc.lower()
    if not base_host:
        raise ValueError("That URL is not valid.")

    queue: deque[str] = deque([start_url])
    visited: set[str] = set()
    pages_fetched = 0
    file_chunks: list[str] = []
    logo_saved = False

    print("Starting headless Chrome (Selenium Manager)...")
    driver = build_headless_chrome()
    try:
        while queue and pages_fetched < MAX_PAGES:
            url = queue.popleft()
            if url in visited:
                continue
            visited.add(url)

            if pages_fetched > 0:
                time.sleep(random.uniform(1, 3))

            try:
                driver.get(url)
            except WebDriverException as e:
                print(f"Skip (navigation failed): {url} — {e}")
                continue

            time.sleep(RENDER_WAIT_SECONDS)

            final_url = strip_fragment(driver.current_url)

            try:
                title_text, paragraph_texts = extract_title_and_paragraphs(driver)
            except WebDriverException as e:
                print(f"Skip (extract failed): {final_url} — {e}")
                continue

            file_chunks.append(format_page_block(final_url, title_text, paragraph_texts))
            pages_fetched += 1
            print(f"Scraped ({pages_fetched}/{MAX_PAGES}): {final_url}")

            if not logo_saved:
                logo_saved = extract_and_save_homepage_logo(driver, logo_file)

            try:
                for absolute in discover_internal_links(driver, base_host):
                    if absolute not in visited:
                        queue.append(absolute)
            except WebDriverException as e:
                print(f"Warning: link discovery failed on {final_url} — {e}")
    finally:
        driver.quit()

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(f"Crawl summary: {pages_fetched} page(s), starting from {start_url}\n\n")
        f.write("".join(file_chunks))
        if campaign_brief and str(campaign_brief).strip():
            f.write("\n\n")
            f.write(SEPARATOR + "\n")
            f.write(
                "USER CAMPAIGN BRIEF (goals / target audience — provided by the user)\n"
            )
            f.write(SEPARATOR + "\n\n")
            f.write(str(campaign_brief).strip() + "\n")

    print(f"Done. Content saved to {output_file} ({pages_fetched} page(s)).")


def main() -> None:
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
