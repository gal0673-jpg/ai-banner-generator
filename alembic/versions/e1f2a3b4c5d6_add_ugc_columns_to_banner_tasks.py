"""Add UGC pipeline columns to banner_tasks

Adds the five columns required by the HeyGen / ElevenLabs talking-avatar
pipeline: ugc_script, ugc_avatar_id, ugc_raw_video_url, ugc_status, ugc_error.

Revision ID: e1f2a3b4c5d6
Revises: d7e3c1a0b2f4
Create Date: 2026-04-09 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d7e3c1a0b2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_script", sa.JSON(), nullable=True),
    )
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_avatar_id", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_raw_video_url", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_status", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "ugc_error")
    op.drop_column("banner_tasks", "ugc_status")
    op.drop_column("banner_tasks", "ugc_raw_video_url")
    op.drop_column("banner_tasks", "ugc_avatar_id")
    op.drop_column("banner_tasks", "ugc_script")
