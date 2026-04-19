"""Add ugc_video_fit_mode to banner_tasks (UGC crop vs blur composite).

Revision ID: m5b6c7d8e9f0
Revises: 8760fc55eaeb
Create Date: 2026-04-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "m5b6c7d8e9f0"
down_revision: Union[str, Sequence[str], None] = "8760fc55eaeb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_video_fit_mode", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "ugc_video_fit_mode")
