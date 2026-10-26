from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, union_all, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import Principal, require_permission
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.redis_client import cache_delete_prefix
from app.db.base import utcnow
from app.db.seed_content import RETIRED_CATEGORY_SLUGS
from app.db.session import get_db
from app.models.ai import AiArticleDraft, AiSuggestion
from app.models.audit import AuditLog
from app.models.content import Article, Category, Tag
from app.models.creator import AdCampaign, CreatorSubmission
from app.models.discovery import Pin, TrendingScore
from app.models.engagement import Follow
from app.models.enums import (
    AuditAction,
    FollowTargetType,
    HomeSectionKind,
    ScopeType,
    TrendingScope,
)
from app.models.epaper import EpaperPageTemplate, EpaperUserEditionPreference
from app.models.geo import District, Locality, Mandal, State
from app.models.ingestion import ContentSource
from app.models.media import Media
from app.models.notify import NotificationCampaign
from app.models.poll import Poll, TrendingTopic
from app.models.reader import UserPreference
from app.models.setting import AppSetting
from app.models.site import HomepageSection
from app.models.user import Role, User, UserRole
from app.models.video import Video
from app.services import audit_service, panchayat_service

router = APIRouter(prefix="/cms", tags=["cms-management"])


def page(db: Session, model: type, stmt, offset: int, limit: int) -> tuple[list, int]:
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    return list(db.scalars(stmt.offset(offset).limit(limit)).all()), total


@router.get("/taxonomy")
def taxonomy(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("taxonomy.view")),
):
    categories = db.scalars(
        select(Category).order_by(Category.sort, Category.name_en)
    ).all()
    # One grouped count over both placement columns (a story is filed under a
    # section and optionally a sub-section). Soft-deleted stories count too:
    # they still block a delete.
    refs = union_all(
        select(Article.category_id.label("cid")),
        select(Article.subcategory_id.label("cid")),
    ).subquery()
    article_counts = dict(
        db.execute(
            select(refs.c.cid, func.count())
            .where(refs.c.cid.is_not(None))
            .group_by(refs.c.cid)
        ).all()
    )
    districts = db.scalars(
        select(District).order_by(District.state, District.sort, District.name_en)
    ).all()
    tags = db.scalars(
        select(Tag).order_by(Tag.usage_count.desc(), Tag.name_en).limit(250)
    ).all()
    return {
        "categories": [
            {
                "id": x.id,
                "slug": x.slug,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "active": x.is_active,
                "in_nav": x.show_in_nav,
                "is_active": x.is_active,
                "show_in_nav": x.show_in_nav,
                "sort": x.sort,
                "parent_id": x.parent_id,
                "description_te": x.description_te,
                "article_count": int(article_counts.get(x.id, 0)),
            }
            for x in categories
        ],
        "districts": [
            {
                "id": x.id,
                "slug": x.slug,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "state": x.state,
                "active": x.is_active,
            }
            for x in districts
        ],
        "tags": [
            {
                "id": x.id,
                "slug": x.slug,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "type": x.type,
                "usage_count": x.usage_count,
                "active": x.is_active,
            }
            for x in tags
        ],
    }


@router.get("/media")
def media_library(
    offset: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("media.view")),
):
    from app.services.media_service import STUDIO_ONLY, meta_flag

    # The creative studio's references and backdrops live on its own screen;
    # here they would be offered as a story's main image.
    stmt = (
        select(Media)
        .where(Media.deleted_at.is_(None), *(~meta_flag(k) for k in STUDIO_ONLY))
        .order_by(Media.created_at.desc())
    )
    rows, total = page(db, Media, stmt, offset, limit)
    return {
        "items": [
            {
                "id": x.id,
                "type": x.type,
                "filename": x.filename,
                "mime": x.mime,
                "bytes": x.bytes,
                "url": x.cdn_url or f"/media/{x.storage_key}",
                "width": x.width,
                "height": x.height,
                "credit": x.credit,
                "alt_te": x.alt_te,
                "ai_generated": x.ai_generated,
                "created_at": x.created_at,
            }
            for x in rows
        ],
        "total": total,
    }


@router.post("/media", status_code=201)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    alt_te: str | None = Form(None),
    caption_te: str | None = Form(None),
    credit: str | None = Form(None),
    source_type: str = Form("own"),
    ai_generated: bool = Form(False),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("media.upload")),
):
    """§1 needs a picker, and a picker needs something to pick — this is the
    upload behind it. Validation, EXIF stripping and re-encoding all happen in
    `media_service`; nothing here trusts the declared content type."""
    from app.services import media_service

    raw = await file.read()
    media = media_service.create_image_media(
        db,
        raw=raw,
        filename=file.filename or "upload",
        mime=file.content_type or "application/octet-stream",
        max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
        uploaded_by=p.id,
        alt_te=alt_te,
        caption_te=caption_te,
        credit=credit,
        source_type=source_type,
        # §7.4: an AI-made picture carries the visible label wherever it shows.
        ai_generated=ai_generated,
    )
    audit_service.record(
        db,
        action=AuditAction.MEDIA_UPLOAD,
        entity_type="media",
        entity_id=media.id,
        actor=p.user,
        after={"filename": media.filename, "bytes": media.bytes, "ai_generated": ai_generated},
        request=request,
    )
    return {
        "id": media.id,
        "url": media.cdn_url or f"/media/{media.storage_key}",
        "width": media.width,
        "height": media.height,
        "alt_te": media.alt_te,
        "credit": media.credit,
        "blurhash": media.blurhash,
    }


