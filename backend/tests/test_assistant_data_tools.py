"""Sanjaya's read-only tools: the numbers, the permissions, the district scope,
and that nothing identifying a reader ever comes back.

Tools are called the way the agent calls them — `registry.execute` with a
ToolContext built from the staff member's live roles — so a permission or a
scope the tool forgot shows up here exactly as it would in production.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.deps import build_principal  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_mandals,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ai import AiUsage  # noqa: E402
from app.models.bulletin import AudioBulletin  # noqa: E402
from app.models.content import Article, Category, WorkflowTransition  # noqa: E402
from app.models.engagement import ArticleEvent, Comment, Like, ReadingSession  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ArticleType,
    BulletinStatus,
    CommentStatus,
    CommentTargetType,
    EventType,
    MediaType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District  # noqa: E402
from app.models.ingestion import ContentSource  # noqa: E402
from app.models.media import Media  # noqa: E402
from app.models.notify import NotificationCampaign  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.repositories import site_repo  # noqa: E402
from app.services import auth_service, bulletin_service  # noqa: E402
from app.services.assistant import registry, tools_data  # noqa: E402
from app.services.assistant.tools_data import resolve_category, resolve_district  # noqa: E402

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)

PII_KEYS = {"email", "phone", "ip", "anon_id", "viewer_key", "voter_key", "token"}


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    s = TestSession()
    seed_roles(s, seed_permissions(s))
    seed_states(s)
    seed_mandals(s, seed_districts(s))
    seed_categories(s)
    s.commit()
    yield s
    s.close()
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


def staff(
    db: Session, role: RoleKey, email: str, district_id: int | None = None
) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        r = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(
            email=email,
            phone=f"+9170000{db.scalar(select(func.count(User.id))):05d}",
            name_te="సిబ్బంది",
            name_en=f"Staff {role.value}",
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()
        db.add(
            UserRole(
                user_id=user.id,
                role_id=r.id,
                scope_type=ScopeType.DISTRICT if district_id else ScopeType.GLOBAL,
                scope_id=district_id,
            )
        )
        db.commit()
        db.refresh(user)
    return user


def run(db: Session, user: User, name: str, **args: Any) -> tuple[dict, list[dict]]:
    ctx = registry.ToolContext(db, build_principal(user, "test"))
    return registry.execute(ctx, name, args)


_n = 0


def article(
    db: Session,
    *,
    title: str,
    district: District,
    category: Category | None = None,
    state: WorkflowState = WorkflowState.PUBLISHED,
    kind: ArticleType = ArticleType.NORMAL,
    hero: bool = True,
    author: User | None = None,
    deleted: bool = False,
) -> Article:
    global _n
    _n += 1
    media = None
    if hero:
        media = Media(
            type=MediaType.IMAGE,
            filename="h.webp",
            mime="image/webp",
            storage_provider="test",
            storage_key=f"images/test/ad{_n}.webp",
        )
        db.add(media)
        db.flush()
    live = state == WorkflowState.PUBLISHED
    a = Article(
        short_id=f"at{_n:04d}",
        slug=f"tool-{_n}",
        title_te=title,
        title_en=f"{title} en",
        summary_te="సారాంశం",
        body_plain="క" * 2000,
        category_id=category.id if category else None,
        district_id=district.id,
        hero_media_id=media.id if media else None,
        article_type=kind,
        status=ArticleStatus.PUBLISHED if live else ArticleStatus.PENDING,
        workflow_state=state,
        published_at=utcnow() - timedelta(hours=2) if live else None,
        author_id=author.id if author else None,
        created_by=author.id if author else None,
        deleted_at=utcnow() if deleted else None,
    )
    db.add(a)
    db.flush()
    return a


@pytest.fixture(scope="module")
def world(db: Session) -> dict[str, Any]:
    d1, d2 = db.scalars(select(District).order_by(District.id).limit(2)).all()
    cat = db.scalars(select(Category).order_by(Category.id)).first()
    reporter = staff(db, RoleKey.REPORTER, "rep@tools.example.com")
    now = utcnow()

    a = article(db, title="వార్త ఎ", district=d1, category=cat, author=reporter)
    a.like_count, a.seed_like_count = (
        1,
        5,
    )  # what engagement_service / a seed would leave
    b = article(db, title="వార్త బి", district=d2, category=cat)
    gone = article(db, title="తొలగించిన వార్త", district=d1, category=cat, deleted=True)
    ai_draft = article(
        db,
        title="AI డ్రాఫ్ట్",
        district=d1,
        state=WorkflowState.SUBMITTED,
        kind=ArticleType.AI_DRAFT,
        hero=False,
        author=reporter,
    )
    other_queue = article(
        db, title="ఇతర జిల్లా క్యూ", district=d2, state=WorkflowState.SUBMITTED
    )

    db.add_all(
        [
            WorkflowTransition(
                article_id=a.id,
                from_state=WorkflowState.DRAFT,
                to_state=WorkflowState.SUBMITTED,
                actor_id=reporter.id,
                created_at=now - timedelta(hours=6),
            ),
            WorkflowTransition(
                article_id=a.id,
                from_state=WorkflowState.SUBMITTED,
                to_state=WorkflowState.APPROVED,
                actor_id=reporter.id,
                note="సరే",
                created_at=now - timedelta(hours=3),
            ),
        ]
    )
    # Reads: a×3, b×1, and the deleted story ×5 — it must never rank.
    for art, n in ((a, 3), (b, 1), (gone, 5)):
        for i in range(n):
            db.add(
                ReadingSession(
                    article_id=art.id,
                    viewer_key=f"anon:{art.id}-{i}",
                    day=now.date(),
                    seconds=30,
                    max_scroll_pct=50,
                    created_at=now,
                    updated_at=now,
                )
            )
    db.add_all(
        [
            ArticleEvent(
                article_id=a.id,
                anon_id="dev-1",
                event_type=EventType.VIEW,
                created_at=now,
            ),
            ArticleEvent(
                article_id=b.id,
                anon_id="dev-2",
                event_type=EventType.SHARE,
                created_at=now,
            ),
            ArticleEvent(
                article_id=gone.id,
                anon_id="dev-3",
                event_type=EventType.SHARE,
                created_at=now,
            ),
            Like(article_id=a.id, user_id=reporter.id, created_at=now),
        ]
    )
    for seeded, status in (
        (False, CommentStatus.VISIBLE),
        (True, CommentStatus.VISIBLE),
        (False, CommentStatus.HIDDEN),
    ):
        db.add(
            Comment(
                target_type=CommentTargetType.ARTICLE,
                article_id=a.id,
                body="నా ఫోన్ 9876543210",
                status=status,
                is_seeded=seeded,
            )
        )
    # Through the real writer: `normalized` is only the reader's text lower-cased,
    # so the phone and the one-off search must be kept out by the aggregate.
    for q, n in (("Rain", 3), ("Ramesh 9876543210", 3), ("once only", 1)):
        for _ in range(n):
            site_repo.log_search(db, query=q, results_count=0, user_id=None)
    db.add_all(
        [
            AiUsage(
                operation="draft",
                provider="aimlapi",
                model="m1",
                actor_id=reporter.id,
                cost_paise=250,
            ),
            AiUsage(
                operation="tts",
                provider="sarvam",
                actor_id=None,
                cost_paise=0,
                ok=False,
                error="x",
            ),
            NotificationCampaign(
                title_te="పుష్",
                audience="all",
                status="sent",
                sent_at=now,
                devices=10,
                push_ok=8,
                push_failed=2,
                opened=2,
            ),
            ContentSource(
                slug="ok",
                name="Healthy feed",
                feed_url="https://a.example/rss",
                last_status="ok",
            ),
            ContentSource(
                slug="bad",
                name="Broken feed",
                feed_url="https://b.example/rss",
                consecutive_failures=4,
                last_status="HTTP 500",
            ),
            AudioBulletin(
                bulletin_date=bulletin_service.today(),
                slot=7,
                slot_label_te="ఉదయం",
                duration_sec=180,
                url="/media/b7.mp3",
            ),
        ]
    )
    db.commit()
    return {
        "d1": d1,
        "d2": d2,
        "cat": cat,
        "a": a,
        "b": b,
        "gone": gone,
        "ai_draft": ai_draft,
        "other_queue": other_queue,
        "reporter": reporter,
    }


def _walk_keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | set().union(*(_walk_keys(v) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(_walk_keys(v) for v in value)) if value else set()
    return set()


ARGS = {
    "platform_stats": {"section": "users"},
    "taxonomy_lookup": {"kind": "districts"},
}


def test_every_tool_runs_and_leaks_nothing(db: Session, world: dict) -> None:
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    names = [
        n
        for n, t in registry.TOOLS.items()
        if t.handler.__module__.endswith("tools_data")
    ]
    assert len(names) == 17
    args = {**ARGS, "get_article": {"article_id": world["a"].id}}
    for name in names:
        data, cards = run(db, admin, name, **args.get(name, {}))
        assert "error" not in data, (name, data)
        assert "window" in data, name
        assert not (_walk_keys(data) | _walk_keys(cards)) & PII_KEYS, name
        assert "9876543210" not in str(data) + str(cards), name
        assert all(c["type"] in registry.CARD_TYPES for c in cards), name
        t = registry.TOOLS[name]
        assert t.label_te and t.label_en and t.description
    for section in ("videos", "epaper", "ads", "audio", "polls", "contributors"):
        data, _ = run(db, admin, "platform_stats", section=section)
        assert "error" not in data and not _walk_keys(data) & PII_KEYS, section


def test_audience_and_top_articles_exclude_deleted_and_seeded(
    db: Session, world: dict
) -> None:
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    data, cards = run(db, admin, "audience_analytics", days=7)
    top = [r["short_id"] for r in data["top_articles"]]
    assert top[0] == world["a"].short_id and world["gone"].short_id not in top
    assert data["reads"] == 9 and data["comments_total"] == 1
    assert data["top_searches"] == [{"query": "rain", "count": 3}]

    data, _ = run(db, admin, "top_articles", metric="reads")
    assert [(r["short_id"], r["reads"]) for r in data["articles"]] == [
        (world["a"].short_id, 3),
        (world["b"].short_id, 1),
    ]
    data, _ = run(db, admin, "top_articles", metric="comments")
    assert [(r["short_id"], r["comments"]) for r in data["articles"]] == [
        (world["a"].short_id, 1)
    ]
    data, _ = run(db, admin, "top_articles", metric="shares", district=world["d2"].slug)
    assert [r["short_id"] for r in data["articles"]] == [world["b"].short_id]
    data, _ = run(db, admin, "top_articles", category="no-such-thing")
    assert data["error"] == "VALIDATION_ERROR"


def test_money_push_crawl_bulletins(db: Session, world: dict) -> None:
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    data, _ = run(db, admin, "ai_spend", days=30)
    ops = {r["operation"]: r for r in data["by_operation"]}
    assert ops["draft"]["spent_inr"] == 2.5 and ops["tts"]["unpriced_calls"] == 1
    assert ops["tts"]["failed"] == 1 and data["window_spent_inr"] == 2.5
    assert {u["user"] for u in data["top_users"]} == {
        "Staff reporter",
        "scheduled / system",
    }

    data, _ = run(db, admin, "push_stats")
    assert data["campaigns"] == 1 and data["open_rate_pct"] == 25.0

    data, _ = run(db, admin, "crawl_health")
    assert data["sources"][0]["name"] == "Broken feed"

    data, cards = run(db, admin, "bulletins_for_day")
    assert [b["slot"] for b in data["items"]] == [7] and 7 not in data["missing_slots"]
    assert cards[0]["type"] == "bulletin" and cards[0]["duration_sec"] == 180
    assert (
        run(db, admin, "bulletins_for_day", date="yesterday")[0]["error"]
        == "VALIDATION_ERROR"
    )

    # A Google TTS failure, stored exactly as bulletin_service stores it: the
    # httpx error string holds the request URL, and the URL holds the key.
    key = "AIzaFAKE_FAKE_FAKE_FAKE_FAKE_123"
    req = httpx.Request(
        "POST",
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        params={"key": key},
    )
    with pytest.raises(httpx.HTTPStatusError) as exc:
        httpx.Response(403, request=req).raise_for_status()
    db.add(
        AudioBulletin(
            bulletin_date=bulletin_service.today(),
            slot=9,
            slot_label_te="ఉదయం 9",
            status=BulletinStatus.FAILED,
            error=str({"provider": "google", "error": str(exc.value)[:200]})[:500],
        )
    )
    db.commit()
    data, cards = run(db, admin, "bulletins_for_day")
    assert key not in registry.result_for_model(data) + str(cards)
    assert "key=***" in next(b["error"] for b in data["items"] if b["slot"] == 9)


def test_editorial_and_trend_numbers(
    db: Session, world: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    data, _ = run(db, admin, "editorial_throughput", days=7)
    assert data["published"] == 2 and data["approvals"] == 1
    assert data["top_authors"] == [{"author": "Staff reporter", "published": 1}]
    assert data["median_hours_submit_to_publish"] is not None

    data, _ = run(db, admin, "traffic_trend", days=7)
    assert data["totals"] == {"reads": 9, "published": 2}
    assert len(data["series"]) == 7

    data, _ = run(db, admin, "engagement_summary")
    assert data["comments"] == 1 and data["likes"] == 1 and data["shares"] == 2

    # 01:00 IST on the 30th is still the 29th in UTC, the clock of the reads
    # column: no empty "today" row for a UTC day that has not started.
    fixed = datetime(2026, 9, 29, 19, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(tools_data, "utcnow", lambda: fixed)
    data, _ = run(db, admin, "traffic_trend", days=7)
    assert [r["date"] for r in data["series"]][::6] == ["2026-09-23", "2026-09-29"]
    assert len(data["series"]) == 7


def test_permissions_are_the_routes(db: Session, world: dict) -> None:
    reporter = world["reporter"]
    for name in ("ai_spend", "audience_analytics", "push_stats", "traffic_trend"):
        assert run(db, reporter, name)[0]["error"] == "PERMISSION_DENIED", name
    # An ad manager may open platform_stats, but only its own sections.
    ads = staff(db, RoleKey.AD_MANAGER, "ads@tools.example.com")
    assert "error" not in run(db, ads, "platform_stats", section="ads")[0]
    assert (
        run(db, ads, "platform_stats", section="users")[0]["error"]
        == "PERMISSION_DENIED"
    )
    # content_inventory must not hand a reporter the e-paper, audio and video
    # numbers platform_stats refuses them; an admin still gets every block.
    inv, _ = run(db, reporter, "content_inventory")
    assert "error" not in inv
    for section, key in (
        ("epaper", "epaper_editions_7d_by_status"),
        ("audio", "article_audio"),
        ("videos", "videos_published"),
    ):
        refused = run(db, reporter, "platform_stats", section=section)[0]
        assert refused["error"] == "PERMISSION_DENIED" and key not in inv, section
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    assert {
        "videos_published",
        "active_polls",
        "epaper_editions_7d_by_status",
        "article_audio",
    } <= set(run(db, admin, "content_inventory")[0])


def test_district_scope_and_view_own(db: Session, world: dict) -> None:
    desk = staff(
        db, RoleKey.DESK_EDITOR, "desk@tools.example.com", district_id=world["d1"].id
    )
    data, _ = run(db, desk, "search_articles")
    assert {r["id"] for r in data["articles"]} == {world["a"].id, world["ai_draft"].id}

    data, cards = run(db, desk, "review_queue")
    assert [r["id"] for r in data["articles"]] == [world["ai_draft"].id]
    assert cards[0]["items"][0]["note"]["en"] == "AI draft · needs hero photo"
    assert (
        run(db, desk, "get_article", article_id=world["b"].id)[0]["error"]
        == "SCOPE_DENIED"
    )

    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    data, _ = run(db, admin, "review_queue")
    assert {r["id"] for r in data["articles"]} == {
        world["ai_draft"].id,
        world["other_queue"].id,
    }

    # A stringer holds only article.view_own: their own copy, nobody else's.
    stringer = staff(db, RoleKey.STRINGER, "str@tools.example.com")
    mine = article(
        db,
        title="నా వార్త",
        district=world["d1"],
        state=WorkflowState.DRAFT,
        author=stringer,
    )
    db.commit()
    data, _ = run(db, stringer, "search_articles")
    assert [r["id"] for r in data["articles"]] == [mine.id]
    assert (
        run(db, stringer, "get_article", article_id=world["a"].id)[0]["error"]
        == "NOT_FOUND"
    )


def test_get_article_details(db: Session, world: dict) -> None:
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    data, _ = run(db, admin, "get_article", short_id=world["a"].short_id)
    assert data["id"] == world["a"].id and data["comments"] == 1
    assert data["likes"] == 1 and data["seeded_likes"] == 5
    assert len(data["body_excerpt"]) == 600 and data["has_hero"] is True
    assert [s["state"] for s in data["recent_steps"]] == ["APPROVED", "SUBMITTED"]
    assert data["recent_steps"][0]["by"] == "Staff reporter"


def test_resolvers(db: Session, world: dict) -> None:
    d1, cat = world["d1"], world["cat"]
    for value in (d1.id, str(d1.id), d1.slug, d1.name_en.upper(), d1.name_te):
        assert resolve_district(db, value).id == d1.id, value
    assert resolve_category(db, cat.name_en.lower()).id == cat.id
    assert (
        resolve_district(db, "atlantis") is None and resolve_category(db, None) is None
    )


def test_cms_analytics_keeps_its_keys(
    client: TestClient, db: Session, world: dict
) -> None:
    eic = staff(db, RoleKey.EDITOR_IN_CHIEF, "eic@tools.example.com")
    _s, access, _r, _e = auth_service.create_session(db, eic)
    db.commit()
    r = client.get(
        "/api/v1/cms/analytics", headers={"Authorization": f"Bearer {access}"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {
        "dau",
        "wau",
        "mau",
        "reads_7d",
        "avg_read_seconds_7d",
        "avg_scroll_pct_7d",
        "registered_readers",
        "likes_total",
        "bookmarks_total",
        "comments_total",
        "follows_total",
        "top_articles_7d",
        "top_categories_7d",
        "top_districts_7d",
        "top_searches_7d",
        "generated_at",
    }
    assert set(body["top_articles_7d"][0]) == {"title_te", "short_id", "reads"}
    assert world["gone"].short_id not in {
        x["short_id"] for x in body["top_articles_7d"]
    }
    assert body["comments_total"] == 1


def test_a_full_queue_fits_the_model(db: Session, world: dict) -> None:
    """25 queued drafts with a realistic Telugu headline: nothing clipped, and
    window/scope come before the list so a clip could never cost them."""
    admin = staff(db, RoleKey.SUPER_ADMIN, "root@tools.example.com")
    title = "విజయవాడలో భారీ వర్షం: లోతట్టు ప్రాంతాలు జలమయం, ప్రజలకు అధికారుల హెచ్చరిక"
    try:
        for _ in range(25):
            article(
                db,
                title=title,
                district=world["d1"],
                category=world["cat"],
                state=WorkflowState.SUBMITTED,
                kind=ArticleType.AI_DRAFT,
                hero=False,
                author=world["reporter"],
            )
        for name, args in (
            ("review_queue", {"limit": 25}),
            ("search_articles", {"limit": 25}),
        ):
            data, _ = run(db, admin, name, **args)
            text = registry.result_for_model(data)
            assert len(text) <= registry.MAX_RESULT_CHARS, (name, len(text))
            assert list(data).index("window") < list(data).index("articles"), name
    finally:
        db.rollback()
