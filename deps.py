"""FastAPI dependency callables shared by routers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException

from auth import get_current_superuser
from config import SUPERUSER_EMAIL
from models import User


def require_primary_admin(user: Annotated[User, Depends(get_current_superuser)]) -> User:
    """Only the bootstrapped primary admin may export AI context."""
    if user.email.strip().lower() != SUPERUSER_EMAIL:
        raise HTTPException(
            status_code=403,
            detail="ייצוא הקשר ל-AI זמין רק לחשבון האדמין הראשי.",
        )
    return user
