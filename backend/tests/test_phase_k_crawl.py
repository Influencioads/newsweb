"""Phase K — the hourly crawl, the Telugu rewrite, and the mandal guess.

The negatives are the ones that matter. In order of how much damage they
prevent:

  * an unlicensed source must not gain full text through the HTML fallback;
  * a sensitive subject must never reach a provider at all;
  * one loud feed must not consume the whole hourly budget;
  * nothing the crawl produces may reach a reader without two people.
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

from app.core.deps import build_principal  # noqa: E402
from app.core.errors import ValidationError  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.ai.base import AiProvider, DraftText, RewriteText  # noqa: E402
from app.integrations.feeds import FeedEntry, FeedResult  # noqa: E402
from app.integrations.feeds.extract import PageText  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ArticleType,
    ContentPolicy,
    IngestStatus,
    MandalMatchMethod,
    RewriteStatus,
    RoleKey,
    ScopeType,
    SourceBeat,
    SourceLicence,
    UserStatus,
    WorkflowState,
)
from app.models.geo import District, Mandal, MandalAlias  # noqa: E402
from app.models.ingestion import (  # noqa: E402
    ContentSource,
    IngestedItem,
    IngestedRewrite,
)
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import (  # noqa: E402
    auth_service,
    crawl_service,
    gazetteer_service,
    ingestion_service,
    settings_service,
    workflow_service,
)

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
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
    """Each test starts with an empty crawl queue and default settings.

    The session is module-scoped for speed, so without this the quota tests
    see every item the earlier tests left behind and the selector's arithmetic
    stops being about the case under test.
    """
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    db.query(IngestedRewrite).delete()
    db.query(IngestedItem).delete()
    db.query(ContentSource).delete()
    db.query(AppSetting).delete()
    db.commit()
    settings_service.invalidate()
    gazetteer_service.invalidate()


def configure(db: Session, **values: object) -> None:
    settings_service.set_many(db, values, actor_id=None)
    db.commit()


def staff_headers(db: Session, *, role: RoleKey, email: str) -> dict[str, str]:
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


def make_source(
    db: Session,
    *,
    slug: str,
    beat: SourceBeat = SourceBeat.DISTRICT_LOCAL,
    licence: SourceLicence = SourceLicence.RSS_PUBLIC,
    policy: ContentPolicy = ContentPolicy.EXCERPT_ONLY,
    note: str | None = None,
    rewrite: bool = True,
    district_id: int | None = None,
    mandal_id: int | None = None,
    per_hour: int = 8,
    html_fallback: bool = False,
) -> ContentSource:
    source = ContentSource(
        slug=slug,
        name=slug.replace("-", " ").title(),
        feed_url=f"https://publisher.example.com/{slug}.xml",
        licence=licence,
        content_policy=policy,
        licence_note=note,
        beat=beat,
        rewrite_enabled=rewrite,
        default_district_id=district_id,
        default_mandal_id=mandal_id,
        max_items_per_hour=per_hour,
        allow_html_fallback=html_fallback,
    )
    db.add(source)
    db.flush()
    return source


def make_item(
    db: Session,
    source: ContentSource,
    *,
    title: str = "ఒక సాధారణ వార్త ఇక్కడ ఉంది",
    summary: str = "ఇది ఒక చిన్న సారాంశం. " * 12,
    guid: str | None = None,
    age_minutes: int = 10,
    language: str = "te",
) -> IngestedItem:
    item = IngestedItem(
        source_id=source.id,
        guid=guid or f"g{utcnow().timestamp()}{title[:8]}",
        url="https://publisher.example.com/a1",
        canonical_url="https://publisher.example.com/a1",
        title=title,
        summary=summary,
        language=language,
        fetched_at=utcnow() - timedelta(minutes=age_minutes),
        published_at=utcnow() - timedelta(minutes=age_minutes),
        content_hash=f"h{utcnow().timestamp()}{title[:8]}",
        status=IngestStatus.NEW,
    )
    db.add(item)
    db.flush()
    return item


class FakeAi(AiProvider):
    """A provider that records whether it was called at all.

    The call count is the assertion in the sensitive-subject tests: the guard
    is worthless if it runs after the request.
    """

    key = "fake"

    def __init__(self, result: RewriteText | None = None) -> None:
        self.calls = 0
        self.result = result or RewriteText(
            title_te="మన సొంత మాటల్లో శీర్షిక",
            summary_te="మన సొంత సారాంశం.",
            paragraphs_te=["మొదటి పేరా.", "రెండో పేరా."],
            confidence=0.7,
        )

    def propose_topics(self, *, context: str, limit: int):  # pragma: no cover
        return []

    def write_draft(self, *, topic: str, notes: str, sources: list[dict]) -> DraftText:  # pragma: no cover
        return DraftText(title_te=topic, summary_te=notes, paragraphs_te=[])

    def rewrite_item(self, **kwargs) -> RewriteText:
        self.calls += 1
        return self.result


def install_ai(monkeypatch: pytest.MonkeyPatch, provider: AiProvider) -> None:
    monkeypatch.setattr("app.services.crawl_service.get_ai", lambda *_a, **_k: provider)


# --------------------------------------------------------------------------- #
# The hourly quota
# --------------------------------------------------------------------------- #
class TestQuota:
    def test_global_cap_limits_the_pass(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"crawl.hourly_item_cap": 3})
        source = make_source(db, slug="q-cap", beat=SourceBeat.NATIONAL, per_hour=50)
        for i in range(8):
            make_item(db, source, guid=f"cap{i}", title=f"వార్త సంఖ్య {i} ఇక్కడ")
        db.commit()

        chosen = crawl_service.select_for_rewrite(
            db,
            cap=3,
            beat_quota={"national": 50},
            default_source_cap=50,
        )
        assert len(chosen) == 3

    def test_a_beat_at_its_quota_yields_nothing_more(self, db: Session) -> None:
        source = make_source(db, slug="q-beat", beat=SourceBeat.SPORTS)
        make_item(db, source, guid="beat1", title="క్రీడా వార్త ఒకటి ఇక్కడ")
        db.commit()
        assert (
            crawl_service.select_for_rewrite(
                db, cap=100, beat_quota={"sports": 0}, default_source_cap=10
            )
            == []
        )

    def test_round_robin_stops_one_feed_starving_the_others(self, db: Session) -> None:
        """The single most important line in the selector.

        Without it a chatty aggregator eats the whole budget every hour and
        district coverage silently goes to zero, while the dashboard looks
        perfectly healthy.
        """
        loud = make_source(db, slug="q-loud", beat=SourceBeat.FILM, per_hour=50)
        quiet = make_source(db, slug="q-quiet", beat=SourceBeat.FILM, per_hour=50)
        for i in range(20):
            make_item(db, loud, guid=f"loud{i}", title=f"సినిమా వార్త {i} ఇక్కడ")
        for i in range(2):
            make_item(db, quiet, guid=f"quiet{i}", title=f"చిన్న వార్త {i} ఇక్కడ")
        db.commit()

        chosen = crawl_service.select_for_rewrite(
            db, cap=6, beat_quota={"film": 6}, default_source_cap=50
        )
        picked = {item.source_id for item in chosen}
        assert quiet.id in picked, "the quiet source must not be starved"
        assert len(chosen) == 6

    def test_per_source_cap_bounds_one_source(self, db: Session) -> None:
        source = make_source(db, slug="q-src", beat=SourceBeat.STATE, per_hour=2)
        for i in range(10):
            make_item(db, source, guid=f"src{i}", title=f"రాష్ట్ర వార్త {i} ఇక్కడ")
        db.commit()
        chosen = crawl_service.select_for_rewrite(
            db, cap=100, beat_quota={"state": 100}, default_source_cap=100
        )
        assert len(chosen) == 2

    def test_items_already_rewritten_are_not_picked_again(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"crawl.enabled": True, "crawl.rewrite_enabled": True})
        install_ai(monkeypatch, FakeAi())
        source = make_source(db, slug="q-once", beat=SourceBeat.NATIONAL)
        make_item(db, source, guid="once1", title="ఒకసారి మాత్రమే ఈ వార్త")
        db.commit()

        first = crawl_service.select_for_rewrite(
            db, cap=10, beat_quota={"national": 10}, default_source_cap=10
        )
        assert len(first) == 1
        crawl_service.rewrite_one(db, first[0])
        db.commit()

        second = crawl_service.select_for_rewrite(
            db, cap=10, beat_quota={"national": 10}, default_source_cap=10
        )
        assert second == []

    def test_stale_items_are_ignored(self, db: Session) -> None:
        source = make_source(db, slug="q-old", beat=SourceBeat.NATIONAL)
        make_item(db, source, guid="old1", title="పాత వార్త ఇక్కడ ఉంది", age_minutes=60 * 40)
        db.commit()
        assert (
            crawl_service.select_for_rewrite(
                db,
                cap=10,
                beat_quota={"national": 10},
                default_source_cap=10,
                max_age_hours=18,
            )
            == []
        )

    def test_disabled_crawl_calls_no_provider(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"crawl.enabled": False, "crawl.rewrite_enabled": True})
        fake = FakeAi()
        install_ai(monkeypatch, fake)
        source = make_source(db, slug="q-off", beat=SourceBeat.NATIONAL)
        make_item(db, source, guid="off1", title="ఆఫ్ ఉన్నప్పుడు వార్త ఇక్కడ")
        db.commit()

        out = crawl_service.run_rewrite_pass(db)
        assert out["skipped"] == "rewrite_disabled"
        assert fake.calls == 0


# --------------------------------------------------------------------------- #
# The mandal guess
# --------------------------------------------------------------------------- #
class TestMandalMatching:
    @staticmethod
    def _geo(db: Session) -> tuple[District, Mandal, Mandal]:
        district = db.scalars(select(District).limit(1)).one()
        other = db.scalars(
            select(District).where(District.id != district.id).limit(1)
        ).one()
        mandal = db.scalar(select(Mandal).where(Mandal.slug == "k-tenali"))
        if mandal is None:
            mandal = Mandal(
                district_id=district.id,
                slug="k-tenali",
                name_te="తెనాలి",
                name_en="Tenali",
            )
            db.add(mandal)
            db.flush()
            db.add(MandalAlias(mandal_id=mandal.id, alias="తెనాలీ"))
            twin = Mandal(
                district_id=other.id,
                slug="k-tenali-twin",
                name_te="తెనాలి",
                name_en="Tenali",
            )
            db.add(twin)
            second = Mandal(
                district_id=district.id,
                slug="k-repalle",
                name_te="రేపల్లె",
                name_en="Repalle",
            )
            db.add(second)
            db.flush()
            db.commit()
        second = db.scalar(select(Mandal).where(Mandal.slug == "k-repalle"))
        gazetteer_service.invalidate()
        return district, mandal, second

    def test_source_default_beats_a_keyword_hit(self, db: Session) -> None:
        district, mandal, second = self._geo(db)
        source = make_source(
            db, slug="m-pinned", district_id=district.id, mandal_id=second.id
        )
        db.commit()
        item = ingestion_service._store_entry(
            db,
            source,
            FeedEntry(guid="m1", title="తెనాలిలో సమావేశం జరిగింది", summary="వివరాలు"),
        )
        db.commit()
        assert item is not None
        assert item.matched_mandal_id == second.id
        assert item.mandal_match_method == MandalMatchMethod.SOURCE_DEFAULT
        assert item.mandal_match_confidence == 1.0

    def test_headline_hit_scores_higher_than_a_summary_hit(self, db: Session) -> None:
        district, mandal, _second = self._geo(db)
        assert gazetteer_service.resolve(
            db, title="తెనాలిలో భారీ వర్షం", district_id=district.id
        ) == (mandal.id, MandalMatchMethod.KEYWORD, 0.85)
        assert gazetteer_service.resolve(
            db, title="భారీ వర్షం", summary="తెనాలి పట్టణంలో", district_id=district.id
        ) == (mandal.id, MandalMatchMethod.KEYWORD, 0.6)

    def test_inflected_forms_still_match(self, db: Session) -> None:
        """Telugu is agglutinative — a place name is almost never written bare."""
        district, mandal, _second = self._geo(db)
        for headline in (
            "తెనాలిలో ఘటన",
            "తెనాలికి మంత్రి రాక",
            "తెనాలి మండలంలో ప్రమాదం",
            "తెనాలీ వార్తలు",
        ):
            found, method, _conf = gazetteer_service.resolve(
                db, title=headline, district_id=district.id
            )
            assert (found, method) == (mandal.id, MandalMatchMethod.KEYWORD), headline

    def test_two_distinct_mandals_is_ambiguous_not_a_coin_toss(
        self, db: Session
    ) -> None:
        district, _mandal, _second = self._geo(db)
        found, method, confidence = gazetteer_service.resolve(
            db, title="తెనాలి, రేపల్లె మధ్య రహదారి", district_id=district.id
        )
        assert found is None
        assert method == MandalMatchMethod.AMBIGUOUS
        assert confidence == 0.0

    def test_same_name_in_two_districts_is_ambiguous_without_scoping(
        self, db: Session
    ) -> None:
        self._geo(db)
        found, method, _c = gazetteer_service.resolve(db, title="తెనాలిలో ఘటన")
        assert found is None
        assert method == MandalMatchMethod.AMBIGUOUS

    def test_short_names_are_ignored(self, db: Session) -> None:
        district, _mandal, _second = self._geo(db)
        found, method, _c = gazetteer_service.resolve(
            db, title="తెనాలి సమావేశం", district_id=district.id, min_name_len=20
        )
        assert found is None
        assert method == MandalMatchMethod.NONE

    def test_autotag_off_means_no_guess(self, db: Session) -> None:
        district, _mandal, _second = self._geo(db)
        configure(db, **{"crawl.mandal_autotag": False})
        source = make_source(db, slug="m-noauto", district_id=district.id)
        db.commit()
        item = ingestion_service._store_entry(
            db, source, FeedEntry(guid="m2", title="తెనాలిలో ఘటన", summary="వివరాలు")
        )
        db.commit()
        assert item is not None
        assert item.matched_mandal_id is None
        assert item.mandal_match_method == MandalMatchMethod.NONE


# --------------------------------------------------------------------------- #
# The rewrite
# --------------------------------------------------------------------------- #
class TestRewrite:
    def test_sensitive_subject_never_reaches_a_provider(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The guard has to run *before* the money, not after."""
        configure(db, **{"crawl.enabled": True, "crawl.rewrite_enabled": True})
        fake = FakeAi()
        install_ai(monkeypatch, fake)
        source = make_source(db, slug="r-sensitive")
        item = make_item(
            db, source, guid="s1", title="మైనర్ బాలికపై అత్యాచారం కేసు నమోదు"
        )
        db.commit()

        rewrite = crawl_service.rewrite_one(db, item)
        db.commit()
        assert fake.calls == 0, "a sensitive item must not be sent to a provider"
        assert rewrite.status == RewriteStatus.HUMAN_ONLY
        assert item.requires_human is True

    def test_english_sensitive_terms_are_caught_too(self, db: Session) -> None:
        assert crawl_service.is_sensitive("Police register rape case") is True
        assert crawl_service.is_sensitive("communal tension in the town") is True
        assert crawl_service.is_sensitive("New road opens to traffic") is False

    def test_too_little_source_text_is_skipped_not_invented(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"crawl.rewrite_min_words": 45})
        fake = FakeAi()
        install_ai(monkeypatch, fake)
        source = make_source(db, slug="r-thin")
        item = make_item(db, source, guid="t1", title="చిన్న వార్త", summary="రెండు మాటలు")
        db.commit()

        rewrite = crawl_service.rewrite_one(db, item)
        db.commit()
        assert rewrite.status == RewriteStatus.SKIPPED
        assert fake.calls == 0

    def test_a_refusal_is_recorded_and_produces_no_copy(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_ai(
            monkeypatch,
            FakeAi(
                RewriteText(
                    title_te="",
                    summary_te="",
                    paragraphs_te=[],
                    refused=True,
                    refusal_reason="not enough reporting",
                )
            ),
        )
        source = make_source(db, slug="r-refuse")
        item = make_item(db, source, guid="rf1", title="ఏదో ఒక వార్త ఇక్కడ ఉంది")
        db.commit()

        rewrite = crawl_service.rewrite_one(db, item)
        db.commit()
        assert rewrite.status == RewriteStatus.REFUSED
        assert rewrite.body is None
        assert item.status == IngestStatus.NEW, "a refusal does not consume the item"

    def test_attribution_is_added_even_when_the_model_omits_it(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Never trust the model to attribute. It usually will; usually is not
        good enough when the failure is republishing without credit."""
        install_ai(monkeypatch, FakeAi())
        source = make_source(db, slug="r-credit")
        item = make_item(db, source, guid="c1")
        db.commit()

        rewrite = crawl_service.rewrite_one(db, item)
        db.commit()
        assert rewrite.status == RewriteStatus.READY
        assert source.name in (rewrite.body_plain or "")
        assert rewrite.attribution_te.startswith("మూలం:")

    def test_a_near_verbatim_telugu_rewrite_is_refused(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        source = make_source(db, slug="r-copy")
        item = make_item(
            db,
            source,
            guid="v1",
            title="ప్రభుత్వం కొత్త పథకాన్ని ప్రకటించింది",
            summary="ప్రభుత్వం కొత్త పథకాన్ని ప్రకటించింది. " * 20,
        )
        db.commit()
        install_ai(
            monkeypatch,
            FakeAi(
                RewriteText(
                    title_te="ప్రభుత్వం కొత్త పథకాన్ని ప్రకటించింది",
                    summary_te="ప్రభుత్వం కొత్త పథకాన్ని ప్రకటించింది.",
                    paragraphs_te=["ప్రభుత్వం కొత్త పథకాన్ని ప్రకటించింది. " * 20],
                    confidence=0.9,
                )
            ),
        )
        rewrite = crawl_service.rewrite_one(db, item)
        db.commit()
        assert rewrite.status == RewriteStatus.REFUSED
        assert "too_similar_to_source" in (rewrite.refusal_reason or "")

    def test_the_keyless_provider_degrades_and_never_fabricates(self) -> None:
        from app.integrations.ai.heuristic import HeuristicAi

        result = HeuristicAi().rewrite_item(
            headline="A headline",
            body_text="Only these words exist in the source.",
            publisher="Publisher",
            source_url="https://example.com/1",
        )
        assert result.refused is False
        assert result.unverified is True
        assert result.confidence < 0.2
        joined = " ".join(result.paragraphs_te)
        assert "Only these words exist" in joined
        assert "Publisher" in joined


# --------------------------------------------------------------------------- #
# Licence — the compliance boundary
# --------------------------------------------------------------------------- #
class TestLicenceAndHtmlFallback:
    def test_excerpt_only_source_never_stores_extracted_body(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The most important test in this file.

        The fallback may *read* a publisher's page to build a prompt. For a
        source with no republication licence it must not write a single word of
        that text to the database — not truncated, absent.
        """
        configure(db, **{"crawl.html_fallback_enabled": True})
        install_ai(monkeypatch, FakeAi())
        monkeypatch.setattr(
            "app.services.crawl_service.extract_article",
            lambda *_a, **_k: PageText(
                status="ok",
                text="The publisher's full article body. " * 40,
                method="jsonld",
                word_count=200,
            ),
        )
        source = make_source(
            db,
            slug="l-excerpt",
            licence=SourceLicence.RSS_PUBLIC,
            policy=ContentPolicy.EXCERPT_ONLY,
            html_fallback=True,
            note="checked terms",
        )
        item = make_item(db, source, guid="x1", summary="short stub", language="en")
        db.commit()

        rewrite = crawl_service.rewrite_one(db, item)
        db.commit()
        db.refresh(item)
        assert rewrite.status == RewriteStatus.READY
        assert item.content_html is None, "unlicensed text must never be persisted"
        assert item.word_count == 0

    def test_a_licensed_source_does_store_the_extracted_body(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"crawl.html_fallback_enabled": True})
        install_ai(monkeypatch, FakeAi())
        monkeypatch.setattr(
            "app.services.crawl_service.extract_article",
            lambda *_a, **_k: PageText(
                status="ok",
                text="Licensed body text.<script>alert(1)</script> " * 30,
                method="jsonld",
                word_count=120,
            ),
        )
        source = make_source(
            db,
            slug="l-full",
            licence=SourceLicence.AGENCY_CONTRACT,
            policy=ContentPolicy.FULL_TEXT,
            note="Wire contract 2026-14",
            html_fallback=True,
        )
        item = make_item(db, source, guid="y1", summary="stub", language="en")
        db.commit()

        crawl_service.rewrite_one(db, item)
        db.commit()
        db.refresh(item)
        assert item.content_html is not None
        assert "<script>" not in item.content_html

    def test_fallback_disabled_globally_never_fetches(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"crawl.html_fallback_enabled": False})
        install_ai(monkeypatch, FakeAi())
        calls = {"n": 0}

        def _boom(*_a, **_k):
            calls["n"] += 1
            raise AssertionError("must not fetch when the global switch is off")

        monkeypatch.setattr("app.services.crawl_service.extract_article", _boom)
        source = make_source(db, slug="l-off", html_fallback=True, note="note")
        make_item(db, source, guid="z1", summary="short")
        db.commit()
        assert calls["n"] == 0

    def test_html_fallback_requires_a_written_licence_note(
        self, db: Session, client: TestClient
    ) -> None:
        headers = staff_headers(db, role=RoleKey.ADMIN, email="crawl-admin@test.local")
        response = client.post(
            "/api/v1/cms/sources",
            headers=headers,
            json={
                "slug": "l-nonote",
                "name": "No Note",
                "feed_url": "https://publisher.example.com/n.xml",
                "allow_html_fallback": True,
            },
        )
        assert response.status_code == 422
        assert "licence_note" in str(response.json())


