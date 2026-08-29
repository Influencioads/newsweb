from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import Principal, require_permission
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.content import Category, Tag
from app.models.geo import District
from app.models.media import Media
from app.models.user import Role, User

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


@router.get("/settings")
def settings_summary(_p: Principal = Depends(require_permission("settings.view"))):
    return {"environment": settings.APP_ENV, "site_name": settings.APP_NAME, "app_url": settings.APP_URL,
            "api_url": settings.API_URL, "storage_provider": settings.STORAGE_PROVIDER,
            "ai_enabled": settings.AI_ENABLED, "secure_cookies": settings.SECURE_COOKIES,
            "hsts_enabled": settings.HSTS_ENABLED, "csp_enabled": settings.CSP_ENABLED,
            "public_cache_ttl_seconds": settings.PUBLIC_CACHE_TTL_SECONDS,
            "breaking_cache_ttl_seconds": settings.BREAKING_CACHE_TTL_SECONDS}
