"""Notifications (updated doc §13).

Reader:  GET /users/me/notifications · POST /users/me/notifications/read
         POST /users/me/devices (anonymous installs too) ·
         POST /notifications/{campaign_id}/opened (a push was tapped)
CMS:     GET/POST /cms/notifications — campaign log + compose, send or
         schedule (push.approve, the §11 level-60 gate) ·
         DELETE /cms/notifications/{id} cancels a scheduled one
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.core.deps import (
    Principal,
    get_current_principal,
    get_optional_principal,
    require_permission,
)
from app.core.errors import ValidationError
from app.core.ratelimit import rate_limit
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import (
    ArticleStatus,
    AuditAction,
    NotificationKind,
    SessionPlatform,
)
from app.models.notify import Notification, NotificationCampaign
from app.services import audit_service, notification_service, settings_service

router = APIRouter(tags=["notifications"])


# --------------------------------------------------------------------------- #
# reader inbox
# --------------------------------------------------------------------------- #
class NotificationOut(BaseModel):
    id: int
    kind: NotificationKind
    title_te: str
    body_te: str | None
    article_url: str | None
    #: What the app opens. Parsing it back out of `article_url` breaks on ids
    #: that contain '-', which nanoid's alphabet allows.
    short_id: str | None = None
    created_at: datetime
    read_at: datetime | None


class InboxOut(BaseModel):
    unread: int
    items: list[NotificationOut]
    next_offset: int | None = None


@router.get(
    "/users/me/notifications", response_model=InboxOut, summary="My notification inbox"
)
def my_notifications(
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> InboxOut:
    rows = list(
        db.execute(
            select(Notification)
            .where(Notification.user_id == principal.id)
            .order_by(Notification.created_at.desc())
            .limit(limit + 1)
            .offset(offset)
        ).scalars()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]

    article_ids = [n.article_id for n in rows if n.article_id]
    urls: dict[int, str] = {}
    short_ids: dict[int, str] = {}
    if article_ids:
        for article in db.execute(
            select(Article).where(Article.id.in_(article_ids))
        ).scalars():
            urls[article.id] = article.url_path
            short_ids[article.id] = article.short_id

    return InboxOut(
        unread=notification_service.unread_count(db, principal.id),
        items=[
            NotificationOut(
                id=n.id,
                kind=n.kind,
                title_te=n.title_te,
                body_te=n.body_te,
                article_url=urls.get(n.article_id) if n.article_id else None,
                short_id=short_ids.get(n.article_id) if n.article_id else None,
                created_at=n.created_at,
                read_at=n.read_at,
            )
            for n in rows
        ],
        next_offset=offset + limit if has_more else None,
    )


class MarkReadIn(BaseModel):
    ids: list[int] | None = Field(
        default=None, description="Omit to mark everything read", max_length=100
    )


@router.post("/users/me/notifications/read", summary="Mark notifications read")
def mark_read(
    payload: MarkReadIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> dict:
    changed = notification_service.mark_read(db, principal.id, payload.ids)
    return {"marked": changed}


class DeviceIn(BaseModel):
    #: Anyone can register, so only Expo's own token shape is accepted: one
    #: junk token would otherwise fail the whole 100-message batch it lands in.
    token: str = Field(
        min_length=10, max_length=400, pattern=r"^Expo(nent)?PushToken\[[^\]]+\]$"
    )
    platform: SessionPlatform = SessionPlatform.ANDROID
    #: The edition chosen on the phone; how district and local pushes find
    #: a reader who never signed in.
    district_slug: str | None = Field(default=None, max_length=80)


@router.post("/users/me/devices", summary="Register a push device token (Expo)")
def register_device(
    payload: DeviceIn,
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
    _rl: None = Depends(rate_limit("device_register", 10)),
) -> dict:
    # Most app readers never sign in, so the token is kept either way.
    device = notification_service.register_device(
        db,
        user_id=principal.id if principal else None,
        token=payload.token,
        platform=payload.platform,
        district_slug=payload.district_slug,
    )
    return {"id": device.id, "ok": True}


@router.post("/notifications/{campaign_id}/opened", summary="A push was tapped")
def push_opened(
    campaign_id: int,
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("push_opened", 20)),
) -> dict:
    notification_service.record_opened(db, campaign_id)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# CMS campaigns (§19 Notifications)
# --------------------------------------------------------------------------- #
class CampaignIn(BaseModel):
    title_te: str = Field(min_length=3, max_length=400)
    body_te: str | None = Field(default=None, max_length=1000)
    article_id: int | None = None
    #: The id an editor actually has — it is in the story's url. Resolved to
    #: `article_id` below, so a caller can send either.
    short_id: str | None = Field(default=None, max_length=12)
    audience: str = Field(
        default="all",
        description="all | district:<slug> | category:<slug> | tag:<slug>",
    )
    #: Future means scheduled; empty means now. A time already past is refused
    #: (the editor meant a schedule), bar a minute's grace for the round trip.
    send_at: datetime | None = None


@router.get("/cms/notifications", summary="Campaign log")
def campaigns(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    source: str | None = Query(default=None, pattern="^(manual|auto)$"),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("push.create")),
) -> dict:
    stmt = select(NotificationCampaign)
    if source == "auto":
        stmt = stmt.where(NotificationCampaign.audience.startswith("auto:"))
    elif source == "manual":
        stmt = stmt.where(~NotificationCampaign.audience.startswith("auto:"))
    rows = list(
        db.execute(
            stmt.order_by(
                # Scheduled first, so one can always be found and cancelled
                # however many publish-time alerts have been logged since.
                case((NotificationCampaign.status == "scheduled", 0), else_=1),
                NotificationCampaign.created_at.desc(),
                NotificationCampaign.id.desc(),
            )
            .limit(limit + 1)
            .offset(offset)
        ).scalars()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "next_offset": offset + limit if has_more else None,
        "items": [
            {
                "id": c.id,
                "title_te": c.title_te,
                "audience": c.audience,
                "status": c.status,
                "sent_count": c.sent_count,
                "devices": c.devices,
                "push_ok": c.push_ok,
                "push_failed": c.push_failed,
                "opened": c.opened,
                "article_id": c.article_id,
                "send_at": c.send_at,
                "sent_at": c.sent_at,
                "created_at": c.created_at,
            }
            for c in rows
        ],
        "devices_registered": notification_service.device_counts(db),
        "push_enabled": settings_service.get_bool(db, "push.enabled"),
    }


@router.post(
    "/cms/notifications", status_code=201, summary="Compose and send a campaign"
)
def send_campaign(
    payload: CampaignIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("push.approve")),
) -> dict:
    article_id = payload.article_id
    if article_id is None and payload.short_id:
        article = db.scalar(
            select(Article).where(
                Article.short_id == payload.short_id,
                Article.deleted_at.is_(None),
            )
        )
        if article is None:
            raise ValidationError(details={"short_id": "unknown story"})
        # A push that deep-links to a story nobody can open is worse than one
        # that only carries text, so refuse rather than silently drop the link.
        if article.status != ArticleStatus.PUBLISHED:
            raise ValidationError(details={"short_id": "story is not published"})
        article_id = article.id

    send_at = payload.send_at
    if send_at is not None and send_at.tzinfo is None:
        send_at = send_at.replace(tzinfo=timezone.utc)
    # Sending a "scheduled" push to everyone at once is the worst way to fail
    # (a slow laptop clock, a confirm dialog left open past the time).
    if send_at is not None and send_at < utcnow() - timedelta(minutes=1):
        raise ValidationError(details={"send_at": "in the past"})
    campaign = notification_service.send_campaign(
        db,
        title_te=payload.title_te,
        body_te=payload.body_te,
        article_id=article_id,
        audience=payload.audience,
        created_by=p.id,
        send_at=send_at,
    )
    scheduled = campaign.status == "scheduled"
    audit_service.record(
        db,
        action=AuditAction.PUSH_CREATED if scheduled else AuditAction.PUSH_SENT,
        entity_type="notification_campaign",
        entity_id=campaign.id,
        actor=p.user,
        after={
            "audience": payload.audience,
            "sent_count": campaign.sent_count,
            "article_id": article_id,
            "send_at": campaign.send_at.isoformat() if scheduled else None,
        },
        request=request,
    )
    return {"id": campaign.id, "sent_count": campaign.sent_count, "status": campaign.status}


@router.delete("/cms/notifications/{campaign_id}", summary="Cancel a scheduled campaign")
def cancel_campaign(
    campaign_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("push.approve")),
) -> dict:
    campaign = notification_service.cancel_campaign(db, campaign_id)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="notification_campaign",
        entity_id=campaign.id,
        actor=p.user,
        after={"status": "cancelled"},
        request=request,
    )
    return {"id": campaign.id, "status": "cancelled"}
