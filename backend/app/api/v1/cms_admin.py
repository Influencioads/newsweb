from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.core.redis_client import cache_delete_prefix
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.content import Category, Tag
from app.models.enums import AuditAction, HomeSectionKind
from app.models.geo import District, Locality, Mandal, State
from app.models.media import Media
from app.models.site import HomepageSection
from app.models.user import Role, User
from app.services import audit_service

router = APIRouter(prefix="/cms", tags=["cms-management"])


def page(db: Session, model: type, stmt, offset: int, limit: int) -> tuple[list, int]:
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    return list(db.scalars(stmt.offset(offset).limit(limit)).all()), total


@router.get("/taxonomy")
def taxonomy(db: Session = Depends(get_db), _p: Principal = Depends(require_permission("taxonomy.view"))):
    categories = db.scalars(select(Category).order_by(Category.sort, Category.name_en)).all()
    districts = db.scalars(select(District).order_by(District.state, District.sort, District.name_en)).all()
    tags = db.scalars(select(Tag).order_by(Tag.usage_count.desc(), Tag.name_en).limit(250)).all()
    return {
        "categories": [{"id": x.id, "slug": x.slug, "name_te": x.name_te, "name_en": x.name_en, "active": x.is_active, "in_nav": x.show_in_nav} for x in categories],
        "districts": [{"id": x.id, "slug": x.slug, "name_te": x.name_te, "name_en": x.name_en, "state": x.state, "active": x.is_active} for x in districts],
        "tags": [{"id": x.id, "slug": x.slug, "name_te": x.name_te, "name_en": x.name_en, "type": x.type, "usage_count": x.usage_count, "active": x.is_active} for x in tags],
    }


@router.get("/media")
def media_library(offset: int = Query(0, ge=0), limit: int = Query(48, ge=1, le=100),
                  db: Session = Depends(get_db), _p: Principal = Depends(require_permission("media.view"))):
    stmt = select(Media).where(Media.deleted_at.is_(None)).order_by(Media.created_at.desc())
    rows, total = page(db, Media, stmt, offset, limit)
    return {"items": [{"id": x.id, "type": x.type, "filename": x.filename, "mime": x.mime,
                        "bytes": x.bytes, "url": x.cdn_url or f"/media/{x.storage_key}",
                        "width": x.width, "height": x.height, "credit": x.credit,
                        "alt_te": x.alt_te, "ai_generated": x.ai_generated,
                        "created_at": x.created_at} for x in rows], "total": total}


@router.get("/users")
def users(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
          db: Session = Depends(get_db), _p: Principal = Depends(require_permission("user.view"))):
    stmt = select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc())
    rows, total = page(db, User, stmt, offset, limit)
    return {"items": [{"id": x.id, "name_te": x.name_te, "name_en": x.name_en, "email": x.email,
                        "phone": x.phone, "status": x.status, "two_factor_enabled": x.two_factor_enabled,
                        "last_login_at": x.last_login_at, "roles": [{"key": ur.role.key, "label_te": ur.role.label_te, "label_en": ur.role.label_en,
                        "scope_type": ur.scope_type, "scope_id": ur.scope_id} for ur in x.roles if ur.role]} for x in rows], "total": total}


@router.get("/roles")
def roles(db: Session = Depends(get_db), _p: Principal = Depends(require_permission("role.view"))):
    rows = db.scalars(select(Role).order_by(Role.level.desc(), Role.label_en)).all()
    return {"items": [{"id": x.id, "key": x.key, "label_te": x.label_te, "label_en": x.label_en,
                        "level": x.level, "scope": x.default_scope_type, "staff": x.is_staff,
                        "permissions": sorted(x.permission_keys)} for x in rows], "total": len(rows)}


@router.get("/audit")
def audit(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
          db: Session = Depends(get_db), _p: Principal = Depends(require_permission("audit.view"))):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc())
    rows, total = page(db, AuditLog, stmt, offset, limit)
    return {"items": [{"id": x.id, "actor": x.actor_label, "actor_id": x.actor_id, "action": x.action,
                        "entity_type": x.entity_type, "entity_id": x.entity_id, "note": x.note,
                        "ip": x.ip, "request_id": x.request_id, "created_at": x.created_at} for x in rows], "total": total}


