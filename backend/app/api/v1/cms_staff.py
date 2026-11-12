"""Who may use the CMS — managed by admins (permission user.manage).

    POST   /cms/users              add a staff member by their Google address
    PATCH  /cms/users/{id}         {"status": "active" | "disabled"}
    DELETE /cms/users/{id}         remove the account's access for good

Staff sign in with Google (app/services/google_auth_service): an account here
with a staff role is what lets that Google address into the CMS. Switching
someone off or removing them signs them out on every device at once.
Nobody can switch off or remove themselves, and the last active super admin
always stays, so the CMS can never be left with no one able to sign in.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.base import utcnow
from app.db.session import get_db
from app.models.enums import AuditAction, RoleKey, ScopeType, UserStatus
from app.models.user import Role, User, UserRole
from app.services import audit_service, auth_service
from app.services.google_auth_service import READER_ROLES

router = APIRouter(prefix="/cms/users", tags=["cms-management"])


class StaffIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=2, max_length=40)


class StatusIn(BaseModel):
    status: Literal["active", "disabled"]


def _out(user: User) -> dict:
    return {
        "id": user.id,
        "name_te": user.name_te,
        "name_en": user.name_en,
        "email": user.email,
        "status": user.status,
        "roles": [{"key": ur.role.key, "label_en": ur.role.label_en, "label_te": ur.role.label_te} for ur in user.roles if ur.role],
    }


def _active_super_admins(db: Session) -> int:
    return db.scalar(
        select(func.count(func.distinct(User.id)))
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.key == RoleKey.SUPER_ADMIN.value, User.status == UserStatus.ACTIVE, User.deleted_at.is_(None))
    ) or 0


def _target(db: Session, user_id: int, p: Principal) -> User:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise NotFoundError()
    if user.id == p.id:
        raise ValidationError(details={"user": "You cannot switch off or remove your own access."})
    if any(ur.role and ur.role.key == RoleKey.SUPER_ADMIN.value for ur in user.roles) and not p.has_role(RoleKey.SUPER_ADMIN):
        raise ValidationError(details={"user": "Only a super admin can change a super admin."})
    return user


def _keeps_a_super_admin(db: Session, user: User) -> None:
    is_super = any(ur.role and ur.role.key == RoleKey.SUPER_ADMIN.value for ur in user.roles)
    if is_super and user.status == UserStatus.ACTIVE and _active_super_admins(db) <= 1:
        raise ValidationError(details={"user": "This is the last active super admin."})


@router.post("", status_code=201, summary="Add a staff member (they sign in with Google)")
def add_staff(
    payload: StaffIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("user.manage")),
) -> dict:
    email = payload.email.strip().lower()
    role = db.scalar(select(Role).where(Role.key == payload.role))
    if role is None or role.key in READER_ROLES:
        raise ValidationError(details={"role": "Pick a newsroom role."})
    if role.key == RoleKey.SUPER_ADMIN.value and not p.has_role(RoleKey.SUPER_ADMIN):
        raise ValidationError(details={"role": "Only a super admin can add a super admin."})

    user = db.scalar(select(User).where(User.email == email, User.deleted_at.is_(None)))
    if user is not None and any(ur.role and ur.role.key not in READER_ROLES for ur in user.roles):
        raise ConflictError(details={"email": "This address is already on the staff list."})
    if user is None:
        user = User(email=email, name_te=payload.name, name_en=payload.name, status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
    else:  # A reader becoming staff keeps their account.
        user.status = UserStatus.ACTIVE
    db.add(UserRole(user_id=user.id, role_id=role.id, scope_type=ScopeType.GLOBAL, scope_id=None))
    db.flush()
    db.refresh(user)
    audit_service.record(
        db, action=AuditAction.CREATE, entity_type="user", entity_id=user.id, actor=p.user,
        after={"email": email, "role": role.key}, request=request,
    )
    return _out(user)


@router.patch("/{user_id}", summary="Switch a staff member's access off or on")
def set_status(
    user_id: int,
    payload: StatusIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("user.manage")),
) -> dict:
    user = _target(db, user_id, p)
    before = user.status
    if payload.status == "disabled":
        _keeps_a_super_admin(db, user)
        user.status = UserStatus.DISABLED
        auth_service.revoke_all_user_sessions(db, user.id, reason="access switched off")
    else:
        user.status = UserStatus.ACTIVE
    audit_service.record(
        db, action=AuditAction.UPDATE, entity_type="user", entity_id=user.id, actor=p.user,
        before={"status": str(before)}, after={"status": str(user.status)}, request=request,
    )
    return _out(user)


@router.delete("/{user_id}", summary="Remove an account's access for good")
def remove(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("user.manage")),
) -> dict:
    user = _target(db, user_id, p)
    _keeps_a_super_admin(db, user)
    auth_service.revoke_all_user_sessions(db, user.id, reason="access removed")
    user.status = UserStatus.DISABLED
    user.deleted_at = utcnow()
    audit_service.record(
        db, action=AuditAction.DELETE, entity_type="user", entity_id=user.id, actor=p.user,
        before={"email": user.email}, request=request,
    )
    return {"removed": True}
