"""Tests for services.upload_validation.validate_upload_content."""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from services.upload_validation import validate_upload_content


# ── helpers ──────────────────────────────────────────────────────────────────


def _png_bytes(size: tuple[int, int] = (1, 1)) -> bytes:
    buf = BytesIO()
    Image.new("RGBA", size, (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (2, 2), (255, 255, 255)).save(buf, format="JPEG")
    return buf.getvalue()


def _gif_bytes() -> bytes:
    return (
        b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00"
        b",\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    )


def _mp4_bytes() -> bytes:
    # ISO-BMFF: 4-byte size, 'ftyp' tag, brand, padding
    return b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + b"\x00" * 16


# ── tests ────────────────────────────────────────────────────────────────────


def test_png_bytes_are_accepted_as_png():
    assert validate_upload_content(_png_bytes(), ".png") == ".png"


def test_jpeg_bytes_are_accepted_as_jpg_or_jpeg():
    assert validate_upload_content(_jpeg_bytes(), ".jpg") == ".jpg"
    assert validate_upload_content(_jpeg_bytes(), ".jpeg") == ".jpeg"


def test_gif_bytes_are_accepted_as_gif():
    assert validate_upload_content(_gif_bytes(), ".gif") == ".gif"


def test_html_disguised_as_png_is_rejected():
    """The point of the magic-byte check: ``evil.html`` renamed to ``evil.png``
    must not be stored as a PNG."""
    html = b"<!doctype html><html>...</html>"
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(html, ".png")
    assert exc.value.status_code == 415


def test_png_bytes_labeled_as_gif_are_rejected_for_format_mismatch():
    """An attacker who flips the suffix shouldn't be able to bypass downstream
    consumers that branch on extension."""
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(_png_bytes(), ".gif")
    assert exc.value.status_code == 415


def test_clean_svg_is_accepted():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>'
    assert validate_upload_content(svg, ".svg") == ".svg"


def test_svg_with_script_tag_is_rejected():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(svg, ".svg")
    assert exc.value.status_code == 415


def test_svg_with_event_handler_is_rejected():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(svg, ".svg")
    assert exc.value.status_code == 415


def test_svg_with_javascript_uri_is_rejected():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>'
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(svg, ".svg")
    assert exc.value.status_code == 415


def test_mp4_with_ftyp_box_is_accepted():
    assert validate_upload_content(_mp4_bytes(), ".mp4") == ".mp4"


def test_non_video_bytes_labeled_as_mp4_are_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(b"<!doctype html>" + b"\x00" * 16, ".mp4")
    assert exc.value.status_code == 415


def test_unsupported_suffix_is_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(b"MZ" + b"\x00" * 100, ".exe")
    assert exc.value.status_code == 415


def test_missing_suffix_is_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(_png_bytes(), "")
    assert exc.value.status_code == 415


def test_empty_body_is_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_upload_content(b"", ".png")
    assert exc.value.status_code == 400
