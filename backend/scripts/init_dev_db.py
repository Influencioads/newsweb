"""Create (or recreate) the local SQLite development database and seed it.

Local development runs without Docker: SQLite stands in for MySQL (the code
supports both — see app/db/session.py) and Redis-backed features degrade to
their dev fallbacks. Production/staging use MySQL with Alembic migrations;
this script exists only for the dependency-free local loop.

Usage (from backend/):
    .venv/Scripts/python.exe scripts/init_dev_db.py            # create if missing + seed
    .venv/Scripts/python.exe scripts/init_dev_db.py --fresh    # delete and rebuild

`--fresh` is needed after a schema change: SQLite gets no ALTER TABLE support
from create_all, and everything in this database is reproducible seed data.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DB_PATH = Path(__file__).resolve().parents[1] / "var" / "news-local.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_PATH.as_posix()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fresh", action="store_true", help="delete the DB file first")
    parser.add_argument(
        "--no-demo", action="store_true", help="seed reference data only (no demo accounts/articles)"
    )
    args = parser.parse_args()

    if args.fresh and DB_PATH.exists():
        try:
            DB_PATH.unlink()
        except PermissionError:
            print(
                f"Cannot delete {DB_PATH}: the dev server has it open. "
                "Stop scripts/run_dev.py first, then re-run --fresh.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        print(f"deleted {DB_PATH}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Imports come after DATABASE_URL is pinned — settings cache on first import.
    import app.models  # noqa: F401 — load every model into the metadata
    from app.db.base import Base
    from app.db.seed import run
    from app.db.session import engine

    Base.metadata.create_all(engine)
    print(f"schema ready at {DB_PATH}")
    run(include_demo=not args.no_demo)


if __name__ == "__main__":
    main()
