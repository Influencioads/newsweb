"""Editorial notes, pinned comments and seeded engagement.

The assertions that matter most here are the ones about *containment*: a
fabricated like must not reach ranking, a fabricated comment must not be
attributable to a real account, and the newsroom must not be able to do either.
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

from app.core.errors import ValidationError  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.engagement import Comment  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, seed_engagement_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)

_counter = 0


def make_article(db: Session, *, minutes_ago: int = 5) -> Article:
    global _counter
    _counter += 1
    category = db.scalars(select(Category).limit(1)).one()
    article = Article(
        short_id=f"s{_counter:05d}",
        slug=f"seeded-{_counter}",
        title_te="ఒక కథనం",
        summary_te="సారాంశం",
        category_id=category.id,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.PUBLISHED,
        published_at=utcnow() - timedelta(minutes=minutes_ago),
    )
    db.add(article)
    db.flush()
    return article


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    seed_districts(session)
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


def staff_headers(db: Session, *, role: RoleKey) -> dict[str, str]:
    email = f"{role.value}-seed@test.example.com"
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(
            email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE
        )
        db.add(user)
        db.flush()
        db.add(
            UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL)
        )
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


class TestSeededLikes:
    def test_the_reader_sees_the_total_but_ranking_sees_only_real_likes(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        article.like_count = 3
        db.commit()

        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/seed-likes",
            json={"count": 500},
            headers=headers,
        )
        assert r.status_code == 200, r.text

        detail = client.get(f"/api/v1/public/articles/{article.short_id}").json()
        assert detail["like_count"] == 503, "reader total is real + seeded"

        db.refresh(article)
        assert article.like_count == 3, "the real counter is untouched"
        assert article.seed_like_count == 500

    def test_the_card_carries_the_same_total(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        article.like_count = 1
        article.seed_like_count = 40
        db.commit()
        cards = client.get("/api/v1/public/articles?limit=50").json()["articles"]
        card = next(c for c in cards if c["short_id"] == article.short_id)
        assert card["like_count"] == 41
        assert "comment_count" in card, "counts ship on the card shape too"

    def test_un_seeding_is_setting_it_to_zero(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        article.seed_like_count = 99
        db.commit()
        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/seed-likes",
            json={"count": 0},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        db.refresh(article)
        assert article.seed_like_count == 0

    def test_the_newsroom_cannot_seed(self, db: Session, client: TestClient) -> None:
        """`engagement.seed` is its own permission group precisely so it does
        not arrive through the editorial bundle."""
        article = make_article(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF)
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/seed-likes",
            json={"count": 10},
            headers=headers,
        )
        assert r.status_code == 403, r.text


class TestSeededComments:
    def test_a_seeded_comment_has_no_account_behind_it(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/seed-comment",
            json={"body_te": "మంచి కథనం.", "name_index": 0},
            headers=headers,
        )
        assert r.status_code == 200, r.text

        comment = db.scalars(
            select(Comment).where(Comment.article_id == article.id)
        ).one()
        assert comment.user_id is None, "cannot be attributed to a real reader"
        assert comment.is_seeded is True
        assert comment.seed_author_name == seed_engagement_service.SEED_NAMES[0]

        listed = client.get(
            f"/api/v1/public/articles/{article.short_id}/comments"
        ).json()
        assert listed["comments"][0]["author_name_te"] == comment.seed_author_name
        assert listed["comments"][0]["is_mine"] is False

    def test_the_name_is_an_index_not_free_text(self, db: Session) -> None:
        article = make_article(db)
        db.commit()
        with pytest.raises(ValidationError):
            seed_engagement_service.seed_comment(
                db,
                article=article,
                body="హాయ్",
                name_index=len(seed_engagement_service.SEED_NAMES),
            )
        db.rollback()

    def test_it_refuses_a_name_a_real_account_already_uses(self, db: Session) -> None:
        """Belt and braces over "given names only": never publish something a
        reader could mistake for a person who actually has an account."""
        article = make_article(db)
        name = seed_engagement_service.SEED_NAMES[1]
        db.add(
            User(
                email="clash@test.example.com",
                name_te=name,
                name_en="Clash",
                status=UserStatus.ACTIVE,
            )
        )
        db.commit()
        with pytest.raises(ValidationError):
            seed_engagement_service.seed_comment(
                db, article=article, body="హాయ్", name_index=1
            )
        db.rollback()

    def test_seeded_comments_do_not_score_in_trending(self, db: Session) -> None:
        """A genuine comment is the control. Without it this would pass even if
        trending were broken outright."""
        from app.models.discovery import TrendingScore
        from app.models.enums import TrendingScope
        from app.services import engagement_service, trending_service

        seeded_only = make_article(db, minutes_ago=1)
        genuine = make_article(db, minutes_ago=1)
        reader = User(
            email="trend-reader@test.example.com",
            name_te="పాఠకుడు",
            name_en="Reader",
            status=UserStatus.ACTIVE,
        )
        db.add(reader)
        db.flush()

        seed_engagement_service.seed_comment(
            db, article=seeded_only, body="బాగుంది", name_index=2
        )
        engagement_service.add_comment(
            db,
            user_id=reader.id,
            body="నిజమైన వ్యాఖ్య",
            parent_id=None,
            short_id=genuine.short_id,
        )
        db.commit()

        trending_service.compute_trending(db)

        def score(article_id: int) -> float:
            row = db.scalars(
                select(TrendingScore).where(
                    TrendingScore.article_id == article_id,
                    TrendingScore.scope_type == TrendingScope.GLOBAL,
                )
            ).first()
            return row.score if row else 0.0

        assert score(genuine.id) > 0, "a real comment must still score"
        assert score(seeded_only.id) == 0.0, (
            "trending must measure readers, not what the desk typed"
        )

    def test_the_names_are_given_names_only_and_clean_telugu(self) -> None:
        """A bare first name cannot name a public figure. A stray invisible
        character would render as a broken name, so assert the block too."""
        names = seed_engagement_service.SEED_NAMES
        assert len(set(names)) == len(names)
        for name in names:
            assert " " not in name, f"{name!r} looks like a full name"
            for ch in name:
                assert 0x0C00 <= ord(ch) <= 0x0C7F or ord(ch) in (
                    0x200C,
                    0x200D,
                ), f"{name!r} carries {hex(ord(ch))}"


class TestPinnedComments:
    def test_a_pinned_comment_leads_the_thread(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        db.commit()
        for index in (3, 4, 5):
            seed_engagement_service.seed_comment(
                db, article=article, body=f"వ్యాఖ్య {index}", name_index=index
            )
        db.commit()

        oldest = db.scalars(
            select(Comment)
            .where(Comment.article_id == article.id)
            .order_by(Comment.created_at, Comment.id)
        ).first()

        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.patch(
            f"/api/v1/cms/moderation/comments/{oldest.id}",
            json={"hide": False, "pinned": True},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_pinned"] is True

        listed = client.get(
            f"/api/v1/public/articles/{article.short_id}/comments"
        ).json()["comments"]
        assert listed[0]["id"] == oldest.id, "pinned leads, newest follows"
        assert listed[0]["is_pinned"] is True

        r = client.patch(
            f"/api/v1/cms/moderation/comments/{oldest.id}",
            json={"hide": False, "pinned": False},
            headers=headers,
        )
        assert r.json()["is_pinned"] is False


class TestPushWithAStory:
    """A push that deep-links to a story the reader cannot open is worse than
    one that carries only text, so the short id is resolved and checked."""

    def test_a_short_id_reaches_the_campaign_as_an_article_id(
        self, db: Session, client: TestClient
    ) -> None:
        from app.models.notify import NotificationCampaign

        article = make_article(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.post(
            "/api/v1/cms/notifications",
            json={
                "title_te": "ముఖ్య ప్రకటన",
                "body_te": "వివరాలు",
                "short_id": article.short_id,
                "audience": "all",
            },
            headers=headers,
        )
        assert r.status_code == 201, r.text
        campaign = db.get(NotificationCampaign, r.json()["id"])
        assert campaign.article_id == article.id

    def test_an_unknown_story_is_refused_rather_than_dropped(
        self, db: Session, client: TestClient
    ) -> None:
        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "ప్రకటన", "short_id": "zzzzzz", "audience": "all"},
            headers=headers,
        )
        assert r.status_code == 422, r.text

    def test_an_unpublished_story_is_refused(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        article.status = ArticleStatus.DRAFT
        db.commit()
        headers = staff_headers(db, role=RoleKey.ADMIN)
        r = client.post(
            "/api/v1/cms/notifications",
            json={"title_te": "ప్రకటన", "short_id": article.short_id, "audience": "all"},
            headers=headers,
        )
        assert r.status_code == 422, r.text


class TestCriticNote:
    def test_it_reaches_the_reader_and_clears(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF)

        note = "ఈ కథనంపై సంపాదకుల వ్యాఖ్య."
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/critic-note",
            json={"note_te": note},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        detail = client.get(f"/api/v1/public/articles/{article.short_id}").json()
        assert detail["critic_note_te"] == note

        r = client.post(
            f"/api/v1/cms/articles/{article.id}/critic-note",
            json={"note_te": None},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        detail = client.get(f"/api/v1/public/articles/{article.short_id}").json()
        assert detail["critic_note_te"] is None

    def test_it_works_on_a_published_story(
        self, db: Session, client: TestClient
    ) -> None:
        """The reason it is its own route: `workflow_service.update` refuses a
        PUBLISHED article, and a critic note is for exactly those."""
        article = make_article(db)
        assert article.workflow_state == WorkflowState.PUBLISHED
        db.commit()
        headers = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF)
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/critic-note",
            json={"note_te": "వ్యాఖ్య"},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    def test_a_desk_editor_cannot_attach_one(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR)
        r = client.post(
            f"/api/v1/cms/articles/{article.id}/critic-note",
            json={"note_te": "వ్యాఖ్య"},
            headers=headers,
        )
        assert r.status_code == 403, r.text