@router.get("/users")
def users(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("user.view")),
):
    stmt = (
        select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc())
    )
    rows, total = page(db, User, stmt, offset, limit)
    return {
        "items": [
            {
                "id": x.id,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "email": x.email,
                "phone": x.phone,
                "status": x.status,
                "two_factor_enabled": x.two_factor_enabled,
                "last_login_at": x.last_login_at,
                "roles": [
                    {
                        "key": ur.role.key,
                        "label_te": ur.role.label_te,
                        "label_en": ur.role.label_en,
                        "scope_type": ur.scope_type,
                        "scope_id": ur.scope_id,
                    }
                    for ur in x.roles
                    if ur.role
                ],
            }
            for x in rows
        ],
        "total": total,
    }


@router.get("/roles")
def roles(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("role.view")),
):
    rows = db.scalars(select(Role).order_by(Role.level.desc(), Role.label_en)).all()
    return {
        "items": [
            {
                "id": x.id,
                "key": x.key,
                "label_te": x.label_te,
                "label_en": x.label_en,
                "level": x.level,
                "scope": x.default_scope_type,
                "staff": x.is_staff,
                "permissions": sorted(x.permission_keys),
            }
            for x in rows
        ],
        "total": len(rows),
    }


@router.get("/audit")
def audit(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("audit.view")),
):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc())
    rows, total = page(db, AuditLog, stmt, offset, limit)
    return {
        "items": [
            {
                "id": x.id,
                "actor": x.actor_label,
                "actor_id": x.actor_id,
                "action": x.action,
                "entity_type": x.entity_type,
                "entity_id": x.entity_id,
                "note": x.note,
                "ip": x.ip,
                "request_id": x.request_id,
                "created_at": x.created_at,
            }
            for x in rows
        ],
        "total": total,
    }


# --------------------------------------------------------------------------- #
# taxonomy management (updated doc §19 Categories)
# --------------------------------------------------------------------------- #
_CATEGORY_SLUG = r"^[a-z0-9-]+$"


class CategoryWrite(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=_CATEGORY_SLUG)
    name_te: str = Field(min_length=1, max_length=120)
    name_en: str = Field(min_length=1, max_length=120)
    parent_id: int | None = None
    description_te: str | None = Field(default=None, max_length=2000)
    show_in_nav: bool = True
    is_active: bool = True
    #: Omitted -> appended after the last category.
    sort: int | None = None


class CategoryPatch(BaseModel):
    slug: str | None = Field(
        default=None, min_length=2, max_length=80, pattern=_CATEGORY_SLUG
    )
    name_te: str | None = Field(default=None, min_length=1, max_length=120)
    name_en: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: int | None = None
    description_te: str | None = Field(default=None, max_length=2000)
    show_in_nav: bool | None = None
    is_active: bool | None = None
    sort: int | None = None


class CategoryOrder(BaseModel):
    ordered_ids: list[int] = Field(min_length=1, max_length=500)


#: Columns NOT NULL in `categories` — a PATCH may omit them, never null them.
_CATEGORY_REQUIRED = ("slug", "name_te", "name_en", "show_in_nav", "is_active", "sort")

#: Rows that file content under a category. Deleting a category any of these
#: point at needs a destination (`move_to`), so nothing silently loses its
#: section — and ad campaigns, which the FK would cascade-delete, survive.
_FILED_UNDER = (
    ("videos", Video.category_id),
    ("sources", ContentSource.default_category_id),
    ("submissions", CreatorSubmission.category_id),
    ("ad_campaigns", AdCampaign.category_id),
)
#: Loose labels: they follow a move, or lose the category (what MySQL's SET
#: NULL would do; SQLite tests don't enforce FKs, so it is done by hand).
_LOOSE_REFS = (
    Poll.category_id,
    TrendingTopic.category_id,
    AiSuggestion.category_id,
    AiArticleDraft.category_id,
)


def _invalidate_public_cache() -> None:
    """A taxonomy or homepage change must reach readers without a deploy —
    the config/home caches are purged, the next request rebuilds them."""
    cache_delete_prefix("home:")
    cache_delete_prefix("locations")
    # Per-category trending lists are keyed by slug and carry its names.
    cache_delete_prefix("trending:")


def _count(db: Session, *where) -> int:
    return int(db.scalar(select(func.count()).where(*where)) or 0)


def _refuse_system_category(cat: Category, what: str) -> None:
    """`panchayat_service.stamp_ugc` finds its section by this exact slug."""
    if cat.slug == panchayat_service.PANCHAYAT_CATEGORY_SLUG:
        raise ConflictError(
            message_en=f"The panchayat section is used by the system; it can't be {what}.",
            message_te="పంచాయతీ విభాగాన్ని సిస్టమ్ వాడుతుంది; దీన్ని మార్చడం/తొలగించడం కుదరదు.",
            details={"slug": cat.slug},
        )


