"""Generated editions: page plans, the slot filler, editing, workflow, PDF.

An edition is N pages; a page is a layout of slots (`epaper_layouts`); a slot
holds one published story. "Recommend articles that fit" is `_fill_slots`: it
walks the empty slots of a page biggest first and gives each the best-ranked
story that is big enough for it, preferring the page's own categories, then
anything left in the day's pool. Generation, per-page refill and personal
editions all go through it, so they cannot disagree about what fits.
"""

from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, NamedTuple
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.fonts import telugu_shaping_available
from app.core.logging import get_logger
from app.db.base import utcnow
from app.db.session import session_scope
from app.integrations.storage import get_storage
from app.models.audio import AudioAsset
from app.models.content import Article, Category
from app.models.enums import ArticleStatus, AudioStatus
from app.models.epaper import (
    EpaperAsset,
    EpaperEdition,
    EpaperPage,
    EpaperPageArticle,
    EpaperPageTemplate,
    EpaperUserEdition,
)
from app.models.geo import District
from app.models.media import Media
from app.schemas.epaper import (
    CandidateOut,
    EpaperArticleOut,
    EpaperEditionOut,
    EpaperPageOut,
    PageCreateIn,
    PlanOut,
    SlotOut,
    TemplatePlanOut,
)
from app.services import epaper_pdf, media_service, settings_service
from app.services.epaper_layouts import (
    OVERFLOW_LAYOUT,
    SIZE_RANK,
    size_class,
    size_rank,
    slot_count,
    slots_for,
)

logger = get_logger(__name__)

IST = ZoneInfo("Asia/Kolkata")

MAX_PAGES = 24
#: Body characters a clip carries; the clip view links to the full story.
BODY_CHARS = 8000
#: Pages past the section templates take whatever the day still has.
OVERFLOW_TITLE = "మరిన్ని వార్తలు"
SHAPING_UNAVAILABLE = "Telugu shaping unavailable: install libfribidi0"

#: (slug, title_te, title_en, category slugs, layout). Slugs must exist in
#: `app.db.seed_content.CATEGORIES`; a template with no categories draws from
#: the whole day. The layout decides how many stories the page holds.
DEFAULT_TEMPLATES: tuple[tuple[str, str, str, list[str], str], ...] = (
    ("front-page", "మొదటి పేజీ", "Front Page", [], "lead_grid"),
    ("national", "జాతీయం", "National", ["national"], "three_column"),
    ("world", "అంతర్జాతీయం", "International", ["world"], "three_column"),
    ("politics", "రాజకీయం", "Politics", ["politics"], "two_column"),
    ("telangana", "తెలంగాణ", "Telangana", ["telangana"], "lead_grid"),
    ("andhra-pradesh", "ఆంధ్రప్రదేశ్", "Andhra Pradesh", ["andhra-pradesh"], "lead_grid"),
    ("districts", "జిల్లాలు", "Districts", ["districts"], "briefs"),
    (
        "business-jobs",
        "వ్యాపారం & ఉద్యోగాలు",
        "Business & Jobs",
        ["business", "jobs"],
        "two_column",
    ),
    ("cinema", "సినిమా", "Cinema", ["cinema"], "image_lead"),
    ("sports", "క్రీడలు", "Sports", ["sports"], "image_lead"),
    ("health", "ఆరోగ్యం", "Health", ["health"], "two_column"),
    ("lifestyle", "లైఫ్‌స్టైల్", "Lifestyle", ["lifestyle", "travel", "food"], "two_column"),
    ("crime", "క్రైమ్", "Crime", ["crime"], "three_column"),
    ("inspiring", "స్ఫూర్తి", "Inspiring", ["inspiring", "zero-to-hero"], "lead_grid"),
    ("opinion", "అభిప్రాయం", "Opinion", ["opinion"], "two_column"),
    ("big-question", "బిగ్ క్వశ్చన్", "Big Question", [], "breaking"),
)


def ensure_templates(
    db: Session, actor_id: int | None = None
) -> list[EpaperPageTemplate]:
    rows = list(
        db.scalars(select(EpaperPageTemplate).order_by(EpaperPageTemplate.sort))
    )
    if rows:
        return rows
    categories = {c.slug: c.id for c in db.scalars(select(Category)).all()}
    for sort, (slug, te, en, category_slugs, layout) in enumerate(DEFAULT_TEMPLATES, 1):
        ids = [categories[s] for s in category_slugs if s in categories]
        db.add(
            EpaperPageTemplate(
                slug=slug,
                title_te=te,
                title_en=en,
                sort=sort,
                category_ids=ids,
                layout_type=layout,
                created_by=actor_id,
                updated_by=actor_id,
            )
        )
    db.flush()
    return list(
        db.scalars(select(EpaperPageTemplate).order_by(EpaperPageTemplate.sort))
    )


