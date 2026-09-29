"""Notifications (updated doc §13): publish-time fan-out, admin campaigns,
the inbox, and push-device registration.

The in-app inbox rows are the product; push is a transport on top. A send
writes the inbox rows at once and leaves its campaign `queued`; the
`notify.dispatch` beat task (`dispatch_due`) then posts it through Expo's push
service and records what came back. Publish-time fan-out is logged as
`auto:<stage>` campaigns so its pushes are counted too. Fan-out runs inside
the publish transaction but is wrapped by the caller so a notification bug can
never block a story from going live.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import and_, delete, func, insert, or_, select, true, update
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.content import Article, ArticleTag, Category, Tag
from app.models.engagement import Follow
from app.models.enums import (
    FollowTargetType,
    NotificationKind,
    RoleKey,
    SessionPlatform,
)
from app.models.geo import District
from app.models.notify import Notification, NotificationCampaign, PushDevice
from app.models.reader import UserPreference
from app.models.user import Role, User, UserRole
from app.services import settings_service

logger = get_logger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
#: Expo accepts at most 100 messages per request.
PUSH_CHUNK = 100
#: Inbox rows go in by executemany, this many at a time.
_INSERT_CHUNK = 1000
#: A campaign that sat queued this long (the worker was down, or push was off)
#: is no longer news; it is marked failed rather than delivered late.
STALE_AFTER = timedelta(hours=2)


def _post(messages: list[dict[str, Any]], access_token: str) -> list[dict[str, Any]]:
    """One request to Expo's push service; returns its tickets, in order.

    Module-level so tests replace it — nothing in the suite may reach Expo.
    """
    headers = {"Accept": "application/json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    response = httpx.post(EXPO_PUSH_URL, json=messages, headers=headers, timeout=20.0)
    response.raise_for_status()
    return list(response.json().get("data") or [])


def _notify(
    db: Session,
    *,
    user_ids: set[int],
    kind: NotificationKind,
    title_te: str,
    body_te: str | None,
    article_id: int | None,
    campaign_id: int | None = None,
) -> int:
    now = utcnow()
    rows = [
        {
            "user_id": user_id,
            "kind": kind,
            "title_te": title_te[:400],
            "body_te": (body_te or None) and body_te[:1000],
            "article_id": article_id,
            "campaign_id": campaign_id,
            "created_at": now,
        }
        for user_id in user_ids
    ]
    # ponytail: synchronous, inside the publish transaction. Move the inbox
    # fan-out into the worker once the signed-in audience reaches six figures.
    for i in range(0, len(rows), _INSERT_CHUNK):
        db.execute(insert(Notification), rows[i : i + _INSERT_CHUNK])
    return len(rows)


def _initial_status(db: Session) -> str:
    # Push off means inbox-only: logged as sent with no devices rather than
    # queued, so switching push back on never replays a backlog to phones.
    return "queued" if settings_service.get_bool(db, "push.enabled") else "sent"


# --------------------------------------------------------------------------- #
# audience resolution
# --------------------------------------------------------------------------- #
def _pref_map(db: Session, user_ids: set[int]) -> dict[int, UserPreference]:
    if not user_ids:
        return {}
    rows = db.execute(
        select(UserPreference).where(UserPreference.user_id.in_(user_ids))
    ).scalars()
    return {p.user_id: p for p in rows}


def _followers(
    db: Session, target_type: FollowTargetType, target_ids: list[int]
) -> set[int]:
    if not target_ids:
        return set()
    rows = db.execute(
        select(Follow.user_id).where(
            Follow.target_type == target_type, Follow.target_id.in_(target_ids)
        )
    ).scalars()
    return set(rows)


def _all_reader_ids(db: Session) -> set[int]:
    rows = db.execute(
        select(UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .join(User, User.id == UserRole.user_id)
        .where(Role.key == RoleKey.SUBSCRIBER.value, User.deleted_at.is_(None))
    ).scalars()
    return set(rows)


def _has_anonymous_devices(db: Session, district_id: int | None = None) -> bool:
    stmt = select(PushDevice.id).where(PushDevice.user_id.is_(None))
    if district_id is not None:
        stmt = stmt.where(PushDevice.district_id == district_id)
    return db.scalar(stmt.limit(1)) is not None


def _auto_campaign(
    db: Session,
    article: Article,
    *,
    stage: str,
    kind: NotificationKind,
    title_te: str,
    user_ids: set[int],
    anonymous: bool,
) -> int:
    """One publish-time stage, logged as a campaign so its push is sent and
    counted like an editor's. Nobody to reach means nothing logged."""
    if not user_ids and not anonymous:
        return 0
    campaign = NotificationCampaign(
        title_te=title_te[:400],
        body_te=(article.summary_te or None) and article.summary_te[:1000],
        article_id=article.id,
        audience=f"auto:{stage}",
        status=_initial_status(db),
        sent_count=0,
    )
    db.add(campaign)
    db.flush()
    campaign.sent_count = _notify(
        db,
        user_ids=user_ids,
        kind=kind,
        title_te=title_te,
        body_te=article.summary_te,
        article_id=article.id,
        campaign_id=campaign.id,
    )
    return campaign.sent_count


