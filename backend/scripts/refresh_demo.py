"""Make an ageing demo database look live again.

Demo fixtures are dated relative to when they were seeded, and several
surfaces are deliberately time-bounded: the breaking ticker only shows the
last 24 hours (§1.3), trending decays over 48 (§8), analytics reports the
last 7 days (§25). A dev database left alone for a few days therefore goes
quiet — every one of those is the product behaving correctly, but it makes a
demo look broken.

This re-bases the demo articles onto the current clock, keeping their
relative spacing, and refreshes the synthetic reader activity behind
trending and analytics. Nothing here runs in production: demo rows are the
only ones touched, and the seeder refuses to write them there at all.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.refresh_demo
"""

from __future__ import annotations

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.environ.setdefault("DATABASE_URL", "sqlite:///./var/news-local.db")

from datetime import timedelta

from sqlalchemy import delete, func, select

from app.core.config import settings
from app.db.base import utcnow
from app.db.seed import seed_demo_events
from app.db.session import session_scope
from app.models.content import Article
from app.models.engagement import ArticleEvent
from app.models.enums import ArticleStatus
from app.services import trending_service


def run() -> None:
    if settings.is_production:
        raise SystemExit("Refusing to re-date content in production.")

    with session_scope() as db:
        newest = db.execute(
            select(func.max(Article.published_at)).where(
                Article.status == ArticleStatus.PUBLISHED
            )
        ).scalar()
        if newest is None:
            print("no published articles — run scripts/init_dev_db.py first")
            return

        # Shift everything by the same delta so the newest story lands a few
        # minutes ago and the rest keep their original spacing (and ordering).
        shift = (utcnow() - timedelta(minutes=5)) - newest
        if shift <= timedelta(0):
            print("demo content is already current")
        else:
            articles = list(
                db.execute(
                    select(Article).where(Article.status == ArticleStatus.PUBLISHED)
                ).unique().scalars()
            )
            for article in articles:
                for field in ("published_at", "first_published_at", "approved_at"):
                    value = getattr(article, field, None)
                    if value is not None:
                        setattr(article, field, value + shift)
            print(f"re-dated {len(articles)} articles forward by {shift.days}d "
                  f"{shift.seconds // 3600}h")

        # Behaviour events are cheaper to regenerate than to shift.
        db.execute(delete(ArticleEvent))
        db.flush()
        events = seed_demo_events(db)
        print(f"reseeded {events} reader events")

    with session_scope() as db:
        scored = trending_service.compute_trending(db)
        print(f"trending recomputed over {scored} articles")

    print("\nDemo refreshed — breaking ticker, trending and analytics are live again.")


if __name__ == "__main__":
    run()
