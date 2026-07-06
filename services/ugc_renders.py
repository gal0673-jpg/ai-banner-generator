"""Helpers for the normalized ``ugc_renders`` table.

Phase 1 of the aspect-ratio refactor — this is the **write path** for the new
table. Writes happen via ``banner_service._apply_task_field_updates`` whenever
a legacy column (``ugc_composited_video_url{,_1_1,_16_9}`` or
``ugc_final_video_url{,_1_1,_16_9}``) is set.

Readers still hit the denormalized columns on ``UgcVideoData`` so the API
status contract is unchanged. Once readers migrate (Phase 2), the legacy
columns will be dropped from ``ugc_video_data``.
"""

from __future__ import annotations

import logging
import uuid
from typing import Final

from sqlalchemy.orm import Session

from models import UgcRenderArtifact

logger = logging.getLogger(__name__)


#: Maps the legacy column name → (aspect_ratio, kind) for the new table.
#: Stable mapping used by ``mirror_url_to_renders`` and the backfill migration.
_LEGACY_TO_NORMALIZED: Final[dict[str, tuple[str, str]]] = {
    "ugc_composited_video_url":      ("9:16", "composited"),
    "ugc_composited_video_url_1_1":  ("1:1",  "composited"),
    "ugc_composited_video_url_16_9": ("16:9", "composited"),
    "ugc_final_video_url":           ("9:16", "final"),
    "ugc_final_video_url_1_1":       ("1:1",  "final"),
    "ugc_final_video_url_16_9":      ("16:9", "final"),
}


def legacy_column_to_normalized(name: str) -> tuple[str, str] | None:
    """Return ``(aspect_ratio, kind)`` for a legacy column name, or None."""
    return _LEGACY_TO_NORMALIZED.get(name)


def set_render_url(
    db: Session,
    *,
    task_id: uuid.UUID,
    aspect_ratio: str,
    kind: str,
    url: str | None,
) -> None:
    """Upsert one ``ugc_renders`` row.

    - ``url=None`` or empty → delete the row (the corresponding render no longer exists).
    - ``url=<string>`` → insert or update.
    - Caller owns ``db.commit()``. Mirrors a normal upsert via SQLAlchemy
      Session API; works on MySQL, Postgres, and SQLite without dialect-specific SQL.
    """
    existing = db.get(UgcRenderArtifact, (task_id, aspect_ratio, kind))
    cleaned = (url or "").strip()

    if not cleaned:
        if existing is not None:
            db.delete(existing)
        return

    if existing is None:
        db.add(UgcRenderArtifact(
            banner_task_id=task_id,
            aspect_ratio=aspect_ratio,
            kind=kind,
            url=cleaned,
        ))
    else:
        existing.url = cleaned


def mirror_url_to_renders(
    db: Session,
    *,
    task_id: uuid.UUID,
    legacy_column: str,
    value: str | None,
) -> None:
    """If ``legacy_column`` is one of the per-aspect URL columns, mirror the
    write to the normalized ``ugc_renders`` table.

    Silently ignores columns that aren't render URLs (e.g. ``ugc_status``)
    — caller can call this on every UGC key without pre-checking.
    """
    mapping = _LEGACY_TO_NORMALIZED.get(legacy_column)
    if mapping is None:
        return
    aspect_ratio, kind = mapping
    set_render_url(db, task_id=task_id, aspect_ratio=aspect_ratio, kind=kind, url=value)
