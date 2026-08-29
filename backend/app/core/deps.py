"""Authentication and authorization dependencies.

This module is where §6.1 ("checked by key, never by role name") and brief §7
(district scoping) are actually enforced. The frontend hiding a button is a
convenience; **this** is the authority (brief §6).

Usage:

    @router.post("/{article_id}/publish")
    def publish(
        article_id: int,
        principal: Principal = Depends(require_permission("article.publish", scoped=True)),
    ): ...

`scoped=True` means the caller's geographic scope must contain the resource. The
route then calls `principal.assert_scope(district_id=..., mandal_id=...)` once it
has loaded the resource, because the scope target is not known until then.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import (
    AccountInactiveError,
    PermissionDeniedError,
    ScopeDeniedError,
    SessionRevokedError,
    UnauthorizedError,
)
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.enums import ScopeType
from app.models.user import User
from app.services.session_registry import is_session_active

# auto_error=False so a missing header raises our own envelope, not FastAPI's.
_bearer = HTTPBearer(auto_error=False, description="JWT access token")


@dataclass
class Principal:
    """The authenticated caller and everything an authorization check needs."""

    user: User
    session_key: str
    permissions: frozenset[str]
    level: int
    #: Districts this user may act on. Empty set + `is_global` False means none.
    district_ids: frozenset[int] = field(default_factory=frozenset)
    mandal_ids: frozenset[int] = field(default_factory=frozenset)
    desk_ids: frozenset[int] = field(default_factory=frozenset)
    is_global: bool = False

    @property
    def id(self) -> int:
        return self.user.id

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def require(self, permission: str) -> None:
        if not self.has(permission):
            raise PermissionDeniedError(
                details={"required_permission": permission},
            )

    def require_level(self, minimum: int, *, reason: str = "") -> None:
        if self.level < minimum:
            raise PermissionDeniedError(
                details={"required_level": minimum, "your_level": self.level, "reason": reason}
            )

    # ---------------------------------------------------------------- scoping
    def in_scope(self, *, district_id: int | None = None, mandal_id: int | None = None) -> bool:
        """Is this resource inside the caller's geographic scope? (brief §7)"""
        if self.is_global:
            return True
        # A mandal-scoped user (stringer) may only touch their own mandal.
        if self.mandal_ids:
            if mandal_id is not None and mandal_id in self.mandal_ids:
                return True
            # Without a mandal on the resource, fall through to the district check
            # only if the user also holds a district scope.
        if district_id is not None and district_id in self.district_ids:
            return True
        # Content with no geography (national/cinema) is only editable by someone
        # with a global scope — otherwise every district reporter could edit it.
        return False

    def assert_scope(
        self, *, district_id: int | None = None, mandal_id: int | None = None
    ) -> None:
        if not self.in_scope(district_id=district_id, mandal_id=mandal_id):
            raise ScopeDeniedError(
                details={
                    "resource_district_id": district_id,
                    "resource_mandal_id": mandal_id,
                    "your_district_ids": sorted(self.district_ids),
                    "your_mandal_ids": sorted(self.mandal_ids),
                }
            )


def build_principal(user: User, session_key: str) -> Principal:
    """Collapse a user's role assignments into a flat permission + scope set."""
    permissions: set[str] = set()
    district_ids: set[int] = set()
    mandal_ids: set[int] = set()
    desk_ids: set[int] = set()
    is_global = False
    level = 0

    for assignment in user.roles:
        role = assignment.role
        if role is None:
            continue
        permissions |= role.permission_keys
        level = max(level, role.level)

        match assignment.scope_type:
            case ScopeType.GLOBAL:
                is_global = True
            case ScopeType.DISTRICT if assignment.scope_id is not None:
                district_ids.add(assignment.scope_id)
            case ScopeType.MANDAL if assignment.scope_id is not None:
                mandal_ids.add(assignment.scope_id)
            case ScopeType.DESK if assignment.scope_id is not None:
                desk_ids.add(assignment.scope_id)
            case ScopeType.EDITION if assignment.scope_id is not None:
                district_ids.add(assignment.scope_id)
            case _:
                pass

    return Principal(
        user=user,
        session_key=session_key,
        permissions=frozenset(permissions),
        level=level,
        district_ids=frozenset(district_ids),
        mandal_ids=frozenset(mandal_ids),
        desk_ids=frozenset(desk_ids),
        is_global=is_global,
    )


def get_current_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Principal:
    """Resolve the caller from the Authorization header.

    Order matters: signature -> session registry -> account status. The session
    registry check is what makes force-logout immediate (§6.2); without it a
    stolen access token would stay valid for its full 15 minutes after revocation.
    """
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError()

    payload = decode_access_token(credentials.credentials)
    session_key = str(payload.get("sid", ""))
    if not session_key or not is_session_active(session_key):
        raise SessionRevokedError()

    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise UnauthorizedError() from exc

    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise SessionRevokedError()
    if not user.is_active:
        raise AccountInactiveError()

    request.state.user_id = user.id
    return build_principal(user, session_key)


def require_permission(
    permission: str, *, scoped: bool = False, min_level: int | None = None
) -> Callable[..., Principal]:
    """Dependency factory — the FastAPI equivalent of the spec's
    `@RequirePermission('article.publish', { scoped: true })`.

    `scoped` is recorded on the principal for the route to act on; the geographic
    check itself happens in `principal.assert_scope(...)` once the route has
    loaded the resource and knows its district.
    """

    def dependency(
        principal: Principal = Depends(get_current_principal),
    ) -> Principal:
        principal.require(permission)
        if min_level is not None:
            principal.require_level(min_level, reason=permission)
        return principal

    dependency.__doc__ = (
        f"Requires permission `{permission}`"
        + (" (district-scoped)" if scoped else "")
        + (f", minimum role level {min_level}" if min_level else "")
    )
    return dependency


def require_any_permission(*permissions: str) -> Callable[..., Principal]:
    def dependency(principal: Principal = Depends(get_current_principal)) -> Principal:
        if not any(principal.has(p) for p in permissions):
            raise PermissionDeniedError(details={"required_any_of": list(permissions)})
        return principal

    return dependency


def get_optional_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Principal | None:
    """For public endpoints that personalise when signed in (bookmarks) but must
    still work for anonymous readers."""
    if credentials is None or not credentials.credentials:
        return None
    try:
        return get_current_principal(request, credentials, db)
    except (UnauthorizedError, SessionRevokedError, AccountInactiveError):
        return None
