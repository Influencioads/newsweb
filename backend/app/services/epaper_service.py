from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.base import utcnow
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
from app.models.media import Media
from app.schemas.epaper import EpaperEditionOut, EpaperPageOut, EpaperArticleOut
from app.services import settings_service

IST = ZoneInfo("Asia/Kolkata")

DEFAULT_TEMPLATES = (
    ("front-page", "మొదటి పేజీ", "Front Page", [], 10, "lead_grid"),
    ("national", "జాతీయం", "National", ["national"], 6, "three_column"),
    (
        "international",
        "అంతర్జాతీయం",
        "International",
        ["international"],
        6,
        "three_column",
    ),
    ("telangana", "తెలంగాణ", "Telangana", ["telangana"], 7, "lead_grid"),
    (
        "andhra-pradesh",
        "ఆంధ్రప్రదేశ్",
        "Andhra Pradesh",
        ["andhra-pradesh", "andhra"],
        7,
        "lead_grid",
    ),
    ("local", "జిల్లా / స్థానికం", "District / Local", ["local"], 7, "briefs"),
    (
        "business-jobs",
        "వ్యాపారం & ఉద్యోగాలు",
        "Business & Jobs",
        ["business", "jobs"],
        6,
        "two_column",
    ),
    ("education", "విద్య", "Education", ["education"], 6, "two_column"),
    ("tech-ai", "టెక్ & ఏఐ", "Tech & AI", ["technology", "tech-ai"], 6, "two_column"),
    ("sports", "క్రీడలు", "Sports", ["sports"], 6, "image_lead"),
    ("movies", "సినిమా", "Movies", ["cinema", "movies"], 6, "image_lead"),
    ("health", "ఆరోగ్యం", "Health", ["health"], 6, "two_column"),
    ("real-heroes", "రియల్ హీరోస్", "Real Heroes", ["real-heroes"], 5, "lead_grid"),
    ("big-question", "బిగ్ క్వశ్చన్", "Big Question", ["big-question"], 4, "breaking"),
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
    for sort, (slug, te, en, category_slugs, count, layout) in enumerate(
        DEFAULT_TEMPLATES, 1
    ):
        ids = [categories[s] for s in category_slugs if s in categories]
        db.add(
            EpaperPageTemplate(
                slug=slug,
                title_te=te,
                title_en=en,
                sort=sort,
                category_ids=ids,
                story_count=count,
                layout_type=layout,
                created_by=actor_id,
                updated_by=actor_id,
            )
        )
    db.flush()
    return list(
        db.scalars(select(EpaperPageTemplate).order_by(EpaperPageTemplate.sort))
    )


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=IST).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def _ranked_articles(
    db: Session, day: date, category_ids: list[int] | None = None
) -> list[Article]:
    start, end = _day_bounds(day)
    stmt = select(Article).where(
        Article.status == ArticleStatus.PUBLISHED,
        Article.deleted_at.is_(None),
        Article.published_at >= start,
        Article.published_at < end,
        or_(Article.expires_at.is_(None), Article.expires_at > utcnow()),
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


def generate_daily(
    db: Session,
    day: date | None = None,
    actor_id: int | None = None,
    regenerate: bool = False,
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
        for page in list(edition.pages):
            db.delete(page)
        db.flush()
    templates = [t for t in ensure_templates(db, actor_id) if t.is_visible]
    used: set[int] = set()
    page_number = 0
    for template in templates:
        candidates = _ranked_articles(db, day, template.category_ids or None)
        chosen = [a for a in candidates if a.id not in used][: template.story_count]
        if not chosen and template.slug != "front-page":
            continue
        page_number += 1
        page = EpaperPage(
            edition_id=edition.id,
            template_id=template.id,
            page_number=page_number,
            title=template.title_te,
            layout_type=template.layout_type,
            status="GENERATED",
        )
        db.add(page)
        db.flush()
        for position, article in enumerate(chosen, 1):
            db.add(
                EpaperPageArticle(
                    page_id=page.id,
                    article_id=article.id,
                    position=position,
                    display_type="lead" if position == 1 else "standard",
                )
            )
            used.add(article.id)
    edition.status = "GENERATED"
    db.flush()
    db.expire(edition, ["pages"])
    return edition


def load_edition(db: Session, day: date, public_only: bool = True) -> EpaperEdition:
    stmt = (
        select(EpaperEdition)
        .options(
            selectinload(EpaperEdition.pages)
            .selectinload(EpaperPage.articles)
            .selectinload(EpaperPageArticle.article)
        )
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


def _article_out(db: Session, link: EpaperPageArticle) -> EpaperArticleOut:
    a = link.article
    hero_url = (
        db.scalar(select(Media.cdn_url).where(Media.id == a.hero_media_id))
        if a.hero_media_id
        else None
    )
    audio_url = (
        db.scalar(
            select(AudioAsset.url).where(
                AudioAsset.id == a.audio_asset_id,
                AudioAsset.status == AudioStatus.READY,
            )
        )
        if a.audio_asset_id
        else None
    )
    return EpaperArticleOut(
        id=a.id,
        short_id=a.short_id,
        url=a.url_path,
        title_te=a.title_te,
        title_en=a.title_en,
        summary_te=a.summary_te,
        hero_url=hero_url,
        category_slug=a.category.slug if a.category else None,
        is_breaking=a.is_breaking,
        audio_url=audio_url,
        position=link.position,
        display_type=link.display_type,
    )


def serialize(
    db: Session, edition: EpaperEdition, include_pages: bool = True
) -> EpaperEditionOut:
    pdf = next(
        (
            a.public_url
            for a in edition.assets
            if a.kind == "PDF"
            and a.revision == edition.revision
            and a.status == "READY"
        ),
        None,
    )
    pages = (
        [
            EpaperPageOut(
                id=p.id,
                page_number=p.page_number,
                title=p.title,
                layout_type=p.layout_type,
                share_url=f"{settings.APP_URL.rstrip('/')}/epaper/{edition.edition_date.isoformat()}/page/{p.page_number}",
                articles=[_article_out(db, x) for x in p.articles],
                poll_id=p.poll_id,
            )
            for p in edition.pages
        ]
        if include_pages
        else []
    )
    return EpaperEditionOut(
        id=edition.id,
        title=edition.title,
        edition_date=edition.edition_date,
        edition_type=edition.edition_type,
        status=edition.status,
        revision=edition.revision,
        page_count=len(edition.pages),
        pages=pages,
        pdf_url=pdf,
        audio_enabled=settings_service.get_bool(db, "epaper.audio_enabled"),
        published_at=edition.published_at,
    )


def update_page(
    db: Session,
    page: EpaperPage,
    *,
    title: str | None,
    layout_type: str | None,
    article_ids: list[int] | None,
    poll_id: int | None,
) -> EpaperPage:
    if page.edition.status == "PUBLISHED":
        raise ConflictError(message_en="Published pages are immutable.")
    if title is not None:
        page.title = title
    if layout_type is not None:
        page.layout_type = layout_type
    page.poll_id = poll_id
    if article_ids is not None:
        rows = list(
            db.scalars(
                select(Article).where(
                    Article.id.in_(article_ids),
                    Article.status == ArticleStatus.PUBLISHED,
                    Article.deleted_at.is_(None),
                )
            )
        )
        by_id = {a.id: a for a in rows}
        if len(by_id) != len(set(article_ids)):
            raise ValidationError(
                details={"article_ids": "Only published articles are allowed"}
            )
        db.execute(
            delete(EpaperPageArticle).where(EpaperPageArticle.page_id == page.id)
        )
        for pos, article_id in enumerate(article_ids, 1):
            db.add(
                EpaperPageArticle(
                    page_id=page.id,
                    article_id=article_id,
                    position=pos,
                    display_type="lead" if pos == 1 else "standard",
                )
            )
        page.edition.revision += 1
    db.flush()
    return page


def approve(db: Session, edition: EpaperEdition, actor_id: int) -> EpaperEdition:
    if edition.status not in {"GENERATED", "UNDER_REVIEW"}:
        raise ConflictError(message_en="Only generated editions can be approved.")
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
        raise ConflictError(message_en="Approve the edition before publishing.")
    edition.status, edition.published_at = "PUBLISHED", utcnow()
    for page in edition.pages:
        page.status = "PUBLISHED"
    return edition


def generate_pdf(db: Session, edition: EpaperEdition) -> EpaperAsset:
    if edition.status not in {"APPROVED", "PUBLISHED"}:
        raise ConflictError(message_en="Approve the edition before generating its PDF.")
    existing = db.scalar(
        select(EpaperAsset).where(
            EpaperAsset.edition_id == edition.id,
            EpaperAsset.kind == "PDF",
            EpaperAsset.revision == edition.revision,
            EpaperAsset.status == "READY",
        )
    )
    if existing:
        return existing
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen.canvas import Canvas

        font_path = "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf"
        font = "Helvetica"
        try:
            pdfmetrics.registerFont(TTFont("NotoTelugu", font_path))
            font = "NotoTelugu"
        except Exception:
            pass
        out = BytesIO()
        canvas = Canvas(out, pagesize=A4)
        width, height = A4
        for page in edition.pages:
            canvas.setFont(font, 17)
            canvas.drawString(42, height - 45, edition.title[:70])
            canvas.setFont(font, 13)
            canvas.drawString(42, height - 72, f"{page.page_number}. {page.title}")
            y = height - 105
            for link in page.articles:
                canvas.setFont(font, 11 if link.position == 1 else 9)
                title = (
                    link.article.title_te
                    if font == "NotoTelugu"
                    else (
                        link.article.title_en
                        or link.article.title_te.encode("ascii", "replace").decode()
                    )
                )
                for chunk in [title[i : i + 82] for i in range(0, len(title), 82)]:
                    canvas.drawString(48, y, chunk)
                    y -= 15
                y -= 8
                if y < 70:
                    break
            canvas.setFont("Helvetica", 8)
            canvas.drawRightString(width - 40, 25, f"Page {page.page_number}")
            canvas.showPage()
        canvas.save()
        raw = out.getvalue()
        key = (
            f"epaper/{edition.edition_date.isoformat()}/edition-r{edition.revision}.pdf"
        )
        stored = get_storage().put(
            key,
            raw,
            content_type="application/pdf",
            cache_control="public, max-age=31536000, immutable",
        )
        asset = EpaperAsset(
            edition_id=edition.id,
            kind="PDF",
            revision=edition.revision,
            status="READY",
            storage_key=key,
            public_url=stored.url,
        )
    except Exception as exc:
        asset = EpaperAsset(
            edition_id=edition.id,
            kind="PDF",
            revision=edition.revision,
            status="FAILED",
            error=str(exc)[:1000],
        )
    db.add(asset)
    db.flush()
    return asset


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
    candidates = [article for article in all_ranked if article.id in preferred_ids]
    if district_ids:
        candidates = [
            a for a in candidates if a.district_id in district_ids or a.is_breaking
        ]
    if mandal_ids:
        candidates = [
            a for a in candidates if a.mandal_id in mandal_ids or a.is_breaking
        ]
    # Important breaking/public-interest stories remain at the front even when
    # they fall outside the saved preferences.
    breaking = [article for article in all_ranked if article.is_breaking]
    candidates = breaking + [
        article for article in candidates if article.id not in {x.id for x in breaking}
    ]
    if not candidates:
        candidates = all_ranked
    if not candidates:
        raise ValidationError(
            details={"articles": "No fresh published stories are available"}
        )
    used: set[int] = set()
    selections = [("ముఖ్య వార్తలు", candidates[:10])]
    for category_id in category_ids:
        category = db.get(Category, category_id)
        if category:
            selections.append(
                (
                    category.name_te,
                    [a for a in candidates if a.category_id == category_id][:8],
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
        for pos, article in enumerate(chosen, 1):
            db.add(
                EpaperPageArticle(
                    page_id=page.id,
                    article_id=article.id,
                    position=pos,
                    display_type="lead" if pos == 1 else "standard",
                )
            )
            used.add(article.id)
    db.flush()
    db.expire(edition, ["pages"])
    return edition