def _repoint_campaigns(db: Session, old_slug: str, new_slug: str | None) -> int:
    """A scheduled push stores its audience as `category:<slug>` and resolves
    it at send time, so it follows a rename/move — or, with nowhere to go, is
    cancelled now rather than failing unseen at release."""
    values = (
        {"audience": f"category:{new_slug}"} if new_slug else {"status": "cancelled"}
    )
    return db.execute(
        update(NotificationCampaign)
        .where(
            NotificationCampaign.status == "scheduled",
            NotificationCampaign.audience == f"category:{old_slug}",
        )
        .values(**values)
    ).rowcount


def _check_parent(db: Session, cat_id: int | None, parent_id: int | None) -> None:
    """Two levels only (section > sub-section), which also rules out cycles:
    the parent must be an existing top-level category other than this one, and
    a category that has sub-categories can't become one itself."""
    if parent_id is None:
        return
    parent = db.get(Category, parent_id)
    if parent is None or parent.id == cat_id or parent.parent_id is not None:
        raise ValidationError(
            details={"parent_id": "must be another existing top-level category"}
        )
    if cat_id is not None and _count(db, Category.parent_id == cat_id):
        raise ValidationError(
            details={"parent_id": "a category with sub-categories can't be nested"}
        )


def _ensure_home_section(db: Session, cat: Category) -> None:
    """A top-level nav category gets a home block (web + mobile render only
    configured sections), appended at the end — the insert-only rule of
    `seed_homepage_sections`, inlined so the route doesn't import the seed."""
    if cat.parent_id is not None or not cat.show_in_nav:
        return
    taken = db.scalar(
        select(HomepageSection.id).where(
            or_(HomepageSection.key == cat.slug, HomepageSection.category_id == cat.id)
        )
    )
    if taken is not None:
        return
    last = db.scalar(select(func.coalesce(func.max(HomepageSection.sort), -1)))
    db.add(
        HomepageSection(
            key=cat.slug,
            kind=HomeSectionKind.CATEGORY,
            category_id=cat.id,
            sort=int(last) + 1,
            is_enabled=True,
            item_count=7,
            min_items=3,
        )
    )
    db.flush()


def _rewrite_reader_slugs(db: Session, old: str, new: str | None) -> None:
    """Readers' interests are a JSON list of slugs: rename (or drop, when
    `new` is None) in Python so it runs the same on SQLite and MySQL."""
    # ponytail: scans every preferences row; add a JSON_CONTAINS prefilter if
    # user_preferences grows past what an admin click can wait for.
    for prefs in db.scalars(
        select(UserPreference).where(UserPreference.category_slugs.is_not(None))
    ):
        slugs = list(prefs.category_slugs or [])
        if old not in slugs:
            continue
        out: list[str] = []
        for s in slugs:
            s = new if s == old else s
            if s and s not in out:
                out.append(s)
        prefs.category_slugs = out


def _retire_slug(db: Session, slug: str) -> None:
    """Remember a slug renamed away or deleted, so `seed_categories` doesn't
    re-create it (with a nav entry and home block) on the next re-seed."""
    row = db.scalar(select(AppSetting).where(AppSetting.key == RETIRED_CATEGORY_SLUGS))
    if row is None:
        row = AppSetting(key=RETIRED_CATEGORY_SLUGS, value={"v": []})
        db.add(row)
    slugs = list((row.value or {}).get("v") or [])
    if slug not in slugs:
        row.value = {"v": [*slugs, slug]}


def _repoint(db: Session, owner, target, kind, old: int, new: int | None) -> None:
    """Move rows unique per (owner, kind, target) — reader follows, personal
    e-paper picks — from category `old` to `new`. An owner already holding
    `new` just loses `old`; with no `new` they are all dropped."""
    model = target.class_
    if new is not None:
        # ponytail: the ids are materialised (MySQL can't subselect the table
        # it deletes from); fine up to tens of thousands of followers.
        have = list(db.scalars(select(owner).where(kind, target == new)))
        if have:
            db.execute(delete(model).where(kind, target == old, owner.in_(have)))
        db.execute(update(model).where(kind, target == old).values({target: new}))
    else:
        db.execute(delete(model).where(kind, target == old))


@router.post("/taxonomy/categories", status_code=201)
def create_category(
    payload: CategoryWrite,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    exists = db.scalar(select(Category).where(Category.slug == payload.slug))
    if exists is not None:
        raise ValidationError(details={"slug": "already exists"})
    _check_parent(db, None, payload.parent_id)
    data = payload.model_dump()
    # The reader nav is flat: a sub-section joins it only when asked to.
    if payload.parent_id is not None and "show_in_nav" not in payload.model_fields_set:
        data["show_in_nav"] = False
    if data["sort"] is None:
        data["sort"] = int(db.scalar(select(func.coalesce(func.max(Category.sort), -1)))) + 1
    cat = Category(**data)
    db.add(cat)
    db.flush()
    _ensure_home_section(db, cat)
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="category",
        entity_id=cat.id,
        actor=p.user,
        after=data,
        request=request,
    )
    _invalidate_public_cache()
    return {"id": cat.id, "slug": cat.slug}


