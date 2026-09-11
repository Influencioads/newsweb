from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import (
    Principal,
    get_current_principal,
    get_optional_principal,
    require_permission,
)
from app.core.errors import ConflictError, NotFoundError
from app.core.redis_client import cache_delete_prefix
from app.db.session import get_db
from app.models.epaper import (
    EpaperEdition,
    EpaperPage,
    EpaperPageArticle,
    EpaperPageShare,
    EpaperPageTemplate,
    EpaperUserEdition,
    EpaperUserEditionPreference,
)
from app.models.enums import AuditAction
from app.models.content import Category, Tag
from app.models.geo import District, Mandal
from app.schemas.epaper import (
    GenerateEditionIn,
    PageCreateIn,
    PageOrderIn,
    PageTemplateIn,
    PageUpdateIn,
    UserEditionIn,
)
from app.services import audit_service, epaper_service, settings_service

router = APIRouter(tags=["epaper"])


def _today() -> date:
    return datetime.now(epaper_service.IST).date()


@router.get("/epaper/today")
def today(db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    return epaper_service.serialize(db, epaper_service.load_edition(db, _today()))


@router.get("/epaper/options")
def preference_options(db: Session = Depends(get_db)):
    categories = db.scalars(
        select(Category).where(Category.is_active.is_(True)).order_by(Category.sort)
    ).all()
    districts = db.scalars(
        select(District)
        .where(District.is_active.is_(True))
        .order_by(District.state, District.sort)
    ).all()
    mandals = db.scalars(
        select(Mandal).where(Mandal.is_active.is_(True)).order_by(Mandal.name_en)
    ).all()
    tags = db.scalars(
        select(Tag).where(Tag.is_active.is_(True)).order_by(Tag.name_te)
    ).all()
    return {
        "categories": [
            {"id": x.id, "name_te": x.name_te, "name_en": x.name_en, "slug": x.slug}
            for x in categories
        ],
        "districts": [
            {"id": x.id, "name_te": x.name_te, "name_en": x.name_en, "slug": x.slug}
            for x in districts
        ],
        "mandals": [
            {
                "id": x.id,
                "district_id": x.district_id,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "slug": x.slug,
            }
            for x in mandals
        ],
        "tags": [
            {"id": x.id, "name_te": x.name_te, "name_en": x.name_en, "slug": x.slug}
            for x in tags
        ],
    }


@router.get("/epaper/archive")
def archive(limit: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    rows = db.scalars(
        select(EpaperEdition)
        .where(
            EpaperEdition.edition_type == "DAILY", EpaperEdition.status == "PUBLISHED"
        )
        .order_by(EpaperEdition.edition_date.desc())
        .limit(limit)
    ).all()
    return {
        "items": [epaper_service.serialize(db, x, include_pages=False) for x in rows]
    }


@router.get("/epaper/{edition_date}")
def by_date(edition_date: date, db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    return epaper_service.serialize(db, epaper_service.load_edition(db, edition_date))


@router.get("/epaper/{edition_date}/pages")
def pages(edition_date: date, db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    return {
        "pages": epaper_service.serialize(
            db, epaper_service.load_edition(db, edition_date)
        ).pages
    }


@router.get("/epaper/{edition_date}/pages/{page_number}")
def page(edition_date: date, page_number: int, db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    edition = epaper_service.serialize(
        db, epaper_service.load_edition(db, edition_date)
    )
    found = next((p for p in edition.pages if p.page_number == page_number), None)
    if not found:
        raise NotFoundError()
    return found


@router.get("/epaper/{edition_date}/pdf")
def pdf(edition_date: date, db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    edition = epaper_service.load_edition(db, edition_date)
    asset = epaper_service.generate_pdf(db, edition)
    if asset.status != "READY" or not asset.public_url:
        raise ConflictError(message_en="The PDF could not be generated.")
    return RedirectResponse(asset.public_url, status_code=307)


@router.get("/epaper/{edition_date}/audio")
def audio(edition_date: date, db: Session = Depends(get_db)):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    if not settings_service.get_bool(db, "epaper.audio_enabled"):
        return {"enabled": False, "tracks": []}
    edition = epaper_service.serialize(
        db, epaper_service.load_edition(db, edition_date)
    )
    tracks = [
        {
            "article_id": a.id,
            "short_id": a.short_id,
            "title_te": a.title_te,
            "url": a.audio_url,
            "page_number": p.page_number,
        }
        for p in edition.pages
        for a in p.articles
        if a.audio_url
    ]
    return {"enabled": True, "tracks": tracks}


@router.post("/epaper/{edition_date}/pages/{page_number}/share", status_code=202)
def share_page(
    edition_date: date,
    page_number: int,
    channel: str = "native",
    db: Session = Depends(get_db),
    p: Principal | None = Depends(get_optional_principal),
):
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()
    edition = epaper_service.load_edition(db, edition_date)
    page = next((x for x in edition.pages if x.page_number == page_number), None)
    if not page:
        raise NotFoundError()
    db.add(
        EpaperPageShare(
            page_id=page.id, user_id=p.id if p else None, channel=channel[:30]
        )
    )
    return {"recorded": True}


@router.get("/my-epaper")
def my_editions(
    db: Session = Depends(get_db), p: Principal = Depends(get_current_principal)
):
    rows = db.scalars(
        select(EpaperUserEdition)
        .options(selectinload(EpaperUserEdition.preferences))
        .where(EpaperUserEdition.user_id == p.id)
        .order_by(EpaperUserEdition.updated_at.desc())
    ).all()
    return {"items": [epaper_service.user_edition_row(x) for x in rows]}


def _replace_preferences(
    db: Session, row: EpaperUserEdition, payload: UserEditionIn
) -> None:
    db.execute(
        delete(EpaperUserEditionPreference).where(
            EpaperUserEditionPreference.user_edition_id == row.id
        )
    )
    for pref in payload.preferences:
        db.add(EpaperUserEditionPreference(user_edition_id=row.id, **pref.model_dump()))


@router.post("/my-epaper", status_code=201)
def create_my(
    payload: UserEditionIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    row = EpaperUserEdition(
        user_id=p.id,
        name=payload.name,
        auto_generate=payload.auto_generate,
        generation_time=payload.generation_time,
    )
    db.add(row)
    db.flush()
    _replace_preferences(db, row, payload)
    db.flush()
    return epaper_service.user_edition_row(row)


@router.patch("/my-epaper/{saved_id}")
def update_my(
    saved_id: int,
    payload: UserEditionIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    row = db.scalar(
        select(EpaperUserEdition)
        .options(selectinload(EpaperUserEdition.preferences))
        .where(EpaperUserEdition.id == saved_id, EpaperUserEdition.user_id == p.id)
    )
    if not row:
        raise NotFoundError()
    row.name, row.auto_generate, row.generation_time = (
        payload.name,
        payload.auto_generate,
        payload.generation_time,
    )
    _replace_preferences(db, row, payload)
    db.flush()
    return epaper_service.user_edition_row(row)


@router.delete("/my-epaper/{saved_id}")
def delete_my(
    saved_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    row = db.scalar(
        select(EpaperUserEdition).where(
            EpaperUserEdition.id == saved_id, EpaperUserEdition.user_id == p.id
        )
    )
    if not row:
        raise NotFoundError()
    row.is_active = False
    return {"id": row.id, "disabled": True}


@router.post("/my-epaper/{saved_id}/generate")
def generate_my(
    saved_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    if not settings_service.get_bool(db, "epaper.personalized_enabled"):
        raise ConflictError(message_en="Personalized E-Paper is disabled.")
    row = db.scalar(
        select(EpaperUserEdition)
        .options(selectinload(EpaperUserEdition.preferences))
        .where(
            EpaperUserEdition.id == saved_id,
            EpaperUserEdition.user_id == p.id,
            EpaperUserEdition.is_active.is_(True),
        )
    )
    if not row:
        raise NotFoundError()
    return epaper_service.serialize(db, epaper_service.generate_personal(db, row))


@router.get("/my-epaper/editions/{edition_id}")
def read_my_edition(
    edition_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    row = db.scalar(
        select(EpaperEdition)
        .options(
            selectinload(EpaperEdition.pages)
            .selectinload(EpaperPage.articles)
            .selectinload(EpaperPageArticle.article)
        )
        .where(
            EpaperEdition.id == edition_id,
            EpaperEdition.owner_user_id == p.id,
            EpaperEdition.status == "PUBLISHED",
        )
    )
    if not row:
        raise NotFoundError()
    return epaper_service.serialize(db, row)


@router.get("/my-epaper/editions/{edition_id}/pdf")
def download_my_edition(
    edition_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(get_current_principal),
):
    row = db.scalar(
        select(EpaperEdition).where(
            EpaperEdition.id == edition_id, EpaperEdition.owner_user_id == p.id
        )
    )
    if not row:
        raise NotFoundError()
    asset = epaper_service.generate_pdf(db, row)
    if asset.status != "READY" or not asset.public_url:
        raise ConflictError(message_en="The PDF could not be generated.")
    return RedirectResponse(asset.public_url, status_code=307)


# --------------------------------------------------------------- admin -----
@router.get("/admin/epaper/templates")
def templates(
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.view")),
):
    rows = epaper_service.ensure_templates(db, p.id)
    return {
        "items": [
            {
                "id": x.id,
                "slug": x.slug,
                "title_te": x.title_te,
                "title_en": x.title_en,
                "sort": x.sort,
                "category_ids": x.category_ids,
                "story_count": x.story_count,
                "layout_type": x.layout_type,
                "is_visible": x.is_visible,
            }
            for x in rows
        ]
    }


@router.post("/admin/epaper/templates", status_code=201)
def create_template(
    payload: PageTemplateIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    row = EpaperPageTemplate(**payload.model_dump(), created_by=p.id, updated_by=p.id)
    db.add(row)
    db.flush()
    return {"id": row.id, **payload.model_dump()}


@router.patch("/admin/epaper/templates/{template_id}")
def update_template(
    template_id: int,
    payload: PageTemplateIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    row = db.get(EpaperPageTemplate, template_id)
    if not row:
        raise NotFoundError()
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    row.updated_by = p.id
    return {"id": row.id, **payload.model_dump()}


@router.delete("/admin/epaper/templates/{template_id}")
def hide_template(
    template_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    row = db.get(EpaperPageTemplate, template_id)
    if not row:
        raise NotFoundError()
    row.is_visible = False
    row.updated_by = p.id
    return {"id": row.id, "hidden": True}


@router.get("/admin/epaper")
def admin_editions(
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.view")),
):
    rows = db.scalars(
        select(EpaperEdition)
        .options(selectinload(EpaperEdition.pages))
        .where(EpaperEdition.edition_type == "DAILY")
        .order_by(EpaperEdition.edition_date.desc())
        .limit(limit)
    ).all()
    return {
        "items": [epaper_service.serialize(db, x, include_pages=False) for x in rows]
    }


@router.get("/admin/epaper/by-date/{edition_date}")
def admin_edition_by_date(
    edition_date: date,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.view")),
):
    return epaper_service.serialize(
        db, epaper_service.load_edition(db, edition_date, public_only=False)
    )


@router.post("/admin/epaper/generate", status_code=201)
def generate(
    payload: GenerateEditionIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    edition = epaper_service.generate_daily(db, payload.edition_date, p.id)
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="epaper_edition",
        entity_id=edition.id,
        actor=p.user,
        request=request,
    )
    return epaper_service.serialize(db, edition)


@router.post("/admin/epaper/{edition_id}/regenerate")
def regenerate(
    edition_id: int,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    row = db.get(EpaperEdition, edition_id)
    if not row:
        raise NotFoundError()
    return epaper_service.serialize(
        db, epaper_service.generate_daily(db, row.edition_date, p.id, regenerate=True)
    )


@router.patch("/admin/epaper/{edition_id}/pages/{page_id}")
def update_page(
    edition_id: int,
    page_id: int,
    payload: PageUpdateIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    page = db.scalar(
        select(EpaperPage)
        .options(selectinload(EpaperPage.edition))
        .where(EpaperPage.id == page_id, EpaperPage.edition_id == edition_id)
    )
    if not page:
        raise NotFoundError()
    epaper_service.update_page(
        db,
        page,
        title=payload.title,
        layout_type=payload.layout_type,
        article_ids=payload.article_ids,
        poll_id=payload.poll_id,
    )
    return {"updated": True}


@router.post("/admin/epaper/{edition_id}/pages", status_code=201)
def add_page(
    edition_id: int,
    payload: PageCreateIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = db.scalar(
        select(EpaperEdition)
        .options(selectinload(EpaperEdition.pages))
        .where(EpaperEdition.id == edition_id)
    )
    if not edition:
        raise NotFoundError()
    if edition.status == "PUBLISHED":
        raise ConflictError(message_en="Published editions are immutable.")
    page = EpaperPage(
        edition_id=edition.id,
        page_number=len(edition.pages) + 1,
        title=payload.title,
        layout_type=payload.layout_type,
        status="GENERATED",
    )
    db.add(page)
    db.flush()
    epaper_service.update_page(
        db,
        page,
        title=None,
        layout_type=None,
        article_ids=payload.article_ids,
        poll_id=payload.poll_id,
    )
    return {"id": page.id, "created": True}


@router.delete("/admin/epaper/{edition_id}/pages/{page_id}")
def delete_page(
    edition_id: int,
    page_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = db.scalar(
        select(EpaperEdition)
        .options(selectinload(EpaperEdition.pages))
        .where(EpaperEdition.id == edition_id)
    )
    if not edition:
        raise NotFoundError()
    if edition.status == "PUBLISHED":
        raise ConflictError(message_en="Published editions are immutable.")
    page = next((row for row in edition.pages if row.id == page_id), None)
    if not page:
        raise NotFoundError()
    db.delete(page)
    remaining = [row for row in edition.pages if row.id != page_id]
    for number, row in enumerate(remaining, 1):
        row.page_number = -number
    db.flush()
    for number, row in enumerate(remaining, 1):
        row.page_number = number
    edition.revision += 1
    return {"id": page_id, "deleted": True}


@router.put("/admin/epaper/{edition_id}/pages/order")
def order_pages(
    edition_id: int,
    payload: PageOrderIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    rows = list(
        db.scalars(select(EpaperPage).where(EpaperPage.edition_id == edition_id))
    )
    if {x.id for x in rows} != set(payload.page_ids):
        raise ConflictError(
            message_en="Page order must include every page exactly once."
        )
    by_id = {x.id: x for x in rows}
    for number, page_id in enumerate(payload.page_ids, 1):
        by_id[page_id].page_number = -number
    db.flush()
    for number, page_id in enumerate(payload.page_ids, 1):
        by_id[page_id].page_number = number
    return {"ordered": True}


@router.post("/admin/epaper/{edition_id}/approve")
def approve(
    edition_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.publish")),
):
    row = db.get(EpaperEdition, edition_id)
    if not row:
        raise NotFoundError()
    epaper_service.approve(db, row, p.id)
    audit_service.record(
        db,
        action=AuditAction.APPROVE,
        entity_type="epaper_edition",
        entity_id=row.id,
        actor=p.user,
        request=request,
    )
    return epaper_service.serialize(db, row)


@router.post("/admin/epaper/{edition_id}/publish")
def publish(
    edition_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.publish")),
):
    row = db.get(EpaperEdition, edition_id)
    if not row:
        raise NotFoundError()
    epaper_service.publish(db, row, p.id)
    epaper_service.generate_pdf(db, row)
    cache_delete_prefix("home:")
    audit_service.record(
        db,
        action=AuditAction.EPAPER_PUBLISH,
        entity_type="epaper_edition",
        entity_id=row.id,
        actor=p.user,
        request=request,
    )
    return epaper_service.serialize(db, row)


@router.post("/admin/epaper/{edition_id}/pdf")
def create_pdf(
    edition_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.upload")),
):
    row = db.get(EpaperEdition, edition_id)
    if not row:
        raise NotFoundError()
    asset = epaper_service.generate_pdf(db, row)
    return {"status": asset.status, "url": asset.public_url, "error": asset.error}
