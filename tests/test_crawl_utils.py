"""Tests for the pure crawler helpers extracted from crawler_service."""

from __future__ import annotations

import pytest

from services.crawl_utils import (
    format_page_block,
    is_content_sparse,
    link_contains_junk,
    normalize_url,
    same_site,
    strip_fragment,
)


@pytest.mark.parametrize("raw, expected", [
    ("example.com", "https://example.com"),
    ("http://example.com", "http://example.com"),
    ("https://example.com/x", "https://example.com/x"),
    ("  example.co.il  ", "https://example.co.il"),
    ("///example.com", "https://example.com"),  # leading slashes stripped
    ("", ""),
])
def test_normalize_url(raw, expected):
    assert normalize_url(raw) == expected


def test_strip_fragment_removes_hash_and_keeps_query():
    assert strip_fragment("https://x.com/a?b=1#frag") == "https://x.com/a?b=1"
    # Empty path normalizes to '/'.
    assert strip_fragment("https://x.com#top") == "https://x.com/"


@pytest.mark.parametrize("url, base, expected", [
    ("https://x.com/a", "x.com", True),
    ("https://X.CoM/a", "x.com", True),          # case-insensitive host
    ("https://other.com/a", "x.com", False),
    ("mailto:a@x.com", "x.com", False),          # non-http scheme
    ("ftp://x.com/a", "x.com", False),
])
def test_same_site(url, base, expected):
    assert same_site(url, base) is expected


def test_link_contains_junk_english_case_insensitive():
    assert link_contains_junk("https://x.com/Privacy-Policy", "")
    assert link_contains_junk("https://x.com/x", "Terms of Service")
    assert not link_contains_junk("https://x.com/products", "מוצרים שלנו")


def test_link_contains_junk_hebrew_substring():
    assert link_contains_junk("https://x.com/page", "מדיניות פרטיות")
    assert link_contains_junk("https://x.com/%D7%A0%D7%92%D7%99%D7%A9%D7%95%D7%AA", "")  # encoded 'נגישות'


def test_format_page_block_with_and_without_paragraphs():
    block = format_page_block("https://x.com", "כותרת", ["פסקה אחת", "פסקה שתיים"])
    assert "URL: https://x.com" in block
    assert "Title: כותרת" in block
    assert "פסקה אחת" in block

    empty = format_page_block("https://x.com", "T", [])
    assert "(no <p> tags with text found)" in empty


def test_is_content_sparse():
    # Rich page: 4 long paragraphs, plenty of chars → not sparse.
    rich = ["x" * 80 for _ in range(4)]
    assert is_content_sparse(rich) is False
    # Thin SPA shell → sparse.
    assert is_content_sparse(["short"]) is True
    assert is_content_sparse([]) is True