@router.put("/taxonomy/categories/order")
def reorder_categories(
    payload: CategoryOrder,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    rows = {c.id: c for c in db.scalars(select(Category)).all()}
    unknown = [i for i in payload.ordered_ids if i not in rows]
    if unknown:
        raise ValidationError(
            details={"ordered_ids": f"unknown category ids: {unknown}"}
        )
    for position, cat_id in enumerate(payload.ordered_ids):
        rows[cat_id].sort = position
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="category",
        entity_id="order",
        actor=p.user,
        after={"ordered_ids": payload.ordered_ids},
        request=request,
    )
    _invalidate_public_cache()
    return {"ok": True, "count": len(payload.ordered_ids)}


@router.patch("/taxonomy/categories/{category_id}")
def update_category(
    category_id: int,
    payload: CategoryPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    cat = db.get(Category, category_id)
    if cat is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    for k in _CATEGORY_REQUIRED:
        if k in changes and changes[k] is None:
            raise ValidationError(details={k: "may not be empty"})
    if changes.get("slug", cat.slug) == cat.slug:
        changes.pop("slug", None)
    if changes.get("parent_id", cat.parent_id) == cat.parent_id:
        changes.pop("parent_id", None)

    old_slug = cat.slug
    if "slug" in changes:
        _refuse_system_category(cat, "renamed")
        new_slug = changes["slug"]
        if db.scalar(select(Category.id).where(Category.slug == new_slug)) is not None:
            raise ValidationError(details={"slug": "already exists"})
        # The category's home block is keyed by its slug (/section/<key>); a
        # different block already holding the new key would collide.
        if db.scalar(
            select(HomepageSection.id).where(
                HomepageSection.key == new_slug,
                or_(
                    HomepageSection.category_id.is_(None),
                    HomepageSection.category_id != cat.id,
                ),
            )
        ) is not None:
            raise ValidationError(
                details={"slug": "already used by a homepage section"}
            )
    if "parent_id" in changes:
        _refuse_system_category(cat, "moved")
        _check_parent(db, cat.id, changes["parent_id"])

    before = {k: getattr(cat, k) for k in changes}
    audit_after = dict(changes)
    for k, v in changes.items():
        setattr(cat, k, v)
    if "parent_id" in changes:
        # Re-file its stories so each stays valid for
        # workflow_service._resolve_placement (a sub-section is a child of the
        # story's section): nested -> section = new parent, sub-section = this;
        # promoted -> section = this, no sub-section. (It has no children:
        # _check_parent refuses nesting one that does.)
        ours = or_(Article.category_id == cat.id, Article.subcategory_id == cat.id)
        section, sub = (cat.parent_id, cat.id) if cat.parent_id else (cat.id, None)
        audit_after["stories_refiled"] = db.execute(
            update(Article).where(ours).values(category_id=section, subcategory_id=sub)
        ).rowcount
    if "slug" in changes:
        _retire_slug(db, old_slug)
        db.execute(
            update(HomepageSection)
            .where(
                HomepageSection.category_id == cat.id,
                HomepageSection.key == old_slug,
            )
            .values(key=cat.slug)
        )
        _rewrite_reader_slugs(db, old_slug, cat.slug)
        audit_after["campaigns_repointed"] = _repoint_campaigns(db, old_slug, cat.slug)
    if changes.get("show_in_nav") or "parent_id" in changes:
        db.flush()
        _ensure_home_section(db, cat)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="category",
        entity_id=cat.id,
        actor=p.user,
        before=before,
        after=audit_after,
        request=request,
    )
    _invalidate_public_cache()
    return {
        "id": cat.id,
        "slug": cat.slug,
        "active": cat.is_active,
        "in_nav": cat.show_in_nav,
        "sort": cat.sort,
        "parent_id": cat.parent_id,
    }


