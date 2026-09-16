from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
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
from app.models.content import Category, Tag
from app.models.enums import AuditAction
from app.models.epaper import (
    EpaperEdition,
    EpaperPage,
    EpaperPageShare,
    EpaperPageTemplate,
    EpaperUserEdition,
    EpaperUserEditionPreference,
)
from app.models.geo import District, Mandal
from app.schemas.epaper import (
    FillIn,
    GenerateEditionIn,
    PageCreateIn,
    PageOrderIn,
    PageTemplateIn,
    PageUpdateIn,
    RegenerateIn,
    UserEditionIn,
)
from app.services import audit_service, epaper_service, settings_service

router = APIRouter(tags=["epaper"])


def _today() -> date:
    return datetime.now(epaper_service.IST).date()


def _require_enabled(db: Session) -> None:
    if not settings_service.get_bool(db, "epaper.enabled"):
        raise NotFoundError()


def _admin_edition(db: Session, edition_id: int) -> EpaperEdition:
    row = db.scalar(
        select(EpaperEdition)
        .options(epaper_service._page_loads())
        .where(EpaperEdition.id == edition_id)
    )
    if not row:
        raise NotFoundError()
    return row


def _page_of(edition: EpaperEdition, page_id: int) -> EpaperPage:
    page = next((row for row in edition.pages if row.id == page_id), None)
    if not page:
        raise NotFoundError()
    return page


def _page_out(db: Session, edition: EpaperEdition, page_id: int):  # type: ignore[no-untyped-def]
    db.expire(edition, ["pages"])
    return next(p for p in epaper_service.serialize(db, edition).pages if p.id == page_id)


def _audit(
    db: Session, request: Request, p: Principal, action: AuditAction, edition_id: int
) -> None:
    audit_service.record(
        db,
        action=action,
        entity_type="epaper_edition",
        entity_id=edition_id,
        actor=p.user,
        request=request,
    )


def _start_pdf(
    db: Session, edition: EpaperEdition, background: BackgroundTasks
) -> tuple[str, str | None, str | None]:
    asset = epaper_service.queue_pdf(db, edition)
    if asset.status == "PENDING":
        background.add_task(epaper_service.render_pdf_job, edition.id)
    return asset.status, asset.public_url, asset.error


# -------------------------------------------------------------- public -----
@router.get("/epaper/today")
def today(db: Session = Depends(get_db)):
    _require_enabled(db)
    return epaper_service.serialize(
        db, epaper_service.load_edition(db, _today()), include_pdf=False
    )


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
    _require_enabled(db)
    rows = db.scalars(
        select(EpaperEdition)
        .options(selectinload(EpaperEdition.pages))
        .where(
            EpaperEdition.edition_type == "DAILY", EpaperEdition.status == "PUBLISHED"
        )
        .order_by(EpaperEdition.edition_date.desc())
        .limit(limit)
    ).all()
    return {
        "items": [
            epaper_service.serialize(db, x, include_pages=False, include_pdf=False)
            for x in rows
        ]
    }


@router.get("/epaper/{edition_date}")
def by_date(edition_date: date, db: Session = Depends(get_db)):
    _require_enabled(db)
    return epaper_service.serialize(
        db, epaper_service.load_edition(db, edition_date), include_pdf=False
    )


@router.get("/epaper/{edition_date}/pages")
def pages(edition_date: date, db: Session = Depends(get_db)):
    _require_enabled(db)
    return {
        "pages": epaper_service.serialize(
            db, epaper_service.load_edition(db, edition_date), include_pdf=False
        ).pages
    }


@router.get("/epaper/{edition_date}/pages/{page_number}")
def page(edition_date: date, page_number: int, db: Session = Depends(get_db)):
    _require_enabled(db)
    edition = epaper_service.serialize(
        db, epaper_service.load_edition(db, edition_date), include_pdf=False
    )
    found = next((p for p in edition.pages if p.page_number == page_number), None)
    if not found:
        raise NotFoundError()
    return found


@router.get("/epaper/{edition_date}/audio")
def audio(edition_date: date, db: Session = Depends(get_db)):
    _require_enabled(db)
    if not settings_service.get_bool(db, "epaper.audio_enabled"):
        return {"enabled": False, "tracks": []}
    edition = epaper_service.serialize(
        db, epaper_service.load_edition(db, edition_date), include_pdf=False
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
    _require_enabled(db)
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


# ------------------------------------------------------------ personal -----
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
        raise ConflictError(
            message_en="Personalized E-Paper is disabled.",
            message_te="వ్యక్తిగత ఈ-పేపర్ ప్రస్తుతం అందుబాటులో లేదు.",
        )
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
        .options(epaper_service._page_loads())
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
        select(EpaperEdition)
        .options(epaper_service._page_loads())
        .where(EpaperEdition.id == edition_id, EpaperEdition.owner_user_id == p.id)
    )
    if not row:
        raise NotFoundError()
    # Personal editions are small and private: rendered on demand, text only.
    asset = epaper_service.generate_pdf(db, row, images=False)
    if asset.status != "READY" or not asset.public_url:
        raise ConflictError(
            message_en=f"The PDF could not be generated: {asset.error or 'unknown error'}",
            message_te="PDF రూపొందించలేకపోయాం.",
        )
    return RedirectResponse(asset.public_url, status_code=307)


# --------------------------------------------------------------- admin -----
@router.get("/admin/epaper/templates")
def templates(
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.view")),
):
    rows = epaper_service.ensure_templates(db, p.id)
    return {"items": [epaper_service.template_row(x) for x in rows]}


