"""Article read paths.

Every public query funnels through `published_filter()`. That is the single
place the "readers only ever see approved, published, non-deleted copy" rule is
expressed, so no feature file can forget it and leak a draft.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db.base import utcnow
from app.models.content import Article, ArticleTag, Category, Tag
from app.models.enums import ArticleStatus
from app.models.geo import District, Mandal
from app.models.user import User


def published_filter() -> list:
    """The reader-visibility predicate. Never bypass this on a public path."""
    now = utcnow()
    return [
        Article.status == ArticleStatus.PUBLISHED,
        Article.deleted_at.is_(None),
        Article.published_at.is_not(None),
        Article.published_at <= now,
        or_(Article.expires_at.is_(None), Article.expires_at > now),
    ]


def _with_relations(stmt: Select) -> Select:
    return stmt.options(
        joinedload(Article.category),
        selectinload(Article.tags),
    )


def published_query() -> Select:
    return _with_relations(select(Article).where(and_(*published_filter())))


def latest(
    db: Session,
    *,
    limit: int = 20,
    offset: int = 0,
    category_id: int | None = None,
    district_id: int | None = None,
    mandal_id: int | None = None,
    author_id: int | None = None,
    tag_id: int | None = None,
    exclude_ids: set[int] | None = None,
    before: datetime | None = None,
    query: str | None = None,
) -> list[Article]:
    stmt = published_query()
    if category_id is not None:
        stmt = stmt.where(Article.category_id == category_id)
    if district_id is not None:
        stmt = stmt.where(Article.district_id == district_id)
    if mandal_id is not None:
        stmt = stmt.where(Article.mandal_id == mandal_id)
    if author_id is not None:
        stmt = stmt.where(Article.author_id == author_id)
    if tag_id is not None:
        stmt = stmt.join(ArticleTag, ArticleTag.article_id == Article.id).where(ArticleTag.tag_id == tag_id)
    if exclude_ids:
        stmt = stmt.where(Article.id.notin_(exclude_ids))
    if before is not None:
        stmt = stmt.where(Article.published_at < before)
    if query:
        term = f"%{query.strip()}%"
        stmt = stmt.where(
            or_(
                Article.title_te.ilike(term),
                Article.title_en.ilike(term),
                Article.summary_te.ilike(term),
            )
        )
    stmt = stmt.order_by(Article.published_at.desc(), Article.id.desc()).limit(limit).offset(offset)
    return list(db.execute(stmt).unique().scalars())


def get_by_short_id(db: Session, short_id: str) -> Article | None:
    stmt = published_query().where(Article.short_id == short_id)
    return db.execute(stmt).unique().scalar_one_or_none()


def breaking(db: Session, *, limit: int = 5, hours: int = 24) -> list[Article]:
    """Breaking ticker source (mockup 1b). Kept short and time-bounded — a
    three-day-old 'breaking' banner destroys the signal."""
    from datetime import timedelta

    since = utcnow() - timedelta(hours=hours)
    stmt = (
        published_query()
        .where(Article.is_breaking.is_(True), Article.published_at >= since)
        .order_by(Article.published_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).unique().scalars())


def related(db: Session, article: Article, *, limit: int = 3) -> list[Article]:
    """Related stories for the article page (mockup 1c).

    Category first, then same district, then simply recent — so the block is
    never empty on a young site.
    """
    picked: list[Article] = []
    seen = {article.id}

    for predicate in (
        Article.category_id == article.category_id if article.category_id else None,
        Article.district_id == article.district_id if article.district_id else None,
        None,
    ):
        if len(picked) >= limit:
            break
        stmt = published_query().where(Article.id.notin_(seen))
        if predicate is not None:
            stmt = stmt.where(predicate)
        stmt = stmt.order_by(Article.published_at.desc()).limit(limit - len(picked))
        for a in db.execute(stmt).unique().scalars():
            if a.id not in seen:
                picked.append(a)
                seen.add(a.id)

    return picked[:limit]


def count_published(db: Session) -> int:
    from sqlalchemy import func

    return int(
        db.execute(select(func.count(Article.id)).where(and_(*published_filter()))).scalar() or 0
    )


def nav_categories(db: Session) -> list[Category]:
    stmt = (
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.sort, Category.id)
    )
    return list(db.execute(stmt).scalars())


def active_districts(db: Session) -> list[District]:
    stmt = (
        select(District)
        .where(District.is_active.is_(True))
        .order_by(District.state, District.sort, District.id)
    )
    return list(db.execute(stmt).scalars())


def get_category_by_slug(db: Session, slug: str) -> Category | None:
    return db.execute(
        select(Category).where(Category.slug == slug, Category.is_active.is_(True))
    ).scalar_one_or_none()


def get_district_by_slug(db: Session, slug: str) -> District | None:
    return db.execute(
        select(District).where(District.slug == slug, District.is_active.is_(True))
    ).scalar_one_or_none()


def get_mandal_by_slug(db: Session, slug: str) -> Mandal | None:
    return db.execute(select(Mandal).where(Mandal.slug == slug, Mandal.is_active.is_(True))).scalar_one_or_none()


def get_author_by_slug(db: Session, slug: str) -> User | None:
    return db.execute(select(User).where(User.author_slug == slug, User.is_author.is_(True), User.deleted_at.is_(None))).scalar_one_or_none()


def get_tag_by_slug(db: Session, slug: str) -> Tag | None:
    return db.execute(select(Tag).where(Tag.slug == slug, Tag.is_active.is_(True))).scalar_one_or_none()


def gallery_media(db: Session, article_id: int) -> list:
    """Gallery images for an article, in the order the desk arranged them.

    `article_media.role` distinguishes hero / inline / gallery, so the gallery
    strip never re-shows the hero or an image already placed in the body.
    """
    from app.models.media import ArticleMedia, Media

    stmt = (
        select(Media)
        .join(ArticleMedia, ArticleMedia.media_id == Media.id)
        .where(
            ArticleMedia.article_id == article_id,
            ArticleMedia.role == "gallery",
            Media.deleted_at.is_(None),
        )
        .order_by(ArticleMedia.sort, Media.id)
    )
    return list(db.execute(stmt).scalars())