@router.delete("/taxonomy/categories/{category_id}")
def delete_category(
    category_id: int,
    request: Request,
    move_to: int | None = Query(None, description="Category that inherits its content"),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    """Hard delete. A category still holding content is refused (409, with
    the counts) unless `move_to` names where that content goes; hiding it
    instead is PATCH `is_active=false`."""
    cat = db.get(Category, category_id)
    if cat is None:
        raise NotFoundError()
    _refuse_system_category(cat, "deleted")
    children = _count(db, Category.parent_id == cat.id)
    if children:
        raise ConflictError(
            message_en="Delete or move its sub-categories first.",
            message_te="ముందు దీని ఉప-విభాగాలను తొలగించండి లేదా మార్చండి.",
            details={"children": children},
        )
    desks = _count(
        db, UserRole.scope_type == ScopeType.DESK, UserRole.scope_id == cat.id
    )
    if desks:
        raise ConflictError(
            message_en="Staff roles are scoped to this desk; reassign them first.",
            message_te="ఈ డెస్క్‌కు సిబ్బంది పాత్రలు ఉన్నాయి; ముందు వాటిని మార్చండి.",
            details={"desk_roles": desks},
        )

    counts = {
        "articles": _count(
            db, or_(Article.category_id == cat.id, Article.subcategory_id == cat.id)
        ),
        **{name: _count(db, col == cat.id) for name, col in _FILED_UNDER},
    }
    target: Category | None = None
    if move_to is not None:
        target = db.get(Category, move_to)
        if target is None or target.id == cat.id:
            raise ValidationError(details={"move_to": "must be another existing category"})
    elif any(counts.values()):
        raise ConflictError(
            message_en="This category still has content. Choose where to move it.",
            message_te="ఈ విభాగంలో ఇంకా కంటెంట్ ఉంది. దాన్ని ఎక్కడికి మార్చాలో ఎంచుకోండి.",
            details={"counts": counts},
        )

    if target is not None:
        # Every story filed here (as section or sub-section) lands on the
        # target, kept valid for _resolve_placement: a sub-section target
        # files it under its parent + it, a section target alone.
        section, sub = (
            (target.parent_id, target.id) if target.parent_id else (target.id, None)
        )
        db.execute(
            update(Article)
            .where(or_(Article.category_id == cat.id, Article.subcategory_id == cat.id))
            .values(category_id=section, subcategory_id=sub)
        )
        for _name, col in _FILED_UNDER:
            db.execute(update(col.class_).where(col == cat.id).values({col: target.id}))
    new_id = target.id if target else None
    follows = Follow.target_type == FollowTargetType.CATEGORY
    _repoint(db, Follow.user_id, Follow.target_id, follows, cat.id, new_id)
    pick = EpaperUserEditionPreference
    picks = pick.preference_type == "category"
    _repoint(db, pick.user_edition_id, pick.target_id, picks, cat.id, new_id)
    for col in _LOOSE_REFS:
        db.execute(
            update(col.class_)
            .where(col == cat.id)
            .values({col: target.id if target else None})
        )
    # FK cascades, done explicitly — SQLite (tests) doesn't enforce them.
    db.execute(delete(HomepageSection).where(HomepageSection.category_id == cat.id))
    db.execute(delete(Pin).where(Pin.category_id == cat.id))
    db.execute(
        delete(TrendingScore).where(
            TrendingScore.scope_type == TrendingScope.CATEGORY,
            TrendingScore.scope_id == cat.id,
        )
    )
    # References with no FK at all.
    for tpl in db.scalars(select(EpaperPageTemplate)):
        if cat.id in (tpl.category_ids or []):
            tpl.category_ids = [i for i in tpl.category_ids if i != cat.id]
    _rewrite_reader_slugs(db, cat.slug, None)
    campaigns = _repoint_campaigns(db, cat.slug, target.slug if target else None)
    _retire_slug(db, cat.slug)

    slug = cat.slug
    db.delete(cat)
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="category",
        entity_id=category_id,
        actor=p.user,
        before={"slug": slug, "name_en": cat.name_en},
        after={
            "move_to": target.slug if target else None,
            "moved": counts,
            "scheduled_pushes": campaigns,
        },
        request=request,
    )
    _invalidate_public_cache()
    return {"ok": True, "slug": slug, "moved": counts}


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
    return {
        "id": s.id,
        "key": s.key,
        "kind": s.kind,
        "category_id": s.category_id,
        "category_slug": s.category.slug if s.category else None,
        "title_te": s.title_te or (s.category.name_te if s.category else None),
        "title_en": s.title_en or (s.category.name_en if s.category else None),
        "sort": s.sort,
        "is_enabled": s.is_enabled,
        "item_count": s.item_count,
        "min_items": s.min_items,
    }


@router.get("/homepage/sections")
def homepage_sections_admin(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("settings.view")),
):
    rows = db.scalars(
        select(HomepageSection).order_by(HomepageSection.sort, HomepageSection.id)
    ).all()
    return {"items": [_section_row(s) for s in rows], "total": len(rows)}


@router.post("/homepage/sections", status_code=201)
def create_homepage_section(
    payload: SectionCreate,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
):
    if (
        db.scalar(select(HomepageSection).where(HomepageSection.key == payload.key))
        is not None
    ):
        raise ValidationError(details={"key": "already exists"})
    if payload.kind == HomeSectionKind.CATEGORY:
        if payload.category_id is None or db.get(Category, payload.category_id) is None:
            raise ValidationError(
                details={"category_id": "required for a category section"}
            )
    section = HomepageSection(**payload.model_dump())
    db.add(section)
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="homepage_section",
        entity_id=section.id,
        actor=p.user,
        after=payload.model_dump(),
        request=request,
    )
    _invalidate_public_cache()
    return _section_row(section)


@router.patch("/homepage/sections/{section_id}")
def update_homepage_section(
    section_id: int,
    payload: SectionPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
):
    section = db.get(HomepageSection, section_id)
    if section is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(section, k) for k in changes}
    for k, v in changes.items():
        setattr(section, k, v)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="homepage_section",
        entity_id=section.id,
        actor=p.user,
        before=before,
        after=changes,
        request=request,
    )
    _invalidate_public_cache()
    return _section_row(section)


class SectionOrder(BaseModel):
    ordered_ids: list[int] = Field(min_length=1, max_length=100)


