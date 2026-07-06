"""Add CHECK constraints for status / task_kind / video_status / ugc_status.

MySQL 8.0.16+ enforces CHECK constraints; older versions accept the syntax but
ignore it (no harm). Constraint expressions and names are imported from
``task_status.py`` so the ORM and the migration share one source of truth.

Revision ID: r5e6f7a8b9c0
Revises: q4d5e6f7a8b9
Create Date: 2026-05-15

"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# Migration files run from alembic/versions/ — pull the project root onto sys.path
# so ``import task_status`` (project-level module) resolves.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from task_status import (  # noqa: E402
    BANNER_STATUS,
    BANNER_STATUS_CHECK_EXPR,
    BANNER_STATUS_CK,
    TASK_KIND,
    TASK_KIND_CHECK_EXPR,
    TASK_KIND_CK,
    UGC_STATUS,
    UGC_STATUS_CHECK_EXPR,
    UGC_STATUS_CK,
    VIDEO_STATUS,
    VIDEO_STATUS_CHECK_EXPR,
    VIDEO_STATUS_CK,
)

revision: str = "r5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "q4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_check(insp: sa.Inspector, table: str, name: str) -> bool:
    """Idempotency helper — skip ALTER if the named CHECK already exists."""
    try:
        for ck in insp.get_check_constraints(table):
            if ck.get("name") == name:
                return True
    except NotImplementedError:
        # Some dialects (sqlite older versions) lack get_check_constraints
        return False
    return False


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # ── Safety net: any pre-existing rows with values outside the new whitelist
    # would make the ALTER ... ADD CHECK fail on MySQL 8.0.16+. We scan first
    # and emit a single warning per column so the operator sees what to fix.
    for tbl, col, allowed in (
        ("banner_tasks", "status", BANNER_STATUS),
        ("banner_tasks", "task_kind", TASK_KIND),
        ("banner_creative_data", "video_status", VIDEO_STATUS),
        ("ugc_video_data", "ugc_status", UGC_STATUS),
    ):
        try:
            rows = bind.execute(
                sa.text(
                    f"SELECT DISTINCT {col} FROM {tbl} "
                    f"WHERE {col} IS NOT NULL"
                )
            ).all()
        except Exception:
            continue
        bad = sorted(r[0] for r in rows if r[0] not in allowed)
        if bad:
            print(
                f"  [warn] {tbl}.{col} has unexpected values that violate the new CHECK: {bad}. "
                f"Allowed: {sorted(allowed)}. The migration will continue and may fail on strict MySQL."
            )

    # ── banner_tasks.status + banner_tasks.task_kind ──────────────────────────
    if not _has_check(insp, "banner_tasks", BANNER_STATUS_CK):
        op.create_check_constraint(
            BANNER_STATUS_CK, "banner_tasks", BANNER_STATUS_CHECK_EXPR
        )
    if not _has_check(insp, "banner_tasks", TASK_KIND_CK):
        op.create_check_constraint(
            TASK_KIND_CK, "banner_tasks", TASK_KIND_CHECK_EXPR
        )

    # ── banner_creative_data.video_status (NULL allowed) ──────────────────────
    if not _has_check(insp, "banner_creative_data", VIDEO_STATUS_CK):
        op.create_check_constraint(
            VIDEO_STATUS_CK, "banner_creative_data", VIDEO_STATUS_CHECK_EXPR
        )

    # ── ugc_video_data.ugc_status (NULL allowed) ──────────────────────────────
    if not _has_check(insp, "ugc_video_data", UGC_STATUS_CK):
        op.create_check_constraint(
            UGC_STATUS_CK, "ugc_video_data", UGC_STATUS_CHECK_EXPR
        )


def downgrade() -> None:
    for tbl, name in (
        ("banner_tasks", BANNER_STATUS_CK),
        ("banner_tasks", TASK_KIND_CK),
        ("banner_creative_data", VIDEO_STATUS_CK),
        ("ugc_video_data", UGC_STATUS_CK),
    ):
        try:
            op.drop_constraint(name, tbl, type_="check")
        except Exception:
            pass