def template_row(template: EpaperPageTemplate) -> dict[str, Any]:
    return {
        "id": template.id,
        "slug": template.slug,
        "title_te": template.title_te,
        "title_en": template.title_en,
        "sort": template.sort,
        "category_ids": list(template.category_ids or []),
        "layout_type": template.layout_type,
        "slot_count": slot_count(template.layout_type),
        "is_visible": template.is_visible,
    }


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=IST).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def ranked_articles(
    db: Session,
    day: date,
    category_ids: list[int] | None = None,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[Article]:
    """Published stories for `day`, best first.

    Public because the audio bulletin wants exactly this ordering — breaking,
    then featured, then what readers actually read — over a narrower window
    than a whole day. `since`/`until` default to the IST day bounds, so every
    existing caller behaves identically.
    """
    start, end = _day_bounds(day)
    if since is not None:
        start = since
    if until is not None:
        end = until
    stmt = (
        select(Article)
        .options(selectinload(Article.category))
        .where(
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
            Article.published_at >= start,
            Article.published_at < end,
            or_(Article.expires_at.is_(None), Article.expires_at > utcnow()),
        )
    )
    if category_ids:
        stmt = stmt.where(
            or_(
                Article.category_id.in_(category_ids),
                Article.subcategory_id.in_(category_ids),
            )
        )
    return list(
        db.scalars(
            stmt.order_by(
                Article.is_breaking.desc(),
                Article.is_featured.desc(),
                Article.view_count.desc(),
                Article.share_count.desc(),
                Article.comment_count.desc(),
                Article.published_at.desc(),
            )
        )
    )


# ------------------------------------------------------------------ fitting --
def _in_section(article: Article, category_ids: list[int]) -> bool:
    if not category_ids:
        return True
    return article.category_id in category_ids or article.subcategory_id in category_ids


def _fill_slots(
    db: Session,
    page: EpaperPage,
    pool: list[Article],
    used: set[int],
    category_ids: list[int],
    ranks: dict[int, int],
) -> int:
    """Fill the page's EMPTY slots from `pool` (best first). Returns the count placed.

    Biggest slots first, so the lead goes to the strongest story that can carry
    it. For each slot: the page's own section, size fitting; then the whole
    pool, size fitting; then the section relaxed; then anything at all. A slot
    stays empty only when the day is out of stories.
    """
    slots = slots_for(page.layout_type)
    taken = {link.position - 1 for link in page.articles}
    free = [i for i in range(len(slots)) if i not in taken]
    section = [a for a in pool if _in_section(a, category_ids)] if category_ids else pool
    placed = 0
    # ponytail: O(slots x pool) scans; bucket the pool by size if a day ever has thousands of stories.
    for i in sorted(free, key=lambda i: (-SIZE_RANK[slots[i].size], i)):
        need = SIZE_RANK[slots[i].size]
        pick = (
            next((a for a in section if a.id not in used and ranks[a.id] >= need), None)
            or next((a for a in pool if a.id not in used and ranks[a.id] >= need), None)
            or next((a for a in section if a.id not in used), None)
            or next((a for a in pool if a.id not in used), None)
        )
        if pick is None:
            break
        used.add(pick.id)
        placed += 1
        db.add(
            EpaperPageArticle(
                page_id=page.id,
                article_id=pick.id,
                position=i + 1,
                display_type=slots[i].size,
            )
        )
    db.flush()
    db.expire(page, ["articles"])
    return placed


def _ranks(pool: list[Article]) -> dict[int, int]:
    return {a.id: size_rank(a) for a in pool}


def _placed_ids(edition: EpaperEdition) -> set[int]:
    return {link.article_id for page in edition.pages for link in page.articles}


def _page_categories(db: Session, page: EpaperPage) -> list[int]:
    if not page.template_id:
        return []
    template = db.get(EpaperPageTemplate, page.template_id)
    return list(template.category_ids or []) if template else []


def page_plan(
    db: Session, n: int, actor_id: int | None = None
) -> list[EpaperPageTemplate | None]:
    """Which template makes which page. `None` is an overflow page."""
    templates = [t for t in ensure_templates(db, actor_id) if t.is_visible]
    front = next((t for t in templates if t.slug == "front-page"), None)
    ordered = ([front] if front else []) + [t for t in templates if t is not front]
    plan: list[EpaperPageTemplate | None] = list(ordered[:n])
    return plan + [None] * (n - len(plan))


def clamp_pages(n: int) -> int:
    return max(1, min(MAX_PAGES, n))


def default_page_count(db: Session) -> int:
    return clamp_pages(settings_service.get_int(db, "epaper.page_count") or 8)


# --------------------------------------------------------------- generation --
def generate_daily(
    db: Session,
    day: date | None = None,
    actor_id: int | None = None,
    regenerate: bool = False,
    page_count: int | None = None,
) -> EpaperEdition:
    day = day or datetime.now(IST).date()
    edition = db.scalar(
        select(EpaperEdition).where(
            EpaperEdition.edition_date == day,
            EpaperEdition.edition_type == "DAILY",
            EpaperEdition.owner_user_id.is_(None),
        )
    )
    if edition and edition.status == "PUBLISHED":
        raise ConflictError(
            message_en="Published editions cannot be regenerated.",
            message_te="ప్రచురించిన ఎడిషన్‌ను మళ్లీ రూపొందించలేరు.",
        )
    if edition and not regenerate and edition.pages:
        return edition
    n = clamp_pages(
        page_count
        or (len(edition.pages) if edition is not None and regenerate else 0)
        or default_page_count(db)
    )
    if edition is None:
        edition = EpaperEdition(
            title=f"Today's Telugu News — {day.isoformat()}",
            edition_date=day,
            edition_type="DAILY",
            status="GENERATED",
            created_by=actor_id,
        )
        db.add(edition)
        db.flush()
    else:
        edition.revision += 1
        edition.approved_by, edition.approved_at = None, None
        for page in list(edition.pages):
            db.delete(page)
        db.flush()
        db.expire(edition, ["pages"])
    pool = ranked_articles(db, day)
    ranks = _ranks(pool)
    used: set[int] = set()
    for number, template in enumerate(page_plan(db, n, actor_id), 1):
        page = EpaperPage(
            edition_id=edition.id,
            template_id=template.id if template else None,
            page_number=number,
            title=template.title_te if template else OVERFLOW_TITLE,
            layout_type=template.layout_type if template else OVERFLOW_LAYOUT,
            status="GENERATED",
        )
        db.add(page)
        db.flush()
        _fill_slots(
            db, page, pool, used, list(template.category_ids or []) if template else [], ranks
        )
    edition.status = "GENERATED"
    db.flush()
    db.expire(edition, ["pages"])
    return edition


def _assert_daily(edition: EpaperEdition) -> None:
    if edition.owner_user_id is not None or edition.edition_type != "DAILY":
        raise ConflictError(
            message_en="Only the daily edition can be changed here.",
            message_te="రోజువారీ ఎడిషన్‌ను మాత్రమే ఇక్కడ మార్చగలరు.",
        )


def regenerate(
    db: Session,
    edition: EpaperEdition,
    actor_id: int | None,
    page_count: int | None = None,
) -> EpaperEdition:
    _assert_daily(edition)
    return generate_daily(
        db, edition.edition_date, actor_id, regenerate=True, page_count=page_count
    )


def plan_preview(db: Session, day: date, actor_id: int | None = None) -> PlanOut:
    """What a generation for `day` would have to work with."""
    pool = ranked_articles(db, day)
    templates = [t for t in ensure_templates(db, actor_id) if t.is_visible]
    return PlanOut(
        edition_date=day,
        candidates=len(pool),
        default_page_count=default_page_count(db),
        # Nine is what an average page holds across the layouts.
        suggested_page_count=clamp_pages(math.ceil(len(pool) / 9)) if pool else 1,
        per_template=[
            TemplatePlanOut(
                slug=t.slug,
                title_te=t.title_te,
                layout_type=t.layout_type,
                slot_count=slot_count(t.layout_type),
                available=sum(_in_section(a, list(t.category_ids or [])) for a in pool),
            )
            for t in templates
        ],
    )


# --------------------------------------------------------------- candidates --
class _Hero(NamedTuple):
    url: str | None
    caption_te: str | None
    credit: str | None


def _hero_urls(db: Session, media_ids: set[int]) -> dict[int, _Hero]:
    if not media_ids:
        return {}
    rows = db.execute(
        select(
            Media.id, Media.cdn_url, Media.caption_te, Media.credit, Media.source_type
        ).where(Media.id.in_(media_ids))
    ).all()
    # The sheet is public: a borrowed photo's credit stays in the CMS (2026-10-03).
    return {
        media_id: _Hero(url, caption, credit if kind in media_service.CREDIT_EXEMPT else None)
        for media_id, url, caption, credit, kind in rows
    }


def _words(article: Article) -> int:
    return article.word_count or len((article.body_plain or "").split())


def _paragraphs(text: str | None) -> list[str]:
    """Body paragraphs for typesetting.

    `body_plain` ends every block with a single newline (tiptap.to_plain_text)
    and seeded copy uses blank lines, so any line break is a paragraph break.
    Past BODY_CHARS whole trailing paragraphs are dropped, never cut mid-way.
    """
    out: list[str] = []
    total = 0
    for line in (text or "").splitlines():
        para = line.strip()
        if not para:
            continue
        total += len(para)
        if total > BODY_CHARS:
            # One paragraph longer than the whole budget would otherwise leave
            # the story with no body at all; cut that one rather than drop it.
            if not out:
                out.append(para[:BODY_CHARS])
            break
        out.append(para)
    return out


def candidates(
    db: Session,
    edition: EpaperEdition,
    *,
    page: EpaperPage | None = None,
    q: str | None = None,
    limit: int = 50,
) -> list[CandidateOut]:
    """Stories of the edition's day not yet on any of its pages, best first."""
    placed = _placed_ids(edition)
    pool = [a for a in ranked_articles(db, edition.edition_date) if a.id not in placed]
    if q:
        needle = q.casefold()
        pool = [
            a
            for a in pool
            if needle in (a.title_te or "").casefold()
            or needle in (a.title_en or "").casefold()
        ]
    section = _page_categories(db, page) if page is not None else []
    heroes = _hero_urls(db, {a.hero_media_id for a in pool if a.hero_media_id})
    rows = [
        CandidateOut(
            id=a.id,
            short_id=a.short_id,
            title_te=a.title_te,
            title_en=a.title_en,
            category_slug=a.category.slug if a.category else None,
            category_name_te=a.category.name_te if a.category else None,
            word_count=_words(a),
            has_hero=a.hero_media_id is not None,
            hero_url=heroes[a.hero_media_id].url if a.hero_media_id in heroes else None,
            size=size_class(a),
            is_breaking=a.is_breaking,
            is_featured=a.is_featured,
            published_at=a.published_at,
            in_section=bool(section) and _in_section(a, section),
        )
        for a in pool
    ]
    rows.sort(key=lambda r: not r.in_section)  # stable: rank order survives
    return rows[:limit]


def _assert_mutable(edition: EpaperEdition) -> None:
    if edition.status == "PUBLISHED":
        raise ConflictError(
            message_en="Published editions are immutable.",
            message_te="ప్రచురించిన ఎడిషన్‌ను మార్చలేరు.",
        )


def touch(edition: EpaperEdition) -> None:
    """Any visible change is a new revision; cached PDFs key on it."""
    edition.revision += 1


def _clear_links(db: Session, page: EpaperPage) -> None:
    db.execute(delete(EpaperPageArticle).where(EpaperPageArticle.page_id == page.id))
    db.flush()
    db.expire(page, ["articles"])


def fill_page(db: Session, page: EpaperPage, *, reset: bool = False) -> EpaperPage:
    """Recommend stories for the page's empty slots (or all of them with `reset`)."""
    edition = page.edition
    _assert_mutable(edition)
    if reset:
        _clear_links(db, page)
    pool = ranked_articles(db, edition.edition_date)
    _fill_slots(db, page, pool, _placed_ids(edition), _page_categories(db, page), _ranks(pool))
    touch(edition)
    db.flush()
    return page


def fill_edition(
    db: Session, edition: EpaperEdition, *, reset: bool = False
) -> EpaperEdition:
    _assert_mutable(edition)
    if reset:
        for page in edition.pages:
            _clear_links(db, page)
    pool = ranked_articles(db, edition.edition_date)
    ranks = _ranks(pool)
    used = _placed_ids(edition)
    for page in sorted(edition.pages, key=lambda p: p.page_number):
        _fill_slots(db, page, pool, used, _page_categories(db, page), ranks)
    touch(edition)
    db.flush()
    return edition


# ------------------------------------------------------------------ editing --
def _reslot(db: Session, page: EpaperPage) -> None:
    """After a layout change: drop stories past the new slot count, resize the rest."""
    slots = slots_for(page.layout_type)
    for link in list(page.articles):
        if link.position > len(slots):
            db.delete(link)
        else:
            link.display_type = slots[link.position - 1].size
    db.flush()
    db.expire(page, ["articles"])


def _replace_links(db: Session, page: EpaperPage, article_ids: list[int | None]) -> None:
    slots = slots_for(page.layout_type)
    ids = [i for i in article_ids if i is not None]
    if len(article_ids) > len(slots):
        raise ValidationError(
            details={"article_ids": f"{page.layout_type} has {len(slots)} slots"}
        )
    if len(ids) != len(set(ids)):
        raise ValidationError(details={"article_ids": "Duplicate article"})
    if ids:
        published = set(
            db.scalars(
                select(Article.id).where(
                    Article.id.in_(ids),
                    Article.status == ArticleStatus.PUBLISHED,
                    Article.deleted_at.is_(None),
                )
            )
        )
        if set(ids) - published:
            raise ValidationError(
                details={"article_ids": "Only published articles are allowed"}
            )
        elsewhere = db.scalars(
            select(EpaperPageArticle.article_id)
            .join(EpaperPage, EpaperPageArticle.page_id == EpaperPage.id)
            .where(
                EpaperPage.edition_id == page.edition_id,
                EpaperPage.id != page.id,
                EpaperPageArticle.article_id.in_(ids),
            )
        ).all()
        if elsewhere:
            raise ValidationError(
                details={
                    "article_ids": f"Already placed elsewhere in this edition: {sorted(elsewhere)}"
                }
            )
    _clear_links(db, page)
    for index, article_id in enumerate(article_ids):
        if article_id is not None:
            db.add(
                EpaperPageArticle(
                    page_id=page.id,
                    article_id=article_id,
                    position=index + 1,
                    display_type=slots[index].size,
                )
            )
    db.flush()
    db.expire(page, ["articles"])


def update_page(db: Session, page: EpaperPage, changes: dict[str, Any]) -> EpaperPage:
    """`changes` is `PageUpdateIn.model_dump(exclude_unset=True)`: absent means untouched."""
    _assert_mutable(page.edition)
    if changes.get("title"):
        page.title = changes["title"]
    if changes.get("layout_type"):
        page.layout_type = changes["layout_type"]
        _reslot(db, page)
    if "poll_id" in changes:
        page.poll_id = changes["poll_id"]
    if changes.get("article_ids") is not None:
        _replace_links(db, page, changes["article_ids"])
    touch(page.edition)
    db.flush()
    return page


def add_page(db: Session, edition: EpaperEdition, payload: PageCreateIn) -> EpaperPage:
    _assert_mutable(edition)
    template = (
        db.get(EpaperPageTemplate, payload.template_id) if payload.template_id else None
    )
    title = payload.title or (template.title_te if template else None)
    if not title:
        raise ValidationError(details={"title": "Give a title or a template_id"})
    page = EpaperPage(
        edition_id=edition.id,
        template_id=template.id if template else None,
        page_number=max((p.page_number for p in edition.pages), default=0) + 1,
        title=title,
        layout_type=payload.layout_type or (template.layout_type if template else "lead_grid"),
        status="GENERATED",
    )
    db.add(page)
    db.flush()
    db.expire(edition, ["pages"])
    return update_page(
        db, page, {"article_ids": payload.article_ids, "poll_id": payload.poll_id}
    )


def delete_page(db: Session, edition: EpaperEdition, page_id: int) -> None:
    _assert_mutable(edition)
    page = next((row for row in edition.pages if row.id == page_id), None)
    if not page:
        raise NotFoundError()
    db.delete(page)
    remaining = sorted(
        (row for row in edition.pages if row.id != page_id), key=lambda r: r.page_number
    )
    # Two passes through negative numbers keep the unique (edition, number) index happy.
    for number, row in enumerate(remaining, 1):
        row.page_number = -number
    db.flush()
    for number, row in enumerate(remaining, 1):
        row.page_number = number
    touch(edition)
    db.flush()
    db.expire(edition, ["pages"])


def order_pages(db: Session, edition: EpaperEdition, page_ids: list[int]) -> None:
    _assert_mutable(edition)
    by_id = {row.id: row for row in edition.pages}
    if set(by_id) != set(page_ids) or len(page_ids) != len(by_id):
        raise ConflictError(
            message_en="Page order must include every page exactly once.",
            message_te="పేజీ క్రమంలో ప్రతి పేజీ ఒక్కసారే ఉండాలి.",
        )
    for number, page_id in enumerate(page_ids, 1):
        by_id[page_id].page_number = -number
    db.flush()
    for number, page_id in enumerate(page_ids, 1):
        by_id[page_id].page_number = number
    touch(edition)
    db.flush()
    db.expire(edition, ["pages"])


# ----------------------------------------------------------------- workflow --
def submit(db: Session, edition: EpaperEdition, actor_id: int) -> EpaperEdition:
    if edition.status not in {"GENERATED", "DRAFT"}:
        raise ConflictError(
            message_en="Only a generated edition can be sent for review.",
            message_te="రూపొందించిన ఎడిషన్‌ను మాత్రమే సమీక్షకు పంపగలరు.",
        )
    if not any(page.articles for page in edition.pages):
        raise ValidationError(details={"pages": "Edition has no published stories"})
    edition.status = "UNDER_REVIEW"
    return edition


def approve(db: Session, edition: EpaperEdition, actor_id: int) -> EpaperEdition:
    if edition.status not in {"GENERATED", "UNDER_REVIEW"}:
        raise ConflictError(
            message_en="Only generated editions can be approved.",
            message_te="రూపొందించిన ఎడిషన్‌లను మాత్రమే ఆమోదించగలరు.",
        )
    if not edition.pages or not any(page.articles for page in edition.pages):
        raise ValidationError(details={"pages": "Edition has no published stories"})
    edition.status, edition.approved_by, edition.approved_at = (
        "APPROVED",
        actor_id,
        utcnow(),
    )
    return edition


def publish(db: Session, edition: EpaperEdition, actor_id: int) -> EpaperEdition:
    if edition.status != "APPROVED" or not edition.approved_by:
        raise ConflictError(
            message_en="Approve the edition before publishing.",
            message_te="ప్రచురించే ముందు ఎడిషన్‌ను ఆమోదించండి.",
        )
    edition.status, edition.published_at = "PUBLISHED", utcnow()
    for page in edition.pages:
        page.status = "PUBLISHED"
    return edition


def withdraw(db: Session, edition: EpaperEdition, actor_id: int) -> EpaperEdition:
    """Take an approved or published edition back to the desk."""
    _assert_daily(edition)
    if edition.status not in {"APPROVED", "PUBLISHED"}:
        raise ConflictError(
            message_en="Only approved or published editions can be withdrawn.",
            message_te="ఆమోదించిన లేదా ప్రచురించిన ఎడిషన్‌లను మాత్రమే ఉపసంహరించగలరు.",
        )
    edition.status = "GENERATED"
    edition.approved_by, edition.approved_at, edition.published_at = None, None, None
    for page in edition.pages:
        page.status = "GENERATED"
    touch(edition)
    return edition


# ---------------------------------------------------------------------- PDF --
def pdf_asset(db: Session, edition: EpaperEdition) -> EpaperAsset | None:
    """The PDF row for the current revision, whatever its state."""
    return db.scalar(
        select(EpaperAsset).where(
            EpaperAsset.edition_id == edition.id,
            EpaperAsset.kind == "PDF",
            EpaperAsset.revision == edition.revision,
        )
    )


def queue_pdf(db: Session, edition: EpaperEdition) -> EpaperAsset:
    """Reserve (or reuse) the asset row and mark it pending. Nothing is drawn here."""
    if edition.status not in {"APPROVED", "PUBLISHED"}:
        raise ConflictError(
            message_en="Approve the edition before generating its PDF.",
            message_te="PDF రూపొందించే ముందు ఎడిషన్‌ను ఆమోదించండి.",
        )
    asset = pdf_asset(db, edition)
    if asset is not None and asset.status == "READY":
        return asset
    if asset is None:
        asset = EpaperAsset(edition_id=edition.id, kind="PDF", revision=edition.revision)
        db.add(asset)
    asset.status, asset.error = "PENDING", None
    db.flush()
    return asset


def generate_pdf(db: Session, edition: EpaperEdition, *, images: bool = True) -> EpaperAsset:
    asset = queue_pdf(db, edition)
    if asset.status == "READY":
        return asset
    if not telugu_shaping_available():
        asset.status, asset.error = "FAILED", SHAPING_UNAVAILABLE
        db.flush()
        return asset
    try:
        raw = epaper_pdf.render_edition(serialize(db, edition), images=images)
        key = f"epaper/{edition.edition_date.isoformat()}/edition-r{edition.revision}.pdf"
        stored = get_storage().put(
            key,
            raw,
            content_type="application/pdf",
            cache_control="public, max-age=31536000, immutable",
        )
        asset.status, asset.storage_key, asset.public_url, asset.error = (
            "READY",
            key,
            stored.url,
            None,
        )
    except Exception as exc:  # noqa: BLE001 — a failed render is a FAILED asset, not a 500
        asset.status, asset.error = "FAILED", str(exc)[:1000]
    db.flush()
    return asset


def _page_loads():  # type: ignore[no-untyped-def]
    return (
        selectinload(EpaperEdition.pages)
        .selectinload(EpaperPage.articles)
        .selectinload(EpaperPageArticle.article)
        .selectinload(Article.category)
    )


def render_pdf_job(edition_id: int, *, images: bool = True) -> None:
    """Background entry point: its own session, never raises."""
    try:
        with session_scope() as db:
            edition = db.scalar(
                select(EpaperEdition)
                .options(_page_loads())
                .where(EpaperEdition.id == edition_id)
            )
            if edition is not None:
                generate_pdf(db, edition, images=images)
    except Exception as exc:  # noqa: BLE001 — logged; the asset row carries the error
        logger.warning("epaper_pdf_job_failed", edition_id=edition_id, error=str(exc)[:200])


# ------------------------------------------------------------- serializing --
def load_edition(db: Session, day: date, public_only: bool = True) -> EpaperEdition:
    stmt = (
        select(EpaperEdition)
        .options(_page_loads())
        .where(
            EpaperEdition.edition_date == day,
            EpaperEdition.edition_type == "DAILY",
            EpaperEdition.owner_user_id.is_(None),
        )
    )
    if public_only:
        stmt = stmt.where(EpaperEdition.status == "PUBLISHED")
    edition = db.scalar(stmt)
    if edition is None:
        raise NotFoundError(
            message_en="E-Paper edition not found.", message_te="ఈ-పేపర్ ఎడిషన్ కనబడలేదు."
        )
    return edition


def _url_maps(
    db: Session, edition: EpaperEdition
) -> tuple[dict[int, _Hero], dict[int, str | None], dict[int, str]]:
    """Heroes, ready audio and district names for every story on the edition, one query each."""
    links = [link for page in edition.pages for link in page.articles]
    heroes = _hero_urls(db, {x.article.hero_media_id for x in links if x.article.hero_media_id})
    audio_ids = {x.article.audio_asset_id for x in links if x.article.audio_asset_id}
    audio: dict[int, str | None] = {}
    if audio_ids:
        rows = db.execute(
            select(AudioAsset.id, AudioAsset.url).where(
                AudioAsset.id.in_(audio_ids), AudioAsset.status == AudioStatus.READY
            )
        ).all()
        audio = {asset_id: url for asset_id, url in rows}
    district_ids = {x.article.district_id for x in links if x.article.district_id}
    districts: dict[int, str] = {}
    if district_ids:
        districts = {
            district_id: name
            for district_id, name in db.execute(
                select(District.id, District.name_te).where(District.id.in_(district_ids))
            )
        }
    return heroes, audio, districts


def _article_out(
    link: EpaperPageArticle,
    heroes: dict[int, _Hero],
    audio: dict[int, str | None],
    districts: dict[int, str],
) -> EpaperArticleOut:
    a = link.article
    hero = heroes.get(a.hero_media_id) if a.hero_media_id else None
    return EpaperArticleOut(
        id=a.id,
        short_id=a.short_id,
        url=a.url_path,
        title_te=a.title_te,
        title_en=a.title_en,
        summary_te=a.summary_te,
        byline_te=a.byline_te,
        dateline_te=districts.get(a.district_id) if a.district_id else None,
        body=_paragraphs(a.body_plain),
        hero_url=hero.url if hero else None,
        hero_caption_te=hero.caption_te if hero else None,
        hero_credit=hero.credit if hero else None,
        category_slug=a.category.slug if a.category else None,
        category_name_te=a.category.name_te if a.category else None,
        is_breaking=a.is_breaking,
        audio_url=audio.get(a.audio_asset_id) if a.audio_asset_id else None,
        position=link.position,
        slot=link.position - 1,
        display_type=link.display_type,
        size=link.display_type,
        word_count=_words(a),
    )


def serialize(
    db: Session,
    edition: EpaperEdition,
    include_pages: bool = True,
    *,
    include_pdf: bool = True,
) -> EpaperEditionOut:
    """`include_pdf=False` is the public shape: the PDF is staff-only, so its
    url, status and error are all None and the asset row is not even read."""
    asset = pdf_asset(db, edition) if include_pdf else None
    pages: list[EpaperPageOut] = []
    if include_pages:
        heroes, audio, districts = _url_maps(db, edition)
        base = settings.APP_URL.rstrip("/")
        pages = [
            EpaperPageOut(
                id=p.id,
                page_number=p.page_number,
                title=p.title,
                layout_type=p.layout_type,
                template_id=p.template_id,
                share_url=f"{base}/epaper/{edition.edition_date.isoformat()}/page/{p.page_number}",
                slots=[
                    SlotOut(index=i, x=s.x, y=s.y, w=s.w, h=s.h, size=s.size)
                    for i, s in enumerate(slots_for(p.layout_type))
                ],
                articles=[_article_out(x, heroes, audio, districts) for x in p.articles],
                poll_id=p.poll_id,
            )
            for p in edition.pages
        ]
    return EpaperEditionOut(
        id=edition.id,
        title=edition.title,
        edition_date=edition.edition_date,
        edition_type=edition.edition_type,
        status=edition.status,
        revision=edition.revision,
        page_count=len(edition.pages),
        pages=pages,
        pdf_url=asset.public_url if asset is not None and asset.status == "READY" else None,
        pdf_status=asset.status if asset is not None else None,
        pdf_error=asset.error if asset is not None else None,
        audio_enabled=settings_service.get_bool(db, "epaper.audio_enabled"),
        published_at=edition.published_at,
    )


# ------------------------------------------------------------ personalised --
def user_edition_row(row: EpaperUserEdition) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "auto_generate": row.auto_generate,
        "generation_time": row.generation_time,
        "is_active": row.is_active,
        "preferences": [
            {
                "preference_type": p.preference_type,
                "target_id": p.target_id,
                "priority": p.priority,
            }
            for p in row.preferences
        ],
    }


