"""Shared pytest fixtures.

Tests run against an in-memory SQLite DB by default — no external services.
``DATABASE_URL`` is set *before* any project module is imported so
``database.py``'s module-level engine binds to SQLite, not the user's real
MySQL.
"""

from __future__ import annotations

import os
from pathlib import Path

# Configure env BEFORE any ``from <project> import ...`` runs.
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "pytest-key-must-be-long-enough-1234567890")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import database  # noqa: E402  — module under test owns the engine
from database import Base  # noqa: E402


@pytest.fixture(scope="session")
def _shared_engine():
    """One in-memory SQLite engine shared by every test in the session.

    Uses ``StaticPool`` so the same in-memory DB is visible to multiple
    connections (default SQLite in-memory is per-connection).
    """
    from sqlalchemy.pool import StaticPool

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Swap in our test engine. Three modules grabbed ``SessionLocal`` at import
    # time (``services.credits``, ``services.banner_service``,
    # ``routers.banners``) — they hold the old reference. Re-bind every site
    # so production helpers transparently use the in-memory test DB.
    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    database.engine = engine
    database.SessionLocal = test_session_factory

    import models  # noqa: F401 — registers tables with Base.metadata

    # Re-bind in modules that imported SessionLocal by name (Python binding is
    # by reference; the original objects still point at the old engine).
    import importlib
    for mod_name in ("services.credits", "services.banner_service", "routers.banners",
                     "routers.auth", "routers.admin", "routers.avatar_studio"):
        try:
            mod = importlib.import_module(mod_name)
        except ImportError:
            continue
        if hasattr(mod, "SessionLocal"):
            mod.SessionLocal = test_session_factory

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session(_shared_engine):
    """Yield a SessionLocal-bound session and roll back any leftover state.

    Each test starts with a clean slate by deleting rows from every table
    after the yield. We don't recreate the schema (slow); we just truncate.
    """
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()
        # Clean every table in reverse dependency order so FKs don't trip.
        from sqlalchemy import delete
        import models
        # Order matters: leaf tables (ledger, credits, creative, ugc_video) first,
        # then the parent (banner_tasks, users).
        with database.SessionLocal() as cleanup:
            cleanup.execute(delete(models.CreditLedger))
            cleanup.execute(delete(models.UserCredits))
            cleanup.execute(delete(models.BannerCreativeData))
            cleanup.execute(delete(models.UgcVideoData))
            cleanup.execute(delete(models.BannerTask))
            cleanup.execute(delete(models.BusinessProfile))
            cleanup.execute(delete(models.AvatarCatalog))
            cleanup.execute(delete(models.VoiceCatalog))
            cleanup.execute(delete(models.User))
            cleanup.commit()


@pytest.fixture()
def make_user(db_session):
    """Factory that creates a User row and returns it (committed)."""
    import uuid
    from models import User

    def _factory(*, email: str = "u@test.local", is_superuser: bool = False) -> User:
        u = User(
            id=uuid.uuid4(),
            email=email,
            hashed_password="x",
            is_superuser=is_superuser,
        )
        db_session.add(u)
        db_session.commit()
        db_session.refresh(u)
        return u

    return _factory


@pytest.fixture()
def make_task(db_session):
    """Factory that creates a BannerTask row owned by the given user."""
    import uuid
    from models import BannerTask

    def _factory(user, *, status: str = "pending", task_kind: str = "banner", url: str = "https://example.com") -> BannerTask:
        t = BannerTask(
            id=uuid.uuid4(),
            user_id=user.id,
            status=status,
            task_kind=task_kind,
            url=url,
        )
        db_session.add(t)
        db_session.commit()
        db_session.refresh(t)
        return t

    return _factory
