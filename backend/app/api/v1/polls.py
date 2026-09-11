from __future__ import annotations

import csv
from datetime import timedelta
from io import StringIO

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from slugify import slugify

from app.core.deps import Principal, get_optional_principal, require_permission
from app.core.errors import NotFoundError
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article, Category
from app.models.enums import ArticleStatus, AuditAction
from app.models.geo import District
from app.models.poll import Poll, PollOption, PollVote, TrendingTopic
from app.schemas.poll import PollIn, PollOut, PollPatch, VoteIn
from app.services import audit_service, poll_service, settings_service

router = APIRouter(tags=["polls"])


def _fingerprint(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = (
        forwarded.split(",")[0].strip()
        if forwarded
        else (request.client.host if request.client else "")
    )
    return f"{ip[:45]}:{request.headers.get('user-agent', '')[:160]}"


def _selected(db: Session, poll_id: int, key: str | None) -> int | None:
    if not key:
        return None
    return db.scalar(
        select(PollVote.option_id).where(
            PollVote.poll_id == poll_id, PollVote.voter_key == key
        )
    )


def _key(
    request: Request,
    p: Principal | None,
    anonymous_id: str | None,
    required: bool = False,
) -> str | None:
    if p:
        return poll_service.voter_key(p.id, None, "")
    if anonymous_id:
        return poll_service.voter_key(None, anonymous_id, _fingerprint(request))
    return (
        poll_service.voter_key(None, anonymous_id, _fingerprint(request))
        if required
        else None
    )


@router.get("/polls", response_model=list[PollOut])
def list_polls(
    request: Request,
    article_id: int | None = None,
    big_question: bool | None = None,
    anonymous_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    p: Principal | None = Depends(get_optional_principal),
):
    if not settings_service.get_bool(db, "polls.enabled"):
        return []
    key = _key(request, p, anonymous_id)
    rows = poll_service.active_polls(db, article_id, big_question)
    return [poll_service.serialize(x, _selected(db, x.id, key)) for x in rows]


@router.get("/polls/{poll_id}", response_model=PollOut)
def get_poll(
    poll_id: int,
    request: Request,
    anonymous_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    p: Principal | None = Depends(get_optional_principal),
):
    if not settings_service.get_bool(db, "polls.enabled"):
        raise NotFoundError()
    row = poll_service.get_poll(db, poll_id)
    key = _key(request, p, anonymous_id)
    return poll_service.serialize(row, _selected(db, row.id, key))


@router.get("/polls/{poll_id}/results", response_model=PollOut)
def results(poll_id: int, db: Session = Depends(get_db)):
    return poll_service.serialize(poll_service.get_poll(db, poll_id))


@router.post("/polls/{poll_id}/vote", response_model=PollOut)
def vote(
    poll_id: int,
    payload: VoteIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal | None = Depends(get_optional_principal),
):
    if not settings_service.get_bool(db, "polls.enabled"):
        raise NotFoundError()
    row = poll_service.get_poll(db, poll_id)
    key = _key(request, p, payload.anonymous_id, required=True)
    poll_service.vote(db, row, payload.option_id, key or "", p.id if p else None)
    return poll_service.serialize(row, payload.option_id)


# --------------------------------------------------------------- admin -----
def _admin_rows(db: Session) -> list[Poll]:
    return list(
        db.scalars(
            select(Poll)
            .options(selectinload(Poll.options))
            .order_by(Poll.created_at.desc())
        )
    )


@router.get("/admin/polls")
def admin_polls(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("article.view")),
):
    return {"items": [poll_service.serialize(x) for x in _admin_rows(db)]}


@router.post("/admin/polls", status_code=201)
def create_poll(
    payload: PollIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.create")),
):
    row = Poll(
        **payload.model_dump(exclude={"options"}),
        status="DRAFT",
        created_by=p.id,
        updated_by=p.id,
    )
    db.add(row)
    db.flush()
    for i, option in enumerate(payload.options, 1):
        row.options.append(PollOption(display_order=i, **option.model_dump()))
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="poll",
        entity_id=row.id,
        actor=p.user,
        request=request,
    )
    return poll_service.serialize(row)


@router.patch("/admin/polls/{poll_id}")
def patch_poll(
    poll_id: int,
    payload: PollPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.edit")),
):
    row = poll_service.get_poll(db, poll_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_by = p.id
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="poll",
        entity_id=row.id,
        actor=p.user,
        request=request,
    )
    return poll_service.serialize(row)


@router.delete("/admin/polls/{poll_id}")
def disable_poll(
    poll_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("article.delete")),
):
    row = poll_service.get_poll(db, poll_id)
    row.status = "DISABLED"
    row.updated_by = p.id
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="poll",
        entity_id=row.id,
        actor=p.user,
        note="disabled",
        request=request,
    )
    return {"id": row.id, "disabled": True}


