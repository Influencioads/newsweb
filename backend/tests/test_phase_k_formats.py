"""Phase K — one story, four formats, and what a link-preview crawler sees.

The assertions that matter here are mostly about *absence*:

  * a story with no video renders no video slot, not a placeholder;
  * a host that cannot shape Telugu produces no card at all rather than an
    unreadable one, and says so instead of raising;
  * the OG stub is a minimal version of the same page, never a different one.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core import fonts  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article, Category  # noqa: E402
from app.models.enums import ArticleStatus, WorkflowState  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.video import Video  # noqa: E402
from app.services import settings_service, share_card_service  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
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


@pytest.fixture(autouse=True)
def _isolate(db: Session) -> Iterator[None]:
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    db.query(Article).delete()
    db.query(Video).delete()
    db.query(AppSetting).delete()
    db.commit()
    settings_service.invalidate()


def make_article(db: Session, *, short_id: str = "fmt001", video_id=None) -> Article:
    category = db.scalars(select(Category).limit(1)).one()
    article = Article(
        short_id=short_id,
        slug="ఒక-కథనం".encode("ascii", "ignore").decode() or "a-story",
        title_te="ఆంధ్రప్రదేశ్‌లో కొత్త పథకం ప్రారంభం",
        summary_te="లబ్ధిదారులకు నేరుగా సాయం అందుతుంది.",
        body={"type": "doc", "content": []},
        body_plain="లబ్ధిదారులకు నేరుగా సాయం అందుతుంది.",
        category_id=category.id,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.PUBLISHED,
        published_at=utcnow(),
        byline_te="స్టాఫ్ రిపోర్టర్",
        video_id=video_id,
    )
    db.add(article)
    db.flush()
    return article


def make_video(db: Session, *, published: bool = True) -> Video:
    video = Video(
        youtube_id="dQw4w9WgXcQ",
        title_te="వీడియో శీర్షిక",
        duration_sec=212,
        is_published=published,
        published_at=utcnow() if published else None,
    )
    db.add(video)
    db.flush()
    return video


# --------------------------------------------------------------------------- #
# The four formats
# --------------------------------------------------------------------------- #
class TestFormats:
    def test_a_story_with_no_video_reports_it_absent(
        self, db: Session, client: TestClient
    ) -> None:
        """Absent rather than omitted: the client renders nothing, and a
        missing key would be harder to reason about than an explicit false."""
        article = make_article(db)
        db.commit()
        body = client.get(f"/api/v1/public/articles/{article.short_id}/formats").json()
        assert body["video"]["available"] is False
        assert body["video"]["url"] is None
        assert body["article"]["available"] is True

    def test_a_published_video_is_reported(self, db: Session, client: TestClient) -> None:
        video = make_video(db)
        article = make_article(db, short_id="fmt002", video_id=video.id)
        db.commit()
        body = client.get(f"/api/v1/public/articles/{article.short_id}/formats").json()
        assert body["video"]["available"] is True
        assert "youtube-nocookie" in body["video"]["embed_url"]

    def test_an_unpublished_video_is_the_same_as_none(
        self, db: Session, client: TestClient
    ) -> None:
        """A dead embed is worse than no embed."""
        video = make_video(db, published=False)
        article = make_article(db, short_id="fmt003", video_id=video.id)
        db.commit()
        body = client.get(f"/api/v1/public/articles/{article.short_id}/formats").json()
        assert body["video"]["available"] is False

    def test_the_audio_block_is_the_article_audio_payload(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db, short_id="fmt004")
        db.commit()
        body = client.get(f"/api/v1/public/articles/{article.short_id}/formats").json()
        for key in ("available", "url", "duration_sec", "voice_enabled", "fallback"):
            assert key in body["audio"], key

    def test_a_draft_story_has_no_formats(self, db: Session, client: TestClient) -> None:
        article = make_article(db, short_id="fmt005")
        article.status = ArticleStatus.DRAFT
        db.commit()
        assert (
            client.get(f"/api/v1/public/articles/{article.short_id}/formats").status_code
            == 404
        )

    def test_the_reader_payload_now_carries_the_video(
        self, db: Session, client: TestClient
    ) -> None:
        """`Article.video_id` has existed since the video hub shipped, but no
        reader schema exposed it, so a linked video could not be rendered."""
        video = make_video(db)
        article = make_article(db, short_id="fmt006", video_id=video.id)
        db.commit()
        body = client.get(f"/api/v1/public/articles/{article.short_id}").json()
        assert body["video"] is not None
        assert body["video"]["youtube_id"] == "dQw4w9WgXcQ"


# --------------------------------------------------------------------------- #
# The card
# --------------------------------------------------------------------------- #
class TestShareCard:
    def test_unavailable_without_shaping_and_it_says_so_rather_than_raising(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The whole point of the guard. Without libraqm a Telugu card would be
        a valid PNG of unreadable glyphs; declining is the correct answer."""
        monkeypatch.setattr(
            "app.services.share_card_service.telugu_shaping_available", lambda: False
        )
        article = make_article(db, short_id="card01")
        db.commit()
        assert share_card_service.available(db) is False
        assert share_card_service.ensure_card(db, article) is None

    def test_the_endpoint_404s_rather_than_500s_when_unavailable(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.services.share_card_service.telugu_shaping_available", lambda: False
        )
        article = make_article(db, short_id="card02")
        db.commit()
        response = client.get(f"/api/v1/public/articles/{article.short_id}/card.png")
        assert response.status_code == 404

    def test_the_admin_switch_also_turns_it_off(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.services.share_card_service.telugu_shaping_available", lambda: True
        )
        settings_service.set_many(db, {"share_card.enabled": False}, actor_id=None)
        db.commit()
        assert share_card_service.available(db) is False

    def test_the_hash_changes_with_the_headline_and_is_otherwise_stable(
        self, db: Session
    ) -> None:
        article = make_article(db, short_id="card03")
        db.commit()
        first = share_card_service.card_hash(article, None)
        assert share_card_service.card_hash(article, None) == first

        article.title_te = "పూర్తిగా వేరే శీర్షిక"
        db.flush()
        assert share_card_service.card_hash(article, None) != first

    def test_the_key_is_content_addressed(self, db: Session) -> None:
        """No database column and no invalidation logic: the bucket is the
        cache, so the key has to carry the content digest."""
        article = make_article(db, short_id="card04")
        db.commit()
        digest = share_card_service.card_hash(article, None)
        key = share_card_service.storage_key(article, digest)
        assert key.startswith("share-cards/card04/")
        assert digest[:16] in key


