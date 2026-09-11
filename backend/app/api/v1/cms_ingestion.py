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
from app.models.enums import (
    AuditAction,
    ContentPolicy,
    IngestStatus,
    RewriteStatus,
    SourceBeat,
    SourceLicence,
)
from app.models.ingestion import ContentSource, IngestedItem
from app.services import audit_service, crawl_service, ingestion_service

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
    # --- hourly crawl ---
    beat: SourceBeat = SourceBeat.GENERAL
    default_mandal_id: int | None = None
    max_items_per_hour: int = Field(default=8, ge=0, le=500)
    allow_html_fallback: bool = False
    rewrite_enabled: bool = False
    mandal_autotag: bool = True


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
    beat: SourceBeat | None = None
    default_mandal_id: int | None = None
    max_items_per_hour: int | None = Field(default=None, ge=0, le=500)
    allow_html_fallback: bool | None = None
    rewrite_enabled: bool | None = None
    mandal_autotag: bool | None = None


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
                message_en=(
                    "Full-text republication needs an agency, partner, "
                    "press-release, government, Creative Commons or own-network "
                    "licence. A public RSS feed is not a republication licence."
                ),
                message_te=(
                    "పూర్తి పాఠ్యం ప్రచురణకు ఒప్పందం ఆధారిత లైసెన్స్ అవసరం. "
                    "బహిరంగ RSS ఫీడ్ ప్రచురణ హక్కు ఇవ్వదు."
                ),
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
    if source.allow_html_fallback and not (source.licence_note or "").strip():
        # Fetching a publisher's article pages — rather than only what they put
        # in their feed — is a decision somebody has to own. Requiring the note
        # makes the audit log a record of *why*, not just of what changed.
        raise ValidationError(
            message_en=(
                "Record why fetching this publisher's article pages is "
                "acceptable before enabling the HTML fallback."
            ),
            message_te=(
                "ఈ ప్రచురణకర్త పేజీలను తీసుకోవడం ఎందుకు సమ్మతమో ముందుగా నమోదు చేయండి."
            ),
            details={"licence_note": "required for the HTML fallback"},
        )


def _source_row(source: ContentSource, pending: int = 0) -> dict:
    return {
        "id": source.id,
        "slug": source.slug,
        "name": source.name,
        "name_te": source.name_te,
        "feed_url": source.feed_url,
        "feed_kind": source.feed_kind,
        "homepage_url": source.homepage_url,
        "logo_url": source.logo_url,
        "licence": source.licence,
        "content_policy": source.content_policy,
        "licence_note": source.licence_note,
        "may_store_full_text": source.may_store_full_text,
        "attribution_required": source.attribution_required,
        "auto_publish": source.auto_publish,
        "default_category_id": source.default_category_id,
        "default_district_id": source.default_district_id,
        "language": source.language,
        "fetch_interval_minutes": source.fetch_interval_minutes,
        "is_active": source.is_active,
        "beat": source.beat,
        "default_mandal_id": source.default_mandal_id,
        "max_items_per_hour": source.max_items_per_hour,
        "allow_html_fallback": source.allow_html_fallback,
        "rewrite_enabled": source.rewrite_enabled,
        "mandal_autotag": source.mandal_autotag,
        "last_fetched_at": source.last_fetched_at,
        "last_status": source.last_status,
        "consecutive_failures": source.consecutive_failures,
        "items_ingested": source.items_ingested,
        "pending_items": pending,
    }


@router.get("/sources")
def list_sources(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("taxonomy.view")),
):
    pending = dict(
        db.execute(
            select(IngestedItem.source_id, func.count(IngestedItem.id))
            .where(IngestedItem.status == IngestStatus.NEW)
            .group_by(IngestedItem.source_id)
        ).all()
    )
    rows = db.scalars(select(ContentSource).order_by(ContentSource.name)).all()
    return {
        "items": [_source_row(s, int(pending.get(s.id, 0))) for s in rows],
        "total": len(rows),
        "queue": ingestion_service.queue_counts(db),
    }


@router.post("/sources", status_code=201)
def create_source(
    payload: SourceWrite,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    if db.scalar(select(ContentSource).where(ContentSource.slug == payload.slug)):
        raise ValidationError(details={"slug": "already exists"})
    source = ContentSource(**payload.model_dump(), created_by=p.id)
    _guard_licence(source)
    db.add(source)
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="content_source",
        entity_id=source.id,
        actor=p.user,
        after={
            "slug": source.slug,
            "licence": source.licence,
            "content_policy": source.content_policy,
        },
        request=request,
    )
    return _source_row(source)


