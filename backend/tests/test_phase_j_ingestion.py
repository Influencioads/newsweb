"""Phase J integration tests — content ingestion (updated doc §17).

Most of these exist to hold one line honest: "Do not scrape copyrighted content
blindly. Use source attribution and respect website/API terms and copyright."

The important ones are the negatives — a source without an agreement must not
be able to store full text, and nothing an ingest produces may reach a reader
without an editor.
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
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.feeds import FeedEntry, FeedResult  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ArticleType,
    ContentPolicy,
    IngestStatus,
    RoleKey,
    ScopeType,
    SourceLicence,
    UserStatus,
    WorkflowState,
)
from app.models.ingestion import ContentSource, IngestedItem  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, ingestion_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

FULL_TEXT = (
    "<p>Kathmandu [Nepal], September 8 : the first paragraph of somebody "
    "else's reporting.</p><p>A second paragraph that we would be republishing "
    "verbatim.</p><script>alert(1)</script>"
)


def entry(guid: str, title: str, *, body: str | None = FULL_TEXT) -> FeedEntry:
    return FeedEntry(
        guid=guid,
        title=title,
        url=f"https://publisher.example.com/{guid}",
        summary="A short standfirst as the feed supplies it, roughly forty words long.",
        content_html=body,
        author="Staff Reporter",
        image_url="https://publisher.example.com/img.jpg",
        published_at=utcnow() - timedelta(minutes=20),
        language="en",
    )


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    seed_districts(session)
    seed_categories(session)
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


def make_source(db: Session, *, slug: str, licence: SourceLicence,
                policy: ContentPolicy, note: str | None = None,
                auto: bool = False) -> ContentSource:
    source = ContentSource(
        slug=slug, name=slug.replace("-", " ").title(),
        feed_url=f"https://publisher.example.com/{slug}.xml",
        licence=licence, content_policy=policy, licence_note=note,
        auto_publish=auto,
    )
    db.add(source)
    db.flush()
    return source


# --------------------------------------------------------------------------- #
# §17 — the licence decides how much text we keep
# --------------------------------------------------------------------------- #
class TestLicenceEnforcement:
    def test_public_rss_stores_an_excerpt_and_never_the_body(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The whole point: a public feed is a link, not a republication licence."""
        source = make_source(db, slug="public-rss", licence=SourceLicence.RSS_PUBLIC,
                             policy=ContentPolicy.EXCERPT_ONLY)
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a, **k: FeedResult(entries=[entry("p1", "A public feed story")]),
        )
        ingestion_service.fetch_source(db, source)
        db.commit()

        item = db.scalar(select(IngestedItem).where(IngestedItem.source_id == source.id))
        assert item is not None
        assert item.summary, "the excerpt is what we are entitled to"
        # Not truncated — absent. A column that holds it is a column that leaks.
        assert item.content_html is None
        assert item.word_count == 0
        assert item.canonical_url == "https://publisher.example.com/p1"

    def test_a_licensed_source_keeps_the_body_and_it_is_sanitised(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        source = make_source(db, slug="wire-agency", licence=SourceLicence.AGENCY_CONTRACT,
                             policy=ContentPolicy.FULL_TEXT, note="Wire contract 2026-14")
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a, **k: FeedResult(entries=[entry("w1", "A wire story")]),
        )
        ingestion_service.fetch_source(db, source)
        db.commit()

        item = db.scalar(select(IngestedItem).where(IngestedItem.source_id == source.id))
        assert item.content_html and "second paragraph" in item.content_html
        assert item.word_count > 0
        # Text from outside is never trusted.
        assert "<script>" not in item.content_html
        assert "alert(1)" not in item.content_html

    def test_full_text_without_a_licence_is_refused_by_the_api(
        self, client: TestClient, db: Session
    ) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="j-admin@test.example.com")
        r = client.post("/api/v1/cms/sources", json={
            "slug": "sneaky", "name": "Sneaky Scraper",
            "feed_url": "https://publisher.example.com/rss.xml",
            "licence": "rss_public", "content_policy": "full_text",
        }, headers=admin)
        assert r.status_code == 422
        assert "content_policy" in r.json()["error"]["details"]

    def test_full_text_needs_the_agreement_recorded(
        self, client: TestClient, db: Session
    ) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="j-admin@test.example.com")
        r = client.post("/api/v1/cms/sources", json={
            "slug": "partner-no-note", "name": "Partner",
            "feed_url": "https://publisher.example.com/partner.xml",
            "licence": "publisher_partner", "content_policy": "full_text",
        }, headers=admin)
        assert r.status_code == 422
        assert "licence_note" in r.json()["error"]["details"]

        ok = client.post("/api/v1/cms/sources", json={
            "slug": "partner-ok", "name": "Partner",
            "feed_url": "https://publisher.example.com/partner2.xml",
            "licence": "publisher_partner", "content_policy": "full_text",
            "licence_note": "Signed syndication agreement, 1 Jan 2026",
        }, headers=admin)
        assert ok.status_code == 201, ok.text
        assert ok.json()["may_store_full_text"] is True

    def test_auto_publish_requires_a_full_text_licence(
        self, client: TestClient, db: Session
    ) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="j-admin@test.example.com")
        r = client.post("/api/v1/cms/sources", json={
            "slug": "auto-unlicensed", "name": "Auto",
            "feed_url": "https://publisher.example.com/auto.xml",
            "licence": "rss_public", "content_policy": "excerpt_only",
            "auto_publish": True,
        }, headers=admin)
        assert r.status_code == 422
        assert "auto_publish" in r.json()["error"]["details"]

    def test_defaults_are_the_conservative_ones(self, client: TestClient, db: Session) -> None:
        admin = staff_headers(db, role=RoleKey.ADMIN, email="j-admin@test.example.com")
        created = client.post("/api/v1/cms/sources", json={
            "slug": "defaults", "name": "Defaults",
            "feed_url": "https://publisher.example.com/d.xml",
        }, headers=admin).json()
        assert created["licence"] == SourceLicence.RSS_PUBLIC.value
        assert created["content_policy"] == ContentPolicy.EXCERPT_ONLY.value
        assert created["auto_publish"] is False
        assert created["may_store_full_text"] is False