class TestFontFallback:
    def test_the_telugu_face_has_no_latin_letters(self) -> None:
        """Verified, not assumed — this is why a Latin face is bundled too.

        A missing glyph renders as .notdef, which has the *same* mask size for
        every absent codepoint. Comparing 'A' against an obviously-absent CJK
        character is how you tell a real glyph from a box.
        """
        from PIL import ImageFont

        face = ImageFont.truetype(str(fonts.telugu_font_path("regular")), 40)
        notdef = face.getmask("漢").size
        assert face.getmask("A").size == notdef, "expected Latin to be missing"
        assert face.getmask("ఆ").size != notdef, "Telugu must be present"

    def test_the_latin_face_does_have_them(self) -> None:
        from PIL import ImageFont

        face = ImageFont.truetype(str(fonts.latin_font_path("regular")), 40)
        assert face.getmask("A").size != face.getmask("漢").size

    def test_the_right_face_is_chosen_per_string(self) -> None:
        assert "Telugu" in fonts.font_path_for("ఆంధ్రప్రదేశ్").name
        assert "Telugu" not in fonts.font_path_for("Top Telugu News").name

    def test_a_missing_telugu_font_raises_rather_than_substituting_latin(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The e-paper PDF used to fall back to Helvetica inside a bare except,
        which renders no Telugu at all and logs nothing."""
        fonts.telugu_font_path.cache_clear()
        monkeypatch.setattr(fonts, "_candidates", lambda *_a, **_k: [])
        with pytest.raises(fonts.FontMissingError):
            fonts.telugu_font_path("regular")
        fonts.telugu_font_path.cache_clear()


# --------------------------------------------------------------------------- #
# What a link-preview crawler gets
# --------------------------------------------------------------------------- #
class TestCrawlerSurface:
    def test_the_og_stub_carries_the_real_headline_in_the_body(
        self, db: Session, client: TestClient
    ) -> None:
        """Not cloaking: the crawler gets a minimal version of the same page,
        with the same headline and a canonical link back to it."""
        article = make_article(db, short_id="og0001")
        db.commit()
        html = client.get(f"/_og/article/{article.slug}-{article.short_id}").text
        assert article.title_te in html
        assert 'property="og:title"' in html
        assert 'rel="canonical"' in html
        assert 'name="twitter:card" content="summary_large_image"' in html
        assert 'property="og:locale" content="te_IN"' in html
        # The body, not just the head — that is the anti-cloaking part.
        body = html.split("<body>", 1)[1]
        assert article.title_te in body

    def test_json_ld_finally_reaches_a_crawler(
        self, db: Session, client: TestClient
    ) -> None:
        """The SPA injects it client-side, where no crawler has ever seen it."""
        article = make_article(db, short_id="og0002")
        db.commit()
        html = client.get(f"/_og/article/{article.slug}-{article.short_id}").text
        assert 'type="application/ld+json"' in html
        assert "NewsArticle" in html

    def test_an_unknown_story_still_returns_a_valid_preview(
        self, client: TestClient
    ) -> None:
        response = client.get("/_og/article/nothing-here-zzzzzz")
        assert response.status_code == 200
        assert "og:site_name" in response.text

    def test_robots_and_sitemaps_exist_now(
        self, db: Session, client: TestClient
    ) -> None:
        """nginx has routed these to the API since the video hub shipped; the
        endpoints did not exist, so they 404'd."""
        article = make_article(db, short_id="og0003")
        db.commit()

        robots = client.get("/robots.txt")
        assert robots.status_code == 200

        sitemap = client.get("/sitemap.xml")
        assert sitemap.status_code == 200
        assert article.url_path in sitemap.text

        news = client.get("/news-sitemap.xml")
        assert news.status_code == 200
        assert "news:publication" in news.text

        rss = client.get("/rss.xml")
        assert rss.status_code == 200
        assert article.title_te in rss.text

    def test_a_non_production_host_asks_not_to_be_indexed(
        self, client: TestClient
    ) -> None:
        """A staging site that gets indexed competes with production for its
        own search results."""
        assert "Disallow: /" in client.get("/robots.txt").text

    def test_the_og_stubs_are_not_themselves_indexable_in_production(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Only reachable in production: a staging host disallows everything,
        so the per-path rules never appear there."""
        from app.api.v1 import crawler

        monkeypatch.setattr(
            crawler.settings.__class__, "is_production", property(lambda _self: True)
        )
        text = crawler.robots().body.decode()
        assert "Disallow: /_og/" in text
        assert "Disallow: /admin" in text
        assert "Sitemap:" in text