@router.patch("/sources/{source_id}")
def update_source(
    source_id: int,
    payload: SourcePatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    source = db.get(ContentSource, source_id)
    if source is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(source, k) for k in changes}
    for key, value in changes.items():
        setattr(source, key, value)
    _guard_licence(source)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="content_source",
        entity_id=source.id,
        actor=p.user,
        before=before,
        after=changes,
        request=request,
    )
    return _source_row(source)


@router.delete("/sources/{source_id}")
def delete_source(
    source_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    source = db.get(ContentSource, source_id)
    if source is None:
        raise NotFoundError()
    slug = source.slug
    db.delete(source)
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="content_source",
        entity_id=source_id,
        actor=p.user,
        after={"slug": slug},
        request=request,
    )
    return {"ok": True, "slug": slug}


@router.post("/sources/{source_id}/fetch")
def fetch_now(
    source_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    source = db.get(ContentSource, source_id)
    if source is None:
        raise NotFoundError()
    result = ingestion_service.fetch_source(db, source)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="content_source",
        entity_id=source.id,
        actor=p.user,
        after=result,
        request=request,
    )
    return result


@router.post("/ingestion/run")
def run_ingestion(
    request: Request,
    slug: str | None = None,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    results = ingestion_service.run_all(db, only_slug=slug)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="ingestion",
        entity_id="run",
        actor=p.user,
        after={"sources": len(results), "new": sum(r.get("new", 0) for r in results)},
        request=request,
    )
    return {"results": results, "queue": ingestion_service.queue_counts(db)}


@router.get("/ingestion/queue")
def ingestion_queue(
    status: IngestStatus = IngestStatus.NEW,
    source_id: int | None = None,
    beat: SourceBeat | None = None,
    district_id: int | None = None,
    has_rewrite: bool | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("article.review")),
):
    stmt = select(IngestedItem).where(IngestedItem.status == status)
    if source_id is not None:
        stmt = stmt.where(IngestedItem.source_id == source_id)
    if beat is not None:
        stmt = stmt.join(
            ContentSource, IngestedItem.source_id == ContentSource.id
        ).where(ContentSource.beat == beat)
    if district_id is not None:
        stmt = stmt.where(IngestedItem.matched_district_id == district_id)
    if has_rewrite is True:
        stmt = stmt.where(IngestedItem.rewrite_status == RewriteStatus.READY)
    elif has_rewrite is False:
        stmt = stmt.where(IngestedItem.rewrite_status != RewriteStatus.READY)
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.order_by(
            IngestedItem.published_at.desc().nullslast(), IngestedItem.fetched_at.desc()
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return {
        "items": [
            {
                "id": i.id,
                "title": i.title,
                "summary": i.summary,
                "url": i.url,
                "canonical_url": i.canonical_url,
                "image_url": i.image_url,
                "author": i.author,
                "published_at": i.published_at,
                "fetched_at": i.fetched_at,
                "word_count": i.word_count,
                "status": i.status,
                "article_id": i.article_id,
                "review_note": i.review_note,
                # The editor needs to see the terms before deciding, so the licence
                # travels with every row rather than living on another screen.
                "source": {
                    "id": i.source.id,
                    "slug": i.source.slug,
                    "name": i.source.name,
                    "licence": i.source.licence,
                    "content_policy": i.source.content_policy,
                    "full_text": i.source.may_store_full_text,
                }
                if i.source
                else None,
                "has_full_text": bool(i.content_html),
                # A *guess*, shown with its working. The import form pre-fills
                # it and the editor can change it in one select — which is the
                # whole mechanism by which mandal-level coverage is trustworthy.
                "mandal": {
                    "mandal_id": i.matched_mandal_id,
                    "district_id": i.matched_district_id,
                    "method": i.mandal_match_method,
                    "confidence": round(i.mandal_match_confidence, 2),
                },
                "requires_human": i.requires_human,
                "rewrite_status": i.rewrite_status,
                "rewrite": _rewrite_row(i),
            }
            for i in rows
        ],
        "total": total,
        "queue": ingestion_service.queue_counts(db),
    }


def _rewrite_row(item: IngestedItem) -> dict | None:
    """The latest attempt, ready or not.

    A refusal is shown rather than hidden: "the model declined because the
    source had three sentences" is information an editor acts on, and hiding it
    would make the queue look like nothing happened.
    """
    rewrite = item.latest_rewrite
    if rewrite is None:
        return None
    return {
        "id": rewrite.id,
        "status": rewrite.status,
        "title_te": rewrite.title_te or None,
        "summary_te": rewrite.summary_te,
        "body_plain": rewrite.body_plain,
        "attribution_te": rewrite.attribution_te or None,
        "word_count": rewrite.word_count,
        "engine": rewrite.engine,
        "model": rewrite.model,
        "confidence": round(rewrite.confidence, 2),
        "unverified": rewrite.unverified,
        "similarity_percent": rewrite.similarity_percent,
        "refusal_reason": rewrite.refusal_reason,
        "created_at": rewrite.created_at,
    }


class ReviewIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class ImportIn(BaseModel):
    """Editor overrides applied at import.

    `use_rewrite=False` is the escape hatch for an editor who would rather work
    from the original excerpt than from the machine's Telugu.
    """

    use_rewrite: bool = True
    mandal_id: int | None = None
    district_id: int | None = None
    category_id: int | None = None


@router.post("/ingestion/{item_id}/import", status_code=201)
def import_item(
    item_id: int,
    request: Request,
    payload: ImportIn | None = None,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.create")),
):
    """Creating the article needs `article.create` — the same permission a
    person needs to file copy. A feed does not get a shortcut."""
    item = ingestion_service.get_item(db, item_id)
    options = payload or ImportIn()
    article = ingestion_service.import_item(
        db,
        item,
        actor_id=p.id,
        use_rewrite=options.use_rewrite,
        mandal_id=options.mandal_id,
        district_id=options.district_id,
        category_id=options.category_id,
    )
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="article",
        entity_id=article.id,
        actor=p.user,
        after={
            "from_ingested_item": item_id,
            "source": item.source.slug if item.source else None,
            "workflow_state": article.workflow_state,
            "ai_generated": article.ai_generated,
            "mandal_id": article.mandal_id,
        },
        request=request,
    )
    return {
        "article_id": article.id,
        "short_id": article.short_id,
        "workflow_state": article.workflow_state,
        "status": article.status,
        "ai_generated": article.ai_generated,
        "article_type": article.article_type,
    }


