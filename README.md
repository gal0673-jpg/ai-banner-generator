# Banner Generator — Python Backend

FastAPI backend for the AI-powered banner generation pipeline.

## Prerequisites

- Python 3.11+
- MySQL or PostgreSQL (see `requirements.txt` for driver options)
- [Redis](https://github.com/tporadowski/redis/releases) running on `127.0.0.1:6379` (Windows builds available at the linked releases page)

## Setup

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env` (or create `.env`) and fill in:

```
DATABASE_URL=mysql+pymysql://user:pass@localhost/banner_db
JWT_SECRET_KEY=<random-secret>
OPENAI_API_KEY=sk-...
```

## Running the API server

```bash
uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

## Running the Celery worker (required for banner generation)

Banner generation tasks are dispatched to a Celery queue backed by Redis.
The worker **must** be running alongside the API server for `/generate` requests to be processed.

> **Windows note:** CPython's default `prefork` pool is not compatible with Windows.
> You **must** use either the `gevent` or `solo` pool. `gevent` is recommended for
> concurrency; `solo` is simpler but processes only one task at a time.

### Option A — gevent pool (recommended, handles concurrent tasks)

```bash
pip install gevent
celery -A celery_app worker --loglevel=info -P gevent
```

### Option B — solo pool (simplest, single-task concurrency)

```bash
celery -A celery_app worker --loglevel=info -P solo
```

### Increasing concurrency (gevent only)

```bash
celery -A celery_app worker --loglevel=info -P gevent --concurrency=4
```

## Database migrations

```bash
# Initialise (first time only — already done if alembic/ folder exists)
alembic init alembic

# Generate a migration after model changes
alembic revision --autogenerate -m "describe change"

# Apply pending migrations
alembic upgrade head
```

## Architecture overview

```
Browser  →  FastAPI (/generate)  →  Redis queue  →  Celery worker
                                                         │
                                               run_banner_task()
                                               (crawl → AI pipeline → DB)
```

- The `/generate` endpoint creates a `BannerTask` row with `status="pending"` and
  enqueues `run_banner_task` via `.delay()`.
- The Celery worker picks up the task, runs the full crawl + AI pipeline, and
  updates the row status through `pending → scraped → generating_image → completed`
  (or `failed` on error).
- The frontend polls `/status/{task_id}` (or subscribes to the SSE stream at
  `/status/{task_id}/stream`) to track progress.
