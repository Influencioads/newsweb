"""The home hero banner's slides, chosen and ordered in the CMS (block `hero`)."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.content import Article
from app.models.enums import ArticleStatus, RoleKey, WorkflowState
from tests.test_article_delete import client, db, staff_headers  # noqa: F401  (fixtures)


def _published(client: TestClient, db: Session, headers: dict[str, str], title: str) -> Article:  # noqa: F811
    r = client.post(
        "/api/v1/cms/articles",
        json={
            "title_te": title,
            "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "కథ"}]}]},
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    article = db.get(Article, r.json()["id"])
    article.status = ArticleStatus.PUBLISHED
    article.workflow_state = WorkflowState.PUBLISHED
    article.published_at = utcnow() - timedelta(minutes=5)
    db.commit()
    return article


def test_hero_slides_follow_the_desk_order(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.SUPER_ADMIN, email="hero-admin@test.example.com")
    first = _published(client, db, admin, "మొదటి స్లైడ్")
    second = _published(client, db, admin, "రెండో స్లైడ్")

    assert client.get("/api/v1/public/home").json()["hero"] == []

    r = client.put("/api/v1/cms/site-content/hero", json={"article_ids": [second.id, first.id]}, headers=admin)
    assert r.status_code == 200, r.text
    hero = client.get("/api/v1/public/home").json()["hero"]
    assert [h["short_id"] for h in hero] == [second.short_id, first.short_id]

    # An unpublished story drops out of the banner on its own.
    second.status = ArticleStatus.UNPUBLISHED
    db.commit()
    hero = client.get("/api/v1/public/home").json()["hero"]
    assert [h["short_id"] for h in hero] == [first.short_id]

    for bad in ({"article_ids": [first.id, first.id]}, {"article_ids": list(range(1, 12))}, {"article_ids": [0]}):
        assert client.put("/api/v1/cms/site-content/hero", json=bad, headers=admin).status_code == 422, bad
    assert client.delete("/api/v1/cms/site-content/hero", headers=admin).status_code == 200


def test_picked_author_name_replaces_the_staff_account(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.SUPER_ADMIN, email="byline-admin@test.example.com")
    article = _published(client, db, admin, "రచయిత పేరు")
    url = f"/api/v1/public/articles/{article.short_id}"
    # No name picked: readers see the staff account.
    assert client.get(url).json()["author"] is not None

    article.byline_te = "సాయి మాసుల"
    db.commit()
    story = client.get(url).json()
    assert story["author"] is None
    assert story["byline_te"] == "సాయి మాసుల"
