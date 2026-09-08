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
from app.models.content import Article, ArticleSearchAlias, ArticleTag, Category, Tag
from app.models.enums import ArticleStatus
from app.models.geo import District, Locality, Mandal, State
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
    locality_id: int | None = None,
    state_code: str | None = None,
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
    if locality_id is not None:
        stmt = stmt.where(Article.locality_id == locality_id)
    if state_code is not None:
        stmt = stmt.join(District, District.id == Article.district_id).where(
            District.state == state_code
        )
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
    three-day-old 'breaking' banner destroys the signal.

    §9 duration control: `breaking_until` is the editor's explicit end time and
    wins when set. `hours` remains the fallback for rows published before the
    column existed, so an old story cannot become permanently breaking.
    """
    from datetime import timedelta

    now = utcnow()
    since = now - timedelta(hours=hours)
    stmt = (
        published_query()
        .where(
            Article.is_breaking.is_(True),
            or_(
                Article.breaking_until > now,
                and_(Article.breaking_until.is_(None), Article.published_at >= since),
            ),
        )
        .order_by(Article.published_at.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).unique().scalars())


def related(db: Session, article: Article, *, limit: int = 3) -> list[Article]:
    """Related stories for the article page (mockup 1c).

    §14 similarity, in descending order of how much it actually means:

      1. shared tags, most overlap first — two stories tagged "అమరావతి" +
         "రాజధాని" are about the same thing, which sharing a category is not
      2. same category
      3. same district
      4. simply recent, so the block is never empty on a young site
    """
    from sqlalchemy import func

    picked: list[Article] = []
    seen = {article.id}

    # --- 1. tag overlap -----------------------------------------------------
    tag_ids = [link.tag_id for link in article.tags]
    if tag_ids:
        overlap = (
            select(ArticleTag.article_id, func.count(ArticleTag.tag_id).label("shared"))
            .where(ArticleTag.tag_id.in_(tag_ids), ArticleTag.article_id != article.id)
            .group_by(ArticleTag.article_id)
            .order_by(func.count(ArticleTag.tag_id).desc())
            .limit(limit * 4)
            .subquery()
        )
        stmt = (
            published_query()
            .join(overlap, overlap.c.article_id == Article.id)
            .order_by(overlap.c.shared.desc(), Article.published_at.desc())
            .limit(limit)
        )
        for a in db.execute(stmt).unique().scalars():
            if a.id not in seen:
                picked.append(a)
                seen.add(a.id)

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


def local_feed(
    db: Session,
    *,
    district_id: int,
    mandal_id: int | None = None,
    locality_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Article]:
    """The updated doc's §4 rule: exact location first, then parent levels.

    One query, ordered by a specificity rank (locality > mandal > district)
    and then recency, so a village story outranks a district story of the same
    age but a stale exact match cannot bury today's district news forever —
    within each tier it is still newest-first. Offset paging keeps the tiers
    stable across pages.
    """
    from sqlalchemy import case

    tiers = []
    if locality_id is not None:
        tiers.append((Article.locality_id == locality_id, 3))
    if mandal_id is not None:
        tiers.append((Article.mandal_id == mandal_id, 2))
    tiers.append((Article.district_id == district_id, 1))

    rank = case(*tiers, else_=0).label("locality_rank")
    stmt = (
        published_query()
        .add_columns(rank)
        .where(or_(*[cond for cond, _ in tiers]))
        .order_by(rank.desc(), Article.published_at.desc(), Article.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [row[0] for row in db.execute(stmt).unique()]


def search(
    db: Session,
    *,
    q: str,
    limit: int = 20,
    offset: int = 0,
    category_id: int | None = None,
    district_id: int | None = None,
    author_id: int | None = None,
    tag_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> tuple[list[Article], int]:
    """Reader search (updated doc §10): headline/content, filterable.

    MySQL uses the FULLTEXT index over (title_te, title_en, body_plain) in
    natural-language mode; any other dialect (SQLite dev) falls back to LIKE
    across the same fields. Transliterated aliases are always OR-ed in so an
    English spelling of a Telugu name still hits. Returns (rows, total).
    """
    from sqlalchemy import distinct, func, literal_column, text

    term = q.strip()
    stmt = published_query()
    count_stmt = select(func.count(distinct(Article.id))).where(and_(*published_filter()))

    alias_match = Article.id.in_(
        select(ArticleSearchAlias.article_id).where(
            ArticleSearchAlias.alias.ilike(f"%{term}%")
        )
    )

    if db.get_bind().dialect.name == "mysql":
        match = text(
            "MATCH(articles.title_te, articles.title_en, articles.body_plain) "
            "AGAINST(:ft_q IN NATURAL LANGUAGE MODE)"
        ).bindparams(ft_q=term)
        predicate = or_(match, alias_match)
        # Relevance first, freshness as the tiebreaker.
        order = [literal_column("ft_score").desc(), Article.published_at.desc()]
        stmt = stmt.add_columns(match.label("ft_score"))
    else:
        like = f"%{term}%"
        predicate = or_(
            Article.title_te.ilike(like),
            Article.title_en.ilike(like),
            Article.summary_te.ilike(like),
            Article.body_plain.ilike(like),
            alias_match,
        )
        order = [Article.published_at.desc(), Article.id.desc()]

    filters = [predicate]
    if category_id is not None:
        filters.append(Article.category_id == category_id)
    if district_id is not None:
        filters.append(Article.district_id == district_id)
    if author_id is not None:
        filters.append(Article.author_id == author_id)
    if tag_id is not None:
        tag_subq = select(ArticleTag.article_id).where(ArticleTag.tag_id == tag_id)
        filters.append(Article.id.in_(tag_subq))
    if date_from is not None:
        filters.append(Article.published_at >= date_from)
    if date_to is not None:
        filters.append(Article.published_at <= date_to)

    stmt = stmt.where(*filters).order_by(*order).limit(limit).offset(offset)
    count_stmt = count_stmt.where(*filters)

    rows = [row[0] for row in db.execute(stmt).unique()]
    total = int(db.execute(count_stmt).scalar() or 0)
    return rows, total


def short_news(
    db: Session, *, limit: int = 20, offset: int = 0, category_id: int | None = None
) -> list[Article]:
    """Quick-read feed (updated doc §14): stories carrying the ~40-word
    standfirst (`summary_te`), newest first. The summary is written or reviewed
    in the newsroom, so this feed inherits editorial approval by construction."""
    stmt = (
        published_query()
        .where(Article.summary_te.is_not(None), Article.summary_te != "")
        .order_by(Article.published_at.desc(), Article.id.desc())
        .limit(limit)
        .offset(offset)
    )
    if category_id is not None:
        stmt = stmt.where(Article.category_id == category_id)
    return list(db.execute(stmt).unique().scalars())


def active_states(db: Session) -> list[State]:
    stmt = select(State).where(State.is_active.is_(True)).order_by(State.sort, State.id)
    return list(db.execute(stmt).scalars())


def get_state_by_code(db: Session, code: str) -> State | None:
    return db.execute(
        select(State).where(State.code == code.upper(), State.is_active.is_(True))
    ).scalar_one_or_none()


def mandals_for_district(db: Session, district_id: int) -> list[Mandal]:
    stmt = (
        select(Mandal)
        .where(Mandal.district_id == district_id, Mandal.is_active.is_(True))
        .order_by(Mandal.name_en)
    )
    return list(db.execute(stmt).scalars())


def localities_for_mandal(db: Session, mandal_id: int) -> list[Locality]:
    stmt = (
        select(Locality)
        .where(Locality.mandal_id == mandal_id, Locality.is_active.is_(True))
        .order_by(Locality.name_en)
    )
    return list(db.execute(stmt).scalars())


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
