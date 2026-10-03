"""Sanjaya's working tools and background jobs (lane C).

What each test guards, because each of these fails quietly:

  * "five articles, five products each" must land in the review queue under
    the requester's name (so somebody else approves), built only from pages
    we fetched, with no outlet named and an invented price flagged — and
    every model call on the AI meter;
  * the research switch and the sensitive-topic screen refuse before any
    money is spent;
  * a URL a person typed must not reach inside our network — not directly,
    not by a name that resolves inside it, not by a redirect;
  * a bulletin a person asked for is the length they asked for, keeps its
    closing line, and stays READY: neither the hour striking nor the retry
    task may put it on air;
  * a proposal never changes anything, and refuses the author's own approval.

No network: providers, feeds, DNS and HTTP are all fakes.
"""

from __future__ import annotations

import io
import ipaddress
import json
import math
import os
import socket
import struct
import wave
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, time, timedelta

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from app.core.deps import build_principal  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import seed_districts, seed_permissions, seed_roles, seed_states  # noqa: E402
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.integrations.ai.base import AiProvider, DraftText, RewriteText  # noqa: E402
from app.integrations.ai.llm import LlmAi  # noqa: E402
from app.integrations.feeds import fetcher  # noqa: E402
from app.integrations.feeds.fetcher import FeedEntry, FeedResult  # noqa: E402
from app.integrations.tts.base import Synthesis, TtsProvider  # noqa: E402
from app.models.ai import AiArticleDraft, AiUsage  # noqa: E402
from app.models.assistant import AssistantConversation, AssistantJob, AssistantMessage  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.bulletin import AudioBulletin, AudioBulletinItem  # noqa: E402
from app.models.content import Article, ArticleVersion, WorkflowTransition  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ArticleType,
    BulletinStatus,
    ContentPolicy,
    IngestStatus,
    MediaType,
    RewriteStatus,
    RoleKey,
    ScopeType,
    SourceBeat,
    SourceLicence,
    UserStatus,
    WorkflowState,
)
from app.models.ingestion import ContentSource, IngestedItem, IngestedRewrite  # noqa: E402
from app.models.media import Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.core.errors import (  # noqa: E402
    AiBudgetExceededError,
    AiSensitiveTopicError,
    PermissionDeniedError,
    ValidationError,
)
from app.services import (  # noqa: E402
    ai_service,
    ai_usage_service,
    bulletin_service,
    ingestion_service,
    settings_service,
    workflow_service,
)
from app.services.assistant import jobs, registry, tools_actions  # noqa: E402
from app.services.assistant.registry import ToolContext  # noqa: E402

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
IST = bulletin_service.IST


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    seed_roles(session, seed_permissions(session))
    seed_states(session)
    seed_districts(session)
    seed_categories(session)
    seed_tags(session)
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _isolate(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Jobs run inline, on this session."""

    @contextmanager
    def session() -> Iterator[Session]:
        yield db
        db.commit()

    monkeypatch.setattr(registry, "open_session", session)
    monkeypatch.setattr(registry, "spawn", lambda fn, *a: fn(*a))
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    db.rollback()
    for model in (
        AssistantJob, AssistantMessage, AssistantConversation, AiUsage, AiArticleDraft, WorkflowTransition, AuditLog,
        AudioBulletinItem, AudioBulletin, IngestedRewrite, IngestedItem,
        ContentSource, Article, AppSetting,
    ):
        db.query(model).delete()
    db.commit()
    db.expunge_all()  # bulk deletes leave the identity map; SQLite reuses the ids
    settings_service.invalidate()


def configure(db: Session, **values: object) -> None:
    settings_service.set_many(db, values, actor_id=None)
    db.commit()


def staff(db: Session, role: RoleKey, email: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        role_row = db.scalar(select(Role).where(Role.key == role.value))
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
        db.commit()
    db.refresh(user)
    return user


def call(
    db: Session, user: User, name: str, args: dict, convo: int | None = None
) -> tuple[dict, list[dict]]:
    ctx = ToolContext(db=db, principal=build_principal(user, "test"), conversation_id=convo)
    return registry.execute(ctx, name, args)


def only_job(db: Session) -> AssistantJob:
    db.expire_all()
    return db.scalars(select(AssistantJob)).one()


@pytest.fixture
def ai_on(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
    configure(db, **{"ai.enabled": True, "ai.research_enabled": True, "ai.provider": "aimlapi"})


# --------------------------------------------------------------------------- #
# write_articles: the Big Billion Days request
# --------------------------------------------------------------------------- #
OUTLET_URL = "https://www.gadgetdeals360.com/bbd-laptops"
PAGE_TEXT = (
    "Big Billion Days laptop deals. HP Pavilion 15 now ₹54,999 (MRP ₹72,999), 24% off. "
    "Lenovo IdeaPad Slim 3 at ₹38,490. HDFC cards get ₹1,500 off. Sale from 27 September."
)


def _article_json(angle: str, *, leak: bool = False) -> dict:
    intro = "బిగ్ బిలియన్ డేస్ సేల్‌లో ల్యాప్‌టాప్‌లపై భారీ తగ్గింపులు ఉన్నాయి."
    if leak:
        intro = "gadgetdeals360 ప్రకారం " + intro
    return {
        "title_te": f"బిగ్ బిలియన్ డేస్: {angle} పై తగ్గింపులు",
        "summary_te": "సేల్‌లో ముఖ్యమైన ఆఫర్లు ఇవే.",
        "intro_te": [intro, "కొనుగోలు ముందు ధరలు సరిచూసుకోండి."],
        "items": [
            {"name": "HP Pavilion 15", "price": "₹54,999", "mrp": "₹72,999", "discount": "24% తగ్గింపు",
             "offer_te": "HDFC కార్డులపై అదనపు తగ్గింపు", "highlight_te": "తేలికైన డిజైన్", "source_url": OUTLET_URL},
            {"name": "Asus Vivobook 15", "price": "41,990", "mrp": "", "discount": "",
             "offer_te": "", "highlight_te": "విద్యార్థులకు అనుకూలం", "source_url": OUTLET_URL},
            {"name": "Acer Aspire 7", "price": "₹29,999", "mrp": "₹49,999", "discount": "",
             "offer_te": "", "highlight_te": "గేమింగ్ కోసం", "source_url": OUTLET_URL},
            {"name": "Dell Inspiron", "price": "", "mrp": "", "discount": "",
             "offer_te": "", "highlight_te": "ధర చెప్పలేదు", "source_url": OUTLET_URL},
        ],
        "closing_te": ["ఆఫర్లు స్టాక్ ఉన్నంత వరకే."],
    }


class FakeLlm:
    """aimlapi as far as the tools can tell: research, _complete, _parse_json."""

    key = "aimlapi"
    model_name = "fake/writer"
    _parse_json = staticmethod(LlmAi._parse_json)

    def __init__(self, *, leak_first: bool = False) -> None:
        self.last_usage: dict = {}
        self.prompts: list[str] = []
        self.queries: list[str] = []
        self.leak_first = leak_first

    def research(self, query: str, *, recency=None, domains=None, timeout=None) -> dict:
        self.queries.append(query)
        self.last_usage = {"usd_spent": 0.007}
        return {
            "answer": "HP Pavilion 15 is ₹54,999. Asus Vivobook 15 is reported at ₹41,990.",
            "sources": [
                {"title": "BBD laptops", "url": OUTLET_URL, "date": "2026-09-28",
                 "snippet": "Asus Vivobook 15 drops to ₹41,990"},
                {"title": "Sale page", "url": "https://www.flipkart.com/bbd", "date": None, "snippet": ""},
            ],
        }

    def _complete(self, prompt: str, rules: str = "", *, timeout=None) -> str:
        self.prompts.append(prompt)
        self.last_usage = {"usd_spent": 0.01}
        if "Propose" in prompt:
            return json.dumps({"angles": ["laptops", "smartphones"]})
        angle = prompt.split("This article's angle: ", 1)[1].split("\n", 1)[0]
        leak = self.leak_first and "previous answer was rejected" not in prompt
        return json.dumps(_article_json(angle, leak=leak), ensure_ascii=False)


@pytest.fixture
def writer(monkeypatch: pytest.MonkeyPatch) -> FakeLlm:
    fake = FakeLlm()
    monkeypatch.setattr(tools_actions, "get_ai", lambda **_k: fake)
    fetched: list[str] = []

    def extract(url: str, **_k) -> dict:
        fetched.append(url)
        if url == OUTLET_URL:
            return {"status": "ok", "title": "Deals", "url": url, "published_at": None,
                    "word_count": 40, "text": PAGE_TEXT}
        return {"status": "blocked_by_robots", "url": url}

    monkeypatch.setattr(tools_actions, "safe_extract", extract)
    fake.fetched = fetched  # type: ignore[attr-defined]
    return fake


class TestWriteArticles:
    def test_two_articles_three_products_each_land_in_the_review_queue(
        self, db: Session, ai_on: None, writer: FakeLlm
    ) -> None:
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        data, cards = call(db, user, "write_articles", {
            "brief": "Flipkart Big Billion Days 2026 deals", "count": 2,
            "items_per_article": 3, "category": "business",
        })
        assert "error" not in data, data
        assert cards == [{"type": "job", "job_id": data["job_id"]}]

        job = only_job(db)
        assert job.status == "done", job.result
        articles = db.scalars(select(Article).order_by(Article.id)).all()
        assert len(articles) == 2
        for article in articles:
            assert article.workflow_state == WorkflowState.SUBMITTED
            assert article.status == ArticleStatus.PENDING
            assert article.author_id == user.id  # so a different editor must approve
            assert article.article_type == ArticleType.AI_DRAFT
            assert article.ai_generated is True
            assert "gadgetdeals360" not in article.body_plain.lower()
            assert "http" not in article.body_plain
            assert "ధర: ₹54,999 (MRP ₹72,999, 24% తగ్గింపు)" in article.body_plain
            assert "గమనిక: ఈ ధరలు" in article.body_plain
            assert "Dell Inspiron" not in article.body_plain  # no price, no item
            assert "Acer Aspire 7" not in article.body_plain  # a price nobody wrote: left out

        rows = job.result["articles"]
        assert rows[0]["unverified"] == ["Acer Aspire 7"]  # the invented price
        assert rows[0]["search_only"] == ["Asus Vivobook 15"]  # only in the search summary
        note = db.scalars(
            select(WorkflowTransition.note).where(WorkflowTransition.article_id == articles[0].id)
        ).one()
        assert "Left out, a figure not in the sources: Acer Aspire 7 (₹29,999)" in note
        assert "Needs a hero photo" in note and OUTLET_URL in note
        kinds = [c["type"] for c in job.result["cards"]]
        assert kinds == ["articles", "sources"]
        assert job.result["cards"][0]["items"][0]["note"]["en"] == (
            "2 products · 1 unverified left out · needs hero"
        )

        usage = db.scalars(select(AiUsage.operation).where(AiUsage.actor_id == user.id)).all()
        assert sorted(usage) == ["draft", "draft", "draft", "research", "research"]
        assert writer.fetched.count(OUTLET_URL) == 2  # the server read the page itself

    def test_a_named_outlet_is_rewritten_once_then_filed(
        self, db: Session, ai_on: None, writer: FakeLlm
    ) -> None:
        writer.leak_first = True
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "write_articles", {"brief": "Big Billion Days", "items_per_article": 3})
        assert only_job(db).status == "done"
        article = db.scalars(select(Article)).one()
        assert "gadgetdeals360" not in f"{article.title_te} {article.body_plain}".lower()
        drafts = [p for p in writer.prompts if "SOURCE MATERIAL" in p]
        assert len(drafts) == 2 and "names a publication (gadgetdeals360)" in drafts[1]

    def test_research_switched_off_is_refused_before_any_job(
        self, db: Session, ai_on: None, writer: FakeLlm
    ) -> None:
        configure(db, **{"ai.research_enabled": False})
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        data, _ = call(db, user, "write_articles", {"brief": "BBD deals", "count": 5})
        assert data["error"] == "VALIDATION_ERROR"
        assert data["details"] == {"ai.research_enabled": "is off"}
        assert "Web research" in data["message"]
        assert db.scalars(select(AssistantJob)).all() == []

    def test_a_sensitive_brief_is_left_to_a_journalist(
        self, db: Session, ai_on: None, writer: FakeLlm
    ) -> None:
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        data, _ = call(db, user, "write_articles", {"brief": "విద్యార్థి ఆత్మహత్య కేసు వివరాలు"})
        assert data["error"] == "AI_REQUIRES_HUMAN_ONLY"
        assert db.scalars(select(AssistantJob)).all() == []
        assert writer.prompts == [] and writer.queries == []

    def test_the_screen_reads_words_not_fragments(self, db: Session, ai_on: None) -> None:
        # Live run 2026-09-29: a finished Smart TV deals article was thrown away
        # because the crawl's substring screen found కుల in అనుకూల.
        for ordinary in (
            "అనుకూలమైన ధరలో స్మార్ట్ టీవీ",
            "సమతుల్యమైన ధ్వని నాణ్యత",
            "Dolby audio from a leading broadcaster",
            "patriotic sale on smart TVs",
        ):
            tools_actions._screen_topic(db, ordinary)
        for sensitive in ("కులం పేరుతో దాడి", "విద్యార్థి ఆత్మహత్య కేసు", "a riot in the city", "sexual assault case"):
            with pytest.raises(AiSensitiveTopicError):
                tools_actions._screen_topic(db, sensitive)


# --------------------------------------------------------------------------- #
# read_web_page / safe_extract: SSRF
# --------------------------------------------------------------------------- #
@pytest.fixture
def net(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """A fake internet. DNS answers from a table; HTTP from a MockTransport
    that records every request that would have left the machine."""
    table = {
        "deals.example": "93.184.216.34",
        "hop.example": "93.184.216.35",
        "sneaky.example": "10.0.0.8",
        "cgnat.example": "100.100.100.200",  # shared space: a cloud metadata service lives here
    }

    def getaddrinfo(host, *_a, **_k):
        try:
            ip = str(ipaddress.ip_address(host))
        except ValueError:
            if host not in table:
                raise socket.gaierror(host) from None
            ip = table[host]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))]

    monkeypatch.setattr(ingestion_service.socket, "getaddrinfo", getaddrinfo)
    sent: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if request.url.host == "hop.example":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
        html = "<html><head><title>Sale</title></head><body><article>" + (
            "<p>HP Pavilion 15 is ₹54,999 in the sale this week.</p>" * 5
        ) + "</article></body></html>"
        return httpx.Response(200, headers={"content-type": "text/html"}, text=html)

    real = httpx.Client

    class Client(real):  # type: ignore[misc, valid-type]
        def __init__(self, *args, **kwargs) -> None:
            kwargs["transport"] = httpx.MockTransport(handler)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", Client)
    monkeypatch.setattr(fetcher, "_throttle", lambda _url: None)
    fetcher._robots_cache.clear()
    return sent


class TestSafeFetch:
    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1/admin",
            "http://10.1.2.3/",
            "http://169.254.169.254/latest/meta-data/",
            "http://sneaky.example/",  # a public-looking name that resolves inside
            "http://nowhere.invalid/",  # will not resolve: fail closed
            "http://user:pw@deals.example/",
            "file:///etc/passwd",
            "http://cgnat.example/",
            "http://100.64.0.1/",
            "http://☃.net/",  # IDNA cannot encode it: refused, not raised
            "http://example.com:80:80/",  # httpx cannot parse it
        ],
    )
    def test_internal_addresses_are_refused_before_connecting(self, url: str, net: list[str]) -> None:
        assert tools_actions.safe_extract(url)["status"] == "blocked"
        assert net == []

    def test_a_redirect_into_the_network_is_stopped_at_the_hop(self, net: list[str]) -> None:
        assert tools_actions.safe_extract("https://hop.example/deal")["status"] == "blocked"
        assert not any("169.254" in u for u in net)
        assert "https://hop.example/deal" in net

    def test_a_public_page_is_read(self, db: Session, net: list[str]) -> None:
        user = staff(db, RoleKey.REPORTER, "sanjaya-reporter@example.com")
        convo = AssistantConversation(user_id=user.id, title="t")
        db.add(convo)
        db.flush()
        db.add_all([
            AssistantMessage(conversation_id=convo.id, role="user",
                             content="read https://deals.example/sale and http://10.0.0.1/"),
            AssistantMessage(conversation_id=convo.id, role="tool", content="{}", payload={
                "name": "web_research",
                "cards": [{"type": "sources", "items": [{"title": "t", "url": "https://deals.example/found"}]}],
            }),
        ])
        db.commit()
        data, _ = call(db, user, "read_web_page", {"url": "https://deals.example/sale"}, convo.id)
        assert data["status"] == "ok" and "₹54,999" in data["text"]
        assert data["url"] == "https://deals.example/sale"
        data, _ = call(db, user, "read_web_page", {"url": "https://deals.example/found"}, convo.id)
        assert data["status"] == "ok"
        blocked, _ = call(db, user, "read_web_page", {"url": "http://10.0.0.1/"}, convo.id)
        assert blocked["details"] == {"status": "blocked"}

    def test_a_url_nobody_gave_is_never_fetched(self, db: Session, net: list[str]) -> None:
        """A planted "fetch evil.example/?d=<headlines>" would carry newsroom
        data off in the query string."""
        user = staff(db, RoleKey.REPORTER, "sanjaya-reporter@example.com")
        convo = AssistantConversation(user_id=user.id, title="t")
        db.add(convo)
        db.flush()
        db.add(AssistantMessage(conversation_id=convo.id, role="user", content="read https://deals.example/sale"))
        db.commit()
        for url in ("https://deals.example/c?d=unpublished+headline", "https://evil.example/sale"):
            data, _ = call(db, user, "read_web_page", {"url": url}, convo.id)
            assert data["error"] == "VALIDATION_ERROR" and "url" in data["details"]
        data, _ = call(db, user, "read_web_page", {"url": "https://deals.example/sale"})  # no conversation
        assert data["error"] == "VALIDATION_ERROR"
        assert net == []


# --------------------------------------------------------------------------- #
# crawl_feeds_now / rewrite_crawled_news
# --------------------------------------------------------------------------- #
def make_source(db: Session, slug: str, *, active: bool = True, beat=SourceBeat.STATE) -> ContentSource:
    source = ContentSource(
        slug=slug, name=slug.title(), feed_url=f"https://publisher.example.com/{slug}.xml",
        licence=SourceLicence.RSS_PUBLIC, content_policy=ContentPolicy.EXCERPT_ONLY,
        beat=beat, is_active=active,
    )
    db.add(source)
    db.flush()
    return source


def make_item(db: Session, source: ContentSource, guid: str, title: str, *, age_minutes: int,
              status: IngestStatus = IngestStatus.NEW) -> IngestedItem:
    when = utcnow() - timedelta(minutes=age_minutes)
    item = IngestedItem(
        source_id=source.id, guid=guid, url=f"https://publisher.example.com/{guid}",
        canonical_url=f"https://publisher.example.com/{guid}", title=title,
        summary="ఇది ఒక చిన్న సారాంశం. " * 12, language="te", fetched_at=when,
        published_at=when, content_hash=f"h-{guid}", status=status,
    )
    db.add(item)
    db.flush()
    return item


class FakeRewriter(AiProvider):
    key = "fake"

    def __init__(self) -> None:
        self.calls = 0

    def propose_topics(self, *, context: str, limit: int):  # pragma: no cover
        return []

    def write_draft(self, *, topic: str, notes: str, sources: list[dict]) -> DraftText:  # pragma: no cover
        return DraftText(title_te=topic, summary_te=notes, paragraphs_te=[])

    def rewrite_item(self, **_kwargs) -> RewriteText:
        self.calls += 1
        return RewriteText(
            title_te="మన మాటల్లో శీర్షిక", summary_te="మన సారాంశం.",
            paragraphs_te=["మొదటి పేరా ఇక్కడ.", "రెండో పేరా ఇక్కడ."], confidence=0.7,
        )


class TestCrawlAndRewrite:
    def test_crawl_job_polls_every_active_source_now(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        polled: list[str] = []

        def fetch_feed(url: str, **_k) -> FeedResult:
            polled.append(url)
            return FeedResult(entries=[FeedEntry(guid=f"{url}#1", title=f"కొత్త వార్త {len(polled)}", url=f"{url}/1")])

        monkeypatch.setattr(ingestion_service, "fetch_feed", fetch_feed)
        make_source(db, "alpha")
        make_source(db, "beta")
        make_source(db, "gamma", active=False)
        db.commit()
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        data, _ = call(db, user, "crawl_feeds_now", {})
        assert "error" not in data, data
        job = only_job(db)
        assert job.status == "done"
        assert job.result["new_items"] == 2 and len(polled) == 2
        assert not any("gamma" in u for u in polled)
        assert job.result["cards"][0]["type"] == "table"
        assert db.scalars(select(IngestedItem)).all() != []

    def test_crawl_needs_taxonomy_manage(self, db: Session) -> None:
        user = staff(db, RoleKey.DESK_EDITOR, "sanjaya-desk@example.com")
        data, _ = call(db, user, "crawl_feeds_now", {})
        assert data["error"] == "PERMISSION_DENIED"

    def test_rewrite_takes_the_window_and_imports_for_review(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "crawl.enabled": True, "crawl.rewrite_enabled": True})
        fake = FakeRewriter()
        monkeypatch.setattr("app.services.crawl_service.get_ai", lambda *_a, **_k: fake)
        source = make_source(db, "rewrites")
        rain = make_item(db, source, "rain", "భారీ వర్షం హెచ్చరిక జారీ", age_minutes=10)
        roads = make_item(db, source, "roads", "కొత్త రోడ్లకు శంకుస్థాపన", age_minutes=20)
        old = make_item(db, source, "old", "పాత వర్షం వార్త", age_minutes=180)
        done = make_item(db, source, "done", "వర్షం దిగుమతైంది", age_minutes=5, status=IngestStatus.IMPORTED)
        db.commit()
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")

        data, _ = call(db, user, "rewrite_crawled_news", {"query": "వర్షం", "hours": 1})
        assert data["matched"] == 1, data
        job = only_job(db)
        assert job.status == "done" and len(job.result["imported"]) == 1
        db.expire_all()
        article = db.get(Article, rain.article_id)
        assert article.workflow_state == WorkflowState.SUBMITTED
        assert article.author_id == user.id
        assert db.get(IngestedItem, roads.id).article_id is None
        assert db.get(IngestedItem, old.id).rewrite_status == RewriteStatus.NONE
        assert db.get(IngestedItem, done.id).rewrite_status == RewriteStatus.NONE

        db.delete(job)
        db.commit()
        data, _ = call(db, user, "rewrite_crawled_news", {"hours": 1})
        assert data["matched"] == 1  # roads; the old one is outside the hour
        assert fake.calls == 2
        assert db.get(IngestedItem, old.id).status == IngestStatus.NEW
        assert sorted(db.scalars(select(AiUsage.operation)).all()) == ["rewrite", "rewrite"]

    def test_rewrite_is_refused_while_switched_off(self, db: Session) -> None:
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        data, _ = call(db, user, "rewrite_crawled_news", {})
        assert data["details"] == {"crawl.rewrite_enabled": "is off"}


# --------------------------------------------------------------------------- #
# prepare_audio_bulletin
# --------------------------------------------------------------------------- #
class FakeTts(TtsProvider):
    key = "fake"

    def __init__(self) -> None:
        self.calls = 0

    def synthesise(self, text: str, *, language: str, voice: str | None = None) -> Synthesis:
        self.calls += 1
        rate, seconds = 8000, max(1, round(len(text) / 12.0))
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(b"".join(struct.pack("<h", int(1000 * math.sin(i / 30))) for i in range(rate * seconds)))
        return Synthesis(audio=buffer.getvalue(), mime="audio/wav", duration_sec=seconds, voice="fake-te")


LONG_SUMMARY = (
    "రాష్ట్ర ప్రభుత్వం కొత్త సంక్షేమ పథకాన్ని ప్రకటించింది. లబ్ధిదారులకు నేరుగా ఖాతాల్లో సాయం జమ అవుతుంది. "
    "జిల్లా అధికారులు దరఖాస్తుల స్వీకరణ ప్రారంభించారు. గ్రామ సచివాలయాల్లో వివరాలు అందుబాటులో ఉన్నాయి. "
    "అర్హుల జాబితా వచ్చే వారం ప్రకటిస్తారు. ఈ పథకం ద్వారా లక్షలాది కుటుంబాలకు మేలు జరుగుతుందని మంత్రి చెప్పారు. "
)


def publish_story(db: Session, i: int, when: datetime) -> Article:
    article = Article(
        short_id=f"bl{i:04d}", slug=f"bulletin-story-{i}", title_te=f"ముఖ్య వార్త సంఖ్య {i} పై పూర్తి వివరాలు",
        summary_te=LONG_SUMMARY, body={"type": "doc", "content": []}, body_plain=LONG_SUMMARY,
        status=ArticleStatus.PUBLISHED, workflow_state=WorkflowState.PUBLISHED, published_at=when,
    )
    db.add(article)
    db.flush()
    return article


class TestBulletin:
    def test_three_minutes_fits_keeps_its_close_and_is_held(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        tts = FakeTts()
        monkeypatch.setattr("app.services.bulletin_service.get_tts", lambda *_a, **_k: tts)
        monkeypatch.setattr(tools_actions, "get_tts", lambda *_a, **_k: tts)
        # Approval NOT required: the setting under which the beat and the retry
        # would put a bulletin on air by themselves.
        configure(db, **{"bulletin.enabled": True, "bulletin.requires_approval": False})
        day = bulletin_service.today()
        for i in range(10):
            publish_story(db, i, datetime.combine(day, time(12, 30), tzinfo=IST) - timedelta(minutes=i))
        db.commit()
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")

        data, _ = call(db, user, "prepare_audio_bulletin", {"minutes": 3, "slot": 15, "hours_back": 48})
        assert "error" not in data, data
        job = only_job(db)
        assert job.status == "done", job.result
        row = db.scalars(select(AudioBulletin)).one()
        assert row.status == BulletinStatus.READY and row.published_at is None
        assert row.requested_by == user.id
        assert len(row.script_te) <= bulletin_service.target_chars(db, 180)
        assert row.script_te.endswith(bulletin_service._CLOSE_TE)
        assert len(row.items) >= 3
        spoken = row.script_te
        assert all(item.spoken_te in spoken for item in row.items)  # no half-read story
        card_types = [c["type"] for c in job.result["cards"]]
        assert card_types == ["bulletin", "action"]
        assert db.scalars(select(AiUsage.operation)).all() == ["tts"]

        # The hour strikes: the beat leaves a person's bulletin alone.
        calls, digest = tts.calls, row.script_hash
        monkeypatch.setattr(bulletin_service, "current_slot", lambda now=None: 15)
        assert bulletin_service.run_slot(db) is row
        db.commit()
        assert (row.status, row.script_hash, tts.calls) == (BulletinStatus.READY, digest, calls)

        # A hand edit, then the retry task: re-recorded, still not on air.
        from app.workers.tasks import bulletin as bulletin_tasks

        @contextmanager
        def session() -> Iterator[Session]:
            yield db
            db.commit()

        monkeypatch.setattr(bulletin_tasks, "session_scope", session)
        row.status = BulletinStatus.SCRIPTED
        db.commit()
        assert bulletin_tasks.retry() == {"retried": 1}
        db.refresh(row)
        assert row.status == BulletinStatus.READY and row.requested_by == user.id

    def test_the_default_slot_is_the_next_one_ahead(self) -> None:
        at = lambda h, m=0: datetime(2026, 9, 29, h, m, tzinfo=IST)  # noqa: E731
        assert tools_actions._next_slot(at(6, 45)) == ("2026-09-29", 7)
        assert tools_actions._next_slot(at(6, 55)) == ("2026-09-29", 9)  # the beat's, in 5 min
        assert tools_actions._next_slot(at(13)) == ("2026-09-29", 15)  # 13:00 is now, not ahead
        assert tools_actions._next_slot(at(21, 30)) == ("2026-09-30", 7)

    def test_a_live_slot_is_refused(self, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(tools_actions, "get_tts", lambda *_a, **_k: FakeTts())
        configure(db, **{"bulletin.enabled": True})
        live = bulletin_service.get_or_create(db, bulletin_service.today(), 9)
        live.status = BulletinStatus.PUBLISHED
        db.commit()
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        data, _ = call(db, user, "prepare_audio_bulletin", {"slot": 9})
        assert data["error"] == "CONFLICT" and "already live" in data["message"]


# --------------------------------------------------------------------------- #
# propose_action / job_status
# --------------------------------------------------------------------------- #
class TestProposalsAndJobs:
    def _submitted(self, db: Session, author: User) -> Article:
        article = Article(
            short_id="pa0001", slug="proposal-story", title_te="సమీక్షకు వచ్చిన వార్త",
            body={"type": "doc", "content": []}, body_plain="", status=ArticleStatus.PENDING,
            workflow_state=WorkflowState.SUBMITTED, author_id=author.id,
        )
        db.add(article)
        db.commit()
        return article

    def test_the_author_cannot_be_offered_their_own_approval(self, db: Session) -> None:
        author = staff(db, RoleKey.EDITOR_IN_CHIEF, "sanjaya-eic@example.com")
        article = self._submitted(db, author)
        data, cards = call(db, author, "propose_action", {"action": "approve_article", "article_id": article.id})
        assert data["error"] == "VALIDATION_ERROR" and data["details"] == {"rule": "two-person"}
        assert cards == []
        with pytest.raises(ValidationError):
            workflow_service.transition(db, build_principal(author, "t"), article, "approve", None)

    def test_an_admin_may_approve_and_publish_their_own_story(self, db: Session) -> None:
        author = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        article = self._submitted(db, author)
        _, cards = call(db, author, "propose_action", {"action": "approve_article", "article_id": article.id})
        assert cards[0]["action"] == "approve_article"

        hero = Media(type=MediaType.IMAGE, filename="hero.webp", mime="image/webp",
                     storage_provider="test", storage_key="images/test/self.webp")
        db.add(hero)
        db.flush()
        article.hero_media_id = hero.id
        principal = build_principal(author, "t")
        workflow_service.transition(db, principal, article, "approve", None)
        _, cards = call(db, author, "propose_action", {"action": "publish_article", "article_id": article.id})
        assert cards[0]["action"] == "publish_article"
        workflow_service.transition(db, principal, article, "publish", None)
        assert article.workflow_state == WorkflowState.PUBLISHED
        assert article.approved_by == article.published_by == author.id

    def test_a_proposal_changes_nothing(self, db: Session) -> None:
        author = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        editor = staff(db, RoleKey.EDITOR_IN_CHIEF, "sanjaya-eic@example.com")
        article = self._submitted(db, author)
        data, cards = call(db, editor, "propose_action", {"action": "approve_article", "article_id": article.id})
        assert cards[0]["type"] == "action" and cards[0]["action"] == "approve_article"
        assert cards[0]["params"] == {"article_id": article.id, "title": article.title_te}
        db.refresh(article)
        assert article.workflow_state == WorkflowState.SUBMITTED and article.approved_by is None

        data, _ = call(db, editor, "propose_action", {"action": "publish_article", "article_id": article.id})
        assert data["error"] == "CONFLICT" and "no hero photo" in data["message"]

    def test_job_status_is_the_owners_only(self, db: Session) -> None:
        owner = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        other = staff(db, RoleKey.EDITOR_IN_CHIEF, "sanjaya-eic@example.com")
        job = AssistantJob(user_id=owner.id, kind="bulletin", title="t", status="running",
                           progress=40, step_text="Recording", heartbeat_at=utcnow())
        db.add(job)
        db.commit()
        data, _ = call(db, other, "job_status", {"job_id": job.id})
        assert data["error"] == "NOT_FOUND"
        data, _ = call(db, owner, "job_status", {"job_id": job.id})
        assert (data["status"], data["progress"], data["step_text"]) == ("running", 40, "Recording")

        job.heartbeat_at = utcnow() - timedelta(minutes=30)  # killed by a deploy
        db.commit()
        data, _ = call(db, owner, "job_status", {"job_id": job.id})
        assert data["status"] == "failed"


class TestEditingAnyArticle:
    def test_a_live_article_is_editable_by_the_desk_and_versioned(self, db: Session) -> None:
        author = staff(db, RoleKey.REPORTER, "edit-rep@example.com")
        sub = staff(db, RoleKey.SUB_EDITOR, "edit-sub@example.com")
        admin = staff(db, RoleKey.ADMIN, "edit-admin@example.com")
        article = Article(
            short_id="ed0001", slug="live-story", title_te="పాత శీర్షిక",
            body={"type": "doc", "content": []}, body_plain="", status=ArticleStatus.PUBLISHED,
            workflow_state=WorkflowState.PUBLISHED, author_id=author.id, published_at=utcnow(),
        )
        db.add(article)
        db.commit()

        # Below publishing authority, a live story stays as readers have it.
        with pytest.raises(PermissionDeniedError):
            workflow_service.update(db, build_principal(sub, "t"), article, {"title_te": "కొత్త"})
        with pytest.raises(PermissionDeniedError):
            workflow_service.update(db, build_principal(author, "t"), article, {"title_te": "కొత్త"})

        workflow_service.update(db, build_principal(admin, "t"), article, {"title_te": "కొత్త శీర్షిక"})
        db.commit()
        assert article.title_te == "కొత్త శీర్షిక" and article.slug == "live-story"
        assert article.workflow_state == WorkflowState.PUBLISHED
        version = db.scalar(select(ArticleVersion).where(ArticleVersion.article_id == article.id))
        assert version.snapshot["title_te"] == "కొత్త శీర్షిక"



# --------------------------------------------------------------------------- #
# Review fixes: what the first pass let through
# --------------------------------------------------------------------------- #
class BrandLlm(FakeLlm):
    """A deals brief whose source is the brand's own site, and copy that names
    the retailer running the sale."""

    def research(self, query: str, *, recency=None, domains=None, timeout=None) -> dict:
        self.queries.append(query)
        self.last_usage = {"usd_spent": 0.007}
        return {
            "answer": "Samsung Galaxy S24 FE at ₹29,999 on Flipkart.",
            "sources": [{"title": "Offers", "url": "https://www.samsung.com/in/offers/", "date": None,
                         "snippet": "Samsung Galaxy S24 FE ₹29,999"}],
        }

    def _complete(self, prompt: str, rules: str = "", *, timeout=None) -> str:
        self.prompts.append(prompt)
        self.last_usage = {"usd_spent": 0.01}
        return json.dumps({
            "title_te": "బిగ్ బిలియన్ డేస్: ఫోన్లపై తగ్గింపులు",
            "summary_te": "సేల్‌లో ముఖ్యమైన ఆఫర్లు.",
            "intro_te": ["Flipkart బిగ్ బిలియన్ డేస్ సేల్‌లో ఫోన్లపై తగ్గింపులు.", "ధరలు సరిచూసుకోండి."],
            "items": [{"name": "Samsung Galaxy S24 FE", "price": "₹29,999", "mrp": "", "discount": "",
                       "offer_te": "", "highlight_te": "మంచి కెమెరా", "source_url": "x"}],
            "closing_te": ["ఆఫర్లు స్టాక్ ఉన్నంత వరకే."],
        }, ensure_ascii=False)


class SensitiveAngles(FakeLlm):
    def _complete(self, prompt: str, rules: str = "", *, timeout=None) -> str:
        if "Propose" in prompt:
            self.prompts.append(prompt)
            return json.dumps({"angles": ["విద్యార్థి ఆత్మహత్య కేసు వివరాలు"]}, ensure_ascii=False)
        return super()._complete(prompt, rules, timeout=timeout)


class TestWritingReviewFixes:
    def test_prices_from_the_editors_notes_are_verified(
        self, db: Session, ai_on: None, writer: FakeLlm
    ) -> None:
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        notes = ("HP Pavilion 15 ₹54,999 (MRP ₹72,999, 24% off); Asus Vivobook 15 ₹41,990; "
                 "Acer Aspire 7 ₹29,999 (MRP ₹49,999).")
        data, _ = call(db, user, "write_articles", {
            "brief": "Big Billion Days laptops", "items_per_article": 3, "research": False, "notes": notes})
        assert "error" not in data, data
        row = only_job(db).result["articles"][0]
        assert (row["items"], row["unverified"], row["search_only"]) == (3, [], [])
        article = db.get(Article, row["id"])
        assert article.ai_confidence == 1.0 and "Acer Aspire 7" in article.body_plain
        assert writer.queries == []

    def test_the_brand_and_the_retailer_are_the_subject_not_outlets(
        self, db: Session, ai_on: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = BrandLlm()
        monkeypatch.setattr(tools_actions, "get_ai", lambda **_k: fake)
        monkeypatch.setattr(tools_actions, "safe_extract", lambda url, **_k: {
            "status": "ok", "title": "Offers", "url": url, "published_at": None, "word_count": 9,
            "text": "Samsung Galaxy S24 FE now ₹29,999 in the festive sale."})
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "write_articles", {"brief": "Big Billion Days deals", "items_per_article": 1})
        job = only_job(db)
        assert job.result["skipped"] == [], job.result
        article = db.scalars(select(Article)).one()
        assert "Flipkart" in article.body_plain
        assert len([p for p in fake.prompts if "SOURCE MATERIAL" in p]) == 1

    def test_a_sensitive_angle_the_model_proposed_is_left_to_a_journalist(
        self, db: Session, ai_on: None, writer: FakeLlm, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = SensitiveAngles()
        monkeypatch.setattr(tools_actions, "get_ai", lambda **_k: fake)
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "write_articles", {"brief": "Guntur news today", "count": 2, "angles": ["Guntur roads"]})
        job = only_job(db)
        assert [a["angle"] for a in job.result["articles"]] == ["Guntur roads"]
        assert job.result["skipped"] == [
            {"angle": "విద్యార్థి ఆత్మహత్య కేసు వివరాలు", "skipped": "This topic must be written by a human journalist."}
        ]
        assert not any("ఆత్మహత్య" in q for q in fake.queries)  # nothing spent on it

    def test_one_article_crashing_does_not_lose_the_others(
        self, db: Session, ai_on: None, writer: FakeLlm, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real, calls = ai_service.convert_draft, []

        def flaky(*a, **k):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("deadlock")
            return real(*a, **k)

        monkeypatch.setattr(ai_service, "convert_draft", flaky)
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "write_articles", {"brief": "Big Billion Days", "count": 2, "items_per_article": 3})
        job = only_job(db)
        assert job.status == "done"
        assert [s["skipped"] for s in job.result["skipped"]] == ["failed unexpectedly"]
        assert len(job.result["articles"]) == 1 and len(db.scalars(select(Article)).all()) == 1

    def test_ai_switched_off_stops_the_spend_at_the_next_call(self, db: Session, ai_on: None) -> None:
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        configure(db, **{"ai.enabled": False})
        with pytest.raises(ValidationError):
            tools_actions.paid(db, FakeLlm(), user.id, "draft", lambda: pytest.fail("called"))
        assert db.scalars(select(AiUsage)).all() == []


class TestGroundingAndScreens:
    def test_a_price_read_off_another_products_row_is_not_verified(self) -> None:
        page = "HP Pavilion 15 now ₹54,999. " + "x" * 400 + " Acer Aspire 7 is a gaming laptop."
        kept, dropped = jobs._ground(
            [
                {"name": "HP Pavilion 15", "price": "₹54,999"},
                {"name": "Acer Aspire 7", "price": "₹54,999"},  # the HP's price
                {"name": "Asus Vivobook 15", "price": "41,990", "offer_te": "HDFC కార్డులపై ₹5,000 తగ్గింపు"},
            ],
            [page],
            "Asus Vivobook 15 ₹41,990",
        )
        assert [(i["name"], i["grounding"]) for i in kept] == [
            ("HP Pavilion 15", "verified_in_page"), ("Acer Aspire 7", "search_only"),
        ]
        assert [i["name"] for i in dropped] == ["Asus Vivobook 15"]  # the offer's ₹5,000 is nobody's

    def test_outlet_names_in_either_script_and_in_the_price(self) -> None:
        outlets = jobs._outlets(
            ["https://www.samsung.com/in/", "https://www.gadgets360.com/x", "https://www.flipkart.com/bbd"],
            "Big Billion Days Samsung Galaxy S24 FE",
            ["Eenadu", "ఈనాడు"],
        )
        assert outlets == {"gadgets360", "eenadu", "ఈనాడు"}
        copy = jobs._copy({"title_te": "శీర్షిక", "summary_te": "సారాంశం",
                           "intro_te": ["ఒకటి.", "రెండు."], "closing_te": []})
        item = {"name": "HP Pavilion 15", "price": "54,999 (gadgets360.com)", "mrp": "", "discount": "",
                "offer_te": "", "highlight_te": ""}
        assert jobs._screen(copy, [item], 1, outlets, {"54999"}) == "it names a publication (gadgets360)"
        copy["paragraphs"] = ["ఈనాడు కథనం ప్రకారం ధరలు తగ్గాయి."]
        assert jobs._screen(copy, [], 0, outlets, set()) == "it names a publication (ఈనాడు)"
        copy["paragraphs"] = ["ధర ₹99,999 మాత్రమే.", "రెండు.", "మూడు."]
        assert jobs._screen(copy, [], 0, set(), {"54999"}) == "it states a figure the sources do not (99999)"

    def test_copy_too_close_to_a_telugu_source_is_refused(self) -> None:
        text = "రాష్ట్ర ప్రభుత్వం కొత్త సంక్షేమ పథకాన్ని ప్రకటించింది లబ్ధిదారులకు నేరుగా సాయం అందుతుంది"
        copy = {"paragraphs": [text]}
        assert jobs._too_close(copy, [{"text": text}], 85) == "it is too close to a source (100%)"
        assert jobs._too_close(copy, [{"text": text}], 0) is None


class TestBulletinReviewFixes:
    @pytest.fixture
    def tts(self, db: Session, monkeypatch: pytest.MonkeyPatch) -> FakeTts:
        tts = FakeTts()
        monkeypatch.setattr("app.services.bulletin_service.get_tts", lambda *_a, **_k: tts)
        monkeypatch.setattr(tools_actions, "get_tts", lambda *_a, **_k: tts)
        return tts

    def _stories(self, db: Session, n: int) -> list[Article]:
        day = bulletin_service.today()
        stories = [publish_story(db, i, datetime.combine(day, time(12, 30), tzinfo=IST) - timedelta(minutes=i))
                   for i in range(n)]
        db.commit()
        return stories

    def test_a_filter_that_matches_nothing_leaves_a_held_bulletin_alone(
        self, db: Session, tts: FakeTts
    ) -> None:
        configure(db, **{"bulletin.enabled": True, "bulletin.requires_approval": True})
        self._stories(db, 6)
        held = bulletin_service.run_slot(db, day=bulletin_service.today(), slot=15)
        db.commit()
        before = (held.status, held.url, held.script_hash, held.revision, tts.calls)
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "prepare_audio_bulletin", {"slot": 15, "category": "sports"})
        assert only_job(db).status == "failed"
        row = db.scalars(select(AudioBulletin)).one()
        assert (row.status, row.url, row.script_hash, row.revision, tts.calls) == before
        assert bulletin_service.publish(db, row).status == BulletinStatus.PUBLISHED

    def test_replacing_audio_is_a_new_revision_and_repeated_ids_read_once(
        self, db: Session, tts: FakeTts
    ) -> None:
        configure(db, **{"bulletin.enabled": True, "bulletin.requires_approval": True})
        a, b = self._stories(db, 2)
        held = bulletin_service.run_slot(db, day=bulletin_service.today(), slot=15)
        db.commit()
        revision = held.revision
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "prepare_audio_bulletin", {"slot": 15, "article_ids": [a.id, b.id, a.id], "minutes": 2})
        assert only_job(db).status == "done", only_job(db).result
        row = db.scalars(select(AudioBulletin)).one()
        assert [i.article_id for i in row.items] == [a.id, b.id]
        assert row.revision == revision + 1 and row.requested_by == user.id

    def test_the_recording_is_guarded_like_any_paid_call(
        self, db: Session, tts: FakeTts, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        self._stories(db, 3)

        def broke(_db: Session, _uid: int) -> None:
            raise AiBudgetExceededError()

        monkeypatch.setattr(ai_usage_service, "guard", broke)
        user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        call(db, user, "prepare_audio_bulletin", {"slot": 15, "hours_back": 48})
        job = only_job(db)
        assert job.status == "failed" and job.result["error"]["code"] == AiBudgetExceededError.code
        assert tts.calls == 0 and db.scalars(select(AudioBulletin)).all() == []

    def test_a_live_bulletin_edited_by_hand_goes_back_on_air(
        self, db: Session, tts: FakeTts, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Run now stamps `requested_by` too; only a bulletin that never went
        live (the assistant's) is held by the retry."""
        from app.workers.tasks import bulletin as bulletin_tasks

        configure(db, **{"bulletin.enabled": True, "bulletin.requires_approval": False})
        self._stories(db, 3)
        editor = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
        row = bulletin_service.run_slot(db, day=bulletin_service.today(), slot=15, requested_by=editor.id)
        db.commit()
        assert row.status == BulletinStatus.PUBLISHED and row.requested_by == editor.id

        @contextmanager
        def session() -> Iterator[Session]:
            yield db
            db.commit()

        monkeypatch.setattr(bulletin_tasks, "session_scope", session)
        row.status = BulletinStatus.SCRIPTED  # the PATCH route: a hand edit takes it off air
        db.commit()
        assert bulletin_tasks.retry() == {"retried": 1}
        db.refresh(row)
        assert row.status == BulletinStatus.PUBLISHED


def test_the_push_card_shows_every_word_that_will_be_sent(db: Session) -> None:
    user = staff(db, RoleKey.ADMIN, "sanjaya-admin@example.com")
    article = publish_story(db, 99, utcnow())
    db.commit()
    body = "ఈ రోజు సాయంత్రం భారీ వర్షం కురిసే అవకాశం ఉంది"
    data, cards = call(db, user, "propose_action",
                       {"action": "send_push", "article_id": article.id, "body_te": body})
    assert "error" not in data, data
    assert body in cards[0]["summary"]["te"] and body in cards[0]["summary"]["en"]
    assert cards[0]["params"]["body_te"] == body
