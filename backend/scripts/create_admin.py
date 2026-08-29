"""Create the first production super administrator interactively.

Run after migrations and the reference seed:
    python -m scripts.create_admin --email admin@example.com

The password is read with getpass so it is not stored in shell history or
visible in the process list. Existing accounts are never modified.
"""

from __future__ import annotations

import argparse
import getpass
import re

from sqlalchemy import select

from app.core.security import hash_password
from app.db.base import utcnow
from app.db.session import session_scope
from app.models.enums import RoleKey, ScopeType, UserStatus
from app.models.user import Role, User, UserRole

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def create_admin(email: str, name_en: str, name_te: str) -> None:
    email = email.strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise SystemExit("Enter a valid email address.")

    password = getpass.getpass("New administrator password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    if len(password) < 14:
        raise SystemExit("Password must be at least 14 characters.")

    with session_scope() as db:
        existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing is not None:
            raise SystemExit(f"Refusing to modify existing account: {email}")

        role = db.execute(
            select(Role).where(Role.key == RoleKey.SUPER_ADMIN.value)
        ).scalar_one_or_none()
        if role is None:
            raise SystemExit("super_admin role is missing; run python -m app.db.seed first.")

        user = User(
            email=email,
            name_en=name_en.strip() or "Administrator",
            name_te=name_te.strip() or "అడ్మినిస్ట్రేటర్",
            password_hash=hash_password(password),
            password_changed_at=utcnow(),
            status=UserStatus.ACTIVE,
            two_factor_enabled=False,
            is_author=False,
            designation_te="సూపర్ అడ్మిన్",
        )
        db.add(user)
        db.flush()
        db.add(
            UserRole(
                user_id=user.id,
                role_id=role.id,
                scope_type=ScopeType.GLOBAL,
                scope_id=None,
                granted_by=None,
            )
        )

    print(f"Created production super administrator: {email}")
    print("Sign in, then configure two-factor authentication from the account settings.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create the first production administrator")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name-en", default="Administrator")
    parser.add_argument("--name-te", default="అడ్మినిస్ట్రేటర్")
    args = parser.parse_args()
    create_admin(args.email, args.name_en, args.name_te)
