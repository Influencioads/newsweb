"""Site content and footer pages, edited from the CMS (app/services/site_content).

    GET    /cms/site-content            every block, with defaults
    PUT    /cms/site-content/{block}    save one block
    DELETE /cms/site-content/{block}    back to the default
    GET    /cms/pages                   the saved footer pages
    PUT    /cms/pages/{slug}            save a footer page
    DELETE /cms/pages/{slug}            back to the website's original copy
    GET    /public/pages/{slug}         a saved footer page (404: use the original)

The blocks reach readers through `GET /public/config` (`content`).
"""

from typing import Any

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.enums import AuditAction
from app.services import audit_service, site_content

router = APIRouter(tags=["site-content"])


@router.get("/cms/site-content", summary="Site content blocks, with their defaults")
def admin_site_content(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("settings.view")),
) -> dict[str, Any]:
    return site_content.admin_blocks(db)


@router.put("/cms/site-content/{block}", summary="Save one site content block")
def save_site_content(
    block: str,
    request: Request,
    payload: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
) -> dict[str, Any]:
    value = site_content.save_block(db, block, payload, p.id)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="site_content",
        entity_id=block,
        actor=p.user,
        after=value,
        request=request,
    )
    return value


@router.delete("/cms/site-content/{block}", summary="Put one block back to its default")
def reset_site_content(
    block: str,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
) -> dict[str, Any]:
    value = site_content.reset_block(db, block)
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="site_content",
        entity_id=block,
        actor=p.user,
        request=request,
    )
    return value


@router.get("/cms/pages", summary="Footer pages saved from the CMS")
def admin_pages(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("settings.view")),
) -> dict[str, Any]:
    return {"slugs": list(site_content.PAGE_SLUGS), "pages": site_content.pages(db)}


@router.put("/cms/pages/{slug}", summary="Save a footer page")
def save_page(
    slug: str,
    request: Request,
    payload: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
) -> dict[str, Any]:
    page = site_content.save_page(db, slug, payload, p.id)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="site_page",
        entity_id=slug,
        actor=p.user,
        after={"title_te": page["te"]["title"], "title_en": page["en"]["title"]},
        request=request,
    )
    return page


@router.delete("/cms/pages/{slug}", summary="Go back to the page's original copy")
def reset_page(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
) -> dict[str, bool]:
    site_content.reset_page(db, slug)
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="site_page",
        entity_id=slug,
        actor=p.user,
        request=request,
    )
    return {"ok": True}


@router.get("/public/pages/{slug}", summary="A footer page saved from the CMS")
def public_page(slug: str, response: Response, db: Session = Depends(get_db)) -> dict[str, Any]:
    page = site_content.page(db, slug)
    if page is None:
        raise NotFoundError()
    response.headers["Cache-Control"] = "public, max-age=60"
    return page