# --------------------------------------------------------------------------- #
# taxonomy management (updated doc §19 Categories)
# --------------------------------------------------------------------------- #
class CategoryWrite(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    name_te: str = Field(min_length=1, max_length=120)
    name_en: str = Field(min_length=1, max_length=120)
    show_in_nav: bool = True
    sort: int = 0


class CategoryPatch(BaseModel):
    name_te: str | None = Field(default=None, max_length=120)
    name_en: str | None = Field(default=None, max_length=120)
    show_in_nav: bool | None = None
    is_active: bool | None = None
    sort: int | None = None


def _invalidate_public_cache() -> None:
    """A taxonomy or homepage change must reach readers without a deploy —
    the config/home caches are purged, the next request rebuilds them."""
    cache_delete_prefix("home:")
    cache_delete_prefix("locations")


@router.post("/taxonomy/categories", status_code=201)
def create_category(payload: CategoryWrite, request: Request, db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("taxonomy.manage"))):
    exists = db.scalar(select(Category).where(Category.slug == payload.slug))
    if exists is not None:
        raise ValidationError(details={"slug": "already exists"})
    cat = Category(**payload.model_dump())
    db.add(cat)
    db.flush()
    audit_service.record(db, action=AuditAction.CREATE, entity_type="category",
                         entity_id=cat.id, actor=p.user, after=payload.model_dump(), request=request)
    _invalidate_public_cache()
    return {"id": cat.id, "slug": cat.slug}


@router.patch("/taxonomy/categories/{category_id}")
def update_category(category_id: int, payload: CategoryPatch, request: Request,
                    db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("taxonomy.manage"))):
    cat = db.get(Category, category_id)
    if cat is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(cat, k) for k in changes}
    for k, v in changes.items():
        setattr(cat, k, v)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="category",
                         entity_id=cat.id, actor=p.user, before=before, after=changes, request=request)
    _invalidate_public_cache()
    return {"id": cat.id, "slug": cat.slug, "active": cat.is_active,
            "in_nav": cat.show_in_nav, "sort": cat.sort}


# --------------------------------------------------------------------------- #
# homepage sections (updated doc §24 — admin-controlled homepage)
# --------------------------------------------------------------------------- #
class SectionPatch(BaseModel):
    sort: int | None = None
    is_enabled: bool | None = None
    item_count: int | None = Field(default=None, ge=1, le=20)
    min_items: int | None = Field(default=None, ge=1, le=10)
    title_te: str | None = Field(default=None, max_length=120)
    title_en: str | None = Field(default=None, max_length=120)


class SectionCreate(BaseModel):
    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9_-]+$")
    kind: HomeSectionKind = HomeSectionKind.CATEGORY
    category_id: int | None = None
    sort: int = 0
    is_enabled: bool = True
    item_count: int = Field(default=7, ge=1, le=20)
    min_items: int = Field(default=3, ge=1, le=10)


def _section_row(s: HomepageSection) -> dict:
    return {"id": s.id, "key": s.key, "kind": s.kind, "category_id": s.category_id,
            "category_slug": s.category.slug if s.category else None,
            "title_te": s.title_te or (s.category.name_te if s.category else None),
            "title_en": s.title_en or (s.category.name_en if s.category else None),
            "sort": s.sort, "is_enabled": s.is_enabled,
            "item_count": s.item_count, "min_items": s.min_items}


@router.get("/homepage/sections")
def homepage_sections_admin(db: Session = Depends(get_db),
                            _p: Principal = Depends(require_permission("settings.view"))):
    rows = db.scalars(select(HomepageSection).order_by(HomepageSection.sort, HomepageSection.id)).all()
    return {"items": [_section_row(s) for s in rows], "total": len(rows)}