def fan_out_for_article(db: Session, article: Article) -> int:
    """§13 publish triggers: breaking > local > topic, one row per reader.

    Signed-out installs have no inbox; they get breaking pushes, and local
    ones for the district chosen on the phone (`_anonymous_devices`).
    """
    notified: set[int] = set()
    total = 0

    # Breaking — every reader who has not switched the toggle off.
    if article.is_breaking:
        candidates = _all_reader_ids(db)
        prefs = _pref_map(db, candidates)
        audience = {
            uid
            for uid in candidates
            if uid not in notified and (uid not in prefs or prefs[uid].notify_breaking)
        }
        total += _auto_campaign(
            db,
            article,
            stage="breaking",
            kind=NotificationKind.BREAKING,
            title_te=f"⚡ {article.title_te}",
            user_ids=audience,
            anonymous=_has_anonymous_devices(db),
        )
        notified |= audience

    # Local — followers of the district/mandal plus readers whose home
    # location matches (§13 "important story in followed location").
    if article.district_id:
        candidates = _followers(db, FollowTargetType.DISTRICT, [article.district_id])
        if article.mandal_id:
            candidates |= _followers(db, FollowTargetType.MANDAL, [article.mandal_id])
        home_rows = db.execute(
            select(UserPreference.user_id).where(
                UserPreference.district_id == article.district_id,
                UserPreference.notify_local.is_(True),
            )
        ).scalars()
        candidates |= set(home_rows)
        prefs = _pref_map(db, candidates)
        audience = {
            uid
            for uid in candidates
            if uid not in notified and (uid not in prefs or prefs[uid].notify_local)
        }
        total += _auto_campaign(
            db,
            article,
            stage="local",
            kind=NotificationKind.LOCAL,
            title_te=article.title_te,
            user_ids=audience,
            # A breaking story already reached every anonymous install.
            anonymous=not article.is_breaking
            and _has_anonymous_devices(db, article.district_id),
        )
        notified |= audience

    # Topic — followers of the category, tags, or author (§13 "topic alert").
    candidates = set()
    if article.category_id:
        candidates |= _followers(db, FollowTargetType.CATEGORY, [article.category_id])
    tag_ids = [
        row
        for row in db.execute(
            select(ArticleTag.tag_id).where(ArticleTag.article_id == article.id)
        ).scalars()
    ]
    candidates |= _followers(db, FollowTargetType.TAG, tag_ids)
    if article.author_id:
        candidates |= _followers(db, FollowTargetType.AUTHOR, [article.author_id])
    prefs = _pref_map(db, candidates)
    audience = {
        uid
        for uid in candidates
        if uid not in notified and (uid not in prefs or prefs[uid].notify_topics)
    }
    total += _auto_campaign(
        db,
        article,
        stage="topic",
        kind=NotificationKind.TOPIC,
        title_te=article.title_te,
        user_ids=audience,
        anonymous=False,
    )

    if total:
        logger.info("notifications_fanned_out", article_id=article.id, recipients=total)
    return total


