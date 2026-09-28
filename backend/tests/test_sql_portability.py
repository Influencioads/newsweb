"""SQL this codebase emits must run on MySQL, which is what production uses.

The tests run on SQLite, so a MySQL-only syntax error passes every suite and
then 500s on the deployed database. `NULLS LAST` is exactly that: SQLite and
Postgres accept it, MySQL has never parsed it, and it silently took out the
crawl rewrite selector, the CMS ingest queue and the KYC review queue at once.
"""

from __future__ import annotations

import pathlib

from sqlalchemy import select
from sqlalchemy.dialects import mysql

from app.db.base import desc_nulls_last
from app.models.ingestion import IngestedItem

APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def test_the_helper_compiles_without_nulls_last_on_mysql() -> None:
    stmt = select(IngestedItem.id).order_by(
        *desc_nulls_last(IngestedItem.published_at), IngestedItem.id.desc()
    )
    sql = str(stmt.compile(dialect=mysql.dialect()))
    assert "NULLS LAST" not in sql.upper()
    assert "IS NULL" in sql.upper()


def test_no_module_reaches_for_nullslast_again() -> None:
    offenders = [
        str(path.relative_to(APP))
        for path in APP.rglob("*.py")
        # `db/base.py` names it in the docstring explaining why not to use it.
        if path != APP / "db" / "base.py"
        and any(
            token in path.read_text(encoding="utf-8")
            for token in (".nullslast(", ".nullsfirst(")
        )
    ]
    assert not offenders, (
        f"{offenders} emit NULLS LAST/FIRST, which MySQL rejects — "
        "use app.db.base.desc_nulls_last instead"
    )