@router.put("/homepage/sections/order")
def reorder_homepage_sections(
    payload: SectionOrder,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
):
    rows = {s.id: s for s in db.scalars(select(HomepageSection)).all()}
    unknown = [i for i in payload.ordered_ids if i not in rows]
    if unknown:
        raise ValidationError(
            details={"ordered_ids": f"unknown section ids: {unknown}"}
        )
    for position, section_id in enumerate(payload.ordered_ids):
        rows[section_id].sort = position
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="homepage_section",
        entity_id="order",
        actor=p.user,
        after={"ordered_ids": payload.ordered_ids},
        request=request,
    )
    _invalidate_public_cache()
    return {"ok": True, "count": len(payload.ordered_ids)}


# --------------------------------------------------------------------------- #
# moderation (updated doc §19 Moderation) — reports and comments
# --------------------------------------------------------------------------- #
class ReportClose(BaseModel):
    dismiss: bool = False
    note: str | None = Field(default=None, max_length=500)


class CommentModerate(BaseModel):
    """`hide` stays required for every existing caller; `pinned` is optional so
    a client that only hides is unchanged."""

    hide: bool
    pinned: bool | None = None


@router.get("/moderation/reports")
def moderation_reports(
    status: str | None = Query(None, pattern="^(open|resolved|dismissed)$"),
    ugc_only: bool = Query(
        False, description="Only reports about contributed (user-submitted) articles"
    ),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("comment.moderate")),
):
    """The moderation queue, heaviest first.

    Ordered by how many people reported the same target, because three reports
    on one article is a different signal from three reports on three. That is
    all it is: **nothing here unpublishes anything at a threshold.** A
    coordinated brigade would be the fastest way to take down real journalism,
    so the count moves a story up a human's list and no further.
    """
    from app.models.content import Article
    from app.models.engagement import Comment, Report
    from app.models.enums import ReportStatus, ReportTargetType
    from app.repositories import engagement_repo

    where = [Report.status == ReportStatus(status)] if status else []
    if ugc_only:
        where += [
            Report.target_type == ReportTargetType.ARTICLE,
            Report.target_id.in_(
                select(Article.id).where(Article.article_source_type == "USER")
            ),
        ]
    # One GROUP BY over open reports, joined back on the target.
    open_counts = (
        select(
            Report.target_type.label("target_type"),
            Report.target_id.label("target_id"),
            func.count(Report.id).label("n"),
        )
        .where(Report.status == ReportStatus.OPEN)
        .group_by(Report.target_type, Report.target_id)
        .subquery()
    )
    heat = func.coalesce(open_counts.c.n, 0)
    paged = db.execute(
        select(Report, heat)
        .outerjoin(
            open_counts,
            (open_counts.c.target_type == Report.target_type)
            & (open_counts.c.target_id == Report.target_id),
        )
        .where(*where)
        .order_by(heat.desc(), Report.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    rows = [row[0] for row in paged]
    counts = {row[0].id: int(row[1] or 0) for row in paged}
    total = int(db.scalar(select(func.count(Report.id)).where(*where)) or 0)

    article_ids = [
        r.target_id for r in rows if r.target_type == ReportTargetType.ARTICLE
    ]
    comment_ids = [
        r.target_id for r in rows if r.target_type == ReportTargetType.COMMENT
    ]
    articles = engagement_repo.articles_by_ids(db, article_ids)
    comments = (
        {
            c.id: c
            for c in db.scalars(
                select(Comment).where(Comment.id.in_(comment_ids))
            ).all()
        }
        if comment_ids
        else {}
    )

    def target_of(r):
        if r.target_type == ReportTargetType.ARTICLE:
            a = articles.get(r.target_id)
            return {
                "kind": "article",
                "id": r.target_id,
                "title_te": a.title_te if a else None,
                "short_id": a.short_id if a else None,
                "url": a.url_path if a else None,
            }
        c = comments.get(r.target_id)
        return {
            "kind": "comment",
            "id": r.target_id,
            "body": (c.body[:200] if c else None),
            "status": c.status if c else None,
            "author": (c.user.name_en if c and c.user else None),
        }

    return {
        "items": [
            {
                "id": r.id,
                "reason": r.reason,
                "note": r.note,
                "status": r.status,
                "reporter_id": r.user_id,
                #: Open reports against the same target, this one included.
                "report_count": counts.get(r.id, 0),
                "created_at": r.created_at,
                "resolved_at": r.resolved_at,
                "resolution_note": r.resolution_note,
                "target": target_of(r),
            }
            for r in rows
        ],
        "total": total,
    }


@router.post("/moderation/reports/{report_id}/close")
def close_report(
    report_id: int,
    payload: ReportClose,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("comment.moderate")),
):
    from app.services import engagement_service

    report = engagement_service.close_report(
        db,
        report_id=report_id,
        moderator_id=p.id,
        dismiss=payload.dismiss,
        note=payload.note,
    )
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="report",
        entity_id=report.id,
        actor=p.user,
        after={"status": report.status, "note": payload.note},
        request=request,
    )
    return {"id": report.id, "status": report.status}


