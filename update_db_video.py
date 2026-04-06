#!/usr/bin/env python3
"""
One-off MySQL migration: add banner_tasks.video_url.

Usage (from project root, with DATABASE_URL in .env):
  python update_db_video.py

Requires: pymysql, python-dotenv, sqlalchemy (for URL parsing).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


def main() -> None:
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        print("DATABASE_URL is not set in .env", file=sys.stderr)
        sys.exit(1)

    from sqlalchemy.engine.url import make_url

    try:
        url = make_url(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"Invalid DATABASE_URL: {exc}", file=sys.stderr)
        sys.exit(1)

    if not url.drivername.startswith("mysql"):
        print(
            "This script expects a MySQL DATABASE_URL "
            "(e.g. mysql+pymysql://user:pass@localhost/dbname).",
            file=sys.stderr,
        )
        sys.exit(1)

    import pymysql

    conn = pymysql.connect(
        host=url.host or "localhost",
        port=url.port or 3306,
        user=url.username,
        password=url.password or "",
        database=url.database,
        charset="utf8mb4",
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                "ALTER TABLE banner_tasks ADD COLUMN video_url VARCHAR(1024) NULL"
            )
        conn.commit()
        print("OK: added column banner_tasks.video_url")
    except pymysql.err.OperationalError as e:
        conn.rollback()
        # MySQL: 1060 = ER_DUP_FIELDNAME (Duplicate column name)
        if e.args and e.args[0] == 1060:
            print("Column video_url already exists; nothing to do.")
            return
        print(f"MySQL error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
