"""Avatar & Voice catalog — public read endpoints + superuser CRUD."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import get_current_superuser, get_current_user
from database import get_db
from models import AvatarCatalog, User, VoiceCatalog
from schemas import (
    AvatarCreate,
    AvatarRead,
    AvatarUpdate,
    VoiceCreate,
    VoiceRead,
    VoiceUpdate,
)

router = APIRouter(tags=["catalog"])

# ── Public (authenticated) ────────────────────────────────────────────────────


@router.get("/catalog/avatars/active", response_model=list[AvatarRead])
def list_active_avatars(
    _: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[AvatarCatalog]:
    """Return all active avatars for the studio picker."""
    return list(
        db.scalars(
            select(AvatarCatalog)
            .where(AvatarCatalog.is_active.is_(True))
            .order_by(AvatarCatalog.name)
        ).all()
    )


@router.get("/catalog/voices/active", response_model=list[VoiceRead])
def list_active_voices(
    _: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[VoiceCatalog]:
    """Return all active voices for the studio picker."""
    return list(
        db.scalars(
            select(VoiceCatalog)
            .where(VoiceCatalog.is_active.is_(True))
            .order_by(VoiceCatalog.name)
        ).all()
    )


# ── Admin — Avatars ───────────────────────────────────────────────────────────


@router.get("/admin/avatars", response_model=list[AvatarRead])
def admin_list_avatars(
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> list[AvatarCatalog]:
    """Return all avatars (active and inactive) for the admin catalog UI."""
    return list(
        db.scalars(
            select(AvatarCatalog).order_by(AvatarCatalog.name)
        ).all()
    )


@router.post(
    "/admin/avatars",
    response_model=AvatarRead,
    status_code=status.HTTP_201_CREATED,
)
def create_avatar(
    body: AvatarCreate,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> AvatarCatalog:
    row = AvatarCatalog(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/admin/avatars/{avatar_id}", response_model=AvatarRead)
def update_avatar(
    avatar_id: uuid.UUID,
    body: AvatarUpdate,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> AvatarCatalog:
    row = db.get(AvatarCatalog, avatar_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/admin/avatars/{avatar_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(
    avatar_id: uuid.UUID,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> None:
    row = db.get(AvatarCatalog, avatar_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Avatar not found")
    db.delete(row)
    db.commit()


# ── Admin — Voices ────────────────────────────────────────────────────────────


@router.get("/admin/voices", response_model=list[VoiceRead])
def admin_list_voices(
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> list[VoiceCatalog]:
    """Return all voices (active and inactive) for the admin catalog UI."""
    return list(
        db.scalars(
            select(VoiceCatalog).order_by(VoiceCatalog.name)
        ).all()
    )


@router.post(
    "/admin/voices",
    response_model=VoiceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_voice(
    body: VoiceCreate,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> VoiceCatalog:
    row = VoiceCatalog(**body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/admin/voices/{voice_id}", response_model=VoiceRead)
def update_voice(
    voice_id: uuid.UUID,
    body: VoiceUpdate,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> VoiceCatalog:
    row = db.get(VoiceCatalog, voice_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/admin/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voice(
    voice_id: uuid.UUID,
    _: Annotated[User, Depends(get_current_superuser)],
    db: Session = Depends(get_db),
) -> None:
    row = db.get(VoiceCatalog, voice_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice not found")
    db.delete(row)
    db.commit()