# --------------------------------------------------------------------------- #
# The editorial gate
# --------------------------------------------------------------------------- #
class TestEditorialGate:
    def _rewritten_item(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, slug: str
    ) -> IngestedItem:
        install_ai(monkeypatch, FakeAi())
        source = make_source(db, slug=slug)
        item = make_item(db, source, guid=f"{slug}-1")
        db.commit()
        crawl_service.rewrite_one(db, item)
        db.commit()
        return item

    def test_import_lands_in_review_with_provenance_and_credit(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._rewritten_item(db, monkeypatch, "g-import")
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.commit()

        assert article.workflow_state == WorkflowState.SUBMITTED
        assert article.status == ArticleStatus.PENDING
        assert article.article_type == ArticleType.AI_REWRITE
        assert article.ai_generated is True
        assert article.source_credit == item.source.name
        assert article.canonical_url == item.canonical_url
        assert article.published_at is None

    def test_an_imported_rewrite_is_not_visible_to_readers(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._rewritten_item(db, monkeypatch, "g-hidden")
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.commit()
        assert client.get(f"/api/v1/public/articles/{article.short_id}").status_code == 404

    def test_use_rewrite_false_keeps_the_old_excerpt_behaviour(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._rewritten_item(db, monkeypatch, "g-optout")
        article = ingestion_service.import_item(
            db, item, actor_id=None, use_rewrite=False
        )
        db.commit()
        assert article.workflow_state == WorkflowState.DRAFT
        assert article.article_type == ArticleType.SYNDICATED
        assert article.ai_generated is False

    def test_the_importing_editor_cannot_approve_their_own_import(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = self._rewritten_item(db, monkeypatch, "g-self")
        headers = staff_headers(
            db, role=RoleKey.EDITOR_IN_CHIEF, email="crawl-eic@test.local"
        )
        assert headers
        editor = db.scalar(select(User).where(User.email == "crawl-eic@test.local"))
        article = ingestion_service.import_item(db, item, actor_id=editor.id)
        db.commit()

        principal = build_principal(editor, "test-session")
        with pytest.raises(ValidationError):
            workflow_service.transition(
                db, principal, article, "approve", None
            )

    def test_two_people_are_required_even_when_nobody_wrote_it(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A machine article has no author, so the author-vs-approver check
        cannot bite. Without this rule one person approves and publishes alone."""
        item = self._rewritten_item(db, monkeypatch, "g-authorless")
        article = ingestion_service.import_item(db, item, actor_id=None)
        article.author_id = None
        db.flush()

        alice = db.scalar(select(User).where(User.email == "crawl-eic@test.local"))
        principal = build_principal(alice, "test-session")
        workflow_service.transition(
                db, principal, article, "review", None
            )
        workflow_service.transition(
                db, principal, article, "approve", None
            )
        db.flush()
        assert article.approved_by == alice.id

        with pytest.raises(ValidationError):
            workflow_service.transition(
                db, principal, article, "publish", None
            )

    def test_no_crawl_or_ingestion_route_publishes(self, client: TestClient) -> None:
        offenders = [
            route.path
            for route in app.routes
            if ("/cms/crawl" in getattr(route, "path", ""))
            or ("/cms/ingestion" in getattr(route, "path", ""))
            if "publish" in getattr(route, "path", "")
        ]
        assert offenders == []

    def test_no_permission_key_grants_a_bypass(self) -> None:
        from app.core.permissions import (
            FORBIDDEN_PERMISSION_SUBSTRINGS,
            PERMISSION_KEYS,
        )

        for key in PERMISSION_KEYS:
            for banned in FORBIDDEN_PERMISSION_SUBSTRINGS:
                assert banned not in key


# --------------------------------------------------------------------------- #
# Settings and concurrency
# --------------------------------------------------------------------------- #
class TestSettingsAndConcurrency:
    def test_counts_coercion_rejects_a_wrong_shape(self, db: Session) -> None:
        good = dict(settings_service.SPECS["crawl.beat_quota"].default)
        assert settings_service._coerce("crawl.beat_quota", good) == good
        for bad in (
            dict(good, unexpected=1),
            {"national": 1},
            dict(good, national=-1),
            dict(good, national=True),
            [1, 2, 3],
        ):
            with pytest.raises(ValidationError):
                settings_service._coerce("crawl.beat_quota", bad)

    def test_counts_do_not_have_to_total_anything(self, db: Session) -> None:
        """Unlike feed ratios. 'How many an hour' is a count, not a share, and
        forcing a total would make changing one beat silently change another."""
        quota = dict(settings_service.SPECS["crawl.beat_quota"].default)
        quota["national"] = 500
        assert settings_service._coerce("crawl.beat_quota", quota)["national"] == 500

    def test_fetch_many_writes_on_the_calling_thread(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sources = [
            make_source(db, slug=f"t-thread-{i}", beat=SourceBeat.NATIONAL)
            for i in range(5)
        ]
        db.commit()
        monkeypatch.setattr(
            "app.services.crawl_service.fetch_feed",
            lambda *_a, **_k: FeedResult(
                entries=[
                    FeedEntry(guid="th1", title="ఒక వార్త ఇక్కడ", summary="సారాంశం")
                ]
            ),
        )
        results = crawl_service.fetch_many(db, sources, workers=4)
        db.commit()
        assert len(results) == 5
        assert all(r["status"] == "ok" for r in results)

    def test_throttle_serialises_one_host_but_not_many(self) -> None:
        import threading
        import time

        from app.integrations.feeds import fetcher

        fetcher._last_hit.clear()
        start = time.monotonic()
        threads = [
            threading.Thread(target=fetcher._throttle, args=("https://one.example/f",))
            for _ in range(3)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        same_host = time.monotonic() - start
        assert same_host >= 2 * fetcher._MIN_HOST_INTERVAL_SECONDS - 0.3

        fetcher._last_hit.clear()
        start = time.monotonic()
        threads = [
            threading.Thread(
                target=fetcher._throttle, args=(f"https://h{i}.example/f",)
            )
            for i in range(3)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert time.monotonic() - start < 1.0, "different hosts must not serialise"


# --------------------------------------------------------------------------- #
# Admin surface
# --------------------------------------------------------------------------- #
class TestAdminSurface:
    def test_status_reports_quota_and_staleness(
        self, db: Session, client: TestClient
    ) -> None:
        headers = staff_headers(db, role=RoleKey.ADMIN, email="crawl-admin@test.local")
        body = client.get("/api/v1/cms/crawl/status", headers=headers).json()
        assert "beats" in body and "used_this_hour" in body
        assert {b["beat"] for b in body["beats"]} == {b.value for b in SourceBeat}
        assert "stale" in body

    def test_run_is_refused_while_the_crawl_is_off(
        self, db: Session, client: TestClient
    ) -> None:
        configure(db, **{"crawl.enabled": False})
        headers = staff_headers(db, role=RoleKey.ADMIN, email="crawl-admin@test.local")
        response = client.post(
            "/api/v1/cms/crawl/run", headers=headers, json={"fetch": False}
        )
        assert response.status_code == 422

    def test_queue_row_shows_the_guess_and_the_rewrite(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_ai(monkeypatch, FakeAi())
        source = make_source(db, slug="a-queue")
        item = make_item(db, source, guid="aq1")
        db.commit()
        crawl_service.rewrite_one(db, item)
        db.commit()

        headers = staff_headers(db, role=RoleKey.ADMIN, email="crawl-admin@test.local")
        body = client.get(
            "/api/v1/cms/ingestion/queue?has_rewrite=true", headers=headers
        ).json()
        rows = [r for r in body["items"] if r["id"] == item.id]
        assert rows, "the rewritten item should be listed"
        row = rows[0]
        assert row["rewrite"]["status"] == RewriteStatus.READY
        assert row["mandal"]["method"] in {m.value for m in MandalMatchMethod}
        assert row["rewrite"]["engine"] == "fake"


def test_rewrite_history_is_kept(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Attempts accumulate. A refusal then a success is two rows, because an
    editor may want to know the first answer was no."""
    source = make_source(db, slug="h-history")
    item = make_item(db, source, guid="h1")
    db.commit()

    install_ai(
        monkeypatch,
        FakeAi(
            RewriteText(
                title_te="", summary_te="", paragraphs_te=[], refused=True,
                refusal_reason="declined",
            )
        ),
    )
    crawl_service.rewrite_one(db, item)
    db.commit()

    install_ai(monkeypatch, FakeAi())
    crawl_service.rewrite_one(db, item, force=True)
    db.commit()

    rows = db.scalars(
        select(IngestedRewrite).where(IngestedRewrite.item_id == item.id)
    ).all()
    assert len(rows) == 2
    assert {r.status for r in rows} == {RewriteStatus.REFUSED, RewriteStatus.READY}
    assert item.ready_rewrite is not None


def test_an_article_imported_without_a_credit_cannot_publish(db: Session) -> None:
    """Regression guard on the pre-existing §17 rule."""
    article = Article(
        short_id="nocred",
        slug="no-credit",
        title_te="శీర్షిక",
        body={"type": "doc", "content": []},
        status=ArticleStatus.PENDING,
        workflow_state=WorkflowState.APPROVED,
        source_type="syndicated",
        source_credit=None,
    )
    db.add(article)
    db.flush()
    editor = db.scalar(select(User).where(User.email == "crawl-eic@test.local"))
    article.approved_by = editor.id if editor else None
    db.flush()
    principal = build_principal(editor, "test-session")
    with pytest.raises(ValidationError):
        workflow_service.transition(
                db, principal, article, "publish", None
            )
