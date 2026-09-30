"""Crawl image rules — what may be downloaded, and what must never be.

The pure functions in `app/integrations/feeds/images.py` are the main target:
they are where the product decision ("the source article's own images only, no
open-web search") is actually enforced, and they need no database to prove.

Nothing here touches the network. The service tests stub `httpx.stream` and
the storage provider, which is the same seam `test_ai_models_and_image.py` uses.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator
from contextlib import contextmanager

import httpx
import pytest
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from app.core.errors import AiProviderError  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.integrations.ai.base import ImageVerdict  # noqa: E402
from app.integrations.feeds import images as feed_images  # noqa: E402
from app.integrations.storage import StoredObject  # noqa: E402
from app.models.ai import AiUsage  # noqa: E402
from app.models.enums import ContentPolicy, IngestStatus, SourceLicence  # noqa: E402
from app.models.ingestion import ContentSource, IngestedItem  # noqa: E402
from app.models.media import ArticleMedia, Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.services import ingestion_service, settings_service  # noqa: E402

ARTICLE = "https://publisher.example.com/news/floods-in-the-district"
LOGO = "https://publisher.example.com/static/brand-mark.png"
PHOTO = "https://publisher.example.com/wp-content/uploads/2026/09/flood-1200x675.jpg"


# --------------------------------------------------------------------------- #
# the rules themselves
# --------------------------------------------------------------------------- #
class TestUsability:
    def test_a_publisher_logo_is_rejected(self) -> None:
        assert not feed_images.is_usable(
            "https://publisher.example.com/assets/logo.png", article_url=ARTICLE
        )
        # ...and so is one hiding under a different name, caught via the
        # source's own recorded logo_url.
        assert not feed_images.is_usable(
            "https://publisher.example.com/img/brand-mark.png",
            article_url=ARTICLE,
            logo_url=LOGO,
        )

    def test_a_third_party_host_is_rejected(self) -> None:
        """This is the no-open-web-search decision, enforced mechanically."""
        assert not feed_images.is_usable(
            "https://cdn.stockphotos.example.net/floods.jpg", article_url=ARTICLE
        )
        # A subdomain of the publisher is still the publisher.
        assert feed_images.is_usable(
            "https://cdn.publisher.example.com/2026/09/flood.jpg", article_url=ARTICLE
        )

    def test_a_wordpress_thumbnail_is_rejected(self) -> None:
        assert not feed_images.is_usable(
            "https://publisher.example.com/wp-content/uploads/flood-150x150.jpg",
            article_url=ARTICLE,
        )
        # The size can also arrive as a query param, which the path scan must
        # not see and the size check must.
        assert not feed_images.is_usable(
            "https://publisher.example.com/img/flood.jpg?w=120", article_url=ARTICLE
        )
        assert feed_images.is_usable(
            "https://publisher.example.com/img/flood.jpg?w=1200", article_url=ARTICLE
        )

    def test_a_real_photograph_is_accepted(self) -> None:
        assert feed_images.is_usable(PHOTO, article_url=ARTICLE, logo_url=LOGO)

    def test_the_cap_is_honoured_and_order_kept(self) -> None:
        candidates = [
            "https://publisher.example.com/assets/logo.png",  # dropped
            *[f"https://publisher.example.com/img/p{n}.jpg" for n in range(6)],
        ]
        picked = feed_images.pick(candidates, article_url=ARTICLE, logo_url=LOGO)
        assert len(picked) == feed_images.MAX_IMAGES
        assert picked[0] == "https://publisher.example.com/img/p0.jpg"

    def test_no_article_url_means_nothing_passes(self) -> None:
        """With no publisher host there is no rule to apply, so nothing is kept."""
        assert feed_images.pick([PHOTO], article_url=None) == []


# --------------------------------------------------------------------------- #
# downloading at import
# --------------------------------------------------------------------------- #
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
    yield session
    session.close()
    Base.metadata.drop_all(engine)


class _Storage:
    key = "test"

    def put(self, key: str, raw: bytes, **kw: object) -> StoredObject:
        return StoredObject(
            key=key,
            url=f"https://cdn.example/{key}",
            bytes=len(raw),
            provider="test",
            content_type=str(kw.get("content_type") or ""),
        )


def _png(width: int = 800, height: int = 450) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), "navy").save(buf, format="PNG")
    return buf.getvalue()


class _Response:
    """What `httpx.stream` yields: a context manager that hands back chunks.

    Chunked on purpose — the download is streamed so it can stop the moment it
    crosses the size cap, and a stub that returned the whole body in one piece
    would let a regression past.
    """

    status_code = 200

    def __init__(
        self,
        raw: bytes,
        *,
        url: str = PHOTO,
        content_type: str = "image/png",
        declared_length: int | None = None,
        chunk: int = 4096,
    ) -> None:
        self._raw = raw
        self._chunk = chunk
        self.url = url
        self.headers = {"content-type": content_type}
        if declared_length is not None:
            self.headers["content-length"] = str(declared_length)

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def iter_bytes(self):
        for i in range(0, len(self._raw), self._chunk):
            yield self._raw[i : i + self._chunk]


def make_item(db: Session, slug: str, **source_kw: object) -> IngestedItem:
    source = ContentSource(
        slug=slug,
        name=slug.replace("-", " ").title(),
        feed_url=f"https://publisher.example.com/{slug}.xml",
        licence=SourceLicence.RSS_PUBLIC,
        content_policy=ContentPolicy.EXCERPT_ONLY,
        logo_url=LOGO,
        **source_kw,
    )
    item = IngestedItem(
        source=source,
        guid=f"{slug}-1",
        url=ARTICLE,
        canonical_url=ARTICLE,
        title="జిల్లాలో వరదలు",
        summary="A short standfirst.",
        image_url=PHOTO,
        image_urls=[PHOTO, "https://publisher.example.com/img/second.jpg"],
        fetched_at=utcnow(),
        content_hash=f"hash-{slug}",
        status=IngestStatus.NEW,
    )
    db.add(item)
    db.flush()
    return item


@pytest.fixture
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the test hosts resolve to a public address.

    `_is_internal` resolves every URL before fetching it and fails closed, so
    without this the made-up hosts here look like DNS failures and every
    download is refused for the wrong reason. Stubbing the resolver rather than
    the guard keeps the guard itself under test.
    """
    monkeypatch.setattr(
        ingestion_service.socket,
        "getaddrinfo",
        lambda *_a, **_kw: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )


