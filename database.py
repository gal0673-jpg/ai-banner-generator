"""SQLAlchemy engine, session factory, and FastAPI DB dependency."""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to your .env (e.g. mysql+pymysql://user:pass@localhost/dbname)."
    )

# Avoid hanging FastAPI/Celery forever when MySQL is down or unreachable (pymysql).
_connect_args: dict = {}
if "mysql" in DATABASE_URL or "pymysql" in DATABASE_URL:
    _connect_args["connect_timeout"] = 10
    # Prevent a wedged DB/socket from blocking every HTTP request indefinitely (e.g. login).
    _connect_args["read_timeout"] = 25
    _connect_args["write_timeout"] = 25

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args=_connect_args or {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
