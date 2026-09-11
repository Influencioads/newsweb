"""Notification models (updated doc §13): the in-app inbox, campaign records,
and registered push devices.

The inbox is authoritative — a row here is what the reader sees in the app and
on the web. FCM delivery is an additional transport layered on top once
credentials are configured; its absence never hides a notification.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.db.types import UTCDateTime
from app.models.enums import NotificationKind, SessionPlatform


class Notification(PKMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
        Index("ix_notifications_user_id_read_at", "user_id", "read_at"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[NotificationKind] = mapped_column(
        Enum(NotificationKind, native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    body_te: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    article_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=True
    )
    campaign_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("notification_campaigns.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class NotificationCampaign(PKMixin, TimestampMixin, Base):
    """§13 "Scheduled / admin campaigns" — the audit record of each send."""

    __tablename__ = "notification_campaigns"
    __table_args__ = (MYSQL_TABLE_ARGS,)

    title_te: Mapped[str] = mapped_column(String(400), nullable=False)
    body_te: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    article_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="SET NULL"), nullable=True
    )
    audience: Mapped[str] = mapped_column(
        String(120), nullable=False, doc="all | district:<slug> | category:<slug>"
    )
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PushDevice(PKMixin, TimestampMixin, Base):
    """FCM/APNs registration (§13). Stored now; delivery activates when
    FCM_SERVICE_ACCOUNT_JSON is configured — the token inventory must not wait
    for that day."""

    __tablename__ = "push_devices"
    __table_args__ = (
        UniqueConstraint("token", name="uq_push_devices_token"),
        Index("ix_push_devices_user_id", "user_id"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(400), nullable=False)
    platform: Mapped[SessionPlatform] = mapped_column(
        Enum(SessionPlatform, native_enum=False, length=20, validate_strings=True),
        nullable=False,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
