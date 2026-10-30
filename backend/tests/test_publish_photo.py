"""Publishing needs one photo; the editor's extra photos count as that photo.

A story whose Main image was left empty but which has a gallery photo or a
picture inside the body publishes with that photo as its main image. A story
with no photo at all is refused with a message that says what to do.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi.testclient import TestClient

from app.models.content import Article
from app.models.enums import ArticleStatus, MediaType, RoleKey, WorkflowState
from app.models.media import ArticleMedia, Media
from tests.test_article_delete import client, db, staff_headers  # noqa: F401  (fixtures)

_n = 0


def _photo(db: Session) -> Media:  # noqa: F811
    global _n
    _n += 1
    media = Media(type=MediaType.IMAGE, filename=f"p{_n}.webp", mime="image/webp",
                  storage_provider="test", storage_key=f"images/test/p{_n}.webp")
    db.add(media)
    db.flush()
    return media


def _approved(db: Session, body: dict | None = None) -> Article:  # noqa: F811
    global _n
    _n += 1
    article = Article(
        short_id=f"pub{_n:03d}",
        slug=f"publish-photo-{_n}",
        title_te=f"ఫోటో పరీక్ష {_n}",
        status=ArticleStatus.DRAFT,
        workflow_state=WorkflowState.SUBMITTED,
        body=body or {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "కథనం"}]}
        ]},
    )
    db.add(article)
    db.commit()
    return article


def _publish(client: TestClient, headers: dict[str, str], article: Article):  # noqa: F811
    assert client.post(f"/api/v1/cms/articles/{article.id}/approve", json={}, headers=headers).status_code == 200
    return client.post(f"/api/v1/cms/articles/{article.id}/publish", json={}, headers=headers)


def test_a_gallery_photo_becomes_the_main_image(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.ADMIN, email="pub-admin@test.example.com")
    article = _approved(db)
    first, second = _photo(db), _photo(db)
    db.add_all([
        ArticleMedia(article_id=article.id, media_id=second.id, role="gallery", sort=1),
        ArticleMedia(article_id=article.id, media_id=first.id, role="gallery", sort=0),
    ])
    db.commit()

    r = _publish(client, admin, article)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Article, article.id).hero_media_id == first.id
    assert db.get(Article, article.id).workflow_state == WorkflowState.PUBLISHED


def test_a_picture_inside_the_story_becomes_the_main_image(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.ADMIN, email="pub-admin@test.example.com")
    inside = _photo(db)
    article = _approved(db, {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "కథనం"}]},
        {"type": "image", "attrs": {"src": "/media/x.webp", "media_id": inside.id}},
    ]})

    r = _publish(client, admin, article)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Article, article.id).hero_media_id == inside.id


def test_a_story_with_no_photo_is_refused_with_what_to_do(client: TestClient, db: Session) -> None:  # noqa: F811
    admin = staff_headers(db, role=RoleKey.ADMIN, email="pub-admin@test.example.com")
    article = _approved(db)

    r = _publish(client, admin, article)
    assert r.status_code == 422, r.text
    assert "Main image" in r.text
    db.expire_all()
    stored = db.scalar(select(Article).where(Article.id == article.id))
    assert stored.workflow_state == WorkflowState.APPROVED
    assert stored.hero_media_id is None
