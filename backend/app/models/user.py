"""Identity and access: users, roles, permissions, scoped assignments, sessions.

§5 IDENTITY & ACCESS. The shape that matters:

    user_roles(user_id, role_id, scope_type, scope_id)

A user can hold the same role at different scopes (a desk_editor over two
districts), and holds each row independently. The permission check is
`permission key + scope`, never a role name (§6.1).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import (
    MYSQL_TABLE_ARGS,
    Base,
    PKMixin,
    SoftDeleteMixin,
    TimestampMixin,
)
from app.db.types import UTCDateTime
from app.models.enums import ScopeType, SessionPlatform, UserStatus

if TYPE_CHECKING:
    pass


# --------------------------------------------------------------------------- #
# Permissions & roles
# --------------------------------------------------------------------------- #
class Permission(PKMixin, TimestampMixin, Base):
    """A single capability, addressed by key, e.g. `article.publish`.

    §6.1: "The permission `ai.publish_without_review` does not exist. Do not
    create it." A test asserts that no permission key contains
    `publish_without_review`.
    """

    __tablename__ = "permissions"
    __table_args__ = (
        UniqueConstraint("key", name="uq_permissions_key"),
        MYSQL_TABLE_ARGS,
    )

    key: Mapped[str] = mapped_column(String(80), nullable=False)
    group: Mapped[str] = mapped_column(
        String(40), nullable=False, default="general", doc="UI grouping, e.g. 'article'"
    )
    label_en: Mapped[str] = mapped_column(String(160), nullable=False)
    label_te: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_scoped: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        doc="When true the holder's scope must match the resource's district/mandal",
    )

    roles: Mapped[list["RolePermission"]] = relationship(
        back_populates="permission", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Permission {self.key}>"


class Role(PKMixin, TimestampMixin, Base):
    """§6.1. `level` is the seniority rank used by rules like
    "is_breaking requires level >= 80" and "push approval needs level >= 60"."""

    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("key", name="uq_roles_key"),
        Index("ix_roles_level", "level"),
        MYSQL_TABLE_ARGS,
    )

    key: Mapped[str] = mapped_column(String(40), nullable=False)
    label_te: Mapped[str] = mapped_column(String(80), nullable=False)
    label_en: Mapped[str] = mapped_column(String(80), nullable=False)
    level: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, doc="Seniority rank, 0-100 (§6.1)"
    )
    default_scope_type: Mapped[ScopeType] = mapped_column(
        Enum(ScopeType, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=ScopeType.GLOBAL,
    )
    is_staff: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        doc="Staff roles get session limits and mandatory audit on login (§6.2)",
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        doc="System roles are seeded and cannot be deleted through the admin UI",
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    permissions: Mapped[list["RolePermission"]] = relationship(
        back_populates="role", cascade="all, delete-orphan", lazy="selectin"
    )
    assignments: Mapped[list["UserRole"]] = relationship(back_populates="role")

    @property
    def permission_keys(self) -> set[str]:
        return {rp.permission.key for rp in self.permissions if rp.permission}

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Role {self.key} L{self.level}>"


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (MYSQL_TABLE_ARGS,)

    role_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )

    role: Mapped["Role"] = relationship(back_populates="permissions")
    permission: Mapped["Permission"] = relationship(back_populates="roles", lazy="joined")


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
class User(PKMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("phone", name="uq_users_phone"),
        Index("ix_users_status", "status"),
        MYSQL_TABLE_ARGS,
    )

    name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)

    # Either identifier may be absent: field staff sign in by phone, desk staff by
    # email. Both are unique when present.
    phone: Mapped[str | None] = mapped_column(
        String(20), nullable=True, doc="E.164 without '+', e.g. 919848012345"
    )
    email: Mapped[str | None] = mapped_column(String(190), nullable=True)

    password_hash: Mapped[str | None] = mapped_column(
        String(255), nullable=True, doc="argon2id or bcrypt. Never plaintext, never MD5/SHA (§6.2)"
    )
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=UserStatus.ACTIVE,
        server_default=UserStatus.ACTIVE.value,
    )

    # §6.2 — mandatory TOTP for desk staff, admin and super_admin.
    two_factor_secret: Mapped[str | None] = mapped_column(
        String(255), nullable=True, doc="Encrypted TOTP secret; never returned by any API"
    )
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    avatar_media_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bio_te: Mapped[str | None] = mapped_column(Text, nullable=True)
    designation_te: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Author page (§10.3 requires author as a Person with a real author page).
    author_slug: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    is_author: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, doc="Set by the 30-minute lockout (§6.2)"
    )

    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    roles: Mapped[list["UserRole"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
        foreign_keys="UserRole.user_id",
    )
    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_active(self) -> bool:
        return self.status == UserStatus.ACTIVE and self.deleted_at is None

    @property
    def display_name(self) -> str:
        return self.name_te or self.name_en

    @property
    def max_level(self) -> int:
        """Highest role level held. Drives the level >= 60 / >= 80 rules."""
        return max((ur.role.level for ur in self.roles if ur.role), default=0)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.id} {self.email or self.phone}>"


class UserRole(PKMixin, TimestampMixin, Base):
    """A role held at a scope.

    `scope_id` is interpreted according to `scope_type`:
      GLOBAL/SELF -> NULL
      DISTRICT    -> districts.id
      MANDAL      -> mandals.id
      DESK        -> categories.id
      EDITION     -> epaper_editions.edition_slug group (stored as a district id)

    It is intentionally *not* a foreign key: one column cannot reference four
    tables. The service layer validates the target exists when the assignment is
    created, and a test covers each scope type.
    """

    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "role_id", "scope_type", "scope_id", name="uq_user_roles_assignment"
        ),
        Index("ix_user_roles_user_id_role_id", "user_id", "role_id"),
        Index("ix_user_roles_scope", "scope_type", "scope_id"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    scope_type: Mapped[ScopeType] = mapped_column(
        Enum(ScopeType, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=ScopeType.GLOBAL,
    )
    scope_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    granted_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, doc="Optional temporary assignment"
    )

    user: Mapped["User"] = relationship(back_populates="roles", foreign_keys=[user_id])
    role: Mapped["Role"] = relationship(back_populates="assignments", lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserRole u={self.user_id} r={self.role_id} {self.scope_type}:{self.scope_id}>"


class UserSession(PKMixin, TimestampMixin, Base):
    """One row per signed-in device (§5 `sessions`).

    The refresh token is stored **hashed**, exactly like a password — a database
    dump must not yield usable refresh tokens. Rotation replaces `refresh_hash`
    on every use; a replayed old token therefore fails to match, which is how
    token theft is detected (§1 "rotating refresh").

    Redis mirrors revocation state so the access-token check does not need a
    database round trip; MySQL remains the durable record.
    """

    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_user_id_revoked_at", "user_id", "revoked_at"),
        Index("ix_sessions_expires_at", "expires_at"),
        UniqueConstraint("session_key", name="uq_sessions_session_key"),
        MYSQL_TABLE_ARGS,
    )

    session_key: Mapped[str] = mapped_column(
        String(64), nullable=False, doc="Opaque id carried in the JWT `sid` claim"
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    device_label: Mapped[str | None] = mapped_column(
        String(160), nullable=True, doc="Human-readable, shown in 'log out this device'"
    )
    platform: Mapped[SessionPlatform] = mapped_column(
        Enum(SessionPlatform, native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=SessionPlatform.UNKNOWN,
    )
    refresh_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True, doc="IPv4 or IPv6")
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)

    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)

    user: Mapped["User"] = relationship(back_populates="sessions")

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserSession {self.session_key[:8]}… u={self.user_id}>"