@router.post("/admin/epaper/templates", status_code=201)
def create_template(
    payload: PageTemplateIn,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    row = EpaperPageTemplate(**payload.model_dump(), created_by=p.id, updated_by=p.id)
    db.add(row)
    db.flush()
    return epaper_service.template_row(row)


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
    db.flush()
    return epaper_service.template_row(row)


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


@router.get("/admin/epaper/plan")
def plan(
    edition_date: date | None = None,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.view")),
):
    """What the day has to offer before anyone presses Generate."""
    return epaper_service.plan_preview(db, edition_date or _today(), p.id)


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
    edition = epaper_service.generate_daily(
        db, payload.edition_date, p.id, page_count=payload.page_count
    )
    _audit(db, request, p, AuditAction.CREATE, edition.id)
    return epaper_service.serialize(db, edition)


@router.post("/admin/epaper/{edition_id}/regenerate")
def regenerate(
    edition_id: int,
    request: Request,
    payload: RegenerateIn | None = None,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.upload")),
):
    row = _admin_edition(db, edition_id)
    edition = epaper_service.regenerate(
        db, row, p.id, page_count=payload.page_count if payload else None
    )
    _audit(db, request, p, AuditAction.UPDATE, edition.id)
    return epaper_service.serialize(db, edition)


@router.get("/admin/epaper/{edition_id}/candidates")
def candidates(
    edition_id: int,
    page_id: int | None = None,
    q: str | None = Query(None, max_length=120),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.view")),
):
    """Stories of the day not yet placed, best first; the page's own section first."""
    edition = _admin_edition(db, edition_id)
    page = _page_of(edition, page_id) if page_id is not None else None
    return {
        "items": epaper_service.candidates(db, edition, page=page, q=q, limit=limit)
    }


@router.post("/admin/epaper/{edition_id}/pages/{page_id}/fill")
def fill_page(
    edition_id: int,
    page_id: int,
    payload: FillIn | None = None,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = _admin_edition(db, edition_id)
    page = _page_of(edition, page_id)
    epaper_service.fill_page(db, page, reset=bool(payload and payload.reset))
    return _page_out(db, edition, page_id)


@router.post("/admin/epaper/{edition_id}/fill")
def fill_edition(
    edition_id: int,
    payload: FillIn | None = None,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = _admin_edition(db, edition_id)
    epaper_service.fill_edition(db, edition, reset=bool(payload and payload.reset))
    db.expire(edition, ["pages"])
    return epaper_service.serialize(db, edition)


@router.patch("/admin/epaper/{edition_id}/pages/{page_id}")
def update_page(
    edition_id: int,
    page_id: int,
    payload: PageUpdateIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = _admin_edition(db, edition_id)
    page = _page_of(edition, page_id)
    epaper_service.update_page(db, page, payload.model_dump(exclude_unset=True))
    return _page_out(db, edition, page_id)


@router.post("/admin/epaper/{edition_id}/pages", status_code=201)
def add_page(
    edition_id: int,
    payload: PageCreateIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = _admin_edition(db, edition_id)
    page = epaper_service.add_page(db, edition, payload)
    return _page_out(db, edition, page.id)


@router.delete("/admin/epaper/{edition_id}/pages/{page_id}")
def delete_page(
    edition_id: int,
    page_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = _admin_edition(db, edition_id)
    epaper_service.delete_page(db, edition, page_id)
    return {"id": page_id, "deleted": True}


@router.put("/admin/epaper/{edition_id}/pages/order")
def order_pages(
    edition_id: int,
    payload: PageOrderIn,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.hotspot")),
):
    edition = _admin_edition(db, edition_id)
    epaper_service.order_pages(db, edition, payload.page_ids)
    return {"ordered": True}


@router.post("/admin/epaper/{edition_id}/submit")
def submit(
    edition_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.hotspot")),
):
    row = _admin_edition(db, edition_id)
    epaper_service.submit(db, row, p.id)
    _audit(db, request, p, AuditAction.SUBMIT, row.id)
    return epaper_service.serialize(db, row)


@router.post("/admin/epaper/{edition_id}/approve")
def approve(
    edition_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.publish")),
):
    row = _admin_edition(db, edition_id)
    epaper_service.approve(db, row, p.id)
    _audit(db, request, p, AuditAction.APPROVE, row.id)
    return epaper_service.serialize(db, row)


@router.post("/admin/epaper/{edition_id}/publish")
def publish(
    edition_id: int,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.publish")),
):
    row = _admin_edition(db, edition_id)
    epaper_service.publish(db, row, p.id)
    _start_pdf(db, row, background)
    cache_delete_prefix("home:")
    _audit(db, request, p, AuditAction.EPAPER_PUBLISH, row.id)
    return epaper_service.serialize(db, row)


@router.post("/admin/epaper/{edition_id}/withdraw")
def withdraw(
    edition_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("epaper.publish")),
):
    row = _admin_edition(db, edition_id)
    epaper_service.withdraw(db, row, p.id)
    cache_delete_prefix("home:")
    _audit(db, request, p, AuditAction.UNPUBLISH, row.id)
    return epaper_service.serialize(db, row)


@router.post("/admin/epaper/{edition_id}/pdf")
def create_pdf(
    edition_id: int,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("epaper.upload")),
):
    row = _admin_edition(db, edition_id)
    status, url, error = _start_pdf(db, row, background)
    return {"status": status, "url": url, "error": error}
