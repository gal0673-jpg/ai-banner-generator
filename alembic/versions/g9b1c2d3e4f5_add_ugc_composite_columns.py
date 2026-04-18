"""Add ugc_composited_video_url and ugc_composite_note for FFmpeg post-step.

Revision ID: g9b1c2d3e4f5
Revises: f8a0b1c2d3e4
Create Date: 2026-04-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "g9b1c2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "f8a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_composited_video_url", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_composite_note", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "ugc_composite_note")
    op.drop_column("banner_tasks", "ugc_composited_video_url")