@router.post("/homepage/sections", status_code=201)
def create_homepage_section(payload: SectionCreate, request: Request, db: Session = Depends(get_db),
                            p: Principal = Depends(require_permission("settings.manage"))):
    if db.scalar(select(HomepageSection).where(HomepageSection.key == payload.key)) is not None:
        raise ValidationError(details={"key": "already exists"})
    if payload.kind == HomeSectionKind.CATEGORY:
        if payload.category_id is None or db.get(Category, payload.category_id) is None:
            raise ValidationError(details={"category_id": "required for a category section"})
    section = HomepageSection(**payload.model_dump())
    db.add(section)
    db.flush()
    audit_service.record(db, action=AuditAction.CREATE, entity_type="homepage_section",
                         entity_id=section.id, actor=p.user, after=payload.model_dump(), request=request)
    _invalidate_public_cache()
    return _section_row(section)


@router.patch("/homepage/sections/{section_id}")
def update_homepage_section(section_id: int, payload: SectionPatch, request: Request,
                            db: Session = Depends(get_db),
                            p: Principal = Depends(require_permission("settings.manage"))):
    section = db.get(HomepageSection, section_id)
    if section is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(section, k) for k in changes}
    for k, v in changes.items():
        setattr(section, k, v)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="homepage_section",
                         entity_id=section.id, actor=p.user, before=before, after=changes, request=request)
    _invalidate_public_cache()
    return _section_row(section)


class SectionOrder(BaseModel):
    ordered_ids: list[int] = Field(min_length=1, max_length=100)


@router.put("/homepage/sections/order")
def reorder_homepage_sections(payload: SectionOrder, request: Request, db: Session = Depends(get_db),
                              p: Principal = Depends(require_permission("settings.manage"))):
    rows = {s.id: s for s in db.scalars(select(HomepageSection)).all()}
    unknown = [i for i in payload.ordered_ids if i not in rows]
    if unknown:
        raise ValidationError(details={"ordered_ids": f"unknown section ids: {unknown}"})
    for position, section_id in enumerate(payload.ordered_ids):
        rows[section_id].sort = position
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="homepage_section",
                         entity_id="order", actor=p.user,
                         after={"ordered_ids": payload.ordered_ids}, request=request)
    _invalidate_public_cache()
    return {"ok": True, "count": len(payload.ordered_ids)}


# --------------------------------------------------------------------------- #
# moderation (updated doc §19 Moderation) — reports and comments
# --------------------------------------------------------------------------- #
class ReportClose(BaseModel):
    dismiss: bool = False
    note: str | None = Field(default=None, max_length=500)


class CommentModerate(BaseModel):
    hide: bool


@router.get("/moderation/reports")
def moderation_reports(status: str | None = Query(None, pattern="^(open|resolved|dismissed)$"),
                       offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                       db: Session = Depends(get_db),
                       _p: Principal = Depends(require_permission("comment.moderate"))):
    from app.models.engagement import Comment
    from app.models.enums import ReportStatus, ReportTargetType
    from app.repositories import engagement_repo

    rows, total = engagement_repo.report_queue(
        db, status=ReportStatus(status) if status else None, offset=offset, limit=limit)

    article_ids = [r.target_id for r in rows if r.target_type == ReportTargetType.ARTICLE]
    comment_ids = [r.target_id for r in rows if r.target_type == ReportTargetType.COMMENT]
    articles = engagement_repo.articles_by_ids(db, article_ids)
    comments = {c.id: c for c in db.scalars(
        select(Comment).where(Comment.id.in_(comment_ids))).all()} if comment_ids else {}

    def target_of(r):
        if r.target_type == ReportTargetType.ARTICLE:
            a = articles.get(r.target_id)
            return {"kind": "article", "id": r.target_id,
                    "title_te": a.title_te if a else None,
                    "short_id": a.short_id if a else None,
                    "url": a.url_path if a else None}
        c = comments.get(r.target_id)
        return {"kind": "comment", "id": r.target_id,
                "body": (c.body[:200] if c else None), "status": c.status if c else None,
                "author": (c.user.name_en if c and c.user else None)}

    return {"items": [{"id": r.id, "reason": r.reason, "note": r.note, "status": r.status,
                        "reporter_id": r.user_id, "created_at": r.created_at,
                        "resolved_at": r.resolved_at, "resolution_note": r.resolution_note,
                        "target": target_of(r)} for r in rows], "total": total}


