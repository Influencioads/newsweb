"""Replace generated demo art with real, freely-licensed photographs.

Pulls topic-matched images from Wikimedia Commons through the existing
integration (licence-filtered to commercial-safe works) and runs every byte
through the real media pipeline — resize to the §7.4 widths, WebP, blurhash,
storage provider — exactly as an editor's upload would. Credit and licence
label land on the media row, satisfying §12.5.

Idempotent: an article whose hero is already a stock photo is skipped, so
re-runs only fill gaps.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.fetch_real_media
"""

from __future__ import annotations

import sys

# Windows consoles default to cp1252; Telugu titles and arrows must not crash a run.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import os
import re

os.environ.setdefault("DATABASE_URL", "sqlite:///./var/news-local.db")

from sqlalchemy import select

from app.core.config import settings
from app.db.session import session_scope
from app.integrations.images.wikimedia import WikimediaSource
from app.models.content import Article
from app.models.enums import ArticleStatus
from app.models.media import Media
from app.models.user import User
from app.services import media_service

#: Category-level fallbacks when a headline query finds nothing on Commons.
CATEGORY_QUERIES: dict[str, str] = {
    "national": "India parliament building",
    "world": "United Nations flags",
    "politics": "Andhra Pradesh legislative assembly",
    "cinema": "cinema film camera",
    "sports": "cricket stadium India",
    "business": "Hyderabad financial district",
    "jobs": "Hyderabad IT office building",
    "health": "hospital India doctors",
    "lifestyle": "Indian handloom sarees",
    "travel": "Araku Valley Andhra Pradesh",
    "food": "Andhra cuisine thali",
    "crime": "Indian police vehicle",
    "devotional": "Tirumala temple",
    "inspiring": "village library India",
    "zero-to-hero": "athletics track India",
    "best-deals": "Indian bazaar market",
    "andhra-pradesh": "Amaravati Andhra Pradesh",
    "telangana": "Charminar Hyderabad",
}
DEFAULT_QUERY = "India news city"

_STOP = {
    "the", "a", "an", "of", "for", "and", "in", "on", "to", "with", "new",
    "its", "as", "at", "by", "from", "over", "after", "into", "out", "up",
    "rs", "crore", "lakh", "per", "cent", "today", "begins", "released",
    "announced", "approved", "expanded", "set", "next", "first", "phase",
}


def _title_query(title_en: str | None) -> str | None:
    if not title_en:
        return None
    words = [
        w for w in re.findall(r"[A-Za-z]{3,}", title_en)
        if w.lower() not in _STOP
    ]
    if len(words) < 2:
        return None
    return " ".join(words[:3])


def _license_label(code: str, version: str | None) -> str:
    if code == "cc0":
        return "CC0 (public domain)"
    label = f"CC {code.upper().replace('BY-SA', 'BY-SA')}"
    return f"{label} {version}".strip() if version else label


def run() -> None:
    source = WikimediaSource()
    replaced = 0
    skipped = 0
    failed: list[str] = []

    with session_scope() as db:
        editor = db.execute(
            select(User).where(User.email == "srinivas@seed.example.com")
        ).scalar_one_or_none()
        articles = list(
            db.execute(
                select(Article).where(
                    Article.status == ArticleStatus.PUBLISHED,
                    Article.deleted_at.is_(None),
                )
            ).unique().scalars()
        )

        for article in articles:
            current = db.get(Media, article.hero_media_id) if article.hero_media_id else None
            if current is not None and current.source_type == "stock":
                skipped += 1
                continue

            category_slug = article.category.slug if article.category else "default"
            queries = []
            title_q = _title_query(article.title_en)
            if title_q:
                queries.append(title_q)
            queries.append(CATEGORY_QUERIES.get(category_slug, DEFAULT_QUERY))

            picked = None
            for query in queries:
                results = source.search(query, limit=3)
                if results:
                    # Rotate within category fallbacks so ten "jobs" stories do
                    # not all carry the same photograph.
                    picked = results[(article.id + len(query)) % len(results)]
                    break
            if picked is None:
                failed.append(article.short_id)
                continue

            try:
                raw = source.download(picked)
                ext = picked.image_url.rsplit(".", 1)[-1].lower()
                mime = {
                    "jpg": "image/jpeg", "jpeg": "image/jpeg",
                    "png": "image/png", "webp": "image/webp",
                }.get(ext, "image/jpeg")
                creator = picked.creator or "Wikimedia Commons"
                media = media_service.create_image_media(
                    db,
                    raw=raw,
                    filename=f"{article.slug[:40]}.{ext if ext in ('jpg','jpeg','png','webp') else 'jpg'}",
                    mime=mime,
                    max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
                    uploaded_by=editor.id if editor else None,
                    alt_te=article.title_te[:500],
                    caption_te=None,
                    credit=f"{creator} / Wikimedia Commons",
                    source_type="stock",
                )
                media.copyright = _license_label(picked.license_code, picked.license_version)
                media.meta = {
                    "landing_url": picked.landing_url,
                    "provider": picked.provider,
                    "original_title": picked.title,
                }
                article.hero_media_id = media.id
                replaced += 1
                print(f"  {article.short_id}  <-  {picked.title[:60]}")
            except Exception as exc:  # noqa: BLE001 — a bad file must not stop the run
                failed.append(article.short_id)
                print(f"  {article.short_id}  FAILED: {exc}")

    print(f"\nreal photos set: {replaced} · already stock: {skipped} · failed: {len(failed)}")
    if failed:
        print("no image found for:", ", ".join(failed))


if __name__ == "__main__":
    run()
