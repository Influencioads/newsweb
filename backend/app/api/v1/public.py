"""Public reader endpoints (§13 "Public (cached, no auth)").

    GET /public/config                     GET /public/home?edition=
    GET /public/articles?category=&district=&cursor=
    GET /public/articles/{short_id}        GET /public/breaking

Caching (§10.1): responses are cached in Redis and carry
`Cache-Control: s-maxage / stale-while-revalidate`, so an edge cache or the
bundled nginx config absorbs a breaking-news spike instead of MySQL. Publishing
an article purges the affected keys.
"""

from __future__ import annotations

import base64
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import NotFoundError
from app.core.redis_client import cache_get, cache_set
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article
from app.repositories import article_repo
from app.schemas.public import (
    ArticleCardOut,
    ArticleDetailOut,
    AuthorOut,
    BreakingItemOut,
    CategoryFeedOut,
    CategoryOut,
    DistrictOut,
    HomeOut,
    HomeSectionOut,
    MediaOut,
    NavCategoryOut,
    SiteConfigOut,
    TagOut,
)

router = APIRouter(prefix="/public", tags=["public"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _cache_headers(response: Response, ttl: int | None = None) -> None:
    """§10.1 — the CDN, not the database, absorbs the spike."""
    ttl = ttl or settings.PUBLIC_CACHE_TTL_SECONDS
    response.headers["Cache-Control"] = (
        f"public, max-age=0, s-maxage={ttl}, "
        f"stale-while-revalidate={settings.PUBLIC_CACHE_SWR_SECONDS}"
    )


def _media_out(media: Any) -> MediaOut | None:
    if media is None:
        return None
    from app.services.media_service import srcset_for

    return MediaOut(
        id=media.id,
        url=media.cdn_url,
        srcset=srcset_for(media) or None,
        alt_te=media.alt_te,
        caption_te=media.caption_te,
        credit=media.credit,
        license_label=media.copyright,
        source_url=(media.meta or {}).get("landing_url"),
        width=media.width,
        height=media.height,
        blurhash=media.blurhash,
        ai_generated=media.ai_generated,
    )


def _card(article: Article) -> ArticleCardOut:
    """Base card. District and hero are attached by `_cards`, which has the
    district lookup table and can batch the media reads."""
    return ArticleCardOut(
        short_id=article.short_id,
        slug=article.slug,
        url=article.url_path,
        title_te=article.title_te,
        title_en=article.title_en,
        summary_te=article.summary_te,
        category=CategoryOut.model_validate(article.category) if article.category else None,
        district=None,
        hero=None,
        byline_te=article.byline_te,
        is_breaking=article.is_breaking,
        is_exclusive=article.is_exclusive,
        ai_generated=article.ai_generated,
        published_at=article.published_at,
        reading_time_sec=article.reading_time_sec,
    )


def _cards(articles: list[Article], db: Session, districts: dict[int, Any]) -> list[ArticleCardOut]:
    """Project articles to cards, resolving districts and hero media in bulk."""
    from app.models.media import Media

    hero_ids = {a.hero_media_id for a in articles if a.hero_media_id}
    media_by_id: dict[int, Media] = {}
    if hero_ids:
        # One query for the whole page rather than one per card.
        from sqlalchemy import select as _select

        media_by_id = {
            m.id: m
            for m in db.execute(_select(Media).where(Media.id.in_(hero_ids))).scalars()
        }

    out: list[ArticleCardOut] = []
    for a in articles:
        card = _card(a)
        if a.district_id and a.district_id in districts:
            card.district = DistrictOut.model_validate(districts[a.district_id])
        if a.hero_media_id:
            card.hero = _media_out(media_by_id.get(a.hero_media_id))
        out.append(card)
    return out


def _district_map(db: Session) -> dict[int, Any]:
    return {d.id: d for d in article_repo.active_districts(db)}


def _encode_cursor(dt: datetime) -> str:
    return base64.urlsafe_b64encode(dt.isoformat().encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> datetime | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        return datetime.fromisoformat(base64.urlsafe_b64decode(padded).decode())
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------- #
# routes
# --------------------------------------------------------------------------- #
@router.get(
    "/config",
    response_model=SiteConfigOut,
    summary="Masthead, navigation and edition list",
    description="Everything the reader shell needs on first paint. Cached aggressively.",
)
def get_config(response: Response, db: Session = Depends(get_db)) -> SiteConfigOut:
    _cache_headers(response, ttl=300)
    return SiteConfigOut(
        site_name_te="టాప్ తెలుగు న్యూస్",
        site_name_en="Top Telugu News",
        categories=[
            NavCategoryOut.model_validate(c) for c in article_repo.nav_categories(db)
        ],
        districts=[DistrictOut.model_validate(d) for d in article_repo.active_districts(db)],
    )


@router.get(
    "/home",
    response_model=HomeOut,
    summary="Home page payload",
    description=(
        "The whole of mockup 1b in one request: lead story, secondary stories, "
        "briefs, breaking ticker and per-section rails.\n\n"
        "`edition` filters the page to a district edition (§10.2); the reader's "
        "choice is persisted client-side."
    ),
)
def get_home(
    response: Response,
    edition: str | None = Query(
        default=None, description="District slug, e.g. `visakhapatnam`"
    ),
    db: Session = Depends(get_db),
) -> HomeOut:
    _cache_headers(response)
    cache_key = f"home:{edition or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return HomeOut.model_validate(cached)

    districts = _district_map(db)
    edition_district = article_repo.get_district_by_slug(db, edition) if edition else None
    district_id = edition_district.id if edition_district else None

    # The whole front page comes from one ordered pull, so a story never appears
    # in two blocks. Slice boundaries follow the broadsheet structure:
    #   [0]      lead
    #   [1:3]    secondary (thumb + headline)
    #   [3:9]    mid column (kicker + headline + byline)
    #   [9:17]   briefs — sized so the left column runs to roughly the same
    #            depth as the taller centre column and right rail
    top = article_repo.latest(db, limit=17, district_id=district_id)
    if not top and district_id is not None:
        # A young district edition can be empty; fall back to the national feed
        # rather than showing the reader a blank page.
        top = article_repo.latest(db, limit=17)

    lead = top[0] if top else None
    secondary = top[1:3]
    mid_column = top[3:9]
    briefs = top[9:17]
    used = {a.id for a in top}

    # The latest rail is newest-first across everything, and deliberately does
    # NOT exclude the stories above: a reader scanning "just in" expects the
    # newest items regardless of where else they appear.
    latest = article_repo.latest(db, limit=8, district_id=district_id)

    sections: list[HomeSectionOut] = []
    for category in article_repo.nav_categories(db):
        if not category.show_in_nav:
            continue
        items = article_repo.latest(
            db, limit=7, category_id=category.id, exclude_ids=used
        )
        # A section block with one story reads as broken rather than sparse, so
        # a section only earns a block once it has enough copy to fill one.
        if len(items) < 3:
            continue
        used |= {a.id for a in items}
        sections.append(
            HomeSectionOut(
                key=category.slug,
                title_te=category.name_te,
                title_en=category.name_en,
                articles=_cards(items, db, districts),
            )
        )

    payload = HomeOut(
        edition=DistrictOut.model_validate(edition_district) if edition_district else None,
        lead=_cards([lead], db, districts)[0] if lead else None,
        secondary=_cards(secondary, db, districts),
        mid_column=_cards(mid_column, db, districts),
        briefs=_cards(briefs, db, districts),
        latest=_cards(latest, db, districts),
        breaking=[
            BreakingItemOut(
                short_id=a.short_id,
                title_te=a.title_te,
                title_en=a.title_en,
                url=a.url_path,
                published_at=a.published_at,
            )
            for a in article_repo.breaking(db)
        ],
        sections=sections,
        generated_at=utcnow(),
    )
    cache_set(cache_key, payload.model_dump(mode="json"), settings.PUBLIC_CACHE_TTL_SECONDS)
    return payload


@router.get(
    "/breaking",
    response_model=list[BreakingItemOut],
    summary="Breaking-news ticker",
    description=(
        "Polled client-side every 20-30 s against this Redis-cached endpoint "
        "(§10.1) — never server-rendered per request."
    ),
)
def get_breaking(response: Response, db: Session = Depends(get_db)) -> list[BreakingItemOut]:
    _cache_headers(response, ttl=settings.BREAKING_CACHE_TTL_SECONDS)
    cached = cache_get("breaking")
    if cached:
        return [BreakingItemOut.model_validate(i) for i in cached]

    items = [
        BreakingItemOut(
            short_id=a.short_id,
            title_te=a.title_te,
            title_en=a.title_en,
            url=a.url_path,
            published_at=a.published_at,
        )
        for a in article_repo.breaking(db)
    ]
    cache_set(
        "breaking",
        [i.model_dump(mode="json") for i in items],
        settings.BREAKING_CACHE_TTL_SECONDS,
    )
    return items


@router.get(
    "/articles",
    response_model=CategoryFeedOut,
    summary="Article feed, filtered by category or district",
    description="Cursor paginated (§13). Only published, non-deleted articles are ever returned.",
)
def list_articles(
    response: Response,
    q: str | None = Query(default=None, min_length=2, max_length=120, description="Headline search"),
    category: str | None = Query(default=None, description="Category slug"),
    district: str | None = Query(default=None, description="District slug"),
    mandal: str | None = Query(default=None, description="Mandal slug"),
    author: str | None = Query(default=None, description="Author slug"),
    tag: str | None = Query(default=None, description="Tag slug"),
    cursor: str | None = Query(default=None, description="Opaque cursor from `next_cursor`"),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
) -> CategoryFeedOut:
    _cache_headers(response)

    category_row = article_repo.get_category_by_slug(db, category) if category else None
    district_row = article_repo.get_district_by_slug(db, district) if district else None
    mandal_row = article_repo.get_mandal_by_slug(db, mandal) if mandal else None
    author_row = article_repo.get_author_by_slug(db, author) if author else None
    tag_row = article_repo.get_tag_by_slug(db, tag) if tag else None
    if category and category_row is None:
        raise NotFoundError(
            message_en="No such section.", message_te="ఆ విభాగం కనిపించలేదు."
        )
    if district and district_row is None:
        raise NotFoundError(
            message_en="No such district.", message_te="ఆ జిల్లా కనిపించలేదు."
        )
    if mandal and mandal_row is None:
        raise NotFoundError(message_en="No such mandal.", message_te="ఆ మండలం కనిపించలేదు.")
    if author and author_row is None:
        raise NotFoundError(message_en="No such author.", message_te="ఆ రచయిత కనిపించలేదు.")
    if tag and tag_row is None:
        raise NotFoundError(message_en="No such topic.", message_te="ఆ అంశం కనిపించలేదు.")

    articles = article_repo.latest(
        db,
        limit=limit + 1,
        category_id=category_row.id if category_row else None,
        district_id=district_row.id if district_row else None,
        mandal_id=mandal_row.id if mandal_row else None,
        author_id=author_row.id if author_row else None,
        tag_id=tag_row.id if tag_row else None,
        before=_decode_cursor(cursor),
        query=q,
    )
    has_more = len(articles) > limit
    articles = articles[:limit]

    next_cursor = None
    if has_more and articles and articles[-1].published_at:
        next_cursor = _encode_cursor(articles[-1].published_at)

    return CategoryFeedOut(
        category=CategoryOut.model_validate(category_row) if category_row else None,
        district=DistrictOut.model_validate(district_row) if district_row else None,
        articles=_cards(articles, db, _district_map(db)),
        next_cursor=next_cursor,
    )


@router.get(
    "/articles/{short_id}",
    response_model=ArticleDetailOut,
    summary="Single article",
    description=(
        "Returns the Tiptap JSON body — the renderer turns it into React on web "
        "and native components in the app (§11), so there is no HTML round trip.\n\n"
        "A draft, scheduled or unpublished article returns 404 here; the CMS "
        "preview route is the only way to see unapproved copy."
    ),
    responses={404: {"description": "NOT_FOUND — no published article with that id"}},
)
def get_article(
    short_id: str, response: Response, db: Session = Depends(get_db)
) -> ArticleDetailOut:
    _cache_headers(response)

    article = article_repo.get_by_short_id(db, short_id)
    if article is None:
        raise NotFoundError(
            message_en="That article is not available.",
            message_te="ఆ కథనం అందుబాటులో లేదు.",
        )

    districts = _district_map(db)
    card = _cards([article], db, districts)[0]

    author = None
    if article.author_id:
        from app.models.user import User

        user = db.get(User, article.author_id)
        if user is not None:
            author = AuthorOut.model_validate(user)

    return ArticleDetailOut(
        **card.model_dump(),
        sub_title_te=article.sub_title_te,
        body=article.body,
        author=author,
        tags=[TagOut.model_validate(at.tag) for at in article.tags if at.tag],
        source_credit=article.source_credit,
        word_count=article.word_count,
        updated_at=article.updated_at,
        corrected_at=article.corrected_at,
        correction_note_te=article.correction_note_te,
        seo_title=article.seo_title,
        seo_description=article.seo_description,
        canonical_url=article.canonical_url,
        gallery=[
            m
            for m in (
                _media_out(row) for row in article_repo.gallery_media(db, article.id)
            )
            if m is not None
        ],
        related=_cards(article_repo.related(db, article), db, districts),
    )
