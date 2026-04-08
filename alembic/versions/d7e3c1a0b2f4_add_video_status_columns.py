"""Add video_status and video_render_error to banner_tasks

Revision ID: d7e3c1a0b2f4
Revises: b09ba5e8cf40
Create Date: 2026-04-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d7e3c1a0b2f4"
down_revision: Union[str, Sequence[str], None] = "b09ba5e8cf40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("video_status", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "banner_tasks",
        sa.Column("video_render_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "video_render_error")
    op.drop_column("banner_tasks", "video_status")
