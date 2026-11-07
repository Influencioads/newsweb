"""A story can sit in up to four sections: its main one plus three more.

The main section (`category_id`) keeps the URL and the label; the extra ones
add the story to their section pages and to the CMS category filter.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.content import Article, Category
from app.models.enums import ArticleStatus, RoleKey, WorkflowState
from tests.test_article_delete import client, db, staff_headers  # noqa: F401  (fixtures)


def _cat(db: Session, slug: str) -> int:  # noqa: F811
    return db.scalar(select(Category.id).where(Category.slug == slug))


def _create(client: TestClient, headers: dict[str, str], **extra):  # noqa: F811
    return client.post(
        "/api/v1/cms/articles",
        json={
            "title_te": "నాలుగు విభాగాల కథనం",
            "body": {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "కథనం"}]}
            ]},
            **extra,
        },
        headers=headers,
    )


def test_extra_sections_are_saved_and_list_the_story(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.ADMIN, email="extra-admin@test.example.com")
    heroes, tech, mystery = _cat(db, "real-heroes"), _cat(db, "wow-tech"), _cat(db, "mystery")

    # The main section picked again among the extras is ignored.
    r = _create(client, admin, category_id=heroes, extra_category_ids=[tech, heroes, mystery])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["category_id"] == heroes
    assert body["extra_category_ids"] == [tech, mystery]
    article_id = body["id"]

    # Round-trips on the detail and the list.
    assert client.get(f"/api/v1/cms/articles/{article_id}", headers=admin).json()["extra_category_ids"] == [tech, mystery]
    listed = client.get("/api/v1/cms/articles", params={"category_id": mystery, "limit": 100}, headers=admin).json()
    row = next(a for a in listed["articles"] if a["id"] == article_id)
    assert row["extra_category_ids"] == [tech, mystery]

    # Live, it shows on the extra sections' pages as well as its own.
    article = db.get(Article, article_id)
    article.status = ArticleStatus.PUBLISHED
    article.workflow_state = WorkflowState.PUBLISHED
    article.published_at = utcnow() - timedelta(minutes=1)
    db.commit()
    for slug in ("real-heroes", "wow-tech", "mystery"):
        feed = client.get("/api/v1/public/articles", params={"category": slug}).json()["articles"]
        assert article.short_id in {a["short_id"] for a in feed}, slug
    feed = client.get("/api/v1/public/articles", params={"category": "wow-puranam"}).json()["articles"]
    assert article.short_id not in {a["short_id"] for a in feed}

    # Changing the extras replaces them; an empty list clears them.
    r = client.patch(f"/api/v1/cms/articles/{article_id}", json={"extra_category_ids": [mystery]}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["extra_category_ids"] == [mystery]
    r = client.patch(f"/api/v1/cms/articles/{article_id}", json={"extra_category_ids": []}, headers=admin)
    assert r.json()["extra_category_ids"] == []


def test_at_most_three_extra_sections(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.ADMIN, email="extra-admin@test.example.com")
    ids = [_cat(db, s) for s in ("wow-tech", "mystery", "wow-idea", "wow-puranam")]
    r = _create(client, admin, category_id=_cat(db, "real-heroes"), extra_category_ids=ids)
    assert r.status_code == 422, r.text


def test_an_unknown_extra_section_is_refused(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.ADMIN, email="extra-admin@test.example.com")
    r = _create(client, admin, category_id=_cat(db, "real-heroes"), extra_category_ids=[999999])
    assert r.status_code == 422, r.text
