"""Districts and mandals — the geography permission scoping is built on.

§5 lists these under TAXONOMY, and the brief schedules taxonomy for Phase 3. They
are built in Phase 2 instead because district scoping (§7 of the brief) is part
of the permission check: `user_roles.scope_id` points at a district, so the table
must exist before RBAC can be enforced.

Coverage: Andhra Pradesh 26 districts + Telangana 33 districts (§5).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin

if TYPE_CHECKING:
    pass


class District(PKMixin, TimestampMixin, Base):
    __tablename__ = "districts"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_districts_slug"),
        Index("ix_districts_state_slug", "state", "slug"),
        MYSQL_TABLE_ARGS,
    )

    state: Mapped[str] = mapped_column(
        String(2), nullable=False, doc="AP | TS — ISO-ish short code for the state"
    )
    slug: Mapped[str] = mapped_column(
        String(80), nullable=False, doc="URL segment, transliterated English (§4.5)"
    )
    name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort: Mapped[int] = mapped_column(nullable=False, default=0)

    mandals: Mapped[list["Mandal"]] = relationship(
        back_populates="district", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<District {self.slug} ({self.state})>"


class Mandal(PKMixin, TimestampMixin, Base):
    __tablename__ = "mandals"
    __table_args__ = (
        UniqueConstraint("district_id", "slug", name="uq_mandals_district_id_slug"),
        MYSQL_TABLE_ARGS,
    )

    district_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("districts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    district: Mapped["District"] = relationship(back_populates="mandals")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Mandal {self.slug}>"