# --------------------------------------------------------------------------- #
# admin campaigns (§13 Scheduled / §19 Notifications)
# --------------------------------------------------------------------------- #
def _by_slug(db: Session, model: Any, slug: str, what: str) -> Any:
    row = db.execute(select(model).where(model.slug == slug)).scalar_one_or_none()
    if row is None:
        raise ValidationError(details={"audience": f"unknown {what}"})
    return row


def _audience_user_ids(db: Session, audience: str) -> set[int]:
    """The signed-in readers an admin campaign's inbox rows go to."""
    target, _, slug = audience.partition(":")
    if audience == "all":
        return _all_reader_ids(db)
    if target == "district":
        district = _by_slug(db, District, slug, "district")
        user_ids = _followers(db, FollowTargetType.DISTRICT, [district.id])
        user_ids |= set(
            db.execute(
                select(UserPreference.user_id).where(
                    UserPreference.district_id == district.id
                )
            ).scalars()
        )
        return user_ids
    if target == "category":
        category = _by_slug(db, Category, slug, "category")
        return _followers(db, FollowTargetType.CATEGORY, [category.id])
    if target == "tag":
        tag = _by_slug(db, Tag, slug, "tag")
        return _followers(db, FollowTargetType.TAG, [tag.id])
    raise ValidationError(
        details={"audience": "all | district:<slug> | category:<slug> | tag:<slug>"}
    )


def send_campaign(
    db: Session,
    *,
    title_te: str,
    body_te: str | None,
    article_id: int | None,
    audience: str,
    created_by: int,
    send_at: datetime | None = None,
) -> NotificationCampaign:
    """Send now (inbox rows at once, push on the next worker tick) or, with a
    future `send_at`, hold everything until `dispatch_due` reaches it."""
    if article_id is not None and db.get(Article, article_id) is None:
        raise NotFoundError()
    # Resolved even when scheduled, so a bad slug is refused now, not later.
    user_ids = _audience_user_ids(db, audience)
    scheduled = send_at is not None and send_at > utcnow()

    campaign = NotificationCampaign(
        title_te=title_te[:400],
        body_te=(body_te or None) and body_te[:1000],
        article_id=article_id,
        audience=audience,
        created_by=created_by,
        status="scheduled" if scheduled else _initial_status(db),
        send_at=send_at if scheduled else None,
        sent_count=0,
    )
    db.add(campaign)
    db.flush()
    if not scheduled:
        campaign.sent_count = _notify(
            db,
            user_ids=user_ids,
            kind=NotificationKind.SYSTEM,
            title_te=title_te,
            body_te=body_te,
            article_id=article_id,
            campaign_id=campaign.id,
        )
    return campaign


def cancel_campaign(db: Session, campaign_id: int) -> NotificationCampaign:
    campaign = db.get(NotificationCampaign, campaign_id)
    if campaign is None:
        raise NotFoundError()
    if not _claim(db, campaign_id, "scheduled", "cancelled"):
        raise ConflictError(
            "Only a scheduled campaign can be cancelled.",
            "షెడ్యూల్ చేసిన ప్రకటనను మాత్రమే రద్దు చేయగలం.",
            details={"status": campaign.status},
        )
    return campaign


def record_opened(db: Session, campaign_id: int) -> None:
    db.execute(
        update(NotificationCampaign)
        .where(NotificationCampaign.id == campaign_id)
        .values(opened=NotificationCampaign.opened + 1)
    )


# --------------------------------------------------------------------------- #
# push delivery (the notify.dispatch worker)
# --------------------------------------------------------------------------- #
def _claim(db: Session, campaign_id: int, current: str, to: str) -> bool:
    """Move a campaign between states only if nobody else already did."""
    result = db.execute(
        update(NotificationCampaign)
        .where(
            NotificationCampaign.id == campaign_id,
            NotificationCampaign.status == current,
        )
        .values(status=to)
    )
    return bool(result.rowcount)


