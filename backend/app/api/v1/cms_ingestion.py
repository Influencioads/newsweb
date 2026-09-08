"""Content ingestion admin (updated doc §17).

    GET    /cms/sources                  — configured publishers
    POST   /cms/sources                  — add one (taxonomy.manage)
    PATCH  /cms/sources/{id}
    DELETE /cms/sources/{id}
    POST   /cms/sources/{id}/fetch       — poll now
    POST   /cms/ingestion/run            — poll everything due
    GET    /cms/ingestion/queue          — fetched items awaiting a decision
    POST   /cms/ingestion/{id}/import    — becomes an Article at DRAFT
    POST   /cms/ingestion/{id}/reject

Note what is absent: no route publishes. An imported item is a draft, and the
existing workflow — one editor approves, a different one publishes — applies
to syndicated copy exactly as it does to our own.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.db.session import get_db
from app.models.enums import AuditAction, ContentPolicy, IngestStatus, SourceLicence
from app.models.ingestion import ContentSource, IngestedItem
from app.services import audit_service, ingestion_service

router = APIRouter(prefix="/cms", tags=["ingestion"])


class SourceWrite(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=2, max_length=200)
    name_te: str | None = Field(default=None, max_length=200)
    feed_url: str = Field(min_length=8, max_length=900)
    feed_kind: str = Field(default="rss", pattern=r"^(rss|atom|json)$")
    homepage_url: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=700)
    licence: SourceLicence = SourceLicence.RSS_PUBLIC
    content_policy: ContentPolicy = ContentPolicy.EXCERPT_ONLY
    licence_note: str | None = Field(default=None, max_length=2000)
    attribution_required: bool = True
    auto_publish: bool = False
    default_category_id: int | None = None
    default_district_id: int | None = None
    language: str = Field(default="te", max_length=10)
    fetch_interval_minutes: int = Field(default=30, ge=5, le=1440)
    is_active: bool = True


class SourcePatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    name_te: str | None = Field(default=None, max_length=200)
    feed_url: str | None = Field(default=None, max_length=900)
    homepage_url: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=700)
    licence: SourceLicence | None = None
    content_policy: ContentPolicy | None = None
    licence_note: str | None = Field(default=None, max_length=2000)
    attribution_required: bool | None = None
    auto_publish: bool | None = None
    default_category_id: int | None = None
    default_district_id: int | None = None
    fetch_interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    is_active: bool | None = None


def _guard_licence(source: ContentSource) -> None:
    """§17, enforced rather than documented.

    Full-text republication needs a licence that could permit it *and* a note
    saying which agreement that is. Auto-publish needs both plus full text —
    an unattended pipeline republishing somebody else's words with no recorded
    basis is the exact failure this whole design exists to prevent.
    """
    if source.content_policy == ContentPolicy.FULL_TEXT:
        if not source.may_store_full_text:
            raise ValidationError(
                message_en=("Full-text republication needs an agency, partner, "
                            "press-release, government, Creative Commons or own-network "
                            "licence. A public RSS feed is not a republication licence."),
                message_te=("పూర్తి పాఠ్యం ప్రచురణకు ఒప్పందం ఆధారిత లైసెన్స్ అవసరం. "
                            "బహిరంగ RSS ఫీడ్ ప్రచురణ హక్కు ఇవ్వదు."),
                details={"content_policy": "requires a licensed source"},
            )
        if not (source.licence_note or "").strip():
            raise ValidationError(
                message_en="Record which agreement permits full text before enabling it.",
                message_te="పూర్తి పాఠ్యానికి అనుమతినిచ్చే ఒప్పందాన్ని ముందుగా నమోదు చేయండి.",
                details={"licence_note": "required for full text"},
            )
    if source.auto_publish and not source.may_store_full_text:
        raise ValidationError(
            message_en="Auto-import is only available for licensed full-text sources.",
            details={"auto_publish": "requires a full-text licence"},
        )


def _source_row(source: ContentSource, pending: int = 0) -> dict:
    return {
        "id": source.id, "slug": source.slug, "name": source.name,
        "name_te": source.name_te, "feed_url": source.feed_url,
        "feed_kind": source.feed_kind, "homepage_url": source.homepage_url,
        "logo_url": source.logo_url,
        "licence": source.licence, "content_policy": source.content_policy,
        "licence_note": source.licence_note,
        "may_store_full_text": source.may_store_full_text,
        "attribution_required": source.attribution_required,
        "auto_publish": source.auto_publish,
        "default_category_id": source.default_category_id,
        "default_district_id": source.default_district_id,
        "language": source.language,
        "fetch_interval_minutes": source.fetch_interval_minutes,
        "is_active": source.is_active,
        "last_fetched_at": source.last_fetched_at, "last_status": source.last_status,
        "consecutive_failures": source.consecutive_failures,
        "items_ingested": source.items_ingested,
        "pending_items": pending,
    }


@router.get("/sources")
def list_sources(db: Session = Depends(get_db),
                 _p: Principal = Depends(require_permission("taxonomy.view"))):
    pending = dict(db.execute(
        select(IngestedItem.source_id, func.count(IngestedItem.id))
        .where(IngestedItem.status == IngestStatus.NEW)
        .group_by(IngestedItem.source_id)
    ).all())
    rows = db.scalars(select(ContentSource).order_by(ContentSource.name)).all()
    return {
        "items": [_source_row(s, int(pending.get(s.id, 0))) for s in rows],
        "total": len(rows),
        "queue": ingestion_service.queue_counts(db),
    }


@router.post("/sources", status_code=201)
def create_source(payload: SourceWrite, request: Request, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("taxonomy.manage"))):
    if db.scalar(select(ContentSource).where(ContentSource.slug == payload.slug)):
        raise ValidationError(details={"slug": "already exists"})
    source = ContentSource(**payload.model_dump(), created_by=p.id)
    _guard_licence(source)
    db.add(source)
    db.flush()
    audit_service.record(db, action=AuditAction.CREATE, entity_type="content_source",
                         entity_id=source.id, actor=p.user,
                         after={"slug": source.slug, "licence": source.licence,
                                "content_policy": source.content_policy}, request=request)
    return _source_row(source)


@router.patch("/sources/{source_id}")
def update_source(source_id: int, payload: SourcePatch, request: Request,
                  db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("taxonomy.manage"))):
    source = db.get(ContentSource, source_id)
    if source is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(source, k) for k in changes}
    for key, value in changes.items():
        setattr(source, key, value)
    _guard_licence(source)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="content_source",
                         entity_id=source.id, actor=p.user,
                         before=before, after=changes, request=request)
    return _source_row(source)


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, request: Request, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("taxonomy.manage"))):
    source = db.get(ContentSource, source_id)
    if source is None:
        raise NotFoundError()
    slug = source.slug
    db.delete(source)
    audit_service.record(db, action=AuditAction.DELETE, entity_type="content_source",
                         entity_id=source_id, actor=p.user, after={"slug": slug},
                         request=request)
    return {"ok": True, "slug": slug}


@router.post("/sources/{source_id}/fetch")
def fetch_now(source_id: int, request: Request, db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("taxonomy.manage"))):
    source = db.get(ContentSource, source_id)
    if source is None:
        raise NotFoundError()
    result = ingestion_service.fetch_source(db, source)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="content_source",
                         entity_id=source.id, actor=p.user, after=result, request=request)
    return result


@router.post("/ingestion/run")
def run_ingestion(request: Request, slug: str | None = None, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("taxonomy.manage"))):
    results = ingestion_service.run_all(db, only_slug=slug)
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="ingestion",
                         entity_id="run", actor=p.user,
                         after={"sources": len(results),
                                "new": sum(r.get("new", 0) for r in results)},
                         request=request)
    return {"results": results, "queue": ingestion_service.queue_counts(db)}


@router.get("/ingestion/queue")
def ingestion_queue(status: IngestStatus = IngestStatus.NEW,
                    source_id: int | None = None,
                    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                    db: Session = Depends(get_db),
                    _p: Principal = Depends(require_permission("article.review"))):
    stmt = select(IngestedItem).where(IngestedItem.status == status)
    if source_id is not None:
        stmt = stmt.where(IngestedItem.source_id == source_id)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(stmt.order_by(IngestedItem.published_at.desc().nullslast(),
                                    IngestedItem.fetched_at.desc())
                      .offset(offset).limit(limit)).all()
    return {
        "items": [{
            "id": i.id, "title": i.title, "summary": i.summary,
            "url": i.url, "canonical_url": i.canonical_url,
            "image_url": i.image_url, "author": i.author,
            "published_at": i.published_at, "fetched_at": i.fetched_at,
            "word_count": i.word_count, "status": i.status,
            "article_id": i.article_id, "review_note": i.review_note,
            # The editor needs to see the terms before deciding, so the licence
            # travels with every row rather than living on another screen.
            "source": {
                "id": i.source.id, "slug": i.source.slug, "name": i.source.name,
                "licence": i.source.licence, "content_policy": i.source.content_policy,
                "full_text": i.source.may_store_full_text,
            } if i.source else None,
            "has_full_text": bool(i.content_html),
        } for i in rows],
        "total": total,
        "queue": ingestion_service.queue_counts(db),
    }


class ReviewIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/ingestion/{item_id}/import", status_code=201)
def import_item(item_id: int, request: Request, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("article.create"))):
    """Creating the article needs `article.create` — the same permission a
    person needs to file copy. A feed does not get a shortcut."""
    item = ingestion_service.get_item(db, item_id)
    article = ingestion_service.import_item(db, item, actor_id=p.id)
    audit_service.record(db, action=AuditAction.CREATE, entity_type="article",
                         entity_id=article.id, actor=p.user,
                         after={"from_ingested_item": item_id,
                                "source": item.source.slug if item.source else None,
                                "workflow_state": article.workflow_state},
                         request=request)
    return {"article_id": article.id, "short_id": article.short_id,
            "workflow_state": article.workflow_state, "status": article.status}


@router.post("/ingestion/{item_id}/reject")
def reject_item(item_id: int, payload: ReviewIn, request: Request,
                db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("article.review"))):
    item = ingestion_service.reject_item(db, item_id, actor_id=p.id, note=payload.note)
    audit_service.record(db, action=AuditAction.REJECT, entity_type="ingested_item",
                         entity_id=item.id, actor=p.user, note=payload.note, request=request)
    return {"id": item.id, "status": item.status}