@pytest.fixture
def stub_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.media_service.get_storage", lambda *_a, **_kw: _Storage()
    )


class TestAttachMedia:
    def test_a_hero_is_attached_from_the_source_image(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None, public_dns: None
    ) -> None:
        item = make_item(db, "images-on", images_enabled=True)
        monkeypatch.setattr(
            "app.services.ingestion_service.httpx.stream",
            lambda *a, **k: _Response(_png()),
        )

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert article.hero_media_id is not None
        media = db.get(Media, article.hero_media_id)
        assert media is not None
        # 12.5 — a photo that is not ours carries a credit or it is not stored.
        assert media.credit == item.source.name
        assert media.copyright == SourceLicence.RSS_PUBLIC.value
        assert media.meta["origin_url"] == PHOTO
        assert media.meta["ingested_item_id"] == item.id

        links = db.query(ArticleMedia).filter_by(article_id=article.id).all()
        # An excerpt licence buys one picture, not the publisher's gallery.
        assert [link.role for link in links] == ["hero"]

    def test_a_body_past_the_cap_is_abandoned_mid_stream(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None, public_dns: None
    ) -> None:
        """The box this runs on has ~800 MB free and no swap.

        Reading the whole body before checking its size would take the worker
        down rather than skip one picture, so the cap has to bite while the
        bytes are still arriving. The body here is four times the cap, and the
        assertion is on how much each fetch actually pulled: a regression to
        `response.content` reads all of it, a working cap stops just past the
        limit.
        """
        item = make_item(db, "images-huge", images_enabled=True)
        cap = ingestion_service.MAX_IMAGE_BYTES
        oversize = b"x" * (cap * 4)
        chunk = 64 * 1024
        per_fetch: list[int] = []

        class _Counting(_Response):
            def iter_bytes(self):
                pulled = 0
                per_fetch.append(0)
                for piece in super().iter_bytes():
                    pulled += len(piece)
                    per_fetch[-1] = pulled
                    yield piece

        monkeypatch.setattr(
            "app.services.ingestion_service.httpx.stream",
            lambda *a, **k: _Counting(oversize, chunk=chunk),
        )

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert article.hero_media_id is None, "an oversized file must not be stored"
        assert per_fetch, "the download was never attempted"
        assert max(per_fetch) <= cap + chunk, (
            f"read {max(per_fetch)} bytes of a {len(oversize)}-byte body before "
            f"giving up; the {cap}-byte cap is being applied after the fact"
        )

    def test_a_redirect_records_where_the_bytes_actually_came_from(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None, public_dns: None
    ) -> None:
        """Publishers serve their own images off their own CDN, often on
        another domain. We follow that — the starting URL is always one the
        publisher published — but the final host goes on the row so an auditor
        can see it rather than having to trust it."""
        item = make_item(db, "images-redirect", images_enabled=True)
        cdn = "https://cdn.example.net/flood-1200x675.jpg"
        monkeypatch.setattr(
            "app.services.ingestion_service.httpx.stream",
            lambda *a, **k: _Response(_png(), url=cdn),
        )

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()
        media = db.get(Media, article.hero_media_id)
        assert media.meta["origin_url"] == PHOTO
        assert media.meta["fetched_from"] == cdn

    def test_an_address_inside_our_own_network_is_never_fetched(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None
    ) -> None:
        """The worker sits in a private network with a metadata endpoint on it.

        Deliberately no `public_dns` here: the real resolver answers, the host
        does not exist, and the guard must fail closed rather than fetch.
        """
        item = make_item(db, "images-internal", images_enabled=True)
        monkeypatch.setattr(
            ingestion_service.socket,
            "getaddrinfo",
            lambda *_a, **_kw: [(2, 1, 6, "", ("169.254.169.254", 80))],
        )

        def _never(*_a: object, **_kw: object) -> None:
            raise AssertionError("an internal address must not be requested at all")

        monkeypatch.setattr("app.services.ingestion_service.httpx.stream", _never)
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()
        assert article.hero_media_id is None

    def test_a_redirect_into_the_network_is_refused(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None
    ) -> None:
        """Open redirects are ordinary furniture on news CMSes, so passing the
        first check is not permission to keep whatever the last hop returns."""
        item = make_item(db, "images-ssrf", images_enabled=True)
        internal = "http://metadata.internal/latest/meta-data/iam/"
        calls = {"n": 0}

        def _resolve(host, *_a, **_kw):
            calls["n"] += 1
            addr = "169.254.169.254" if host == "metadata.internal" else "93.184.216.34"
            return [(2, 1, 6, "", (addr, 80))]

        monkeypatch.setattr(ingestion_service.socket, "getaddrinfo", _resolve)
        monkeypatch.setattr(
            "app.services.ingestion_service.httpx.stream",
            lambda *a, **k: _Response(_png(), url=internal),
        )
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()
        assert article.hero_media_id is None
        assert calls["n"] >= 2, "the landing address was never resolved"

    def test_a_redirect_onto_a_logo_is_refused(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None, public_dns: None
    ) -> None:
        item = make_item(db, "images-redirect-logo", images_enabled=True)
        monkeypatch.setattr(
            "app.services.ingestion_service.httpx.stream",
            lambda *a, **k: _Response(
                _png(), url="https://cdn.example.net/assets/site-logo.png"
            ),
        )
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()
        assert article.hero_media_id is None

    def test_a_failed_fetch_does_not_fail_the_import(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None, public_dns: None
    ) -> None:
        item = make_item(db, "images-broken", images_enabled=True)

        def _boom(*_a: object, **_kw: object) -> None:
            raise httpx.ConnectError("the publisher CDN is down")

        monkeypatch.setattr("app.services.ingestion_service.httpx.stream", _boom)

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert article.id is not None
        assert item.status == IngestStatus.IMPORTED
        # Hero-less is the correct outcome; nobody pays for an illustration here.
        assert article.hero_media_id is None

    def test_the_kill_switch_is_off_by_default(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, stub_storage: None, public_dns: None
    ) -> None:
        """Forty sources downloading pictures on deploy day is what this stops."""
        item = make_item(db, "images-default")
        assert item.source.images_enabled is False

        def _never(*_a: object, **_kw: object) -> None:
            raise AssertionError("no image may be fetched while the switch is off")

        monkeypatch.setattr("app.services.ingestion_service.httpx.stream", _never)
        article = ingestion_service.import_item(db, item, actor_id=None)
        assert article.hero_media_id is None


