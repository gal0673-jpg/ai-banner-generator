"""Add created_at to banner_tasks for latest-banner ordering

Revision ID: c4f1a2b8d9e0
Revises: 27a9cc284ff3
Create Date: 2026-04-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4f1a2b8d9e0"
down_revision: Union[str, Sequence[str], None] = "27a9cc284ff3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "mysql":
        op.execute(
            sa.text("UPDATE banner_tasks SET created_at = UTC_TIMESTAMP(6) WHERE created_at IS NULL")
        )
    elif dialect == "sqlite":
        op.execute(
            sa.text("UPDATE banner_tasks SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
        )
    else:
        op.execute(sa.text("UPDATE banner_tasks SET created_at = NOW() WHERE created_at IS NULL"))
    op.alter_column(
        "banner_tasks",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "created_at")
