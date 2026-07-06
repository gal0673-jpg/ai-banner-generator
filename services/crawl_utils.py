"""Pure URL / text helpers for the crawler — no Selenium, no Chrome, no I/O.

Extracted from ``crawler_service`` (a 1300-line module mixing transport, Chrome
lifecycle, parsing, and these string utilities) so the deterministic logic is
unit-testable on its own. ``crawler_service`` re-imports every name below, so
existing callers (``crawler_service.normalize_url`` etc.) are unchanged.
"""

from __future__ import annotations

from urllib.parse import unquote, urlparse, urlunparse

SEPARATOR = "=" * 80

# Content-sparseness thresholds — the signal that a page is a JS-rendered SPA
# shell rather than a static/SSR page with real ``<p>`` text.
SPA_MIN_TOTAL_CHARS = 300
SPA_MIN_MEANINGFUL_PARAS = 3

# Links whose URL or anchor text contains any of these are skipped during crawl
# (legal/utility pages carry no brand-story signal). English matches are
# case-insensitive; Hebrew entries match as substrings.
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


def normalize_url(url: str) -> str:
    """Add https:// when no scheme is given."""
    url = url.strip()
    while url.startswith("/"):
        url = url[1:]
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


def is_content_sparse(paragraphs: list[str]) -> bool:
    """
    Return True when ``<p>`` text volume is too thin for a properly rendered static page —
    the canonical signal that we are looking at a JS-rendered SPA shell.

    Both thresholds must be satisfied to avoid false positives on legitimate short pages.
    """
    total_chars = sum(len(p) for p in paragraphs)
    meaningful = sum(1 for p in paragraphs if len(p) > 20)
    return total_chars < SPA_MIN_TOTAL_CHARS or meaningful < SPA_MIN_MEANINGFUL_PARAS
