"""WebSocket endpoint for real-time task-status updates via Redis Pub/Sub.

Clients connect to ``/ws/task/{task_id}`` and receive a stream of JSON
task-status objects as the Celery pipeline progresses.

Authentication mirrors the REST layer: the ``access_token`` cookie (set by
``/auth/login``) is read from the WebSocket upgrade request.  As a fallback for
cross-origin dev setups where the browser may not forward the cookie, a raw JWT
can be passed as ``?token=<jwt>`` in the query string.

Custom close codes used by this endpoint:
    4401 — Not authenticated (missing or invalid token).
    4403 — Forbidden (task belongs to a different user).
    4404 — Task not found / invalid UUID.
"""

from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import auth as auth_module
from database import SessionLocal
from models import BannerTask, User
from services.redis_pubsub import subscribe_task_updates

logger = logging.getLogger(__name__)
router = APIRouter()


def _authenticate_websocket(websocket: WebSocket) -> User | None:
    """Return the authenticated User or None if credentials are absent/invalid.

    Checks (in order):
    1. ``access_token`` cookie — value is ``"Bearer <jwt>"`` (set by login route).
    2. ``?token=<jwt>`` query parameter — raw JWT without the Bearer scheme.
    """
    with SessionLocal() as db:
        cookie_val = websocket.cookies.get("access_token", "")
        token = cookie_val.removeprefix("Bearer ").strip()

        if not token:
            token = websocket.query_params.get("token", "").strip()

        if not token:
            return None

        try:
            user_id_str = auth_module.decode_access_token(token)
            user_uuid = UUID(user_id_str)
        except Exception:  # noqa: BLE001
            return None

        return db.get(User, user_uuid)


@router.websocket("/ws/task/{task_id}")
async def ws_task_status(websocket: WebSocket, task_id: str) -> None:
    """Stream task-status updates to connected clients via Redis Pub/Sub.

    Flow:
    1. Accept the upgrade.
    2. Authenticate; close 4401/4403/4404 on any auth/ownership failure.
    3. Start two concurrent tasks:
       - ``_send_loop``: subscribes to the Redis channel and forwards each
         published payload to the WebSocket as a JSON string.
       - ``_recv_loop``: drains incoming frames (ping/close) to detect client
         disconnect.
    4. When either task completes (disconnect or error), cancel the other and
       return — FastAPI closes the WebSocket automatically.
    """
    await websocket.accept()

    # ── Authentication ────────────────────────────────────────────────────────
    user = _authenticate_websocket(websocket)
    if user is None:
        await websocket.close(code=4401, reason="Not authenticated")
        return

    # ── Task ownership check ──────────────────────────────────────────────────
    try:
        task_uuid = UUID(task_id)
    except ValueError:
        await websocket.close(code=4404, reason="Invalid task id")
        return

    with SessionLocal() as db:
        row = db.get(BannerTask, task_uuid)
        if row is None:
            await websocket.close(code=4404, reason="Task not found")
            return
        if row.user_id != user.id and not user.is_superuser:
            await websocket.close(code=4403, reason="Forbidden")
            return

    logger.debug("[ws] client connected for task %s (user %s)", task_id, user.id)

    # ── Pub/Sub → WebSocket forwarding ────────────────────────────────────────
    async def _send_loop() -> None:
        async for payload in subscribe_task_updates(task_id):
            try:
                await websocket.send_text(json.dumps(payload))
            except Exception:  # noqa: BLE001
                break

    async def _recv_loop() -> None:
        """Drain client frames so we detect disconnect promptly."""
        while True:
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except Exception:  # noqa: BLE001
                break

    send_task = asyncio.create_task(_send_loop())
    recv_task = asyncio.create_task(_recv_loop())

    _done, pending = await asyncio.wait(
        [send_task, recv_task],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for t in pending:
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass

    logger.debug("[ws] connection closed for task %s", task_id)
