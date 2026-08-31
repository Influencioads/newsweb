"""Alembic environment.

The database URL comes from `app.core.config`, never from alembic.ini, so there
is exactly one place credentials are read from (§3, brief §35).

`app.db.registry` imports every model module; importing it here is what makes
`--autogenerate` see the full schema.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.base import Base
from app.db import registry as _registry  # noqa: F401  (imports all models)
from app.db import session as _session  # noqa: F401 (registers SQLite BIGINT -> INTEGER compiler)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url)

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to) -> bool:  # type: ignore[no-untyped-def]
    """Keep autogenerate focused on our own tables."""
    if type_ == "table" and name in {"alembic_version"}:
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=settings.sqlalchemy_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    if connectable.dialect.name == "sqlite":
        from sqlalchemy import event

        @event.listens_for(connectable, "before_cursor_execute", retval=True)
        def _sqlite_rewrite(conn, cursor, statement, parameters, context, executemany):  # type: ignore[no-untyped-def]
            statement = statement.replace("CURRENT_TIMESTAMP(6)", "CURRENT_TIMESTAMP")
            return statement, parameters

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=_include_object,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
