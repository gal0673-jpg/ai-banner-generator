"""Add ugc_speed_factor to banner_tasks (UGC re-render playback rate).

Revision ID: k3f4a5b6c7d8
Revises: j2e3f4a5b6c7
Create Date: 2026-04-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "k3f4a5b6c7d8"
down_revision: Union[str, Sequence[str], None] = "j2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("ugc_speed_factor", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "ugc_speed_factor")