@router.get("/moderation/comments")
def moderation_comments(
    status: str | None = Query(None, pattern="^(visible|pending|hidden|deleted)$"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("comment.moderate")),
):
    from app.models.enums import CommentStatus
    from app.repositories import engagement_repo

    from app.models.enums import CommentTargetType
    from app.models.video import Video

    rows, total = engagement_repo.comment_queue(
        db, status=CommentStatus(status) if status else None, offset=offset, limit=limit
    )

    # §15 — the queue now carries video comments too, so the parent lookup has
    # to follow the target type. A moderator needs to see *what* was commented
    # on; without this a video comment would show a blank headline.
    articles = engagement_repo.articles_by_ids(
        db, [c.article_id for c in rows if c.article_id]
    )
    video_ids = [c.video_id for c in rows if c.video_id]
    videos = (
        {
            v.id: v
            for v in db.scalars(select(Video).where(Video.id.in_(video_ids))).all()
        }
        if video_ids
        else {}
    )

    def parent_of(c) -> dict:
        if c.target_type == CommentTargetType.VIDEO:
            video = videos.get(c.video_id)
            return {
                "target_type": "video",
                "title_te": video.title_te if video else None,
                "ref": str(video.id) if video else None,
            }
        article = articles.get(c.article_id)
        return {
            "target_type": "article",
            "title_te": article.title_te if article else None,
            "ref": article.short_id if article else None,
        }

    return {
        "items": [
            {
                "id": c.id,
                "body": c.body,
                "status": c.status,
                "author": c.user.name_en if c.user else None,
                "author_id": c.user_id,
                "parent_id": c.parent_id,
                "target": parent_of(c),
                # Kept for the existing admin table; a video comment
                # reports the video's title in the same field.
                "article_title_te": parent_of(c)["title_te"],
                "article_short_id": parent_of(c)["ref"],
                "created_at": c.created_at,
                "is_pinned": c.pinned_at is not None,
                # An editorially seeded comment has no account behind it. The
                # queue says so rather than showing a moderator a name they
                # cannot look up.
                "is_seeded": c.is_seeded,
            }
            for c in rows
        ],
        "total": total,
    }


@router.patch("/moderation/comments/{comment_id}")
def moderate_comment(
    comment_id: int,
    payload: CommentModerate,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("comment.moderate")),
):
    from app.services import engagement_service

    comment = engagement_service.moderate_comment(
        db, comment_id=comment_id, moderator_id=p.id, hide=payload.hide
    )
    if payload.pinned is not None:
        # Promoting the best comment to the top of the thread is moderation,
        # so it reuses `comment.moderate` rather than inventing a permission.
        comment.pinned_at = utcnow() if payload.pinned else None
        db.flush()
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="comment",
        entity_id=comment.id,
        actor=p.user,
        after={
            "status": comment.status,
            "pinned_at": comment.pinned_at.isoformat() if comment.pinned_at else None,
        },
        request=request,
    )
    return {
        "id": comment.id,
        "status": comment.status,
        "is_pinned": comment.pinned_at is not None,
    }


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
def locations_admin(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("taxonomy.view")),
):
    states = db.scalars(select(State).order_by(State.sort)).all()
    districts = db.scalars(
        select(District).order_by(District.state, District.sort)
    ).all()
    mandal_counts = dict(
        db.execute(
            select(Mandal.district_id, func.count(Mandal.id)).group_by(
                Mandal.district_id
            )
        ).all()
    )
    return {
        "states": [
            {
                "id": s.id,
                "code": s.code,
                "slug": s.slug,
                "name_te": s.name_te,
                "name_en": s.name_en,
                "active": s.is_active,
            }
            for s in states
        ],
        "districts": [
            {
                "id": d.id,
                "slug": d.slug,
                "state": d.state,
                "name_te": d.name_te,
                "name_en": d.name_en,
                "active": d.is_active,
                "mandal_count": int(mandal_counts.get(d.id, 0)),
            }
            for d in districts
        ],
    }


@router.get("/locations/districts/{district_id}/mandals")
def district_mandals_admin(
    district_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("taxonomy.view")),
):
    rows = db.scalars(
        select(Mandal).where(Mandal.district_id == district_id).order_by(Mandal.name_en)
    ).all()
    locality_counts = dict(
        db.execute(
            select(Locality.mandal_id, func.count(Locality.id)).group_by(
                Locality.mandal_id
            )
        ).all()
    )
    return {
        "items": [
            {
                "id": m.id,
                "slug": m.slug,
                "name_te": m.name_te,
                "name_en": m.name_en,
                "active": m.is_active,
                "locality_count": int(locality_counts.get(m.id, 0)),
            }
            for m in rows
        ]
    }


@router.post("/locations/districts/{district_id}/mandals", status_code=201)
def create_mandal(
    district_id: int,
    payload: MandalWrite,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    if db.get(District, district_id) is None:
        raise NotFoundError()
    exists = db.scalar(
        select(Mandal).where(
            Mandal.district_id == district_id, Mandal.slug == payload.slug
        )
    )
    if exists is not None:
        raise ValidationError(details={"slug": "already exists in this district"})
    mandal = Mandal(district_id=district_id, **payload.model_dump())
    db.add(mandal)
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="mandal",
        entity_id=mandal.id,
        actor=p.user,
        after=payload.model_dump(),
        request=request,
    )
    _invalidate_public_cache()
    return {"id": mandal.id, "slug": mandal.slug}


