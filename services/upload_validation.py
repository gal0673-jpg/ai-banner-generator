"""Validate uploaded asset bytes against the claimed suffix.

The HTTP layer (routers/banners.py /upload-temp-asset) only trusts the file
extension — that's not enough on its own because anyone can rename
``evil.html`` to ``evil.png`` and have the API store it under a path that's
served by ``/task-files/...``. A browser fetching that path may sniff the
content type and execute scripts.

We do three layers of validation here, all cheap:

1. **Image suffixes** (``.png .jpg .jpeg .webp .gif .avif``): open with PIL.
   If PIL refuses, reject. Also verify the detected format matches the suffix
   (so ``evil.png`` containing actual GIF bytes is rejected).

2. **SVG**: parse as text. Reject if it contains ``<script`` or any inline
   ``on…="…"`` event handler. SVG is technically allowed but a known XSS
   vector; this is the minimum safety net.

3. **Video suffixes** (``.mp4 .webm .mov``): check magic bytes.
   - ``mp4``/``mov``: ISO-BMFF ``ftyp`` box at offset 4
   - ``webm``: EBML header ``1A 45 DF A3``

Returns the validated suffix (always ``.lower()``). Raises HTTPException(415)
when the content does not match its claimed type.
"""

from __future__ import annotations

import io
import logging
import re
from typing import Final

from fastapi import HTTPException

logger = logging.getLogger(__name__)


_IMAGE_SUFFIXES: Final[frozenset[str]] = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
)
_VIDEO_SUFFIXES: Final[frozenset[str]] = frozenset({".mp4", ".webm", ".mov"})
_SVG_SUFFIX: Final[str] = ".svg"


# PIL ``Image.format`` values keyed by acceptable extension.
_PIL_FORMAT_BY_SUFFIX: Final[dict[str, frozenset[str]]] = {
    ".png": frozenset({"PNG"}),
    ".jpg": frozenset({"JPEG"}),
    ".jpeg": frozenset({"JPEG"}),
    ".webp": frozenset({"WEBP"}),
    ".gif": frozenset({"GIF"}),
    ".avif": frozenset({"AVIF", "HEIF"}),  # PIL may report either
}


# Inline event handlers like onclick="..." / onload='...' inside SVG.
_SVG_EVENT_ATTR_RE: Final[re.Pattern[str]] = re.compile(
    r"\bon[a-z]+\s*=", re.IGNORECASE
)


def _is_valid_image(body: bytes, suffix: str) -> bool:
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError:
        # PIL is in requirements.txt; if it's missing, fail open with a warning
        # rather than blocking uploads — that's a deployment problem to fix.
        logger.warning("[upload_validation] PIL not installed — skipping image check")
        return True
    try:
        img = Image.open(io.BytesIO(body))
        img.verify()  # parses headers without decoding pixels — cheap
        fmt = (img.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError):
        return False
    allowed = _PIL_FORMAT_BY_SUFFIX.get(suffix, frozenset())
    return fmt in allowed


def _is_valid_svg(body: bytes) -> bool:
    # Reject too-large SVGs outright (cheap DoS guard before regex scan).
    if len(body) > 2 * 1024 * 1024:  # 2 MB
        return False
    try:
        text = body.decode("utf-8", errors="replace")
    except UnicodeDecodeError:
        return False
    head = text.lstrip()[:200].lower()
    if "<svg" not in head and "<?xml" not in head:
        return False
    lower = text.lower()
    if "<script" in lower or "javascript:" in lower:
        return False
    if _SVG_EVENT_ATTR_RE.search(text):
        return False
    return True


def _is_valid_video(body: bytes, suffix: str) -> bool:
    if len(body) < 16:
        return False
    if suffix in (".mp4", ".mov"):
        # ISO-BMFF: bytes [4:8] should be "ftyp"
        return body[4:8] == b"ftyp"
    if suffix == ".webm":
        return body[:4] == b"\x1a\x45\xdf\xa3"
    return False


def validate_upload_content(body: bytes, claimed_suffix: str) -> str:
    """Return the validated suffix or raise HTTPException(415).

    ``claimed_suffix`` is the lowercased file extension (with leading dot) the
    HTTP layer already extracted from the filename.
    """
    if not body:
        raise HTTPException(status_code=400, detail="Empty file.")
    s = (claimed_suffix or "").lower()

    if s in _IMAGE_SUFFIXES:
        if not _is_valid_image(body, s):
            raise HTTPException(
                status_code=415,
                detail=f"Uploaded bytes do not match a valid {s[1:].upper()} image.",
            )
        return s

    if s == _SVG_SUFFIX:
        if not _is_valid_svg(body):
            raise HTTPException(
                status_code=415,
                detail="Uploaded SVG is malformed or contains disallowed content (scripts / event handlers).",
            )
        return s

    if s in _VIDEO_SUFFIXES:
        if not _is_valid_video(body, s):
            raise HTTPException(
                status_code=415,
                detail=f"Uploaded bytes do not match a valid {s[1:].upper()} video.",
            )
        return s

    raise HTTPException(
        status_code=415,
        detail=(
            f"Unsupported file type {s or '(missing extension)'}. "
            "Allowed: PNG, JPG, JPEG, WEBP, GIF, AVIF, SVG, MP4, WEBM, MOV."
        ),
    )
