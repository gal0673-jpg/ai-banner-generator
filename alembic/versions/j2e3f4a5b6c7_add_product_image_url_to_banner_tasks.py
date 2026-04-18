"""Add product_image_url to banner_tasks (Avatar Studio / Remotion).

Revision ID: j2e3f4a5b6c7
Revises: i1d2e3f4a5b6
Create Date: 2026-04-17

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "j2e3f4a5b6c7"
down_revision: Union[str, Sequence[str], None] = "i1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "banner_tasks",
        sa.Column("product_image_url", sa.String(length=1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("banner_tasks", "product_image_url")
