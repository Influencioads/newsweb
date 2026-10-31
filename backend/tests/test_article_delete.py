"""Deleting an article from the CMS (soft delete).

`DELETE /cms/articles/{id}` is for super admin, admin and editor-in-chief
(`article.delete`). It sets `deleted_at`: the story leaves the public site and
every CMS list, the row stays in the database so it can be restored, and the
delete is in the audit log.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_homepage_sections,
    seed_mandals,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    AuditAction,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, settings_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    districts = seed_districts(session)
    seed_mandals(session, districts)
    categories = seed_categories(session)
    seed_homepage_sections(session, categories)
    seed_tags(session)
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="module")
def client(db: Session) -> Iterator[TestClient]:
    def _get_db() -> Iterator[Session]:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _clean_settings_cache() -> Iterator[None]:
    """The settings cache is process-global and 30 s long — a test that writes a
    setting would otherwise leak into the next one."""
    settings_service.invalidate()
    yield
    settings_service.invalidate()


def staff_headers(db: Session, *, role: RoleKey, email: str,
                  district_id: int | None = None) -> dict[str, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(
            user_id=user.id, role_id=role_row.id,
            scope_type=ScopeType.DISTRICT if district_id else ScopeType.GLOBAL,
            scope_id=district_id,
        ))
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}

_n = 0


def make_article(db: Session, *, published: bool = True) -> Article:
    global _n
    _n += 1
    article = Article(
        short_id=f"del{_n:03d}",
        slug=f"delete-test-{_n}",
        title_te=f"తొలగింపు పరీక్ష {_n}",
        status=ArticleStatus.PUBLISHED if published else ArticleStatus.DRAFT,
        workflow_state=WorkflowState.PUBLISHED if published else WorkflowState.DRAFT,
        published_at=utcnow() - timedelta(minutes=5) if published else None,
    )
    db.add(article)
    db.commit()
    return article


def _ids(client: TestClient, headers: dict[str, str]) -> set[int]:
    body = client.get("/api/v1/cms/articles", params={"limit": 100}, headers=headers).json()
    return {a["id"] for a in body["articles"]}


def test_editor_in_chief_deletes_a_published_story(client: TestClient, db: Session) -> None:
    eic = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="del-eic@test.example.com")
    article = make_article(db)
    assert client.get(f"/api/v1/public/articles/{article.short_id}").status_code == 200
    assert article.id in _ids(client, eic)

    r = client.delete(f"/api/v1/cms/articles/{article.id}", headers=eic)
    assert r.status_code == 200, r.text
    assert r.json() == {"id": article.id, "deleted": True}

    # Gone from the site, from public lists and from the CMS.
    assert client.get(f"/api/v1/public/articles/{article.short_id}").status_code == 404
    public_ids = {a["short_id"] for a in client.get("/api/v1/public/articles").json()["articles"]}
    assert article.short_id not in public_ids
    assert article.id not in _ids(client, eic)
    assert client.get(f"/api/v1/cms/articles/{article.id}", headers=eic).status_code == 404
    # A second delete finds nothing.
    assert client.delete(f"/api/v1/cms/articles/{article.id}", headers=eic).status_code == 404

    # Recorded in the audit log, with what was deleted.
    row = db.scalar(
        select(AuditLog).where(
            AuditLog.entity_type == "article",
            AuditLog.entity_id == str(article.id),
            AuditLog.action == AuditAction.DELETE,
        )
    )
    assert row is not None
    assert row.before["title_te"] == article.title_te
    assert row.before["short_id"] == article.short_id


def test_the_row_stays_and_can_be_restored(client: TestClient, db: Session) -> None:
    admin = staff_headers(db, role=RoleKey.ADMIN, email="del-admin@test.example.com")
    article = make_article(db, published=False)
    assert client.delete(f"/api/v1/cms/articles/{article.id}", headers=admin).status_code == 200

    db.expire_all()
    kept = db.get(Article, article.id)
    assert kept is not None and kept.deleted_at is not None
    assert kept.title_te == article.title_te  # nothing else touched

    kept.deleted_at = None  # the restore
    db.commit()
    assert article.id in _ids(client, admin)


@pytest.mark.parametrize(
    "role", [RoleKey.DESK_EDITOR, RoleKey.SUB_EDITOR, RoleKey.REPORTER, RoleKey.MODERATOR]
)
def test_other_roles_cannot_delete(client: TestClient, db: Session, role: RoleKey) -> None:
    headers = staff_headers(db, role=role, email=f"del-{role.value}@test.example.com")
    article = make_article(db)
    r = client.delete(f"/api/v1/cms/articles/{article.id}", headers=headers)
    assert r.status_code == 403, r.text
    db.expire_all()
    assert db.get(Article, article.id).deleted_at is None


def test_the_list_filters_by_category(client: TestClient, db: Session) -> None:
    """The Articles list's category filter matches the section or a sub-section."""
    from app.models.content import Category

    admin = staff_headers(db, role=RoleKey.ADMIN, email="del-admin@test.example.com")
    heroes, tech = (
        db.scalar(select(Category).where(Category.slug == slug)) for slug in ("real-heroes", "wow-tech")
    )
    in_heroes, in_tech, filed_under = make_article(db), make_article(db), make_article(db)
    in_heroes.category_id = heroes.id
    in_tech.category_id = tech.id
    filed_under.subcategory_id = heroes.id
    db.commit()

    body = client.get(
        "/api/v1/cms/articles", params={"category_id": heroes.id, "limit": 100}, headers=admin
    ).json()
    ids = {a["id"] for a in body["articles"]}
    assert {in_heroes.id, filed_under.id} <= ids
    assert in_tech.id not in ids
    assert body["total"] == len(ids)
