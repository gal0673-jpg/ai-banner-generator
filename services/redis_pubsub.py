"""Redis Pub/Sub helpers for real-time task-status broadcasting.

Synchronous ``publish_task_update`` is called from Celery workers (which run in
sync threads).  Async ``subscribe_task_updates`` is an async generator used by
the FastAPI WebSocket endpoint.

Channel naming convention: ``task_status:<task_uuid>``.

The ``redis`` package ships with both sync and async clients since v4.x and is
already a hard dependency (Celery broker).  No extra install is needed.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncGenerator
from typing import Any

logger = logging.getLogger(__name__)

REDIS_URL: str = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
_CHANNEL_PREFIX = "task_status:"


def _channel(task_id: str) -> str:
    return f"{_CHANNEL_PREFIX}{task_id}"


# ---------------------------------------------------------------------------
# Sync publish — called from Celery workers
# ---------------------------------------------------------------------------

_sync_pool: Any = None


def _get_sync_redis() -> Any:
    """Return a sync Redis client backed by a module-level connection pool."""
    global _sync_pool  # noqa: PLW0603
    import redis  # local import so the module is importable without redis installed

    if _sync_pool is None:
        _sync_pool = redis.ConnectionPool.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
    return redis.Redis(connection_pool=_sync_pool)


def publish_task_update(task_id: str, payload: dict[str, Any]) -> None:
    """Publish a full task-status payload to Redis Pub/Sub (thread-safe, sync).

    Called by ``persist_task`` after every DB commit so connected WebSocket
    clients receive the update with minimal latency.  Any Redis error is logged
    at WARNING level and swallowed so it never interrupts the Celery pipeline.
    """
    try:
        r = _get_sync_redis()
        r.publish(_channel(task_id), json.dumps(payload, default=str))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[pubsub] publish failed for task %s: %s", task_id, exc)


# ---------------------------------------------------------------------------
# Async subscribe — used by the FastAPI WebSocket endpoint
# ---------------------------------------------------------------------------


async def subscribe_task_updates(
    task_id: str,
) -> AsyncGenerator[dict[str, Any], None]:
    """Async generator that yields task-status dicts from Redis Pub/Sub.

    Yields one dict per published message.  The generator runs until the caller
    stops iterating (typically because the WebSocket disconnected).  Redis
    resources are cleaned up in the ``finally`` block.

    Usage::

        async for payload in subscribe_task_updates(task_id):
            await websocket.send_json(payload)
    """
    import redis.asyncio as aioredis  # redis-py >= 4.x

    r: aioredis.Redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe(_channel(task_id))
    try:
        async for raw in pubsub.listen():
            if raw.get("type") != "message":
                continue
            try:
                yield json.loads(raw["data"])
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
    finally:
        try:
            await pubsub.unsubscribe(_channel(task_id))
        except Exception:  # noqa: BLE001
            pass
        try:
            await pubsub.aclose()
        except Exception:  # noqa: BLE001
            pass
        try:
            await r.aclose()
        except Exception:  # noqa: BLE001
            pass