def _place_ranked(db: Session, page: EpaperPage, articles: list[Article]) -> None:
    """Stories in rank order into the layout's slots; the layout caps the count."""
    for index, (slot, article) in enumerate(zip(slots_for(page.layout_type), articles)):
        db.add(
            EpaperPageArticle(
                page_id=page.id,
                article_id=article.id,
                position=index + 1,
                display_type=slot.size,
            )
        )


def generate_personal(
    db: Session, saved: EpaperUserEdition, day: date | None = None
) -> EpaperEdition:
    day = day or datetime.now(IST).date()
    kind = f"PERSONAL_{saved.id}"
    existing = db.scalar(
        select(EpaperEdition).where(
            EpaperEdition.edition_date == day,
            EpaperEdition.edition_type == kind,
            EpaperEdition.owner_user_id == saved.user_id,
        )
    )
    if existing:
        return existing
    edition = EpaperEdition(
        title=saved.name,
        edition_date=day,
        edition_type=kind,
        owner_user_id=saved.user_id,
        created_by=saved.user_id,
        status="PUBLISHED",
        approved_by=saved.user_id,
        approved_at=utcnow(),
        published_at=utcnow(),
    )
    db.add(edition)
    db.flush()
    preferences = sorted(saved.preferences, key=lambda p: p.priority)
    category_ids = [p.target_id for p in preferences if p.preference_type == "category"]
    district_ids = [p.target_id for p in preferences if p.preference_type == "district"]
    mandal_ids = [p.target_id for p in preferences if p.preference_type == "mandal"]
    tag_ids = [p.target_id for p in preferences if p.preference_type == "tag"]
    all_ranked = _ranked_articles(db, day, None)
    category_matches = _ranked_articles(db, day, category_ids) if category_ids else []
    tag_matches = [
        article
        for article in all_ranked
        if tag_ids and any(link.tag_id in tag_ids for link in article.tags)
    ]
    preferred_ids = {article.id for article in category_matches + tag_matches}
    candidates_ = [article for article in all_ranked if article.id in preferred_ids]
    if district_ids:
        candidates_ = [
            a for a in candidates_ if a.district_id in district_ids or a.is_breaking
        ]
    if mandal_ids:
        candidates_ = [
            a for a in candidates_ if a.mandal_id in mandal_ids or a.is_breaking
        ]
    # Important breaking/public-interest stories remain at the front even when
    # they fall outside the saved preferences.
    breaking = [article for article in all_ranked if article.is_breaking]
    candidates_ = breaking + [
        article for article in candidates_ if article.id not in {x.id for x in breaking}
    ]
    if not candidates_:
        candidates_ = all_ranked
    if not candidates_:
        raise ValidationError(
            details={"articles": "No fresh published stories are available"}
        )
    used: set[int] = set()
    selections = [("ముఖ్య వార్తలు", candidates_[:10])]
    for category_id in category_ids:
        category = db.get(Category, category_id)
        if category:
            selections.append(
                (
                    category.name_te,
                    [a for a in candidates_ if a.category_id == category_id][:8],
                )
            )
    page_number = 0
    for title, articles in selections:
        chosen = [a for a in articles if a.id not in used]
        if not chosen:
            continue
        page_number += 1
        page = EpaperPage(
            edition_id=edition.id,
            page_number=page_number,
            title=title,
            layout_type="lead_grid",
            status="PUBLISHED",
        )
        db.add(page)
        db.flush()
        _place_ranked(db, page, chosen)
        used.update(a.id for a in chosen[: slot_count("lead_grid")])
    db.flush()
    db.expire(edition, ["pages"])
    return edition


#: The pre-existing private name. Kept so callers and tests written against it
#: keep working — the function grew arguments, it did not change behaviour.
_ranked_articles = ranked_articles
