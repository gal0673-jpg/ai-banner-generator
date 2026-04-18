"""Add ugc_website_display for on-video URL overlay (Remotion).

Revision ID: i1d2e3f4a5b6
Revises: h0c2d3e4f5g6
Create Date: 2026-04-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "i1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "h0c2d3e4f5g6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # TEXT avoids MySQL 65KB row-size limit (many VARCHAR(1024) columns on this table).
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_website_display", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "ugc_website_display")
