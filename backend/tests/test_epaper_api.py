"""The e-paper admin and public HTTP surface: permissions, page count, PDF flow."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import seed_permissions, seed_roles  # noqa: E402
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import ArticleStatus, RoleKey, ScopeType, UserStatus, WorkflowState  # noqa: E402
from app.models.epaper import EpaperAsset, EpaperEdition, EpaperPage, EpaperPageArticle  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, epaper_service, settings_service  # noqa: E402

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_categories(session)
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
def _isolate(db: Session) -> Iterator[None]:
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    for model in (EpaperPageArticle, EpaperPage, EpaperAsset, EpaperEdition, Article, AppSetting):
        db.query(model).delete()
    db.commit()
    db.expunge_all()
    settings_service.invalidate()


def staff_headers(db: Session, *, role: RoleKey, email: str) -> dict[str, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def publish_stories(db: Session, n: int) -> None:
    for i in range(n):
        db.add(
            Article(
                short_id=f"e{i:05d}",
                slug=f"epaper-story-{i}",
                title_te=f"వార్త {i}",
                summary_te="సారాంశం",
                word_count=120,
                status=ArticleStatus.PUBLISHED,
                workflow_state=WorkflowState.PUBLISHED,
                published_at=utcnow(),
            )
        )
    db.commit()


def today() -> str:
    return datetime.now(epaper_service.IST).date().isoformat()


def test_public_pdf_409_when_not_ready(client: TestClient, db: Session) -> None:
    publish_stories(db, 3)
    edition = epaper_service.generate_daily(db, page_count=1)
    epaper_service.approve(db, edition, 1)
    epaper_service.publish(db, edition, 1)
    db.commit()
    response = client.get(f"/api/v1/epaper/{today()}/pdf", follow_redirects=False)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT"


def test_admin_pdf_enqueues_background_job(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    publish_stories(db, 3)
    edition = epaper_service.generate_daily(db, page_count=1)
    epaper_service.approve(db, edition, 1)
    db.commit()
    calls: list[int] = []
    monkeypatch.setattr(epaper_service, "render_pdf_job", lambda edition_id, **_kw: calls.append(edition_id))
    desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
    response = client.post(f"/api/v1/admin/epaper/{edition.id}/pdf", headers=desk)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "PENDING"
    assert calls == [edition.id]
    dtp = staff_headers(db, role=RoleKey.DTP_OPERATOR, email="dtp@example.com")
    assert client.post(f"/api/v1/admin/epaper/{edition.id}/publish", headers=dtp).status_code == 403


def test_generate_accepts_page_count_and_regenerate_refuses_personal(
    client: TestClient, db: Session
) -> None:
    publish_stories(db, 12)
    desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
    response = client.post("/api/v1/admin/epaper/generate", json={"page_count": 2}, headers=desk)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["page_count"] == 2
    assert body["pages"][0]["slots"] and body["pages"][0]["grid"] == {"cols": 6, "rows": 6}
    assert body["pages"][0]["articles"][0]["slot"] == 0
    assert body["pages"][0]["articles"][0]["size"] == "lead"

    plan = client.get("/api/v1/admin/epaper/plan", headers=desk).json()
    assert plan["candidates"] == 12 and plan["default_page_count"] == 8

    page = body["pages"][0]
    patched = client.patch(
        f"/api/v1/admin/epaper/{body['id']}/pages/{page['id']}",
        json={"article_ids": [page["articles"][0]["id"], None, page["articles"][1]["id"]]},
        headers=desk,
    )
    assert patched.status_code == 200, patched.text
    assert [a["slot"] for a in patched.json()["articles"]] == [0, 2]

    listed = client.get(
        f"/api/v1/admin/epaper/{body['id']}/candidates", params={"page_id": page["id"]}, headers=desk
    ).json()["items"]
    assert listed and all(item["size"] in {"lead", "standard", "brief"} for item in listed)

    personal = EpaperEdition(
        title="mine", edition_date=datetime.now(epaper_service.IST).date(), edition_type="PERSONAL_9", owner_user_id=9
    )
    db.add(personal)
    db.commit()
    assert client.post(f"/api/v1/admin/epaper/{personal.id}/regenerate", headers=desk).status_code == 409