@router.post("/moderation/reports/{report_id}/close")
def close_report(report_id: int, payload: ReportClose, request: Request,
                 db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("comment.moderate"))):
    from app.services import engagement_service

    report = engagement_service.close_report(
        db, report_id=report_id, moderator_id=p.id, dismiss=payload.dismiss, note=payload.note)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="report",
                         entity_id=report.id, actor=p.user,
                         after={"status": report.status, "note": payload.note}, request=request)
    return {"id": report.id, "status": report.status}


@router.get("/moderation/comments")
def moderation_comments(status: str | None = Query(None, pattern="^(visible|pending|hidden|deleted)$"),
                        offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                        db: Session = Depends(get_db),
                        _p: Principal = Depends(require_permission("comment.moderate"))):
    from app.models.enums import CommentStatus
    from app.repositories import engagement_repo

    rows, total = engagement_repo.comment_queue(
        db, status=CommentStatus(status) if status else None, offset=offset, limit=limit)
    articles = engagement_repo.articles_by_ids(db, [c.article_id for c in rows])
    return {"items": [{"id": c.id, "body": c.body, "status": c.status,
                        "author": c.user.name_en if c.user else None,
                        "author_id": c.user_id, "parent_id": c.parent_id,
                        "article_title_te": (articles[c.article_id].title_te
                                              if c.article_id in articles else None),
                        "article_short_id": (articles[c.article_id].short_id
                                              if c.article_id in articles else None),
                        "created_at": c.created_at} for c in rows], "total": total}


@router.patch("/moderation/comments/{comment_id}")
def moderate_comment(comment_id: int, payload: CommentModerate, request: Request,
                     db: Session = Depends(get_db),
                     p: Principal = Depends(require_permission("comment.moderate"))):
    from app.services import engagement_service

    comment = engagement_service.moderate_comment(
        db, comment_id=comment_id, moderator_id=p.id, hide=payload.hide)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="comment",
                         entity_id=comment.id, actor=p.user,
                         after={"status": comment.status}, request=request)
    return {"id": comment.id, "status": comment.status}


# --------------------------------------------------------------------------- #
# location master (updated doc §4 / §19 Locations)
# --------------------------------------------------------------------------- #
class MandalWrite(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    name_te: str = Field(min_length=1, max_length=120)
    name_en: str = Field(min_length=1, max_length=120)


class LocalityWrite(MandalWrite):
    kind: str = Field(default="village", pattern=r"^(city|town|village)$")


class LocationTogglePatch(BaseModel):
    is_active: bool | None = None
    name_te: str | None = Field(default=None, max_length=120)
    name_en: str | None = Field(default=None, max_length=120)


@router.get("/locations")
def locations_admin(db: Session = Depends(get_db),
                    _p: Principal = Depends(require_permission("taxonomy.view"))):
    states = db.scalars(select(State).order_by(State.sort)).all()
    districts = db.scalars(select(District).order_by(District.state, District.sort)).all()
    mandal_counts = dict(db.execute(
        select(Mandal.district_id, func.count(Mandal.id)).group_by(Mandal.district_id)
    ).all())
    return {
        "states": [{"id": s.id, "code": s.code, "slug": s.slug, "name_te": s.name_te,
                     "name_en": s.name_en, "active": s.is_active} for s in states],
        "districts": [{"id": d.id, "slug": d.slug, "state": d.state, "name_te": d.name_te,
                        "name_en": d.name_en, "active": d.is_active,
                        "mandal_count": int(mandal_counts.get(d.id, 0))} for d in districts],
    }


@router.get("/locations/districts/{district_id}/mandals")
def district_mandals_admin(district_id: int, db: Session = Depends(get_db),
                           _p: Principal = Depends(require_permission("taxonomy.view"))):
    rows = db.scalars(select(Mandal).where(Mandal.district_id == district_id)
                      .order_by(Mandal.name_en)).all()
    locality_counts = dict(db.execute(
        select(Locality.mandal_id, func.count(Locality.id)).group_by(Locality.mandal_id)
    ).all())
    return {"items": [{"id": m.id, "slug": m.slug, "name_te": m.name_te, "name_en": m.name_en,
                        "active": m.is_active,
                        "locality_count": int(locality_counts.get(m.id, 0))} for m in rows]}


@router.post("/locations/districts/{district_id}/mandals", status_code=201)
def create_mandal(district_id: int, payload: MandalWrite, request: Request,
                  db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("taxonomy.manage"))):
    if db.get(District, district_id) is None:
        raise NotFoundError()
    exists = db.scalar(select(Mandal).where(Mandal.district_id == district_id,
                                            Mandal.slug == payload.slug))
    if exists is not None:
        raise ValidationError(details={"slug": "already exists in this district"})
    mandal = Mandal(district_id=district_id, **payload.model_dump())
    db.add(mandal)
    db.flush()
    audit_service.record(db, action=AuditAction.CREATE, entity_type="mandal",
                         entity_id=mandal.id, actor=p.user, after=payload.model_dump(), request=request)
    _invalidate_public_cache()
    return {"id": mandal.id, "slug": mandal.slug}