# --------------------------------------------------------------------------- #
# fetching behaviour
# --------------------------------------------------------------------------- #
class TestFetching:
    def test_the_same_entry_is_not_stored_twice(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        source = make_source(db, slug="dedup-guid", licence=SourceLicence.RSS_PUBLIC,
                             policy=ContentPolicy.EXCERPT_ONLY)
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a, **k: FeedResult(entries=[entry("d1", "Repeated story")]),
        )
        first = ingestion_service.fetch_source(db, source)
        second = ingestion_service.fetch_source(db, source)
        db.commit()
        assert first["new"] == 1
        assert second["new"] == 0, "a re-poll must not duplicate the feed"

    def test_the_same_wire_copy_from_two_partners_is_one_item(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Syndication means one story arrives with several feed ids."""
        a = make_source(db, slug="partner-a", licence=SourceLicence.RSS_PUBLIC,
                        policy=ContentPolicy.EXCERPT_ONLY)
        b = make_source(db, slug="partner-b", licence=SourceLicence.RSS_PUBLIC,
                        policy=ContentPolicy.EXCERPT_ONLY)
        shared = "Cabinet clears the new irrigation project"
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a_, **k: FeedResult(entries=[entry("a-99", shared)]),
        )
        ingestion_service.fetch_source(db, a)
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a_, **k: FeedResult(entries=[entry("b-77", shared)]),
        )
        second = ingestion_service.fetch_source(db, b)
        db.commit()
        assert second["new"] == 0, "the second copy is a duplicate, not news"

    def test_a_304_costs_nothing(self, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        source = make_source(db, slug="conditional", licence=SourceLicence.RSS_PUBLIC,
                             policy=ContentPolicy.EXCERPT_ONLY)
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a, **k: FeedResult(not_modified=True, status="not_modified"),
        )
        result = ingestion_service.fetch_source(db, source)
        db.commit()
        assert result["status"] == "not_modified"
        assert result["new"] == 0

    def test_a_failing_feed_is_recorded_not_raised(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        source = make_source(db, slug="broken", licence=SourceLicence.RSS_PUBLIC,
                             policy=ContentPolicy.EXCERPT_ONLY)
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a, **k: FeedResult(status="http_500", error="HTTP 500"),
        )
        result = ingestion_service.fetch_source(db, source)
        db.commit()
        assert result["status"] == "http_500"
        assert source.consecutive_failures == 1
        assert source.last_error_at is not None


# --------------------------------------------------------------------------- #
# import — the editorial gate
# --------------------------------------------------------------------------- #
class TestImport:
    def _queued(self, db: Session, monkeypatch: pytest.MonkeyPatch, slug: str,
                licence: SourceLicence, policy: ContentPolicy,
                note: str | None = None) -> IngestedItem:
        source = make_source(db, slug=slug, licence=licence, policy=policy, note=note)
        monkeypatch.setattr(
            "app.services.ingestion_service.fetch_feed",
            lambda *a, **k: FeedResult(entries=[entry(f"{slug}-1", f"Story from {slug}")]),
        )
        ingestion_service.fetch_source(db, source)
        db.commit()
        return db.scalar(select(IngestedItem).where(IngestedItem.source_id == source.id))

    def test_import_creates_a_draft_never_a_published_article(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._queued(db, monkeypatch, "gate-check", SourceLicence.AGENCY_CONTRACT,
                            ContentPolicy.FULL_TEXT, note="Wire contract")
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="j-editor@test.example.com")

        r = client.post(f"/api/v1/cms/ingestion/{item.id}/import", headers=editor)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["workflow_state"] == WorkflowState.DRAFT.value
        assert body["status"] == ArticleStatus.DRAFT.value

        article = db.get(Article, body["article_id"])
        assert article.article_type == ArticleType.SYNDICATED
        assert article.source_type == "syndicated"
        assert article.source_credit, "§17 attribution is mandatory"
        assert article.canonical_url == item.canonical_url
        assert article.published_at is None

        # And it is not reachable by a reader.
        assert client.get(f"/api/v1/public/articles/{article.short_id}").status_code == 404

    def test_an_imported_article_cannot_publish_without_its_credit(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The publish gate already refused a credit-less agency story; this
        proves syndicated copy inherits that protection."""
        item = self._queued(db, monkeypatch, "credit-check", SourceLicence.AGENCY_CONTRACT,
                            ContentPolicy.FULL_TEXT, note="Wire contract")
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="j-editor@test.example.com")
        approver = staff_headers(db, role=RoleKey.ADMIN, email="j-admin2@test.example.com")

        article_id = client.post(f"/api/v1/cms/ingestion/{item.id}/import",
                                 headers=editor).json()["article_id"]
        article = db.get(Article, article_id)
        article.source_credit = None
        db.commit()

        client.post(f"/api/v1/cms/articles/{article_id}/submit", json={}, headers=editor)
        client.post(f"/api/v1/cms/articles/{article_id}/approve", json={}, headers=approver)
        published = client.post(f"/api/v1/cms/articles/{article_id}/publish",
                                json={}, headers=editor)
        assert published.status_code == 422
        assert "source credit" in published.json()["error"]["message_en"].lower()

    def test_an_excerpt_only_import_carries_the_link_not_the_body(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._queued(db, monkeypatch, "excerpt-import", SourceLicence.RSS_PUBLIC,
                            ContentPolicy.EXCERPT_ONLY)
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="j-editor@test.example.com")
        article_id = client.post(f"/api/v1/cms/ingestion/{item.id}/import",
                                 headers=editor).json()["article_id"]

        article = db.get(Article, article_id)
        assert "second paragraph" not in (article.body_plain or ""), \
            "an unlicensed source must not reach the article body"
        assert article.canonical_url in (article.body_plain or ""), \
            "the reader must be sent to the publisher"

    def test_importing_twice_is_refused(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._queued(db, monkeypatch, "double-import", SourceLicence.RSS_PUBLIC,
                            ContentPolicy.EXCERPT_ONLY)
        editor = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="j-editor@test.example.com")
        assert client.post(f"/api/v1/cms/ingestion/{item.id}/import",
                           headers=editor).status_code == 201
        assert client.post(f"/api/v1/cms/ingestion/{item.id}/import",
                           headers=editor).status_code == 409

    def test_reject_removes_it_from_the_queue(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._queued(db, monkeypatch, "reject-me", SourceLicence.RSS_PUBLIC,
                            ContentPolicy.EXCERPT_ONLY)
        reviewer = staff_headers(db, role=RoleKey.DESK_EDITOR, email="j-desk@test.example.com")
        r = client.post(f"/api/v1/cms/ingestion/{item.id}/reject",
                        json={"note": "Not for us"}, headers=reviewer)
        assert r.status_code == 200
        assert r.json()["status"] == IngestStatus.REJECTED.value

        queue = client.get("/api/v1/cms/ingestion/queue", headers=reviewer).json()
        assert all(row["id"] != item.id for row in queue["items"])

    def test_the_queue_shows_the_licence_with_every_row(
        self, client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An editor deciding whether to import needs the terms in front of
        them, not on another screen."""
        self._queued(db, monkeypatch, "licence-visible", SourceLicence.RSS_PUBLIC,
                     ContentPolicy.EXCERPT_ONLY)
        reviewer = staff_headers(db, role=RoleKey.DESK_EDITOR, email="j-desk@test.example.com")
        queue = client.get("/api/v1/cms/ingestion/queue", headers=reviewer).json()
        assert queue["items"], "expected something in the queue"
        for row in queue["items"]:
            assert row["source"]["licence"]
            assert "full_text" in row["source"]
            assert "has_full_text" in row


# --------------------------------------------------------------------------- #
# permissions
# --------------------------------------------------------------------------- #
class TestIngestionPermissions:
    def test_a_reporter_cannot_add_a_source(self, client: TestClient, db: Session) -> None:
        reporter = staff_headers(db, role=RoleKey.REPORTER, email="j-reporter@test.example.com")
        r = client.post("/api/v1/cms/sources", json={
            "slug": "nope", "name": "Nope",
            "feed_url": "https://publisher.example.com/nope.xml",
        }, headers=reporter)
        assert r.status_code == 403

    def test_no_ingestion_route_publishes(self) -> None:
        """The guarantee: ingestion produces drafts, never live articles."""
        paths = [r.path for r in app.routes
                 if "/cms/ingestion" in getattr(r, "path", "")
                 or "/cms/sources" in getattr(r, "path", "")]
        assert paths, "the ingestion router should be mounted"
        assert not any("publish" in path for path in paths)
