"""Bring the SQLite dev database up to the current models, without wiping it.

Alembic targets MySQL and cannot run against SQLite here (the early migrations
use `ALTER TABLE ... ADD CONSTRAINT`, which SQLite has no support for), so the
dev loop has always rebuilt from `create_all`. That is fine on day one and
painful later: a schema change meant `init_dev_db.py --fresh`, which throws away
every article, pin and comment you had been testing with.

This closes that gap. It does the two things `create_all` will not:

  * creates tables that do not exist yet (that part `create_all` does do), and
  * adds columns that are missing from tables that already exist.

Both are additive and idempotent — run it as often as you like. It deliberately
will NOT drop a column, narrow a type, or rename anything: those need a real
migration and a real decision, and silently destroying dev data to match a model
is exactly the behaviour this script exists to avoid.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.sync_dev_schema
    .venv/Scripts/python.exe -m scripts.sync_dev_schema --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault(
    "DATABASE_URL", f"sqlite:///{(BACKEND / 'var' / 'news-local.db').as_posix()}"
)

from sqlalchemy import inspect, text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402

import app.models  # noqa: E402,F401  — registers every table on the metadata


def _sql_literal(value: object) -> str:
    """Render a default as SQL.

    A bare enum name like ARTICLE has to be quoted or SQLite reads it as a
    column reference and the ALTER fails; a number or a function call such as
    CURRENT_TIMESTAMP(6) must not be.
    """
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    text_value = str(value)
    if text_value.startswith("'") or "(" in text_value:
        return text_value
    try:
        float(text_value)
    except ValueError:
        return "'" + text_value.replace("'", "''") + "'"
    return text_value


def column_ddl(column) -> str:
    """`ALTER TABLE ADD COLUMN` fragment for one model column.

    SQLite requires a non-null column to carry a default, so a NOT NULL column
    without one is added as nullable instead of failing the whole sync — the
    real MySQL migration is where that constraint is enforced properly.
    """
    kind = column.type.compile(dialect=engine.dialect)
    parts = [f'"{column.name}"', kind]

    default = None
    if column.server_default is not None:
        raw = getattr(column.server_default, "arg", None)
        default = _sql_literal(str(getattr(raw, "text", raw)))
    if column.default is not None and default is None:
        value = getattr(column.default, "arg", None)
        if value is not None and not callable(value):
            default = _sql_literal(value)

    if default is not None:
        parts.append(f"DEFAULT {default}")
    if not column.nullable and default is not None:
        parts.append("NOT NULL")
    return " ".join(parts)


def run(dry_run: bool = False) -> int:
    if settings.is_production:
        raise SystemExit("Refusing to touch a production schema. Use Alembic.")
    if not engine.dialect.name.startswith("sqlite"):
        raise SystemExit(
            f"This is the SQLite dev helper; {engine.dialect.name} uses Alembic migrations."
        )

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    new_tables = [t for name, t in Base.metadata.tables.items() if name not in existing_tables]
    if new_tables:
        print(f"new tables ({len(new_tables)}):")
        for table in new_tables:
            print(f"  + {table.name}")
        if not dry_run:
            Base.metadata.create_all(engine, tables=new_tables)

    added = 0
    with engine.begin() as connection:
        for name, table in Base.metadata.tables.items():
            if name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(name)}
            missing = [c for c in table.columns if c.name not in present]
            if not missing:
                continue
            print(f"{name}:")
            for column in missing:
                ddl = column_ddl(column)
                print(f"  + {ddl}")
                if not dry_run:
                    connection.execute(text(f'ALTER TABLE "{name}" ADD COLUMN {ddl}'))
                added += 1

    if not new_tables and not added:
        print("schema already matches the models — nothing to do")
    elif dry_run:
        print(f"\n(dry run) would create {len(new_tables)} tables and add {added} columns")
    else:
        print(f"\ncreated {len(new_tables)} tables, added {added} columns — data left untouched")
    return added


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print the changes, apply nothing")
    run(dry_run=parser.parse_args().dry_run)