def _anonymous_devices(db: Session, campaign: NotificationCampaign) -> Any:
    """Which signed-out installs a campaign also reaches, as a WHERE clause.

    Signed-in readers are reached through their inbox rows, which already
    honour their notification toggles. An anonymous install has no rows, so
    it is matched on the one thing the phone told us: its district.
    """
    if campaign.audience == "auto:breaking":
        return true()
    district_id = None
    if campaign.audience == "auto:local" and campaign.article_id:
        article = db.get(Article, campaign.article_id)
        # A breaking story already reached every anonymous install.
        if article is not None and not article.is_breaking:
            district_id = article.district_id
    elif campaign.audience.startswith("district:"):
        district_id = db.scalar(
            select(District.id).where(District.slug == campaign.audience.split(":", 1)[1])
        )
    return PushDevice.district_id == district_id if district_id else None


def _foreign_tokens(response: httpx.Response) -> set[str]:
    """The tokens behind a PUSH_TOO_MANY_EXPERIENCE_IDS refusal that are not ours.

    Expo lists the batch's tokens per project; ours is the largest group.
    ponytail: majority vote — pin our '@owner/slug' if junk registrations
    could ever outnumber real installs within one batch.
    """
    try:
        errors = response.json().get("errors") or []
    except (ValueError, AttributeError):
        return set()
    for error in errors:
        if error.get("code") == "PUSH_TOO_MANY_EXPERIENCE_IDS":
            groups = sorted((error.get("details") or {}).values(), key=len)
            return {token for group in groups[:-1] for token in group}
    return set()


def _campaign_tokens(db: Session, campaign: NotificationCampaign) -> list[str]:
    if campaign.audience == "all":
        where = true()
    else:
        where = PushDevice.user_id.in_(
            select(Notification.user_id).where(Notification.campaign_id == campaign.id)
        )
        anonymous = _anonymous_devices(db, campaign)
        if anonymous is not None:
            where = or_(where, and_(PushDevice.user_id.is_(None), anonymous))
    return list(db.scalars(select(PushDevice.token).where(where).order_by(PushDevice.id)))


def _deliver(db: Session, campaign: NotificationCampaign) -> None:
    # ponytail: Expo tickets only — no receipt pass (the FCM/APNs verdict) and
    # no retry of a chunk that failed. Add a receipts check ~15 min later if
    # "delivered" has to mean on the phone rather than accepted by Expo.
    tokens = _campaign_tokens(db, campaign)
    article = db.get(Article, campaign.article_id) if campaign.article_id else None
    data = {"campaign_id": campaign.id, "short_id": article.short_id if article else None}
    access_token = settings_service.get_secret(db, "push.expo_access_token")
    message = {
        "title": campaign.title_te,
        **({"body": campaign.body_te} if campaign.body_te else {}),
        "data": data,
        "sound": "default",
        "priority": "high",
        "channelId": "default",
    }
    ok = failed = 0
    for i in range(0, len(tokens), PUSH_CHUNK):
        chunk = tokens[i : i + PUSH_CHUNK]
        tickets: list[dict[str, Any]] = []
        for _attempt in range(2):
            try:
                tickets = _post([{"to": token, **message} for token in chunk], access_token)
                break
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "push_chunk_refused",
                    campaign_id=campaign.id,
                    size=len(chunk),
                    body=exc.response.text[:500],
                )
                # A token from another Expo app fails the whole request, not
                # just its own ticket: drop it for good and resend the rest once.
                foreign = _foreign_tokens(exc.response)
                if not foreign:
                    break
                db.execute(delete(PushDevice).where(PushDevice.token.in_(foreign)))
                failed += sum(token in foreign for token in chunk)
                chunk = [token for token in chunk if token not in foreign]
            except (httpx.HTTPError, ValueError):
                logger.exception("push_chunk_failed", campaign_id=campaign.id, size=len(chunk))
                break
        dead = []
        for n, token in enumerate(chunk):
            ticket = tickets[n] if n < len(tickets) else {}
            if ticket.get("status") == "ok":
                ok += 1
                continue
            failed += 1
            if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                dead.append(token)
        if dead:
            # The app was uninstalled or the token rotated; it will never work again.
            db.execute(delete(PushDevice).where(PushDevice.token.in_(dead)))
    campaign.devices, campaign.push_ok, campaign.push_failed = len(tokens), ok, failed
    campaign.sent_at = utcnow()
    campaign.status = "failed" if tokens and not ok else "sent"
    logger.info(
        "push_sent", campaign_id=campaign.id, devices=len(tokens), ok=ok, failed=failed
    )