@router.get("/locations/mandals/{mandal_id}/localities")
def mandal_localities_admin(
    mandal_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("taxonomy.view")),
):
    rows = db.scalars(
        select(Locality)
        .where(Locality.mandal_id == mandal_id)
        .order_by(Locality.name_en)
    ).all()
    return {
        "items": [
            {
                "id": x.id,
                "slug": x.slug,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "kind": x.kind,
                "active": x.is_active,
            }
            for x in rows
        ]
    }


@router.post("/locations/mandals/{mandal_id}/localities", status_code=201)
def create_locality(
    mandal_id: int,
    payload: LocalityWrite,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    if db.get(Mandal, mandal_id) is None:
        raise NotFoundError()
    exists = db.scalar(
        select(Locality).where(
            Locality.mandal_id == mandal_id, Locality.slug == payload.slug
        )
    )
    if exists is not None:
        raise ValidationError(details={"slug": "already exists in this mandal"})
    locality = Locality(mandal_id=mandal_id, **payload.model_dump())
    db.add(locality)
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="locality",
        entity_id=locality.id,
        actor=p.user,
        after=payload.model_dump(),
        request=request,
    )
    _invalidate_public_cache()
    return {"id": locality.id, "slug": locality.slug}


def _patch_location(
    db: Session,
    row,
    payload: LocationTogglePatch,
    p: Principal,
    request: Request,
    entity_type: str,
) -> dict:
    if row is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(row, k) for k in changes}
    for k, v in changes.items():
        setattr(row, k, v)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type=entity_type,
        entity_id=row.id,
        actor=p.user,
        before=before,
        after=changes,
        request=request,
    )
    _invalidate_public_cache()
    return {"id": row.id, "slug": row.slug, "active": row.is_active}


@router.patch("/locations/districts/{district_id}")
def update_district(
    district_id: int,
    payload: LocationTogglePatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    return _patch_location(
        db, db.get(District, district_id), payload, p, request, "district"
    )


@router.patch("/locations/mandals/{mandal_id}")
def update_mandal(
    mandal_id: int,
    payload: LocationTogglePatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    return _patch_location(db, db.get(Mandal, mandal_id), payload, p, request, "mandal")


@router.patch("/locations/localities/{locality_id}")
def update_locality(
    locality_id: int,
    payload: LocationTogglePatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    return _patch_location(
        db, db.get(Locality, locality_id), payload, p, request, "locality"
    )


# --------------------------------------------------------------------------- #
# settings (updated doc §18, §20, §35)
# --------------------------------------------------------------------------- #
class SettingsPatch(BaseModel):
    """Free-form on purpose: the key set lives in `settings_service.SPECS`, which
    validates every value and rejects unknown keys. Duplicating it as pydantic
    fields would mean two lists to keep in step."""

    values: dict[str, object] = Field(default_factory=dict)


@router.get("/settings")
def settings_summary(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("settings.view")),
):
    """Two blocks, because they behave differently: `environment` is read-only
    deployment config, `values` are the editable §18/§20/§35 switches."""
    from app.services import ai_usage_service, settings_service, tts_service

    return {
        "environment": {
            "app_env": settings.APP_ENV,
            "site_name": settings.APP_NAME,
            "app_url": settings.APP_URL,
            "api_url": settings.API_URL,
            "storage_provider": settings.STORAGE_PROVIDER,
            "ai_available": settings.AI_ENABLED,
            "tts_google_configured": bool(settings.GOOGLE_TTS_API_KEY),
            "tts_bhashini_configured": bool(settings.BHASHINI_API_KEY),
            "smtp_configured": bool(settings.SMTP_URL),
            "sms_configured": bool(settings.MSG91_AUTH_KEY),
            "secure_cookies": settings.SECURE_COOKIES,
            "hsts_enabled": settings.HSTS_ENABLED,
            "csp_enabled": settings.CSP_ENABLED,
            "public_cache_ttl_seconds": settings.PUBLIC_CACHE_TTL_SECONDS,
            "breaking_cache_ttl_seconds": settings.BREAKING_CACHE_TTL_SECONDS,
        },
        "values": settings_service.all_settings(db),
        "specs": settings_service.describe(),
        "voice_usage": tts_service.usage_summary(db),
        "ai_usage": ai_usage_service.usage_summary(db),
    }


@router.patch("/settings")
def update_settings(
    payload: SettingsPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("settings.manage")),
):
    from app.services import settings_service

    before = settings_service.all_settings(db)
    values = settings_service.set_many(db, payload.values, actor_id=p.id)
    # `before` is already masked by all_settings; `after` is the admin's raw
    # input, so a provider key would otherwise be written to the audit log in
    # clear. Record that the secret changed, never what it changed to.
    after = {
        key: (
            settings_service.masked_value(key, raw)
            if settings_service.is_secret(key)
            else raw
        )
        for key, raw in payload.values.items()
    }
    audit_service.record(
        db,
        action=AuditAction.SETTING_CHANGED,
        entity_type="app_settings",
        entity_id="values",
        actor=p.user,
        before={k: before.get(k) for k in payload.values},
        after=after,
        request=request,
    )
    # A ratio or voice change alters what /public/home returns.
    _invalidate_public_cache()
    return {"values": values}