@router.get("/locations/mandals/{mandal_id}/localities")
def mandal_localities_admin(mandal_id: int, db: Session = Depends(get_db),
                            _p: Principal = Depends(require_permission("taxonomy.view"))):
    rows = db.scalars(select(Locality).where(Locality.mandal_id == mandal_id)
                      .order_by(Locality.name_en)).all()
    return {"items": [{"id": x.id, "slug": x.slug, "name_te": x.name_te, "name_en": x.name_en,
                        "kind": x.kind, "active": x.is_active} for x in rows]}


@router.post("/locations/mandals/{mandal_id}/localities", status_code=201)
def create_locality(mandal_id: int, payload: LocalityWrite, request: Request,
                    db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("taxonomy.manage"))):
    if db.get(Mandal, mandal_id) is None:
        raise NotFoundError()
    exists = db.scalar(select(Locality).where(Locality.mandal_id == mandal_id,
                                              Locality.slug == payload.slug))
    if exists is not None:
        raise ValidationError(details={"slug": "already exists in this mandal"})
    locality = Locality(mandal_id=mandal_id, **payload.model_dump())
    db.add(locality)
    db.flush()
    audit_service.record(db, action=AuditAction.CREATE, entity_type="locality",
                         entity_id=locality.id, actor=p.user, after=payload.model_dump(), request=request)
    _invalidate_public_cache()
    return {"id": locality.id, "slug": locality.slug}


def _patch_location(db: Session, row, payload: LocationTogglePatch, p: Principal,
                    request: Request, entity_type: str) -> dict:
    if row is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(row, k) for k in changes}
    for k, v in changes.items():
        setattr(row, k, v)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type=entity_type,
                         entity_id=row.id, actor=p.user, before=before, after=changes, request=request)
    _invalidate_public_cache()
    return {"id": row.id, "slug": row.slug, "active": row.is_active}


@router.patch("/locations/districts/{district_id}")
def update_district(district_id: int, payload: LocationTogglePatch, request: Request,
                    db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("taxonomy.manage"))):
    return _patch_location(db, db.get(District, district_id), payload, p, request, "district")


@router.patch("/locations/mandals/{mandal_id}")
def update_mandal(mandal_id: int, payload: LocationTogglePatch, request: Request,
                  db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("taxonomy.manage"))):
    return _patch_location(db, db.get(Mandal, mandal_id), payload, p, request, "mandal")


@router.patch("/locations/localities/{locality_id}")
def update_locality(locality_id: int, payload: LocationTogglePatch, request: Request,
                    db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("taxonomy.manage"))):
    return _patch_location(db, db.get(Locality, locality_id), payload, p, request, "locality")


@router.get("/settings")
def settings_summary(_p: Principal = Depends(require_permission("settings.view"))):
    return {"environment": settings.APP_ENV, "site_name": settings.APP_NAME, "app_url": settings.APP_URL,
            "api_url": settings.API_URL, "storage_provider": settings.STORAGE_PROVIDER,
            "ai_enabled": settings.AI_ENABLED, "secure_cookies": settings.SECURE_COOKIES,
            "hsts_enabled": settings.HSTS_ENABLED, "csp_enabled": settings.CSP_ENABLED,
            "public_cache_ttl_seconds": settings.PUBLIC_CACHE_TTL_SECONDS,
            "breaking_cache_ttl_seconds": settings.BREAKING_CACHE_TTL_SECONDS}
