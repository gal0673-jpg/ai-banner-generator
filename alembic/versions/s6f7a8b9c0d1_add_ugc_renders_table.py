"""Add normalized ugc_renders table (Phase 1 — dual-write only).

Future Phase 2 will switch reads to this table and drop the legacy
``ugc_composited_video_url_*`` and ``ugc_final_video_url_*`` columns from
``ugc_video_data``. This migration only adds infrastructure; existing readers
continue to use the denormalized columns.

Revision ID: s6f7a8b9c0d1
Revises: r5e6f7a8b9c0
Create Date: 2026-05-15

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s6f7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "r5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mapping: legacy column → (aspect_ratio, kind)
_LEGACY_TO_NORMALIZED = [
    ("ugc_composited_video_url",       "9:16", "composited"),
    ("ugc_composited_video_url_1_1",   "1:1",  "composited"),
    ("ugc_composited_video_url_16_9",  "16:9", "composited"),
    ("ugc_final_video_url",            "9:16", "final"),
    ("ugc_final_video_url_1_1",        "1:1",  "final"),
    ("ugc_final_video_url_16_9",       "16:9", "final"),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())

    if "ugc_renders" not in existing:
        op.create_table(
            "ugc_renders",
            sa.Column("banner_task_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("aspect_ratio", sa.String(length=8), nullable=False),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("url", sa.String(length=1024), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["banner_task_id"], ["banner_tasks.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("banner_task_id", "aspect_ratio", "kind"),
            sa.CheckConstraint(
                "kind IN ('composited', 'final')", name="ck_ugc_renders_kind"
            ),
            sa.CheckConstraint(
                "aspect_ratio IN ('9:16', '1:1', '16:9')",
                name="ck_ugc_renders_aspect_ratio",
            ),
        )

    # Backfill: pull existing denormalized URLs into the new table. INSERT IGNORE
    # makes this idempotent if the migration is re-run.
    ugc_cols = {c["name"] for c in insp.get_columns("ugc_video_data")}
    for col, aspect, kind in _LEGACY_TO_NORMALIZED:
        if col not in ugc_cols:
            continue
        op.execute(
            sa.text(
                f"INSERT IGNORE INTO ugc_renders (banner_task_id, aspect_ratio, kind, url, updated_at) "
                f"SELECT banner_task_id, :aspect, :kind, {col}, NOW() "
                f"FROM ugc_video_data "
                f"WHERE {col} IS NOT NULL AND TRIM({col}) <> ''"
            ).bindparams(aspect=aspect, kind=kind)
        )


def downgrade() -> None:
    op.drop_table("ugc_renders")
