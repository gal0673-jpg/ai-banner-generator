"""Add ugc_final_video_url for Remotion-rendered caption video.

Revision ID: h0c2d3e4f5g6
Revises: g9b1c2d3e4f5
Create Date: 2026-04-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "h0c2d3e4f5g6"
down_revision: Union[str, Sequence[str], None] = "g9b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_final_video_url", sa.String(length=1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "ugc_final_video_url")
