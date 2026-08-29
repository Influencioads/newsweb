"""Replace generated placeholder art with real, licensed photographs.

Why this exists rather than "just download news photos": press photographs on a
news site belong to an agency or a staff photographer, and §12.5 requires a
licence and a credit for anything that is not our own. Copying another
publisher's images would ship unlicensed work.

So images come from Openverse, filtered to commercially reusable licences, and
the licence and creator are written into `media.credit` / `media.copyright`
automatically. Every photo that lands in the database is therefore attributable
on sight, which is what §12.5's "enforce at the DB level" means in practice.

    python -m app.db.seed_photos            # fill articles that have no photo yet
    python -m app.db.seed_photos --replace  # swap out the generated placeholders
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.db.session import session_scope
from app.integrations.images import StockImage, get_image_source
from app.models.content import Article
from app.models.media import ArticleMedia, Media
from app.services import media_service, tiptap

logger = get_logger("seed.photos")

#: Search terms per article. Written by hand because an automatic query built
#: from a Telugu headline returns noise — a picture desk chooses the subject,
#: and this is the seed-data stand-in for that judgement.
ARTICLE_QUERIES: dict[str, tuple[str, ...]] = {
    "x7Kp2m": ("Amaravati Andhra Pradesh", "Andhra Pradesh Secretariat", "Vijayawada"),
    "b3Nq8t": ("Visakhapatnam industry", "Visakhapatnam Steel Plant", "Visakhapatnam"),
    "k9Rt4w": ("Srikakulam", "monsoon Andhra Pradesh", "flood India"),
    "m2Vc7h": ("Hyderabad Metro Rail", "Hyderabad Metro station", "Hyderabad"),
    "p5Jd1x": ("Araku Valley", "Parvathipuram", "tribal Andhra Pradesh"),
    "t8Ln3q": ("Rajiv Gandhi International Cricket Stadium", "cricket stadium India", "Hyderabad"),
    "f4Wz9b": ("Ramoji Film City", "cinema hall India", "Telugu cinema"),
    "x2Fd91": ("sugarcane India", "Anakapalli", "sugarcane field"),
    "n6Hs2k": ("chilli India", "Khammam", "Guntur chilli"),
    "c1Bg7v": ("Kadapa", "steel plant India", "Rayalaseema"),
    "r7Yt5n": ("Polavaram dam", "Godavari River", "Godavari bridge"),
    "v3Mq6p": ("Visakhapatnam Port", "port India", "Visakhapatnam harbour"),
    "g8Kr2d": ("National Highway India", "highway Andhra Pradesh", "road India"),
    "h3Nm7c": ("paddy field Andhra Pradesh", "agriculture India", "farmer India"),
    "j9Pw4t": ("HITEC City", "Hyderabad IT", "Cyberabad"),
    "q4Lz8m": ("power transmission India", "electricity India", "thermal power station India"),
    "s2Vx6r": ("Warangal", "Kakatiya Medical College", "hospital India"),
    "u5Cd3j": ("athletics India", "stadium Hyderabad", "sports India"),
    "w8Bn1f": ("film shooting India", "Telugu film", "movie camera"),
    "y1Gk9s": ("Bay of Bengal beach", "Srikakulam beach", "Andhra Pradesh coast"),
    "z6Hq4l": ("school India classroom", "government school India", "students India"),
    "a9Tr2v": ("Hyderabad Metro construction", "Hyderabad flyover", "Hyderabad city"),
    "b7Dm5x": ("Kakinada port", "aquaculture India", "fishing harbour India"),
    "c3Fj8w": ("Vijayawada", "Krishna River Andhra Pradesh", "Andhra Pradesh"),
}

#: Fallbacks by category, used when a headline's own terms return nothing.
CATEGORY_FALLBACK: dict[str, tuple[str, ...]] = {
    "andhra-pradesh": ("Andhra Pradesh", "Vijayawada", "Visakhapatnam"),
    "telangana": ("Telangana", "Hyderabad", "Charminar"),
    "national": ("New Delhi", "Parliament House India", "India Gate"),
    "business": ("industry India", "market India", "factory India"),
    "sports": ("stadium India", "cricket India", "sports India"),
    "cinema": ("Telugu cinema", "film India", "theatre India"),
    "default": ("Andhra Pradesh", "India landscape", "Telangana"),
}

MIN_WIDTH = 800
MAX_SOURCE_BYTES = 12 * 1024 * 1024


def _pick(source, queries: tuple[str, ...], want: int) -> list[StockImage]:
    """Try each query in turn until enough usable images are collected."""
    picked: list[StockImage] = []
    seen: set[str] = set()
    for query in queries:
        if len(picked) >= want:
            break
        for image in source.search(query, limit=want * 2):
            if image.external_id in seen:
                continue
            # Skip anything too small to serve as a 1600px hero.
            if image.width and image.width < MIN_WIDTH:
                continue
            seen.add(image.external_id)
            picked.append(image)
            if len(picked) >= want:
                break
    return picked


def _store(
    db: Session, article: Article, image: StockImage, caption: str
) -> Media | None:
    source = get_image_source()
    try:
        raw = source.download(image)
    except Exception as exc:  # noqa: BLE001 - one bad photo must not stop the run
        logger.warning("photo_download_failed", url=image.image_url[:80], error=str(exc))
        return None

    if len(raw) > MAX_SOURCE_BYTES:
        logger.warning("photo_too_large", bytes=len(raw))
        return None

    try:
        media = media_service.create_image_media(
            db,
            raw=raw,
            filename=f"{(article.slug[:36] or 'photo')}.jpg",
            mime="image/jpeg",
            max_bytes=MAX_SOURCE_BYTES,
            uploaded_by=article.created_by,
            alt_te=caption,
            caption_te=caption,
            # §12.5: credit is mandatory when the image is not our own, and the
            # service refuses the write without one.
            credit=image.attribution,
            source_type="licensed",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("photo_process_failed", title=image.title[:50], error=str(exc))
        return None

    # Keep the full licence trail so an audit can reconstruct provenance.
    media.copyright = image.license_label
    media.meta = {
        "source": image.source,
        "provider": image.provider,
        "external_id": image.external_id,
        "title": image.title,
        "creator": image.creator,
        "license": image.license_code,
        "license_version": image.license_version,
        "license_url": image.license_url,
        "landing_url": image.landing_url,
    }
    return media


def _import_for_article(
    article_id: int, replace: bool, gallery_size: int
) -> tuple[int, int, int]:
    """Import photos for one article, in its own transaction.

    One transaction per article, deliberately: an import that downloads ~100
    files over a slow network will hit a failure somewhere, and a single
    wrapping transaction would throw away every successful article alongside the
    one that broke.
    """
    source = get_image_source()
    heroes = inline = gallery = 0

    with session_scope() as db:
        article = db.get(Article, article_id)
        if article is None or article.deleted_at is not None:
            return (0, 0, 0)

        cat = article.category.slug if article.category else "default"
        queries = ARTICLE_QUERIES.get(
            article.short_id, CATEGORY_FALLBACK.get(cat, CATEGORY_FALLBACK["default"])
        )

        candidates = _pick(source, queries, 2 + gallery_size)
        if not candidates:
            logger.warning("no_photos_found", short_id=article.short_id)
            return (0, 0, 0)

        if replace:
            # Only retire the placeholders once we know replacements exist —
            # otherwise a failed lookup would leave the article with no image.
            links = list(
                db.execute(
                    select(ArticleMedia).where(ArticleMedia.article_id == article.id)
                ).scalars()
            )
            for link in links:
                stale = db.get(Media, link.media_id)
                if stale is not None and stale.deleted_at is None:
                    media_service.delete_media(db, stale)
                db.delete(link)
            article.hero_media_id = None
            db.flush()

        # --- hero ----------------------------------------------------------
        if article.hero_media_id is None and candidates:
            image = candidates.pop(0)
            media = _store(db, article, image, image.title or article.title_te)
            if media is not None:
                article.hero_media_id = media.id
                db.add(
                    ArticleMedia(
                        article_id=article.id, media_id=media.id, role="hero", sort=0
                    )
                )
                heroes += 1

        # --- inline body figure ---------------------------------------------
        has_inline = db.execute(
            select(ArticleMedia).where(
                ArticleMedia.article_id == article.id, ArticleMedia.role == "inline"
            )
        ).first()
        if not has_inline and candidates:
            image = candidates.pop(0)
            caption = image.title or article.title_te
            media = _store(db, article, image, caption)
            if media is not None:
                db.add(
                    ArticleMedia(
                        article_id=article.id, media_id=media.id, role="inline", sort=0
                    )
                )
                from app.db.seed_media import _figure_node

                body = dict(article.body or {"type": "doc", "content": []})
                content = [
                    n for n in (body.get("content") or []) if n.get("type") != "figure"
                ]
                content.insert(
                    1 if len(content) > 1 else len(content), _figure_node(media, caption)
                )
                body["content"] = content

                # Derived columns are always recomputed, never hand-edited.
                clean, plain, html, words, reading = tiptap.derive(body)
                article.body = clean
                article.body_plain = plain
                article.body_html = html
                article.word_count = words
                article.reading_time_sec = reading
                inline += 1

        # --- gallery ---------------------------------------------------------
        has_gallery = db.execute(
            select(ArticleMedia).where(
                ArticleMedia.article_id == article.id, ArticleMedia.role == "gallery"
            )
        ).first()
        if not has_gallery:
            for i, image in enumerate(candidates[:gallery_size]):
                media = _store(db, article, image, image.title or article.title_te)
                if media is not None:
                    db.add(
                        ArticleMedia(
                            article_id=article.id,
                            media_id=media.id,
                            role="gallery",
                            sort=i,
                        )
                    )
                    gallery += 1

    return (heroes, inline, gallery)


def run(replace: bool = False, gallery_size: int = 2) -> None:
    if settings.is_production:
        raise RuntimeError("Refusing to run the demo photo importer in production")

    configure_logging(settings.LOG_LEVEL, settings.LOG_JSON)

    with session_scope() as db:
        article_ids = [
            row
            for row in db.execute(
                select(Article.id)
                .where(Article.deleted_at.is_(None))
                .order_by(Article.id)
            ).scalars()
        ]

    heroes = inline = gallery = failed = 0
    for index, article_id in enumerate(article_ids, start=1):
        try:
            h, i, g = _import_for_article(article_id, replace, gallery_size)
            heroes += h
            inline += i
            gallery += g
        except Exception as exc:  # noqa: BLE001 - keep going, report at the end
            failed += 1
            logger.error("article_photo_import_failed", article_id=article_id, error=str(exc))
        print(f"  [{index}/{len(article_ids)}] hero={heroes} inline={inline} gallery={gallery}",
              flush=True)

    print()
    print(f"Licensed photos imported: hero={heroes} inline={inline} gallery={gallery}")
    if failed:
        print(f"Articles that failed entirely: {failed}")
    print("Every image carries creator + licence in `media.credit` / `media.copyright`.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import licensed photographs for demo articles")
    parser.add_argument(
        "--replace", action="store_true", help="remove generated placeholders first"
    )
    parser.add_argument("--gallery", type=int, default=2, help="gallery images per article")
    args = parser.parse_args()
    if settings.is_production:
        print("Refusing to run in production", file=sys.stderr)
        raise SystemExit(2)
    run(replace=args.replace, gallery_size=args.gallery)
