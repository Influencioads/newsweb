"""Poll every due content source once (updated doc §17).

Meant for cron or Celery Beat, every five minutes. Each source has its own
`fetch_interval_minutes`, and the fetcher sends ETag / If-Modified-Since, so a
frequent schedule costs 304s rather than bandwidth — running this often is
cheaper for the publisher than running it rarely and pulling everything.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.run_ingestion
    .venv/Scripts/python.exe -m scripts.run_ingestion --source lokmat-times
"""

from __future__ import annotations

import argparse
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.environ.setdefault("DATABASE_URL", "sqlite:///./var/news-local.db")

from app.db.session import session_scope  # noqa: E402
from app.services import ingestion_service  # noqa: E402


def run(only_slug: str | None = None) -> None:
    with session_scope() as db:
        results = ingestion_service.run_all(db, only_slug=only_slug)
        if not results:
            print("no sources are due")
            return
        for result in results:
            line = f"  {result['source']:24s} {result['status']:16s}"
            if "new" in result:
                line += f" seen={result.get('seen', 0):3d} new={result['new']:3d}"
            if result.get("error"):
                line += f"  {result['error'][:70]}"
            print(line)
        print(f"\n{sum(r.get('new', 0) for r in results)} new items across "
              f"{len(results)} sources")

    with session_scope() as db:
        counts = ingestion_service.queue_counts(db)
        print(f"queue: {counts}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="slug of a single source to poll")
    run(parser.parse_args().source)
