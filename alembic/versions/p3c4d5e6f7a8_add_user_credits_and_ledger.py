"""Add user_credits and credit_ledger tables.

Revision ID: p3c4d5e6f7a8
Revises: n1a2split_banner_norm
Create Date: 2026-05-15

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "n1a2split_banner_norm"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())

    if "user_credits" not in existing:
        op.create_table(
            "user_credits",
            sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("balance", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_refill_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
        )

    if "credit_ledger" not in existing:
        op.create_table(
            "credit_ledger",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("task_id", sa.Uuid(as_uuid=True), nullable=True),
            sa.Column("amount", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(length=64), nullable=False),
            sa.Column("balance_after", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["task_id"], ["banner_tasks.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_credit_ledger_user_id", "credit_ledger", ["user_id"])
        op.create_index("ix_credit_ledger_task_id", "credit_ledger", ["task_id"])
        op.create_index("ix_credit_ledger_created_at", "credit_ledger", ["created_at"])

    # Backfill: every existing user gets the signup bonus + a ledger entry, so
    # legacy users aren't blocked the moment credit gates land in production.
    # ``INSERT IGNORE`` keeps the migration idempotent across re-runs.
    op.execute(
        sa.text(
            "INSERT IGNORE INTO user_credits (user_id, balance, last_refill_at, updated_at, created_at) "
            "SELECT id, 200, NULL, NOW(), NOW() FROM users"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO credit_ledger (user_id, task_id, amount, reason, balance_after, created_at) "
            "SELECT u.id, NULL, 200, 'grant_backfill', 200, NOW() FROM users u "
            "LEFT JOIN credit_ledger l ON l.user_id = u.id AND l.reason = 'grant_backfill' "
            "WHERE l.id IS NULL"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())

    if "credit_ledger" in existing:
        for ix in ("ix_credit_ledger_created_at", "ix_credit_ledger_task_id", "ix_credit_ledger_user_id"):
            try:
                op.drop_index(ix, table_name="credit_ledger")
            except Exception:  # noqa: BLE001
                pass
        op.drop_table("credit_ledger")

    if "user_credits" in existing:
        op.drop_table("user_credits")
