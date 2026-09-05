"""Notifications (updated doc §13).

Reader:  GET /users/me/notifications · POST /users/me/notifications/read
         POST /users/me/devices
CMS:     GET/POST /cms/notifications — campaign log + compose-and-send
         (push.approve, the §11 level-60 gate)
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_current_principal, require_permission
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import AuditAction, NotificationKind, SessionPlatform
from app.models.notify import Notification, NotificationCampaign
from app.services import audit_service, notification_service

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
    created_at: datetime
    read_at: datetime | None


class InboxOut(BaseModel):
    unread: int
    items: list[NotificationOut]
    next_offset: int | None = None


@router.get("/users/me/notifications", response_model=InboxOut, summary="My notification inbox")
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
    if article_ids:
        for article in db.execute(select(Article).where(Article.id.in_(article_ids))).scalars():
            urls[article.id] = article.url_path

    return InboxOut(
        unread=notification_service.unread_count(db, principal.id),
        items=[
            NotificationOut(
                id=n.id,
                kind=n.kind,
                title_te=n.title_te,
                body_te=n.body_te,
                article_url=urls.get(n.article_id) if n.article_id else None,
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
    token: str = Field(min_length=10, max_length=400)
    platform: SessionPlatform = SessionPlatform.ANDROID


@router.post("/users/me/devices", summary="Register a push device token (FCM)")
def register_device(
    payload: DeviceIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> dict:
    device = notification_service.register_device(
        db, user_id=principal.id, token=payload.token, platform=payload.platform
    )
    return {"id": device.id, "ok": True}


# --------------------------------------------------------------------------- #
# CMS campaigns (§19 Notifications)
# --------------------------------------------------------------------------- #
class CampaignIn(BaseModel):
    title_te: str = Field(min_length=3, max_length=400)
    body_te: str | None = Field(default=None, max_length=1000)
    article_id: int | None = None
    audience: str = Field(
        default="all", description="all | district:<slug> | category:<slug>"
    )


@router.get("/cms/notifications", summary="Campaign log")
def campaigns(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("push.create")),
) -> dict:
    rows = list(
        db.execute(
            select(NotificationCampaign)
            .order_by(NotificationCampaign.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).scalars()
    )
    return {
        "items": [
            {
                "id": c.id,
                "title_te": c.title_te,
                "audience": c.audience,
                "sent_count": c.sent_count,
                "article_id": c.article_id,
                "created_at": c.created_at,
            }
            for c in rows
        ]
    }


@router.post("/cms/notifications", status_code=201, summary="Compose and send a campaign")
def send_campaign(
    payload: CampaignIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("push.approve")),
) -> dict:
    campaign = notification_service.send_campaign(
        db,
        title_te=payload.title_te,
        body_te=payload.body_te,
        article_id=payload.article_id,
        audience=payload.audience,
        created_by=p.id,
    )
    audit_service.record(
        db,
        action=AuditAction.PUSH_SENT,
        entity_type="notification_campaign",
        entity_id=campaign.id,
        actor=p.user,
        after={"audience": payload.audience, "sent_count": campaign.sent_count},
        request=request,
    )
    return {"id": campaign.id, "sent_count": campaign.sent_count}