class _Vision:
    """A vision model that answers from a script: a verdict, None, or a raise."""

    key = "fake"

    def __init__(self, *answers: object) -> None:
        self.answers = list(answers)
        self.calls = 0

    def inspect_image(self, raw: bytes) -> ImageVerdict | None:
        self.calls += 1
        answer = self.answers.pop(0) if self.answers else None
        if isinstance(answer, Exception):
            raise answer
        return ImageVerdict(answer, f"saw {answer}") if answer else None


SECOND = "https://publisher.example.com/img/second.jpg"


class TestPhotoScan:
    """A branded photo is skipped, never cleaned, and never the hero."""

    @pytest.fixture(autouse=True)
    def _scan(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        public_dns: None,
    ) -> Iterator[None]:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        monkeypatch.setattr(ingestion_service, "_vision_failures", 0)
        monkeypatch.setattr(ingestion_service, "_vision_paused_until", 0.0)

        @contextmanager
        def _apart() -> Iterator[Session]:
            # With no actor the vision row is committed on its own session.
            # This SQLite is one StaticPool connection, so a second session
            # would share this transaction anyway; what is tested here is the
            # scan (test_crawl_enrichment_import tests where the row goes).
            yield db

        monkeypatch.setattr(ingestion_service, "session_scope", _apart)
        # Each URL downloads as itself, so the hero's origin says which won.
        monkeypatch.setattr(
            "app.services.ingestion_service.httpx.stream",
            lambda _method, url, **_k: _Response(_png(), url=url),
        )
        settings_service.set_many(
            db, {"ai.enabled": True, "crawl.image_scan": True}, actor_id=None
        )
        db.flush()
        yield
        db.query(AppSetting).delete()
        db.flush()
        settings_service.invalidate()

    def _vision(self, monkeypatch: pytest.MonkeyPatch, *answers: object) -> _Vision:
        vision = _Vision(*answers)
        monkeypatch.setattr(
            "app.services.ingestion_service.get_ai", lambda *_a, **_k: vision
        )
        return vision

    def test_an_excerpt_source_skips_a_watermarked_photo_for_a_clean_one(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The excerpt path used to stop at its first photo, branded or not."""
        item = make_item(db, "scan-watermark", images_enabled=True)
        self._vision(monkeypatch, "watermark", "clean")
        before = db.query(Media).count()
        checks = db.query(AiUsage).filter_by(operation="image_check").count()

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert db.query(Media).count() == before + 1, "a branded photo became Media"
        hero = db.get(Media, article.hero_media_id)
        assert hero.meta["origin_url"] == SECOND
        assert hero.meta["photo_check"]["verdict"] == "clean"
        assert [c["verdict"] for c in item.photo_check["candidates"]] == [
            "watermark",
            "clean",
        ]
        assert item.photo_check["hero"] == "crawled"
        assert (
            db.query(AiUsage).filter_by(operation="image_check").count() == checks + 2
        ), "every vision call goes on the ledger"

    def test_all_branded_means_no_crawled_hero(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = make_item(db, "scan-all-branded", images_enabled=True)
        self._vision(monkeypatch, "logo", "text")
        before = db.query(Media).count()

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert article.hero_media_id is None
        assert db.query(Media).count() == before
        assert item.photo_check["hero"] == "none"

    def test_the_scan_gives_up_at_its_limit(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        settings_service.set_many(db, {"crawl.image_scan_max": 1}, actor_id=None)
        item = make_item(db, "scan-limit", images_enabled=True)
        vision = self._vision(monkeypatch, "watermark", "clean")

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert vision.calls == 1
        assert article.hero_media_id is None, "an unseen photo is not used past the limit"

    def test_a_scan_that_cannot_run_keeps_the_old_behaviour(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No key, no image input: the first photo is used, marked unchecked."""
        item = make_item(db, "scan-keyless", images_enabled=True)
        self._vision(monkeypatch, None)

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        hero = db.get(Media, article.hero_media_id)
        assert hero.meta["origin_url"] == PHOTO
        assert hero.meta["photo_check"] == {"verdict": "unchecked", "model": None}
        assert item.photo_check["candidates"][0]["verdict"] == "unchecked"

    def test_an_error_is_asked_again_and_the_retry_decides(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One timeout used to wave the photo through unchecked."""
        item = make_item(db, "scan-retry", images_enabled=True)
        vision = self._vision(monkeypatch, AiProviderError(), "clean")
        failed = db.query(AiUsage).filter_by(operation="image_check", ok=False).count()
        passed = db.query(AiUsage).filter_by(operation="image_check", ok=True).count()

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert vision.calls == 2
        hero = db.get(Media, article.hero_media_id)
        assert hero.meta["origin_url"] == PHOTO
        assert hero.meta["photo_check"]["verdict"] == "clean"
        assert db.query(AiUsage).filter_by(operation="image_check", ok=False).count() == failed + 1
        assert db.query(AiUsage).filter_by(operation="image_check", ok=True).count() == passed + 1
        assert ingestion_service._vision_failures == 0

    def test_two_errors_leave_the_photo_unchecked(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = make_item(db, "scan-retry-fails", images_enabled=True)
        vision = self._vision(monkeypatch, AiProviderError(), AiProviderError(), "clean")
        failed = db.query(AiUsage).filter_by(operation="image_check", ok=False).count()

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert vision.calls == 2
        hero = db.get(Media, article.hero_media_id)
        assert hero.meta["origin_url"] == PHOTO
        assert hero.meta["photo_check"] == {"verdict": "unchecked", "model": None}
        assert db.query(AiUsage).filter_by(operation="image_check", ok=False).count() == failed + 2
        assert ingestion_service._vision_failures == 1, "one photo, one failure"

    def test_repeated_errors_trip_the_breaker(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        vision = self._vision(
            monkeypatch, *(AiProviderError() for _ in range(8))
        )
        for n in range(4):
            item = make_item(db, f"scan-breaker-{n}", images_enabled=True)
            article = ingestion_service.import_item(db, item, actor_id=None)
            db.flush()
            # An error is "unchecked", and unchecked is today's behaviour.
            assert article.hero_media_id is not None
        assert vision.calls == 6, "the fourth story should not have waited on vision"
        assert (
            db.query(AiUsage).filter_by(operation="image_check", ok=False).count() >= 6
        )

    def test_a_photo_too_big_to_scan_is_skipped_unbilled(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Refused before any call: the photo is the problem, not the provider,
        so it is not used unscanned, not billed, and trips nothing."""
        item = make_item(db, "scan-too-big", images_enabled=True)
        refused = AiProviderError(
            details={"error": "image too large to inspect", "refused_photo": True}
        )
        self._vision(monkeypatch, refused, "clean")
        checks = db.query(AiUsage).filter_by(operation="image_check").count()

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert db.get(Media, article.hero_media_id).meta["origin_url"] == SECOND
        assert item.photo_check["candidates"][0] == {
            "url": PHOTO, "verdict": "unchecked", "reason": "too large or unreadable to scan",
        }
        assert ingestion_service._vision_failures == 0
        assert db.query(AiUsage).filter_by(operation="image_check").count() == checks + 1

    def test_a_failed_call_counts_toward_the_limit(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """At most `crawl.image_scan_max` photos a story, paid failures included;
        a photo's retry is the same photo."""
        settings_service.set_many(db, {"crawl.image_scan_max": 1}, actor_id=None)
        item = make_item(db, "scan-limit-failed", images_enabled=True)
        item.source.licence = SourceLicence.PUBLISHER_PARTNER
        item.source.content_policy = ContentPolicy.FULL_TEXT
        item.image_urls = [PHOTO, SECOND, "https://publisher.example.com/img/third.jpg"]
        vision = self._vision(
            monkeypatch, AiProviderError(), AiProviderError(), "logo", "clean"
        )

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert vision.calls == 2
        assert db.query(ArticleMedia).filter_by(article_id=article.id).count() == 1

    def test_gallery_photos_are_scanned_too(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = make_item(db, "scan-gallery", images_enabled=True)
        item.source.licence = SourceLicence.PUBLISHER_PARTNER
        item.source.content_policy = ContentPolicy.FULL_TEXT
        third = "https://publisher.example.com/img/third.jpg"
        item.image_urls = [PHOTO, SECOND, third]
        self._vision(monkeypatch, "clean", "logo", "clean")

        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        links = db.query(ArticleMedia).filter_by(article_id=article.id).all()
        origins = {
            link.role: db.get(Media, link.media_id).meta["origin_url"] for link in links
        }
        assert origins == {"hero": PHOTO, "gallery": third}

    def test_scan_off_never_asks_a_model(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        settings_service.set_many(db, {"crawl.image_scan": False}, actor_id=None)
        item = make_item(db, "scan-off", images_enabled=True)

        def _never(*_a: object, **_k: object) -> None:
            raise AssertionError("no provider may be built while the scan is off")

        monkeypatch.setattr("app.services.ingestion_service.get_ai", _never)
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        assert db.get(Media, article.hero_media_id).meta["origin_url"] == PHOTO
        assert item.photo_check["candidates"][0]["verdict"] == "unchecked"


class TestTheFeedDialects:
    """Where a Telugu WordPress feed actually puts its photograph.

    Not media:content, not enclosure — inside `content:encoded`. Every live
    source in this deployment (ntvtelugu, tv9telugu, 10tv, v6velugu) ships the
    story picture only there, so a parser reading the four structured dialects
    alone returns nothing for all of them.
    """

    def test_an_inline_img_in_the_content_is_found(self) -> None:
        from app.integrations.feeds.fetcher import _entry_images

        entry = {
            "content": [{"value": f'<p>వార్త</p><img src="{PHOTO}" alt="x" />'}],
            "summary": "సారాంశం",
        }
        assert _entry_images(_Entry(entry)) == [PHOTO]

    def test_structured_dialects_still_come_first(self) -> None:
        from app.integrations.feeds.fetcher import _entry_images

        explicit = "https://publisher.example.com/media/explicit-1200x675.jpg"
        entry = {
            "media_content": [{"url": explicit}],
            "content": [{"value": f'<img src="{PHOTO}">'}],
        }
        assert _entry_images(_Entry(entry)) == [explicit, PHOTO]


class _Entry:
    """feedparser entries answer to attribute access; dicts do not."""

    def __init__(self, data: dict[str, object]) -> None:
        self.__dict__.update(data)
