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
from app.core.deps import Principal, get_optional_principal
from app.core.errors import NotFoundError
from app.core.redis_client import cache_get, cache_set
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article
from app.models.video import Video
from app.models.enums import HomeSectionKind, PinPlacement, TrendingScope
from app.repositories import article_repo, discovery_repo, site_repo
from app.services import trending_service
from app.schemas.public import (
    ArticleCardOut,
    ArticleDetailOut,
    AuthorOut,
    BreakingItemOut,
    CategoryFeedOut,
    CategoryOut,
    DistrictOut,
    EpaperTeaserOut,
    HomeOut,
    HomeSectionOut,
    LocalFeedOut,
    LocalityOut,
    LocationStateOut,
    LocationsOut,
    MandalOut,
    MediaOut,
    NavCategoryOut,
    SearchMetaOut,
    SearchResultsOut,
    SiteConfigOut,
    StateOut,
    TagOut,
    VideoRefOut,
)

router = APIRouter(prefix="/public", tags=["public"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _cache_headers(response: Response, ttl: int | None = None) -> None:
    """§10.1 — the CDN, not the database, absorbs the spike.

    The split matters: `stale-while-revalidate` in Cache-Control lets the
    READER'S BROWSER keep showing a five-minute-old front page after a publish
    or a section change, even though the server cache was purged. So browsers
    get `max-age=0, must-revalidate` (always fetch the current page — the Redis
    layer makes that cheap) while the edge keeps its s-maxage + SWR via
    CDN-Cache-Control, which Cloudflare/Fastly/CloudFront-class caches honor
    and browsers ignore.
    """
    ttl = ttl or settings.PUBLIC_CACHE_TTL_SECONDS
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    response.headers["CDN-Cache-Control"] = (
        f"public, s-maxage={ttl}, "
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
        category=CategoryOut.model_validate(article.category)
        if article.category
        else None,
        district=None,
        hero=None,
        byline_te=article.byline_te,
        is_breaking=article.is_breaking,
        is_exclusive=article.is_exclusive,
        ai_generated=article.ai_generated,
        published_at=article.published_at,
        reading_time_sec=article.reading_time_sec,
    )


def _cards(
    articles: list[Article], db: Session, districts: dict[int, Any]
) -> list[ArticleCardOut]:
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
        states=[StateOut.model_validate(s) for s in article_repo.active_states(db)],
        districts=[
            DistrictOut.model_validate(d) for d in article_repo.active_districts(db)
        ],
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
    mandal: str | None = Query(
        default=None,
        description="Mandal slug — adds the §3 'What's happening in your mandal?' block",
    ),
    db: Session = Depends(get_db),
) -> HomeOut:
    _cache_headers(response)
    # The mandal block varies the payload, so it has to vary the cache key too
    # — otherwise the first reader's mandal is served to the whole district.
    cache_key = f"home:{edition or 'all'}:{mandal or '-'}"
    cached = cache_get(cache_key)
    if cached:
        return HomeOut.model_validate(cached)

    districts = _district_map(db)
    edition_district = (
        article_repo.get_district_by_slug(db, edition) if edition else None
    )
    district_id = edition_district.id if edition_district else None

    # §9: active homepage pins occupy the top slots ahead of the latest pull.
    # The read predicate (`ends_at > now`) is what §1.3 demands — an expired
    # pin cannot hold the slot even for one request.
    pinned = discovery_repo.active_pins(db, placement=PinPlacement.HOME, limit=3)

    # The whole front page comes from one ordered pull, so a story never appears
    # in two blocks. Slice boundaries follow the broadsheet structure:
    #   [0]      lead
    #   [1:3]    secondary (thumb + headline)
    #   [3:9]    mid column (kicker + headline + byline)
    #   [9:17]   briefs — sized so the left column runs to roughly the same
    #            depth as the taller centre column and right rail
    top = article_repo.latest(
        db,
        limit=17,
        district_id=district_id,
        exclude_ids={a.id for a in pinned} or None,
    )
    if not top and not pinned and district_id is not None:
        # A young district edition can be empty; fall back to the national feed
        # rather than showing the reader a blank page.
        top = article_repo.latest(db, limit=17)

    top = pinned + top
    lead = top[0] if top else None
    secondary = top[1:3]
    mid_column = top[3:9]
    briefs = top[9:17]
    used = {a.id for a in top}

    # The latest rail is newest-first across everything, and deliberately does
    # NOT exclude the stories above: a reader scanning "just in" expects the
    # newest items regardless of where else they appear.
    latest = article_repo.latest(db, limit=8, district_id=district_id)

    # §24: the section list is admin-configured (order, count, enable) so the
    # front page changes without a deployment. An unseeded table falls back to
    # nav order so a fresh database still renders a full home page.
    sections: list[HomeSectionOut] = []
    configured = site_repo.homepage_sections(db)
    if configured:
        plans = [
            (
                s.kind,
                s.key,
                s.category.name_te if s.category else (s.title_te or s.key),
                s.category.name_en if s.category else s.title_en,
                s.category_id,
                s.item_count,
                s.min_items,
            )
            for s in configured
            if s.kind == HomeSectionKind.TRENDING
            or (
                s.kind == HomeSectionKind.CATEGORY
                and s.category is not None
                and s.category.is_active
            )
        ]
    else:
        plans = [
            (HomeSectionKind.CATEGORY, c.slug, c.name_te, c.name_en, c.id, 7, 3)
            for c in article_repo.nav_categories(db)
            if c.show_in_nav
        ]

    for kind, key, title_te, title_en, category_id, item_count, min_items in plans:
        if kind == HomeSectionKind.TRENDING:
            trending_service.ensure_fresh(db)
            items = discovery_repo.trending_articles(
                db, limit=item_count, exclude_ids=used
            )
        else:
            # §23: sections are independent blocks. A story may appear both in
            # the broadsheet top and inside its own section — hiding it there
            # would starve small sections and break the "every configured
            # section renders" contract.
            items = article_repo.latest(db, limit=item_count, category_id=category_id)
        # A section block with one story reads as broken rather than sparse, so
        # a section only earns a block once it has enough copy to fill one.
        if len(items) < max(min_items, 1):
            continue
        sections.append(
            HomeSectionOut(
                key=key,
                title_te=title_te,
                title_en=title_en,
                articles=_cards(items, db, districts),
            )
        )

    # §3 — "What's happening in your mandal?". Driven by the reader's saved
    # location, so it is absent for a reader who has not chosen one rather than
    # showing an arbitrary mandal.
    mandal_block: HomeSectionOut | None = None
    if mandal and edition_district is not None:
        mandal_row = next(
            (
                m
                for m in article_repo.mandals_for_district(db, edition_district.id)
                if m.slug == mandal
            ),
            None,
        )
        if mandal_row is not None:
            items = article_repo.latest(db, limit=6, mandal_id=mandal_row.id)
            if items:
                mandal_block = HomeSectionOut(
                    key=f"mandal-{mandal_row.slug}",
                    title_te=f"మీ మండలంలో ఏం జరుగుతోంది? · {mandal_row.name_te}",
                    title_en=f"What's happening in {mandal_row.name_en}?",
                    articles=_cards(items, db, districts),
                )

    from sqlalchemy import select
    from app.models.epaper import EpaperEdition
    from app.services import settings_service

    published_epaper = None
    if settings_service.get_bool(db, "epaper.enabled"):
        published_epaper = db.scalar(
            select(EpaperEdition)
            .where(
                EpaperEdition.edition_type == "DAILY",
                EpaperEdition.status == "PUBLISHED",
                EpaperEdition.edition_date <= utcnow().date(),
            )
            .order_by(EpaperEdition.edition_date.desc())
            .limit(1)
        )

    payload = HomeOut(
        edition=DistrictOut.model_validate(edition_district)
        if edition_district
        else None,
        mandal_block=mandal_block,
        lead=_cards([lead], db, districts)[0] if lead else None,
        secondary=_cards(secondary, db, districts),
        mid_column=_cards(mid_column, db, districts),
        briefs=_cards(briefs, db, districts),
        latest=_cards(latest, db, districts),
        breaking=_breaking_items(db),
        sections=sections,
        epaper=EpaperTeaserOut(
            edition_slug=published_epaper.edition_date.isoformat(),
            pub_date=published_epaper.edition_date.isoformat(),
            thumb_url=None,
            page_count=len(published_epaper.pages),
        )
        if published_epaper
        else None,
        generated_at=utcnow(),
    )
    cache_set(
        cache_key, payload.model_dump(mode="json"), settings.PUBLIC_CACHE_TTL_SECONDS
    )
    return payload


def _breaking_items(db: Session) -> list[BreakingItemOut]:
    """The ticker: stories pinned to the BREAKING slot first, then flagged
    stories that are still inside their window (§9).

    A pin is how an editor forces a story to the front of the ticker without
    re-flagging it, so pinned entries lead and duplicates are dropped.
    """
    pinned = discovery_repo.active_pins(db, placement=PinPlacement.BREAKING, limit=5)
    seen = {a.id for a in pinned}
    rest = [a for a in article_repo.breaking(db) if a.id not in seen]
    return [
        BreakingItemOut(
            short_id=a.short_id,
            title_te=a.title_te,
            title_en=a.title_en,
            url=a.url_path,
            published_at=a.published_at,
        )
        for a in (pinned + rest)[:8]
    ]


@router.get(
    "/breaking",
    response_model=list[BreakingItemOut],
    summary="Breaking-news ticker",
    description=(
        "Polled client-side every 20-30 s against this Redis-cached endpoint "
        "(§10.1) — never server-rendered per request."
    ),
)
def get_breaking(
    response: Response, db: Session = Depends(get_db)
) -> list[BreakingItemOut]:
    _cache_headers(response, ttl=settings.BREAKING_CACHE_TTL_SECONDS)
    cached = cache_get("breaking")
    if cached:
        return [BreakingItemOut.model_validate(i) for i in cached]

    items = _breaking_items(db)
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
    q: str | None = Query(
        default=None, min_length=2, max_length=120, description="Headline search"
    ),
    category: str | None = Query(default=None, description="Category slug"),
    district: str | None = Query(default=None, description="District slug"),
    mandal: str | None = Query(default=None, description="Mandal slug"),
    author: str | None = Query(default=None, description="Author slug"),
    tag: str | None = Query(default=None, description="Tag slug"),
    cursor: str | None = Query(
        default=None, description="Opaque cursor from `next_cursor`"
    ),
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
        raise NotFoundError(
            message_en="No such mandal.", message_te="ఆ మండలం కనిపించలేదు."
        )
    if author and author_row is None:
        raise NotFoundError(message_en="No such author.", message_te="ఆ రచయిత కనిపించలేదు.")
    if tag and tag_row is None:
        raise NotFoundError(message_en="No such topic.", message_te="ఆ అంశం కనిపించలేదు.")

    # §9 category-top pins lead the first page of a section feed.
    pinned: list[Article] = []
    if category_row is not None and cursor is None and not q:
        pinned = discovery_repo.active_pins(
            db, placement=PinPlacement.CATEGORY, category_id=category_row.id, limit=3
        )

    articles = article_repo.latest(
        db,
        limit=limit + 1,
        category_id=category_row.id if category_row else None,
        district_id=district_row.id if district_row else None,
        mandal_id=mandal_row.id if mandal_row else None,
        author_id=author_row.id if author_row else None,
        tag_id=tag_row.id if tag_row else None,
        exclude_ids={a.id for a in pinned} or None,
        before=_decode_cursor(cursor),
        query=q,
    )
    has_more = len(articles) > limit
    articles = pinned + articles[:limit]

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
    from app.services import poll_service

    attached_polls = poll_service.active_polls(db, article_id=article.id)

    author = None
    if article.author_id:
        from app.models.user import User

        user = db.get(User, article.author_id)
        if user is not None:
            author = AuthorOut.model_validate(user)

    return ArticleDetailOut(
        **card.model_dump(),
        like_count=article.like_count,
        comment_count=article.comment_count,
        share_count=article.share_count,
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
        poll=poll_service.serialize(attached_polls[0]) if attached_polls else None,
        video=_video_out(db, article),
    )


def _video_out(db: Session, article: Article) -> VideoRefOut | None:
    """The story's video, when it has one that is actually live.

    None means the reader page renders no video slot at all. An unpublished or
    deleted video is the same as no video — showing a dead embed would be
    worse than showing nothing.
    """
    if not article.video_id:
        return None
    video = db.get(Video, article.video_id)
    if video is None or not video.is_published or video.deleted_at is not None:
        return None
    return VideoRefOut(
        id=video.id,
        youtube_id=video.youtube_id,
        title_te=video.title_te,
        duration_sec=video.duration_sec or 0,
        embed_url=video.embed_url,
        watch_url=video.watch_url,
        thumbnail_url=video.thumbnail_url,
    )


# --------------------------------------------------------------------------- #
# trending (updated doc §8)
# --------------------------------------------------------------------------- #
@router.get(
    "/trending",
    response_model=CategoryFeedOut,
    summary="Trending stories — time-decayed engagement, unique readers",
    description=(
        "Scores fold the behaviour event stream with a 12-hour half-life decay "
        "and per-reader dedup (§8). `category` or `district` narrows to that "
        "scope's own trending list; a young site with no signals yet falls back "
        "to the latest feed rather than an empty page."
    ),
)
def get_trending(
    response: Response,
    category: str | None = Query(default=None, description="Category slug"),
    district: str | None = Query(default=None, description="District slug"),
    offset: int = Query(default=0, ge=0, le=200),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
) -> CategoryFeedOut:
    _cache_headers(response)
    cache_key = f"trending:{category or 'all'}:{district or 'all'}:{offset}:{limit}"
    cached = cache_get(cache_key)
    if cached:
        return CategoryFeedOut.model_validate(cached)

    category_row = article_repo.get_category_by_slug(db, category) if category else None
    district_row = article_repo.get_district_by_slug(db, district) if district else None
    if category and category_row is None:
        raise NotFoundError(
            message_en="No such section.", message_te="ఆ విభాగం కనిపించలేదు."
        )
    if district and district_row is None:
        raise NotFoundError(
            message_en="No such district.", message_te="ఆ జిల్లా కనిపించలేదు."
        )

    trending_service.ensure_fresh(db)
    if district_row is not None:
        scope, scope_id = TrendingScope.DISTRICT, district_row.id
    elif category_row is not None:
        scope, scope_id = TrendingScope.CATEGORY, category_row.id
    else:
        scope, scope_id = TrendingScope.GLOBAL, None

    articles = discovery_repo.trending_articles(
        db, scope_type=scope, scope_id=scope_id, limit=limit + 1, offset=offset
    )
    if not articles and offset == 0:
        articles = article_repo.latest(
            db,
            limit=limit + 1,
            category_id=category_row.id if category_row else None,
            district_id=district_row.id if district_row else None,
        )
    has_more = len(articles) > limit

    payload = CategoryFeedOut(
        category=CategoryOut.model_validate(category_row) if category_row else None,
        district=DistrictOut.model_validate(district_row) if district_row else None,
        articles=_cards(articles[:limit], db, _district_map(db)),
        next_cursor=str(offset + limit) if has_more else None,
    )
    cache_set(
        cache_key, payload.model_dump(mode="json"), settings.PUBLIC_CACHE_TTL_SECONDS
    )
    return payload


# --------------------------------------------------------------------------- #
# short news (updated doc §14)
# --------------------------------------------------------------------------- #
@router.get(
    "/short-news",
    response_model=CategoryFeedOut,
    summary="Quick-read cards — headline, image, 2–5 line summary",
    description=(
        "The §14 swipe feed. Cards are articles whose editorial standfirst "
        "(`summary_te`) exists; each opens the full story. `next_cursor` "
        "carries the offset for the next page."
    ),
)
def get_short_news(
    response: Response,
    category: str | None = Query(default=None, description="Category slug"),
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=15, ge=1, le=30),
    db: Session = Depends(get_db),
) -> CategoryFeedOut:
    _cache_headers(response)
    category_row = article_repo.get_category_by_slug(db, category) if category else None
    if category and category_row is None:
        raise NotFoundError(
            message_en="No such section.", message_te="ఆ విభాగం కనిపించలేదు."
        )

    rows = article_repo.short_news(
        db,
        limit=limit + 1,
        offset=offset,
        category_id=category_row.id if category_row else None,
    )
    has_more = len(rows) > limit
    return CategoryFeedOut(
        category=CategoryOut.model_validate(category_row) if category_row else None,
        district=None,
        articles=_cards(rows[:limit], db, _district_map(db)),
        next_cursor=str(offset + limit) if has_more else None,
    )


