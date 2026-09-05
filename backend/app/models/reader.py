"""Reader-side models (updated doc §11): per-user preferences.

Kept apart from `app.models.user` deliberately — the identity tables serve staff
and readers alike, while this table exists only for readers. One row per user,
created lazily on first save.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin


class UserPreference(PKMixin, TimestampMixin, Base):
    __tablename__ = "user_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_preferences_user_id"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    language: Mapped[str] = mapped_column(
        String(5), nullable=False, default="te", doc="UI language: te | en"
    )

    # Home location (§4): each level optional, child implies parent.
    state_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    mandal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("mandals.id", ondelete="SET NULL"), nullable=True
    )
    locality_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("localities.id", ondelete="SET NULL"), nullable=True
    )

    #: Chosen interest categories, stored as slugs — the onboarding "pick your
    #: interests" step (§32). Slugs, not ids, so the payload round-trips as-is.
    category_slugs: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)

    notify_breaking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_local: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_topics: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserPreference u={self.user_id}>"
