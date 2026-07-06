"""Allowed values for task / video / UGC status columns.

Centralizing these lets the ORM, the migration that adds CHECK constraints, and
typed code (e.g. ``Literal[...]`` annotations) all import from one source.

Adding a new status?
  1. Append it to the relevant ``frozenset`` below.
  2. Generate a migration that ``ALTER TABLE … DROP CHECK …`` + re-adds with the
     new value (or use ``ALTER TABLE … MODIFY COLUMN`` for MySQL).
  3. Update any client-side maps that translate codes to Hebrew labels.
"""

from __future__ import annotations

# ── BannerTask.status (top-level workflow state) ──────────────────────────────
BANNER_STATUS: frozenset[str] = frozenset({
    "pending",
    "scraped",
    "generating_image",
    "completed",
    "failed",
})

# ── BannerTask.task_kind (which pipeline this task drives) ────────────────────
TASK_KIND: frozenset[str] = frozenset({
    "banner",          # /generate — crawl + creative
    "ugc_legacy",      # /generate-ugc — crawl + UGC
    "avatar_studio",   # /avatar-studio/generate — prompts only
})

# ── BannerCreativeData.video_status (banner Remotion render) ──────────────────
# NULL is allowed too (= no render yet OR completed and reset to NULL).
VIDEO_STATUS: frozenset[str] = frozenset({
    "processing",
    "failed",
})

# ── UgcVideoData.ugc_status (UGC / avatar-studio pipeline) ────────────────────
# NULL allowed for "no UGC associated".
UGC_STATUS: frozenset[str] = frozenset({
    "pending",
    "scraped",
    "generating_script",
    "generating_video",
    "processing_video",
    "rendering_captions",
    "completed",
    "failed",
})

# ── BusinessProfile.scan_status (one-time "learn my business" enrichment) ──────
# 'idle'     — created manually, never scanned (or scan not requested yet)
# 'scanning' — crawl + GPT extraction running in a Celery task
# 'ready'    — enrichment done; profile has context_text and (usually) a logo
# 'failed'   — scan failed; scan_error holds the reason. The profile is still
#              usable with whatever fields the user filled in manually.
PROFILE_SCAN_STATUS: frozenset[str] = frozenset({
    "idle",
    "scanning",
    "ready",
    "failed",
})


def _quoted_csv(values: frozenset[str]) -> str:
    """Render an alphabetized comma-separated SQL string list — useful for IN (...) clauses."""
    return ", ".join(f"'{v}'" for v in sorted(values))


# Pre-built SQL fragments so the model layer and the migration share the exact
# same constraint expression.

BANNER_STATUS_CHECK_EXPR = f"status IN ({_quoted_csv(BANNER_STATUS)})"
TASK_KIND_CHECK_EXPR = f"task_kind IN ({_quoted_csv(TASK_KIND)})"
VIDEO_STATUS_CHECK_EXPR = (
    f"video_status IS NULL OR video_status IN ({_quoted_csv(VIDEO_STATUS)})"
)
UGC_STATUS_CHECK_EXPR = (
    f"ugc_status IS NULL OR ugc_status IN ({_quoted_csv(UGC_STATUS)})"
)
PROFILE_SCAN_STATUS_CHECK_EXPR = (
    f"scan_status IN ({_quoted_csv(PROFILE_SCAN_STATUS)})"
)


# Constraint names used in the model AND in the migration (stable so they can
# be ALTER'd by name later).

BANNER_STATUS_CK = "ck_banner_tasks_status"
TASK_KIND_CK = "ck_banner_tasks_task_kind"
VIDEO_STATUS_CK = "ck_banner_creative_data_video_status"
UGC_STATUS_CK = "ck_ugc_video_data_ugc_status"
PROFILE_SCAN_STATUS_CK = "ck_business_profiles_scan_status"