# --------------------------------------------------------------------------- #
# search (updated doc §10)
# --------------------------------------------------------------------------- #
@router.get(
    "/search",
    response_model=SearchResultsOut,
    summary="Full search with filters",
    description=(
        "Headline/content search with category, district, author, tag and date "
        "filters. MySQL FULLTEXT with relevance ordering; every query is logged "
        "(fire-and-forget) to power popular/recent searches."
    ),
)
def search_articles(
    response: Response,
    q: str = Query(min_length=2, max_length=120),
    category: str | None = Query(default=None, description="Category slug"),
    district: str | None = Query(default=None, description="District slug"),
    author: str | None = Query(default=None, description="Author slug"),
    tag: str | None = Query(default=None, description="Tag slug"),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> SearchResultsOut:
    # Results depend on who is asking only via the log, so the response itself
    # stays edge-cacheable for anonymous readers.
    _cache_headers(response, ttl=30)

    category_row = article_repo.get_category_by_slug(db, category) if category else None
    district_row = article_repo.get_district_by_slug(db, district) if district else None
    author_row = article_repo.get_author_by_slug(db, author) if author else None
    tag_row = article_repo.get_tag_by_slug(db, tag) if tag else None

    articles, total = article_repo.search(
        db,
        q=q,
        limit=limit,
        offset=offset,
        category_id=category_row.id if category_row else None,
        district_id=district_row.id if district_row else None,
        author_id=author_row.id if author_row else None,
        tag_id=tag_row.id if tag_row else None,
        date_from=date_from,
        date_to=date_to,
    )

    try:
        site_repo.log_search(
            db,
            query=q,
            results_count=total,
            user_id=principal.id if principal else None,
        )
    except Exception:  # noqa: BLE001 — the log must never break the search
        pass

    next_offset = offset + limit if offset + limit < total else None
    return SearchResultsOut(
        query=q,
        total=total,
        articles=_cards(articles, db, _district_map(db)),
        next_offset=next_offset,
    )


@router.get(
    "/search/meta",
    response_model=SearchMetaOut,
    summary="Popular and (when signed in) recent searches",
)
def search_meta(
    response: Response,
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> SearchMetaOut:
    if principal is None:
        # Popular terms are shared; a reader's own history must never be cached
        # at the edge, so the header is only sent on the anonymous variant.
        _cache_headers(response, ttl=300)
        cached = cache_get("search:meta")
        if cached:
            return SearchMetaOut.model_validate(cached)

    popular = site_repo.popular_searches(db)
    recent = site_repo.recent_searches(db, user_id=principal.id) if principal else []
    payload = SearchMetaOut(popular=popular, recent=recent)
    if principal is None:
        cache_set("search:meta", payload.model_dump(mode="json"), 300)
    return payload


# --------------------------------------------------------------------------- #
# locations (updated doc §4) — the selector tree and the local feed
# --------------------------------------------------------------------------- #
@router.get(
    "/locations",
    response_model=LocationsOut,
    summary="Location hierarchy: states with their districts",
    description="Mandals and localities load on demand via the nested routes.",
)
def get_locations(response: Response, db: Session = Depends(get_db)) -> LocationsOut:
    _cache_headers(response, ttl=3600)
    cached = cache_get("locations")
    if cached:
        return LocationsOut.model_validate(cached)

    districts = article_repo.active_districts(db)
    states = []
    for state in article_repo.active_states(db):
        states.append(
            LocationStateOut(
                **StateOut.model_validate(state).model_dump(),
                districts=[
                    DistrictOut.model_validate(d)
                    for d in districts
                    if d.state == state.code
                ],
            )
        )
    payload = LocationsOut(states=states)
    cache_set("locations", payload.model_dump(mode="json"), 3600)
    return payload


@router.get(
    "/locations/mandals/{mandal_id}/localities",
    response_model=list[LocalityOut],
    summary="Cities/villages under a mandal",
)
def get_localities(
    mandal_id: int, response: Response, db: Session = Depends(get_db)
) -> list[LocalityOut]:
    _cache_headers(response, ttl=3600)
    return [
        LocalityOut.model_validate(loc)
        for loc in article_repo.localities_for_mandal(db, mandal_id)
    ]


@router.get(
    "/locations/{district_slug}/mandals",
    response_model=list[MandalOut],
    summary="Mandals of a district",
)
def get_district_mandals(
    district_slug: str, response: Response, db: Session = Depends(get_db)
) -> list[MandalOut]:
    _cache_headers(response, ttl=3600)
    district = article_repo.get_district_by_slug(db, district_slug)
    if district is None:
        raise NotFoundError(
            message_en="No such district.", message_te="ఆ జిల్లా కనిపించలేదు."
        )
    return [
        MandalOut.model_validate(m)
        for m in article_repo.mandals_for_district(db, district.id)
    ]


@router.get(
    "/local",
    response_model=LocalFeedOut,
    summary="Local feed — exact location first, then parent levels",
    description=(
        "The §4 hierarchy feed: stories for the selected locality/mandal rank "
        "above district-wide stories, newest-first within each tier."
    ),
)
def local_feed(
    response: Response,
    district: str = Query(description="District slug (required anchor of the feed)"),
    mandal: str | None = Query(default=None, description="Mandal slug"),
    locality: str | None = Query(
        default=None, description="Locality slug within the mandal"
    ),
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
) -> LocalFeedOut:
    _cache_headers(response)

    district_row = article_repo.get_district_by_slug(db, district)
    if district_row is None:
        raise NotFoundError(
            message_en="No such district.", message_te="ఆ జిల్లా కనిపించలేదు."
        )

    mandal_row = None
    if mandal:
        mandal_row = next(
            (
                m
                for m in article_repo.mandals_for_district(db, district_row.id)
                if m.slug == mandal
            ),
            None,
        )
        if mandal_row is None:
            raise NotFoundError(
                message_en="No such mandal.", message_te="ఆ మండలం కనిపించలేదు."
            )

    locality_row = None
    if locality and mandal_row is not None:
        locality_row = next(
            (
                loc
                for loc in article_repo.localities_for_mandal(db, mandal_row.id)
                if loc.slug == locality
            ),
            None,
        )

    # §9 local-top pins lead the first page of the district feed.
    pinned: list[Article] = []
    if offset == 0:
        pinned = discovery_repo.active_pins(
            db, placement=PinPlacement.LOCAL, district_id=district_row.id, limit=3
        )

    articles = article_repo.local_feed(
        db,
        district_id=district_row.id,
        mandal_id=mandal_row.id if mandal_row else None,
        locality_id=locality_row.id if locality_row else None,
        limit=limit + 1,
        offset=offset,
    )
    has_more = len(articles) > limit
    pinned_ids = {a.id for a in pinned}
    articles = pinned + [a for a in articles[:limit] if a.id not in pinned_ids]

    state_row = article_repo.get_state_by_code(db, district_row.state)
    return LocalFeedOut(
        state=StateOut.model_validate(state_row) if state_row else None,
        district=DistrictOut.model_validate(district_row),
        mandal=MandalOut.model_validate(mandal_row) if mandal_row else None,
        locality=LocalityOut.model_validate(locality_row) if locality_row else None,
        articles=_cards(articles, db, _district_map(db)),
        next_offset=offset + limit if has_more else None,
    )
