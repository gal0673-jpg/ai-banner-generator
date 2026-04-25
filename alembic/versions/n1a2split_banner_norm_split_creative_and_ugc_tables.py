"""Split banner_tasks into banner_creative_data + ugc_video_data (1:1).

Revision ID: n1a2split_banner_norm
Revises: m5b6c7d8e9f0
Create Date: 2026-04-21

"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n1a2split_banner_norm"
down_revision: Union[str, Sequence[str], None] = "m5b6c7d8e9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use CREATE TABLE IF NOT EXISTS so the migration is idempotent when
    # SQLAlchemy's create_all() already created the tables on a fresh server start
    # before this migration was stamped.
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())

    if "banner_creative_data" not in existing:
        op.create_table(
            "banner_creative_data",
            sa.Column("banner_task_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("headline", sa.String(length=512), nullable=True),
            sa.Column("subhead", sa.String(length=1024), nullable=True),
            sa.Column("bullet_points", sa.JSON(), nullable=True),
            sa.Column("cta", sa.String(length=256), nullable=True),
            sa.Column("video_hook", sa.String(length=256), nullable=True),
            sa.Column("brand_color", sa.String(length=32), nullable=True),
            sa.Column("background_url", sa.String(length=1024), nullable=True),
            sa.Column("logo_url", sa.String(length=1024), nullable=True),
            sa.Column("product_image_url", sa.String(length=1024), nullable=True),
            sa.Column("rendered_banner_1_url", sa.String(length=1024), nullable=True),
            sa.Column("rendered_banner_2_url", sa.String(length=1024), nullable=True),
            sa.Column("canvas_state", sa.JSON(), nullable=True),
            sa.Column("video_url_1", sa.String(length=1024), nullable=True),
            sa.Column("video_url_2", sa.String(length=1024), nullable=True),
            sa.Column("rendered_banner_1_vertical_url", sa.String(length=1024), nullable=True),
            sa.Column("rendered_banner_2_vertical_url", sa.String(length=1024), nullable=True),
            sa.Column("video_url_1_vertical", sa.String(length=1024), nullable=True),
            sa.Column("video_url_2_vertical", sa.String(length=1024), nullable=True),
            sa.Column("video_status", sa.String(length=64), nullable=True),
            sa.Column("video_render_error", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["banner_task_id"], ["banner_tasks.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("banner_task_id"),
        )

    if "ugc_video_data" not in existing:
        op.create_table(
            "ugc_video_data",
            sa.Column("banner_task_id", sa.Uuid(as_uuid=True), nullable=False),
            sa.Column("ugc_script", sa.JSON(), nullable=True),
            sa.Column("ugc_avatar_id", sa.String(length=256), nullable=True),
            sa.Column("ugc_raw_video_url", sa.String(length=1024), nullable=True),
            sa.Column("ugc_composited_video_url", sa.String(length=1024), nullable=True),
            sa.Column("ugc_composite_note", sa.Text(), nullable=True),
            sa.Column("ugc_final_video_url", sa.String(length=1024), nullable=True),
            sa.Column("ugc_composited_video_url_1_1", sa.String(length=1024), nullable=True),
            sa.Column("ugc_final_video_url_1_1", sa.String(length=1024), nullable=True),
            sa.Column("ugc_composited_video_url_16_9", sa.String(length=1024), nullable=True),
            sa.Column("ugc_final_video_url_16_9", sa.String(length=1024), nullable=True),
            sa.Column("ugc_website_display", sa.Text(), nullable=True),
            sa.Column("ugc_status", sa.String(length=64), nullable=True),
            sa.Column("ugc_error", sa.Text(), nullable=True),
            sa.Column("ugc_speed_factor", sa.Float(), nullable=True),
            sa.Column("ugc_video_fit_mode", sa.String(length=32), nullable=True),
            sa.ForeignKeyConstraint(["banner_task_id"], ["banner_tasks.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("banner_task_id"),
        )

    # Migrate existing data from the fat banner_tasks columns into the new tables.
    # INSERT … SELECT only copies rows where the source columns still exist, and
    # uses INSERT IGNORE to skip any rows already present (idempotent).
    bt_cols = {c["name"] for c in insp.get_columns("banner_tasks")}

    creative_cols = (
        "headline, subhead, bullet_points, cta, video_hook, brand_color, background_url, "
        "logo_url, product_image_url, rendered_banner_1_url, rendered_banner_2_url, canvas_state, "
        "video_url_1, video_url_2, rendered_banner_1_vertical_url, rendered_banner_2_vertical_url, "
        "video_url_1_vertical, video_url_2_vertical, video_status, video_render_error"
    )
    if "headline" in bt_cols:  # old columns still present → migrate data
        op.execute(
            sa.text(
                f"INSERT IGNORE INTO banner_creative_data (banner_task_id, {creative_cols}) "
                f"SELECT id, {creative_cols} FROM banner_tasks"
            )
        )

    ugc_cols = (
        "ugc_script, ugc_avatar_id, ugc_raw_video_url, ugc_composited_video_url, ugc_composite_note, "
        "ugc_final_video_url, ugc_composited_video_url_1_1, ugc_final_video_url_1_1, "
        "ugc_composited_video_url_16_9, ugc_final_video_url_16_9, ugc_website_display, "
        "ugc_status, ugc_error, ugc_speed_factor, ugc_video_fit_mode"
    )
    if "ugc_script" in bt_cols:
        op.execute(
            sa.text(
                f"INSERT IGNORE INTO ugc_video_data (banner_task_id, {ugc_cols}) "
                f"SELECT id, {ugc_cols} FROM banner_tasks"
            )
        )

    creative_drop = [
        "headline", "subhead", "bullet_points", "cta", "video_hook", "brand_color",
        "background_url", "logo_url", "product_image_url", "rendered_banner_1_url",
        "rendered_banner_2_url", "canvas_state", "video_url_1", "video_url_2",
        "rendered_banner_1_vertical_url", "rendered_banner_2_vertical_url",
        "video_url_1_vertical", "video_url_2_vertical", "video_status", "video_render_error",
    ]
    ugc_drop = [
        "ugc_script", "ugc_avatar_id", "ugc_raw_video_url", "ugc_composited_video_url",
        "ugc_composite_note", "ugc_final_video_url", "ugc_composited_video_url_1_1",
        "ugc_final_video_url_1_1", "ugc_composited_video_url_16_9", "ugc_final_video_url_16_9",
        "ugc_website_display", "ugc_status", "ugc_error", "ugc_speed_factor", "ugc_video_fit_mode",
    ]
    # Only drop columns that still exist (idempotent if migration is re-run)
    for col in creative_drop + ugc_drop:
        if col in bt_cols:
            op.drop_column("banner_tasks", col)


def downgrade() -> None:
    creative_add = [
        ("headline", sa.String(512)),
        ("subhead", sa.String(1024)),
        ("bullet_points", sa.JSON()),
        ("cta", sa.String(256)),
        ("video_hook", sa.String(256)),
        ("brand_color", sa.String(32)),
        ("background_url", sa.String(1024)),
        ("logo_url", sa.String(1024)),
        ("product_image_url", sa.String(1024)),
        ("rendered_banner_1_url", sa.String(1024)),
        ("rendered_banner_2_url", sa.String(1024)),
        ("canvas_state", sa.JSON()),
        ("video_url_1", sa.String(1024)),
        ("video_url_2", sa.String(1024)),
        ("rendered_banner_1_vertical_url", sa.String(1024)),
        ("rendered_banner_2_vertical_url", sa.String(1024)),
        ("video_url_1_vertical", sa.String(1024)),
        ("video_url_2_vertical", sa.String(1024)),
        ("video_status", sa.String(64)),
        ("video_render_error", sa.Text()),
    ]
    for name, typ in creative_add:
        op.add_column("banner_tasks", sa.Column(name, typ, nullable=True))

    ugc_add = [
        ("ugc_script", sa.JSON()),
        ("ugc_avatar_id", sa.String(256)),
        ("ugc_raw_video_url", sa.String(1024)),
        ("ugc_composited_video_url", sa.String(1024)),
        ("ugc_composite_note", sa.Text()),
        ("ugc_final_video_url", sa.String(1024)),
        ("ugc_composited_video_url_1_1", sa.String(1024)),
        ("ugc_final_video_url_1_1", sa.String(1024)),
        ("ugc_composited_video_url_16_9", sa.String(1024)),
        ("ugc_final_video_url_16_9", sa.String(1024)),
        ("ugc_website_display", sa.Text()),
        ("ugc_status", sa.String(64)),
        ("ugc_error", sa.Text()),
        ("ugc_speed_factor", sa.Float()),
        ("ugc_video_fit_mode", sa.String(32)),
    ]
    for name, typ in ugc_add:
        op.add_column("banner_tasks", sa.Column(name, typ, nullable=True))

    op.execute(
        sa.text(
            f"UPDATE banner_tasks bt INNER JOIN banner_creative_data c ON bt.id = c.banner_task_id "
            f"SET {', '.join(f'bt.{col} = c.{col}' for col, _ in creative_add)}"
        )
    )

    ugc_cols_list = [c[0] for c in ugc_add]
    op.execute(
        sa.text(
            "UPDATE banner_tasks bt INNER JOIN ugc_video_data u ON bt.id = u.banner_task_id SET "
            + ", ".join(f"bt.{col} = u.{col}" for col in ugc_cols_list)
        )
    )

    op.drop_table("ugc_video_data")
    op.drop_table("banner_creative_data")
