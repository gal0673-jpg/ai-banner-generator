"""Add business_profiles table + banner_tasks.business_profile_id FK.

Introduces the "capture the business once, reuse for every asset" entity. A
``BusinessProfile`` stores the customer's name / description / audience / tone /
brand color / logo and a canonical ``context_text`` brief that seeds the creative
pipelines. ``banner_tasks.business_profile_id`` links a generated asset back to
the profile it came from (SET NULL on delete so deleting a profile never orphans
its tasks).

Idempotent: guards on the inspector so re-running is safe (matches the project's
existing migration style).

Revision ID: t7a8b9c0d1e2
Revises: s6f7a8b9c0d1
Create Date: 2026-07-06

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from task_status import PROFILE_SCAN_STATUS_CHECK_EXPR, PROFILE_SCAN_STATUS_CK

revision: str = "t7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "s6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK_NAME = "fk_banner_tasks_business_profile_id"
_IX_NAME = "ix_banner_tasks_business_profile_id"


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())

    if "business_profiles" not in existing:
        op.create_table(
            "business_profiles",
            sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("website_url", sa.String(length=1024), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("audience", sa.Text(), nullable=True),
            sa.Column("tone", sa.String(length=255), nullable=True),
            sa.Column("offerings", sa.Text(), nullable=True),
            sa.Column("brand_color", sa.String(length=32), nullable=True),
            sa.Column("logo_url", sa.String(length=1024), nullable=True),
            sa.Column("context_text", sa.Text(), nullable=True),
            sa.Column(
                "scan_status",
                sa.String(length=32),
                nullable=False,
                server_default="idle",
            ),
            sa.Column("scan_error", sa.Text(), nullable=True),
            sa.Column(
                "is_default",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(PROFILE_SCAN_STATUS_CHECK_EXPR, name=PROFILE_SCAN_STATUS_CK),
        )
        op.create_index(
            "ix_business_profiles_user_id", "business_profiles", ["user_id"]
        )

    banner_cols = {c["name"] for c in insp.get_columns("banner_tasks")}
    if "business_profile_id" not in banner_cols:
        op.add_column(
            "banner_tasks",
            sa.Column("business_profile_id", sa.Uuid(as_uuid=True), nullable=True),
        )
        op.create_index(_IX_NAME, "banner_tasks", ["business_profile_id"])
        op.create_foreign_key(
            _FK_NAME,
            "banner_tasks",
            "business_profiles",
            ["business_profile_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    banner_cols = {c["name"] for c in insp.get_columns("banner_tasks")}
    if "business_profile_id" in banner_cols:
        try:
            op.drop_constraint(_FK_NAME, "banner_tasks", type_="foreignkey")
        except Exception:
            pass
        try:
            op.drop_index(_IX_NAME, table_name="banner_tasks")
        except Exception:
            pass
        op.drop_column("banner_tasks", "business_profile_id")

    if "business_profiles" in set(insp.get_table_names()):
        op.drop_table("business_profiles")
