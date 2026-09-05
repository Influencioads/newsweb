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


class State(PKMixin, TimestampMixin, Base):
    """Top of the reader location hierarchy (updated doc §4):

        India → State → District → Mandal → City/Village

    Districts keep their 2-char `state` code column (RBAC scoping and 59 rows
    of seeded data depend on it); this table joins on that code and exists so
    the hierarchy is admin-manageable and presentable, not to re-key districts.
    """

    __tablename__ = "states"
    __table_args__ = (
        UniqueConstraint("code", name="uq_states_code"),
        UniqueConstraint("slug", name="uq_states_slug"),
        MYSQL_TABLE_ARGS,
    )

    code: Mapped[str] = mapped_column(String(2), nullable=False, doc="AP | TS")
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort: Mapped[int] = mapped_column(nullable=False, default=0)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<State {self.code}>"


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
    localities: Mapped[list["Locality"]] = relationship(
        back_populates="mandal", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Mandal {self.slug}>"


class Locality(PKMixin, TimestampMixin, Base):
    """City / town / village under a mandal — the finest feed granularity
    (updated doc §4). Optional: most stories stop at district or mandal level,
    so this table starts empty and grows through the admin location master."""

    __tablename__ = "localities"
    __table_args__ = (
        UniqueConstraint("mandal_id", "slug", name="uq_localities_mandal_id_slug"),
        MYSQL_TABLE_ARGS,
    )

    mandal_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("mandals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(10), nullable=False, default="village", doc="city | town | village"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    mandal: Mapped["Mandal"] = relationship(back_populates="localities")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Locality {self.slug}>"