@router.get("/admin/polls/{poll_id}/export")
def export_poll(
    poll_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("analytics.view")),
):
    poll = poll_service.get_poll(db, poll_id)
    votes = db.execute(
        select(PollVote, PollOption)
        .join(PollOption, PollVote.option_id == PollOption.id)
        .where(PollVote.poll_id == poll.id)
    ).all()
    out = StringIO()
    writer = csv.writer(out)
    writer.writerow(["vote_id", "option", "user_id", "timestamp"])
    for vote_row, option in votes:
        writer.writerow(
            [
                vote_row.id,
                option.option_text_te,
                vote_row.user_id or "anonymous",
                vote_row.created_at.isoformat(),
            ]
        )
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="poll-{poll.id}.csv"'},
    )


# ------------------------------------------------------ top three topics ---
def _topic_rows(db: Session) -> list[dict]:
    now = utcnow()
    overrides = list(
        db.scalars(
            select(TrendingTopic)
            .where(
                TrendingTopic.is_active.is_(True),
                (TrendingTopic.expires_at.is_(None) | (TrendingTopic.expires_at > now)),
                TrendingTopic.override_rank.is_not(None),
            )
            .order_by(TrendingTopic.override_rank)
            .limit(3)
        )
    )
    out = [
        {
            "slug": x.slug,
            "title_te": x.title_te,
            "title_en": x.title_en,
            "score": x.score,
            "is_override": True,
        }
        for x in overrides
    ]
    if len(out) < 3:
        rows = db.execute(
            select(
                Category.slug,
                Category.name_te,
                Category.name_en,
                func.sum(
                    Article.view_count
                    + Article.share_count * 4
                    + Article.comment_count * 3
                ).label("score"),
            )
            .join(Article, Article.category_id == Category.id)
            .where(
                Article.status == ArticleStatus.PUBLISHED,
                Article.deleted_at.is_(None),
                Article.published_at >= now - timedelta(days=2),
            )
            .group_by(Category.id)
            .order_by(
                func.sum(
                    Article.view_count
                    + Article.share_count * 4
                    + Article.comment_count * 3
                ).desc()
            )
            .limit(6)
        ).all()
        used = {x["slug"] for x in out}
        out.extend(
            {
                "slug": slug,
                "title_te": te,
                "title_en": en,
                "score": float(score or 0),
                "is_override": False,
            }
            for slug, te, en, score in rows
            if slug not in used
        )
    return out[:3]


@router.get("/topics/top")
def top_topics(db: Session = Depends(get_db)):
    return {"items": _topic_rows(db)}


@router.get("/topics/{slug}")
def topic(
    slug: str,
    district: str | None = None,
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    category = db.scalar(
        select(Category).where(Category.slug == slug, Category.is_active.is_(True))
    )
    topic_override = db.scalar(
        select(TrendingTopic).where(
            TrendingTopic.slug == slug, TrendingTopic.is_active.is_(True)
        )
    )
    if not category and not topic_override:
        raise NotFoundError()
    category_id = category.id if category else topic_override.category_id
    stmt = select(Article).where(
        Article.status == ArticleStatus.PUBLISHED, Article.deleted_at.is_(None)
    )
    if category_id:
        stmt = stmt.where(Article.category_id == category_id)
    if district:
        district_id = db.scalar(select(District.id).where(District.slug == district))
        if district_id:
            stmt = stmt.where(Article.district_id == district_id)
    rows = list(db.scalars(stmt.order_by(Article.published_at.desc()).limit(limit)))
    from app.api.v1.public import _cards, _district_map

    return {
        "topic": {
            "slug": slug,
            "title_te": category.name_te if category else topic_override.title_te,
            "title_en": category.name_en if category else topic_override.title_en,
        },
        "articles": _cards(rows, db, _district_map(db)),
    }


@router.post("/admin/topics", status_code=201)
def override_topic(
    payload: dict,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("taxonomy.manage")),
):
    slug = slugify(str(payload.get("slug") or payload.get("title_en") or ""))[:120]
    row = db.scalar(select(TrendingTopic).where(TrendingTopic.slug == slug))
    if row is None:
        row = TrendingTopic(
            slug=slug,
            title_te=str(payload.get("title_te") or "")[:180],
            created_by=p.id,
        )
        db.add(row)
    row.title_te = str(payload.get("title_te") or row.title_te)[:180]
    row.title_en = str(payload.get("title_en") or "")[:180] or None
    row.category_id = payload.get("category_id")
    row.override_rank = int(payload.get("override_rank") or 1)
    row.is_active = bool(payload.get("is_active", True))
    row.updated_by = p.id
    db.flush()
    return {"id": row.id, "slug": row.slug}
