"""Tests for the centralized task_status constants module."""

from __future__ import annotations

import re

import task_status


def test_expected_status_values_are_present():
    """Lock in the contract: removing a value from the whitelist must be a deliberate change."""
    assert task_status.BANNER_STATUS >= {
        "pending", "scraped", "generating_image", "completed", "failed",
    }
    assert task_status.TASK_KIND >= {"banner", "ugc_legacy", "avatar_studio"}
    assert task_status.VIDEO_STATUS >= {"processing", "failed"}
    assert task_status.UGC_STATUS >= {
        "pending", "scraped", "generating_script", "generating_video",
        "processing_video", "rendering_captions", "completed", "failed",
    }


def test_constraint_names_are_stable():
    """Constraint names must not drift — migrations DROP/ADD by name."""
    assert task_status.BANNER_STATUS_CK == "ck_banner_tasks_status"
    assert task_status.TASK_KIND_CK == "ck_banner_tasks_task_kind"
    assert task_status.VIDEO_STATUS_CK == "ck_banner_creative_data_video_status"
    assert task_status.UGC_STATUS_CK == "ck_ugc_video_data_ugc_status"


def test_check_expressions_quote_every_allowed_value():
    for values, expr in (
        (task_status.BANNER_STATUS, task_status.BANNER_STATUS_CHECK_EXPR),
        (task_status.TASK_KIND, task_status.TASK_KIND_CHECK_EXPR),
        (task_status.VIDEO_STATUS, task_status.VIDEO_STATUS_CHECK_EXPR),
        (task_status.UGC_STATUS, task_status.UGC_STATUS_CHECK_EXPR),
    ):
        for v in values:
            assert f"'{v}'" in expr, f"missing {v!r} in {expr}"


def test_nullable_columns_allow_null_in_check():
    """video_status / ugc_status must allow NULL — the column is optional."""
    assert "IS NULL" in task_status.VIDEO_STATUS_CHECK_EXPR
    assert "IS NULL" in task_status.UGC_STATUS_CHECK_EXPR


def test_non_nullable_columns_omit_null_branch():
    """banner_tasks.status and .task_kind are NOT NULL — no ``IS NULL`` clause."""
    assert "IS NULL" not in task_status.BANNER_STATUS_CHECK_EXPR
    assert "IS NULL" not in task_status.TASK_KIND_CHECK_EXPR


def test_no_dangling_separators_in_expression():
    # Each expression must be syntactically valid SQL IN-list shape:
    # ``IN ('v1', 'v2', ...)`` with no trailing comma, at least one value.
    in_list = re.compile(r"IN \('[^']+'(, '[^']+')*\)")
    for expr in (
        task_status.BANNER_STATUS_CHECK_EXPR,
        task_status.TASK_KIND_CHECK_EXPR,
        task_status.VIDEO_STATUS_CHECK_EXPR,
        task_status.UGC_STATUS_CHECK_EXPR,
    ):
        assert in_list.search(expr), expr
        assert ",)" not in expr  # explicit guard against trailing comma
        assert "()" not in expr  # explicit guard against empty list