@router.post("/ingestion/{item_id}/reject")
def reject_item(
    item_id: int,
    payload: ReviewIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.review")),
):
    item = ingestion_service.reject_item(db, item_id, actor_id=p.id, note=payload.note)
    audit_service.record(
        db,
        action=AuditAction.REJECT,
        entity_type="ingested_item",
        entity_id=item.id,
        actor=p.user,
        note=payload.note,
        request=request,
    )
    return {"id": item.id, "status": item.status}


# --------------------------------------------------------------------------- #
# Hourly crawl
# --------------------------------------------------------------------------- #
class CrawlRunIn(BaseModel):
    """Run a pass now, rather than waiting for the schedule."""

    fetch: bool = True
    rewrite: bool = True
    beat: SourceBeat | None = None


@router.get("/crawl/status")
def crawl_status(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("taxonomy.view")),
):
    """Quota used this hour, per-beat coverage, and whether the worker is alive.

    `stale` is the one field to watch. Crawl tasks route to their own Celery
    queue, so a deployment missing the `worker-ingest` container queues them in
    Redis forever with nothing anywhere reporting a failure. A last fetch older
    than two hours is how that becomes visible.
    """
    return crawl_service.status_snapshot(db)


@router.post("/crawl/run")
def crawl_run(
    payload: CrawlRunIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    if not crawl_service.crawl_enabled(db):
        raise ValidationError(
            message_en="Turn the hourly crawl on in Settings first.",
            message_te="ముందుగా సెట్టింగ్స్‌లో గంటవారీ క్రాల్‌ను ఆన్ చేయండి.",
            details={"crawl.enabled": "is off"},
        )
    beats = {payload.beat} if payload.beat else None
    out: dict = {}
    if payload.fetch:
        out["fetch"] = crawl_service.run_fetch_pass(db, beats=beats)
    if payload.rewrite:
        out["rewrite"] = crawl_service.run_rewrite_pass(db, beats=beats, actor_id=p.id)
    audit_service.record(
        db,
        action=AuditAction.AI_RUN,
        entity_type="crawl",
        entity_id="run",
        actor=p.user,
        after=out,
        request=request,
    )
    return out


@router.post("/ingestion/{item_id}/rewrite")
def rewrite_item(
    item_id: int,
    request: Request,
    force: bool = False,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ai.use")),
):
    """Rewrite one queued item now.

    Needs `ai.use` rather than `article.create`: this spends money at a
    provider but creates nothing a reader could ever see. Importing the result
    is the separate, more privileged action.
    """
    item = ingestion_service.get_item(db, item_id)
    if not crawl_service.rewrite_enabled(db):
        raise ValidationError(
            message_en="AI rewriting is switched off.",
            message_te="AI పునర్లేఖనం ఆఫ్‌లో ఉంది.",
            details={"crawl.rewrite_enabled": "is off"},
        )
    rewrite = crawl_service.rewrite_one(db, item, actor_id=p.id, force=force)
    audit_service.record(
        db,
        action=AuditAction.AI_RUN,
        entity_type="ingested_item",
        entity_id=item.id,
        actor=p.user,
        after={"status": rewrite.status, "engine": rewrite.engine},
        request=request,
    )
    return {"item_id": item.id, "rewrite": _rewrite_row(item)}