def dispatch_due(db: Session, now: datetime | None = None) -> dict[str, int]:
    """The `notify.dispatch` beat tick: release due schedules into the inbox,
    then push every queued campaign. Each step claims its campaign with a
    conditional UPDATE, so two overlapping ticks never send one twice."""
    if not settings_service.get_bool(db, "push.enabled"):
        return {"released": 0, "pushed": 0}
    now = now or utcnow()

    released = 0
    due = db.scalars(
        select(NotificationCampaign)
        .where(
            NotificationCampaign.status == "scheduled",
            NotificationCampaign.send_at <= now,
        )
        .order_by(NotificationCampaign.id)
    ).all()
    for campaign in due:
        if not _claim(db, campaign.id, "scheduled", "queued"):
            continue
        try:
            campaign.sent_count = _notify(
                db,
                user_ids=_audience_user_ids(db, campaign.audience),
                kind=NotificationKind.SYSTEM,
                title_te=campaign.title_te,
                body_te=campaign.body_te,
                article_id=campaign.article_id,
                campaign_id=campaign.id,
            )
        except ValidationError:
            # The district, category or tag was removed after scheduling.
            campaign.status = "failed"
        db.commit()
        released += 1

    pushed = 0
    queued = db.scalars(
        select(NotificationCampaign.id)
        .where(NotificationCampaign.status == "queued")
        .order_by(NotificationCampaign.id)
    ).all()
    for campaign_id in queued:
        if not _claim(db, campaign_id, "queued", "sending"):
            continue
        db.commit()
        campaign = db.get(NotificationCampaign, campaign_id)
        if (campaign.send_at or campaign.created_at) < now - STALE_AFTER:
            logger.warning("push_stale", campaign_id=campaign_id)
            campaign.status = "failed"
        else:
            try:
                _deliver(db, campaign)
            except Exception:  # noqa: BLE001 — one bad campaign must not stall the queue
                logger.exception("push_dispatch_failed", campaign_id=campaign_id)
                db.rollback()
                campaign = db.get(NotificationCampaign, campaign_id)
                campaign.status = "failed"
        db.commit()
        pushed += 1
    return {"released": released, "pushed": pushed}


# --------------------------------------------------------------------------- #
# inbox & devices
# --------------------------------------------------------------------------- #
def unread_count(db: Session, user_id: int) -> int:
    return int(
        db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id, Notification.read_at.is_(None)
            )
        ).scalar()
        or 0
    )


def mark_read(db: Session, user_id: int, ids: list[int] | None) -> int:
    stmt = (
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    if ids:
        stmt = stmt.where(Notification.id.in_(ids))
    result = db.execute(stmt)
    return int(result.rowcount or 0)


def register_device(
    db: Session,
    *,
    user_id: int | None,
    token: str,
    platform: SessionPlatform,
    district_slug: str | None = None,
) -> PushDevice:
    district_id = (
        db.scalar(select(District.id).where(District.slug == district_slug))
        if district_slug
        else None
    )
    device = db.execute(
        select(PushDevice).where(PushDevice.token == token)
    ).scalar_one_or_none()
    if device is None:
        device = PushDevice(
            user_id=user_id, token=token, platform=platform, district_id=district_id
        )
        db.add(device)
    else:
        # The token belongs to whoever is signed in on the phone now: it moves
        # between accounts on a shared phone, and back to anonymous on sign-out.
        device.user_id = user_id
        device.platform = platform
        device.district_id = district_id
    device.last_seen_at = utcnow()
    db.flush()
    return device


def device_counts(db: Session) -> dict[str, int]:
    by_platform = dict(
        db.execute(
            select(PushDevice.platform, func.count(PushDevice.id)).group_by(
                PushDevice.platform
            )
        ).all()
    )
    anonymous = db.scalar(
        select(func.count(PushDevice.id)).where(PushDevice.user_id.is_(None))
    )
    return {
        "total": sum(by_platform.values()),
        "android": by_platform.get(SessionPlatform.ANDROID, 0),
        "ios": by_platform.get(SessionPlatform.IOS, 0),
        "anonymous": int(anonymous or 0),
    }
