"""Tests for the business-profile context builder, GPT extraction, and ORM model."""

from __future__ import annotations

import json
import uuid

from services.business_profile import (
    build_context_text,
    extract_profile_fields,
    generate_marketing_copy,
)


# ── build_context_text (pure) ─────────────────────────────────────────────────

def test_build_context_text_includes_all_fields():
    text = build_context_text(
        name="ACME",
        description="We build websites",
        audience="small businesses",
        tone="professional",
        offerings="sites, apps",
        brand_color="#1D4ED8",
    )
    for expected in ("ACME", "We build websites", "small businesses", "professional", "#1D4ED8"):
        assert expected in text
    # No scraped text → no crawl section.
    assert "CRAWLED WEBSITE TEXT" not in text


def test_build_context_text_appends_scraped_section():
    text = build_context_text(name="ACME", scraped_text="hello from the site")
    assert "CRAWLED WEBSITE TEXT" in text
    assert "hello from the site" in text


def test_build_context_text_skips_empty_fields():
    text = build_context_text(name="ACME", description="   ", audience=None)
    assert "Business name: ACME" in text
    assert "What the business does" not in text
    assert "Target audience" not in text


# ── extract_profile_fields (fake OpenAI client) ───────────────────────────────

class _FakeMessage:
    def __init__(self, content: str):
        self.message = type("M", (), {"content": content})


class _FakeResponse:
    def __init__(self, content: str):
        self.choices = [_FakeMessage(content)]


class _FakeCompletions:
    def __init__(self, content: str):
        self._content = content
        self.calls = 0

    def create(self, **_kwargs):
        self.calls += 1
        return _FakeResponse(self._content)


class _FakeClient:
    def __init__(self, content: str):
        self.chat = type("C", (), {"completions": _FakeCompletions(content)})


def test_extract_profile_fields_parses_and_normalizes_hex():
    payload = json.dumps({
        "name": "ACME",
        "description": "בונים אתרים",
        "audience": "עסקים קטנים",
        "tone": "מקצועי וחם",
        "offerings": "אתרים, אפליקציות",
        "brand_color": "1d4ed8",  # no leading '#', lowercase
    })
    out = extract_profile_fields(_FakeClient(payload), "some scraped text")
    assert out["name"] == "ACME"
    assert out["brand_color"] == "#1D4ED8"  # normalized to '#' + uppercase


def test_extract_profile_fields_invalid_hex_becomes_none():
    payload = json.dumps({"name": "ACME", "brand_color": "not-a-color"})
    out = extract_profile_fields(_FakeClient(payload), "text")
    assert out["brand_color"] is None
    # Missing keys are returned as None, not KeyError.
    assert out["audience"] is None


# ── generate_marketing_copy (reuses creative_agent validation) ────────────────

def test_generate_marketing_copy_returns_only_text_fields():
    payload = json.dumps({
        "headline": "כותרת מנצחת",
        "subhead": "משפט אחד שמסביר את הערך",
        "bullet_points": ["יתרון ראשון", "יתרון שני", "יתרון שלישי"],
        "cta": "דברו איתנו",
        "video_hook": "עכשיו זה קורה",
        "brand_color": "#1D4ED8",
        "image_prompt": "an abstract background",
    })
    out = generate_marketing_copy(_FakeClient(payload), "context", goal="מבצע לחג")
    assert out["headline"] == "כותרת מנצחת"
    assert out["bullet_points"] == ["יתרון ראשון", "יתרון שני", "יתרון שלישי"]
    assert out["cta"] == "דברו איתנו"
    # No image_prompt / brand_color leak into the copy response.
    assert "image_prompt" not in out
    assert "brand_color" not in out


# ── ORM model ─────────────────────────────────────────────────────────────────

def test_business_profile_persists_and_links_task(db_session, make_user):
    from models import BannerTask, BusinessProfile

    user = make_user()
    profile = BusinessProfile(
        id=uuid.uuid4(),
        user_id=user.id,
        name="ACME",
        website_url="https://acme.example",
        context_text="cached brief",
        scan_status="ready",
        is_default=True,
    )
    db_session.add(profile)
    db_session.commit()

    task = BannerTask(
        id=uuid.uuid4(),
        user_id=user.id,
        status="pending",
        task_kind="banner",
        url="https://acme.example",
        business_profile_id=profile.id,
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    assert task.business_profile is not None
    assert task.business_profile.name == "ACME"
    assert profile in user.business_profiles


def test_pick_default_avatar_prefers_recommended_voice(db_session):
    import uuid as _uuid

    from models import AvatarCatalog, VoiceCatalog
    from routers.business import _pick_default_avatar_and_voice

    db_session.add(VoiceCatalog(
        id=_uuid.uuid4(), name="קול", gender="female", provider="elevenlabs",
        external_id="voice-generic", is_active=True,
    ))
    db_session.add(AvatarCatalog(
        id=_uuid.uuid4(), name="דנה", gender="female", aspect_ratio="9:16",
        provider="heygen_elevenlabs", external_id="avatar-1",
        recommended_voice_id="voice-rec", is_active=True,
    ))
    db_session.commit()

    avatar, voice_id = _pick_default_avatar_and_voice(db_session)
    assert avatar.external_id == "avatar-1"
    assert voice_id == "voice-rec"  # recommended wins over the generic catalog voice


def test_pick_default_avatar_falls_back_to_gender_voice(db_session):
    import uuid as _uuid

    from models import AvatarCatalog, VoiceCatalog
    from routers.business import _pick_default_avatar_and_voice

    db_session.add(VoiceCatalog(
        id=_uuid.uuid4(), name="קול גברי", gender="male", provider="elevenlabs",
        external_id="voice-male", is_active=True,
    ))
    db_session.add(AvatarCatalog(
        id=_uuid.uuid4(), name="יוסי", gender="male", aspect_ratio="9:16",
        provider="heygen_elevenlabs", external_id="avatar-m", is_active=True,
    ))
    db_session.commit()

    avatar, voice_id = _pick_default_avatar_and_voice(db_session)
    assert avatar.external_id == "avatar-m"
    assert voice_id == "voice-male"  # no recommended → match by gender


def test_pick_default_avatar_raises_without_active_avatar(db_session):
    from fastapi import HTTPException

    from routers.business import _pick_default_avatar_and_voice

    try:
        _pick_default_avatar_and_voice(db_session)
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_deleting_profile_sets_task_fk_null(db_session, make_user):
    from models import BannerTask, BusinessProfile

    user = make_user()
    profile = BusinessProfile(id=uuid.uuid4(), user_id=user.id, name="ACME")
    db_session.add(profile)
    db_session.commit()

    task = BannerTask(
        id=uuid.uuid4(),
        user_id=user.id,
        status="pending",
        task_kind="banner",
        url="https://acme.example",
        business_profile_id=profile.id,
    )
    db_session.add(task)
    db_session.commit()

    db_session.delete(profile)
    db_session.commit()
    db_session.refresh(task)

    # SET NULL on delete — the task survives, unlinked.
    assert task.business_profile_id is None
