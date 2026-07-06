"""Tests for the pure creative_campaign.json validator extracted from run_banner_task."""

from __future__ import annotations

import pytest

from services.creative_campaign import CreativeCampaignError, parse_creative_campaign


def _valid_payload():
    return {
        "headline": "  כותרת  ",
        "subhead": "כותרת משנה",
        "cta": "  דברו איתנו ",
        "bullet_points": [" א ", "ב", "ג"],
        "video_hook": "  הוק קצר  ",
        "brand_color": "1d4ed8",  # no '#', lowercase
    }


def test_valid_payload_is_cleaned():
    out = parse_creative_campaign(_valid_payload())
    assert out["headline"] == "כותרת"  # stripped
    assert out["cta"] == "דברו איתנו"
    assert out["bullet_points"] == ["א", "ב", "ג"]  # each stripped
    assert out["brand_color"] == "#1D4ED8"  # normalized to '#'+upper
    assert out["video_hook"] == "הוק קצר"


def test_custom_hook_overrides_ai_hook():
    out = parse_creative_campaign(_valid_payload(), custom_video_hook="הוק מותאם")
    assert out["video_hook"] == "הוק מותאם"


def test_missing_video_hook_is_none():
    payload = _valid_payload()
    del payload["video_hook"]
    out = parse_creative_campaign(payload)
    assert out["video_hook"] is None


@pytest.mark.parametrize("key", ["headline", "subhead", "cta"])
def test_missing_required_text_raises(key):
    payload = _valid_payload()
    payload[key] = "   "
    with pytest.raises(CreativeCampaignError, match=key):
        parse_creative_campaign(payload)


@pytest.mark.parametrize("bullets", [["a", "b"], ["a", "b", "c", "d"], "not-a-list", None])
def test_bullets_must_be_exactly_three(bullets):
    payload = _valid_payload()
    payload["bullet_points"] = bullets
    with pytest.raises(CreativeCampaignError, match="bullet_points"):
        parse_creative_campaign(payload)


@pytest.mark.parametrize("color", ["", "  ", "nothex", "#12", None, 123])
def test_invalid_brand_color_raises(color):
    payload = _valid_payload()
    payload["brand_color"] = color
    with pytest.raises(CreativeCampaignError, match="brand_color"):
        parse_creative_campaign(payload)


def test_brand_color_with_hash_passes():
    payload = _valid_payload()
    payload["brand_color"] = "#ABCDEF"
    assert parse_creative_campaign(payload)["brand_color"] == "#ABCDEF"
