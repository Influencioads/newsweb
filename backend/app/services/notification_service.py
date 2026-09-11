"""Notifications (updated doc §13): publish-time fan-out, admin campaigns,
the inbox, and push-device registration.

The in-app inbox rows are the product; FCM is a transport added on top when
credentials exist (a stub logs instead of sending until then). Fan-out runs
inside the publish transaction but is wrapped by the caller so a notification
bug can never block a story from going live.
"""

from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import NotFoundError, ValidationError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.content import Article, ArticleTag, Category
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

logger = get_logger(__name__)

#: Fan-out ceiling per event. The dev/small-site path inserts rows directly;
#: beyond this, production should page through Celery (§10 performance).
MAX_FANOUT = 10_000


def _push_transport_send(user_ids: list[int], title: str, db: Session) -> None:
    """FCM delivery stub — activates when FCM_SERVICE_ACCOUNT_JSON is set."""
    if not settings.FCM_SERVICE_ACCOUNT_JSON:
        logger.info("push_skipped_unconfigured", recipients=len(user_ids))
        return
    tokens = db.execute(
        select(func.count(PushDevice.id)).where(PushDevice.user_id.in_(user_ids))
    ).scalar()
    # TODO(phase-later): batch-send via firebase-admin once credentials ship.
    logger.info(
        "push_would_send",
        recipients=len(user_ids),
        devices=int(tokens or 0),
        title=title[:60],
    )


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
    recipients = list(user_ids)[:MAX_FANOUT]
    for user_id in recipients:
        db.add(
            Notification(
                user_id=user_id,
                kind=kind,
                title_te=title_te[:400],
                body_te=(body_te or None) and body_te[:1000],
                article_id=article_id,
                campaign_id=campaign_id,
                created_at=now,
            )
        )
    if recipients:
        _push_transport_send(recipients, title_te, db)
    return len(recipients)


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


def fan_out_for_article(db: Session, article: Article) -> int:
    """§13 publish triggers: breaking > local > topic, one row per reader."""
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
        total += _notify(
            db,
            user_ids=audience,
            kind=NotificationKind.BREAKING,
            title_te=f"⚡ {article.title_te}",
            body_te=article.summary_te,
            article_id=article.id,
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
        total += _notify(
            db,
            user_ids=audience,
            kind=NotificationKind.LOCAL,
            title_te=article.title_te,
            body_te=article.summary_te,
            article_id=article.id,
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
    total += _notify(
        db,
        user_ids=audience,
        kind=NotificationKind.TOPIC,
        title_te=article.title_te,
        body_te=article.summary_te,
        article_id=article.id,
    )

    if total:
        logger.info("notifications_fanned_out", article_id=article.id, recipients=total)
    return total


# --------------------------------------------------------------------------- #
# admin campaigns (§13 Scheduled / §19 Notifications)
# --------------------------------------------------------------------------- #
def send_campaign(
    db: Session,
    *,
    title_te: str,
    body_te: str | None,
    article_id: int | None,
    audience: str,
    created_by: int,
) -> NotificationCampaign:
    if article_id is not None and db.get(Article, article_id) is None:
        raise NotFoundError()

    if audience == "all":
        user_ids = _all_reader_ids(db)
    elif audience.startswith("district:"):
        slug = audience.split(":", 1)[1]
        district = db.execute(
            select(District).where(District.slug == slug)
        ).scalar_one_or_none()
        if district is None:
            raise ValidationError(details={"audience": "unknown district"})
        user_ids = _followers(db, FollowTargetType.DISTRICT, [district.id])
        user_ids |= set(
            db.execute(
                select(UserPreference.user_id).where(
                    UserPreference.district_id == district.id
                )
            ).scalars()
        )
    elif audience.startswith("category:"):
        slug = audience.split(":", 1)[1]
        category = db.execute(
            select(Category).where(Category.slug == slug)
        ).scalar_one_or_none()
        if category is None:
            raise ValidationError(details={"audience": "unknown category"})
        user_ids = _followers(db, FollowTargetType.CATEGORY, [category.id])
    else:
        raise ValidationError(
            details={"audience": "all | district:<slug> | category:<slug>"}
        )

    campaign = NotificationCampaign(
        title_te=title_te[:400],
        body_te=(body_te or None) and body_te[:1000],
        article_id=article_id,
        audience=audience,
        created_by=created_by,
    )
    db.add(campaign)
    db.flush()
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
    db: Session, *, user_id: int, token: str, platform: SessionPlatform
) -> PushDevice:
    device = db.execute(
        select(PushDevice).where(PushDevice.token == token)
    ).scalar_one_or_none()
    if device is None:
        device = PushDevice(user_id=user_id, token=token, platform=platform)
        db.add(device)
    else:
        # A token can migrate between accounts on a shared phone.
        device.user_id = user_id
        device.platform = platform
    device.last_seen_at = utcnow()
    db.flush()
    return device
