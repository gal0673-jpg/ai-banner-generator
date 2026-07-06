"""Drop ugc_video_fit_mode legacy column from ugc_video_data.

The composite pipeline has always used crop-to-fill; this column was never read
or written by application code. Removing it keeps the schema honest.

Revision ID: q4d5e6f7a8b9
Revises: p3c4d5e6f7a8
Create Date: 2026-05-15

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "p3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("ugc_video_data")}
    if "ugc_video_fit_mode" in cols:
        op.drop_column("ugc_video_data", "ugc_video_fit_mode")


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("ugc_video_data")}
    if "ugc_video_fit_mode" not in cols:
        op.add_column(
            "ugc_video_data",
            sa.Column("ugc_video_fit_mode", sa.String(length=32), nullable=True),
        )
