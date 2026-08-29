"""Engine, session factory, and the FastAPI request-scoped session dependency.

Transaction policy (brief §31): one transaction per request. The dependency
commits on success and rolls back on any exception, so a service can never leave
a half-written workflow transition behind.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import BigInteger, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_is_sqlite = settings.sqlalchemy_url.startswith("sqlite")


@compiles(BigInteger, "sqlite")
def _compile_bigint_for_sqlite(_type, _compiler, **_kw):  # type: ignore[no-untyped-def]
    """SQLite only autoincrements a primary key declared exactly as INTEGER."""
    return "INTEGER"


_engine_options = {
    "pool_pre_ping": True,
    "echo": settings.DB_ECHO,
    "future": True,
}
if _is_sqlite:
    _engine_options["connect_args"] = {"check_same_thread": False}
else:
    _engine_options.update(
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_recycle=settings.DB_POOL_RECYCLE,
    )

engine: Engine = create_engine(settings.sqlalchemy_url, **_engine_options)


@event.listens_for(engine, "connect")
def _set_session_defaults(dbapi_connection, _connection_record) -> None:  # type: ignore[no-untyped-def]
    """Force UTC and strict mode on every pooled connection.

    Without this a developer's local `sql_mode` decides whether a too-long Telugu
    headline is truncated silently or raises — production must always raise.
    """
    if _is_sqlite:
        return
    with dbapi_connection.cursor() as cur:
        cur.execute(
            "SET SESSION time_zone = '+00:00', "
            "sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO'"
        )


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one transaction per request."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Transactional scope for workers and scripts (no FastAPI request)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
