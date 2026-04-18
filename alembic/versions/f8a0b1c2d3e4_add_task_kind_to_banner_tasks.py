"""Add task_kind to banner_tasks for banner vs UGC vs avatar studio

Revision ID: f8a0b1c2d3e4
Revises: e1f2a3b4c5d6
Create Date: 2026-04-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f8a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column(
            "task_kind",
            sa.String(length=32),
            nullable=False,
            server_default="banner",
        ),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "task_kind")
