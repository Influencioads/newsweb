"""Crawl enrichment at import — the AI's filing, the claim, and the AI drawing.

What must hold, in order of the damage it prevents:

  * `is_breaking` is never set by a machine; `breaking_suggested` is all it gets;
  * a person tag is never created from a model's say-so;
  * one story cannot become two articles (the claim), nor be rejected under
    the article it already became;
  * the automatic picture never runs from a web request, is only the incident
    prompt's generic scene for crime or death, never for a sensitive topic,
    stops at its daily cap, and never edits a crawled photograph.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.deps import build_principal  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import seed_permissions, seed_roles  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.ai.base import ImageVerdict  # noqa: E402
from app.integrations.ai.image import GeneratedImage  # noqa: E402
from app.integrations.storage import StoredObject  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ai import AiUsage  # noqa: E402
from app.models.content import (  # noqa: E402
    Article,
    ArticleTag,
    ArticleVersion,
    Category,
    Tag,
    WorkflowTransition,
)
from app.models.enums import (  # noqa: E402
    IngestStatus,
    MediaType,
    RewriteStatus,
    RoleKey,
    ScopeType,
    SourceLicence,
    TagType,
    UserStatus,
)
from app.models.geo import District, Mandal  # noqa: E402
from app.models.ingestion import (  # noqa: E402
    ContentSource,
    IngestedItem,
    IngestedRewrite,
)
from app.models.media import ArticleMedia, Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import (  # noqa: E402
    ai_image_service,
    auth_service,
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


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    seed_roles(session, seed_permissions(session))
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


@pytest.fixture(scope="module")
def geo(db: Session) -> dict[str, int]:
    """Two sections with a child each, crime, and two districts with a mandal."""
    politics = Category(slug="enr-politics", name_te="రాజకీయం", name_en="Politics")
    sport = Category(slug="enr-sport", name_te="క్రీడలు", name_en="Sport")
    crime = Category(slug="crime", name_te="క్రైమ్", name_en="Crime")
    db.add_all([politics, sport, crime])
    db.flush()
    cricket = Category(slug="enr-cricket", name_te="క్రికెట్", name_en="Cricket", parent_id=sport.id)
    assembly = Category(
        slug="enr-assembly", name_te="అసెంబ్లీ", name_en="Assembly", parent_id=politics.id
    )
    guntur = District(state="AP", slug="enr-guntur", name_te="గుంటూరు", name_en="Guntur")
    krishna = District(state="AP", slug="enr-krishna", name_te="కృష్ణా", name_en="Krishna")
    db.add_all([cricket, assembly, guntur, krishna])
    db.flush()
    tenali = Mandal(district_id=guntur.id, slug="enr-tenali", name_te="తెనాలి", name_en="Tenali")
    db.add(tenali)
    db.commit()
    return {
        "politics": politics.id,
        "sport": sport.id,
        "crime": crime.id,
        "cricket": cricket.id,
        "assembly": assembly.id,
        "guntur": guntur.id,
        "krishna": krishna.id,
        "tenali": tenali.id,
    }


@pytest.fixture(autouse=True)
def _purge(db: Session) -> Iterator[None]:
    """Everything a test creates goes, tags and media included."""
    yield
    db.rollback()
    for model in (
        ArticleTag,
        ArticleMedia,
        ArticleVersion,
        WorkflowTransition,
        Article,
        Media,
        Tag,
        AiUsage,
        IngestedRewrite,
        IngestedItem,
        ContentSource,
        AppSetting,
    ):
        db.query(model).delete()
    db.commit()
    # SQLite reuses the ids, so a stale object must not answer for a new row.
    db.expunge_all()
    settings_service.invalidate()


def configure(db: Session, **values: object) -> None:
    settings_service.set_many(db, values, actor_id=None)
    db.commit()


def staff(db: Session, email: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        role = db.scalar(select(Role).where(Role.key == RoleKey.EDITOR_IN_CHIEF.value))
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id, scope_type=ScopeType.GLOBAL))
        db.commit()
    db.refresh(user)
    return user


def headers(db: Session, email: str) -> dict[str, str]:
    _s, access, _r, _e = auth_service.create_session(db, staff(db, email))
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def queued(
    db: Session,
    slug: str,
    *,
    cls: dict | None = None,
    title: str = "గ్రామంలో కొత్త రోడ్డు ప్రారంభం",
    default_category_id: int | None = None,
    rewrite: bool = True,
) -> IngestedItem:
    source = ContentSource(
        slug=slug,
        name=slug.title(),
        feed_url=f"https://publisher.example.com/{slug}.xml",
        licence=SourceLicence.RSS_PUBLIC,
        default_category_id=default_category_id,
    )
    item = IngestedItem(
        source=source,
        guid=f"{slug}-1",
        url=f"https://publisher.example.com/{slug}",
        canonical_url=f"https://publisher.example.com/{slug}",
        title=title,
        summary="ఒక చిన్న సారాంశం.",
        fetched_at=utcnow(),
        content_hash=f"hash-{slug}",
        status=IngestStatus.NEW,
    )
    if rewrite:
        item.rewrites.append(
            IngestedRewrite(
                title_te=title,
                summary_te="మన సొంత సారాంశం.",
                engine="llm",
                model="test-model",
                confidence=0.8,
                status=RewriteStatus.READY,
                classification=cls,
            )
        )
    db.add(item)
    db.commit()
    return item


def _cls(**over: object) -> dict:
    base = {
        "category_id": None,
        "subcategory_id": None,
        "district_id": None,
        "mandal_id": None,
        "tags": [],
        "breaking": False,
        "glyph_warning": False,
        "raw": {},
    }
    return {**base, **over}


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (800, 450), "navy").save(buf, format="PNG")
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# The AI's filing
# --------------------------------------------------------------------------- #
class TestClassification:
    def test_the_ai_section_beats_the_source_default(self, db: Session, geo: dict) -> None:
        item = queued(
            db,
            "c-section",
            cls=_cls(category_id=geo["sport"], subcategory_id=geo["cricket"]),
            default_category_id=geo["politics"],
        )
        article = ingestion_service.import_item(db, item, actor_id=None)
        assert article.category_id == geo["sport"]
        assert article.subcategory_id == geo["cricket"]

    def test_an_explicit_section_beats_the_ai_and_drops_a_foreign_child(
        self, db: Session, geo: dict
    ) -> None:
        item = queued(
            db, "c-explicit", cls=_cls(category_id=geo["sport"], subcategory_id=geo["cricket"])
        )
        article = ingestion_service.import_item(
            db, item, actor_id=None, category_id=geo["politics"]
        )
        assert article.category_id == geo["politics"]
        assert article.subcategory_id is None, "cricket is not a child of politics"

    def test_an_inactive_ai_section_falls_back_to_the_source(
        self, db: Session, geo: dict
    ) -> None:
        sport = db.get(Category, geo["sport"])
        sport.is_active = False
        db.commit()
        try:
            item = queued(
                db, "c-inactive", cls=_cls(category_id=geo["sport"]),
                default_category_id=geo["politics"],
            )
            article = ingestion_service.import_item(db, item, actor_id=None)
            assert article.category_id == geo["politics"]
        finally:
            sport.is_active = True
            db.commit()

    def test_the_district_follows_the_mandal(self, db: Session, geo: dict) -> None:
        item = queued(
            db, "c-place", cls=_cls(mandal_id=geo["tenali"], district_id=geo["krishna"])
        )
        article = ingestion_service.import_item(db, item, actor_id=None)
        assert article.mandal_id == geo["tenali"]
        assert article.district_id == geo["guntur"]

    def test_an_explicit_district_drops_a_mandal_nobody_chose(
        self, db: Session, geo: dict
    ) -> None:
        item = queued(db, "c-conflict", cls=_cls(mandal_id=geo["tenali"]))
        article = ingestion_service.import_item(
            db, item, actor_id=None, district_id=geo["krishna"]
        )
        assert article.district_id == geo["krishna"]
        assert article.mandal_id is None

    def test_tags_are_created_inactive_typed_and_never_as_a_person(
        self, db: Session, geo: dict
    ) -> None:
        known = Tag(slug="enr-known", name_te="తెలిసిన", name_en="Known", type=TagType.ORG)
        db.add(known)
        db.commit()
        item = queued(
            db,
            "c-tags",
            cls=_cls(
                tags=[
                    {"name": "తెలిసిన", "type": "org", "tag_id": known.id},
                    {"name": "Tenali Fair", "type": "event", "tag_id": None},
                    {"name": "Some Politician", "type": "person", "tag_id": None},
                ]
            ),
        )
        article = ingestion_service.import_item(db, item, actor_id=None)
        db.flush()

        tags = {link.tag.slug: link.tag for link in article.tags}
        assert "enr-known" in tags and tags["enr-known"].is_active
        new = [t for slug, t in tags.items() if slug != "enr-known"]
        assert len(new) == 1, f"expected only the event tag, got {list(tags)}"
        assert new[0].type == TagType.EVENT and new[0].is_active is False
        assert db.scalar(select(Tag).where(Tag.type == TagType.PERSON)) is None

    def test_breaking_is_suggested_never_set(self, db: Session, geo: dict) -> None:
        item = queued(db, "c-breaking", cls=_cls(breaking=True))
        article = ingestion_service.import_item(db, item, actor_id=None)
        assert article.breaking_suggested is True
        assert article.is_breaking is False

    def test_no_classification_is_todays_behaviour(self, db: Session, geo: dict) -> None:
        item = queued(db, "c-none", default_category_id=geo["politics"])
        article = ingestion_service.import_item(db, item, actor_id=None)
        assert article.category_id == geo["politics"]
        assert article.subcategory_id is None
        assert article.tags == []
        assert article.breaking_suggested is False
        assert article.correction_note_te is None

    def test_publishing_activates_the_tags_the_crawl_created(
        self, db: Session, geo: dict
    ) -> None:
        item = queued(
            db, "c-publish", cls=_cls(tags=[{"name": "Tenali Fair", "type": "event", "tag_id": None}])
        )
        article = ingestion_service.import_item(db, item, actor_id=None)
        hero = Media(type=MediaType.IMAGE, filename="h.webp", mime="image/webp",
                     storage_provider="test", storage_key=f"images/test/{article.id}.webp")
        db.add(hero)
        db.flush()
        article.hero_media_id = hero.id
        db.commit()
        tag = article.tags[0].tag
        assert tag.is_active is False

        alice = build_principal(staff(db, "enr-alice@test.local"), "s1")
        bob = build_principal(staff(db, "enr-bob@test.local"), "s2")
        workflow_service.transition(db, alice, article, "approve", None)
        workflow_service.transition(db, bob, article, "publish", None)
        db.commit()
        assert tag.is_active is True


# --------------------------------------------------------------------------- #
# The claim
# --------------------------------------------------------------------------- #
class TestClaim:
    def test_only_one_claim_wins(self, db: Session, geo: dict) -> None:
        item = queued(db, "k-double")
        assert ingestion_service.claim_item(db, item.id) is True
        assert ingestion_service.claim_item(db, item.id) is False

    def test_a_lock_wait_timeout_is_a_lost_claim(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """InnoDB's 1205 while the winner is still importing is a 409, not a
        500; any other database error still raises."""

        def _fail(code: int) -> object:
            def execute(*_a: object, **_k: object) -> None:
                raise OperationalError("UPDATE ingested_items", {}, Exception(code, "boom"))

            return execute

        monkeypatch.setattr(db, "execute", _fail(1205))
        assert ingestion_service.claim_item(db, 1) is False
        monkeypatch.setattr(db, "execute", _fail(2013))
        with pytest.raises(OperationalError):
            ingestion_service.claim_item(db, 1)

    def test_the_cms_cannot_import_a_claimed_item(
        self, db: Session, client: TestClient, geo: dict
    ) -> None:
        item = queued(db, "k-cms")
        auth = headers(db, "enr-editor@test.local")
        assert ingestion_service.claim_item(db, item.id)
        db.commit()
        r = client.post(f"/api/v1/cms/ingestion/{item.id}/import", headers=auth)
        assert r.status_code == 409
        assert r.json()["error"]["message_te"]
        assert db.query(Article).count() == 0

    def test_an_item_in_review_cannot_be_rejected(
        self, db: Session, client: TestClient, geo: dict
    ) -> None:
        item = queued(db, "k-reject")
        auth = headers(db, "enr-editor@test.local")
        assert client.post(f"/api/v1/cms/ingestion/{item.id}/import", headers=auth).status_code == 201
        r = client.post(
            f"/api/v1/cms/ingestion/{item.id}/reject", json={"note": "no"}, headers=auth
        )
        assert r.status_code == 409
        db.refresh(item)
        assert item.status == IngestStatus.IMPORTED and item.article_id


# --------------------------------------------------------------------------- #
# The AI drawing
# --------------------------------------------------------------------------- #
class _Drawing:
    key = "aimlapi"

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def available(self) -> bool:
        return True

    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        self.prompts.append(prompt)
        return GeneratedImage(
            raw=_png(), mime="image/png", model="openai/gpt-image-1.5",
            usage={"usd_spent": 0.02},
        )

    def edit(self, *_a: object, **_k: object) -> None:
        raise AssertionError("a crawled photo must never go to an image edit model")


class _Storage:
    key = "test"

    def put(self, key: str, raw: bytes, **kw: object) -> StoredObject:
        return StoredObject(key=key, url=f"https://cdn.example/{key}", bytes=len(raw),
                            provider="test", content_type=str(kw.get("content_type") or ""))


class _Ledger:
    """What `session_scope` committed on its own connection.

    This SQLite is one StaticPool connection, so a real second session would
    share the import's transaction and prove nothing. Rows kept here are the
    ones no rollback of the import can take away.
    """

    def __init__(self) -> None:
        self.rows: list[AiUsage] = []

    def add(self, row: AiUsage) -> None:
        self.rows.append(row)

    def flush(self) -> None:
        pass


class TestIllustration:
    @pytest.fixture(autouse=True)
    def _drawing(self, db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        self.storage = _Storage()
        monkeypatch.setattr(
            "app.services.media_service.get_storage", lambda *_a, **_k: self.storage
        )
        self.drawing = _Drawing()
        monkeypatch.setattr(ai_image_service, "get_image", lambda **_k: self.drawing)
        # Which prompt each draw asked for, the real draw still made.
        self.incident: list[bool] = []
        real = ai_image_service.generate_for_article

        def _spy(*a: object, **k: object) -> Media:
            self.incident.append(bool(k.get("incident")))
            return real(*a, **k)

        monkeypatch.setattr(ai_image_service, "generate_for_article", _spy)
        self.ledger = _Ledger()

        @contextmanager
        def _apart() -> Iterator[_Ledger]:
            yield self.ledger

        monkeypatch.setattr(ai_image_service, "session_scope", _apart)
        monkeypatch.setattr(ingestion_service, "session_scope", _apart)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": True,
                         "crawl.ai_illustrations": True})
        yield

    def test_a_story_with_no_photo_gets_a_labelled_drawing(
        self, db: Session, geo: dict
    ) -> None:
        item = queued(db, "i-draw", cls=_cls())
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        db.flush()

        hero = db.get(Media, article.hero_media_id)
        assert hero.ai_generated is True
        assert hero.meta["representative"] is True
        assert db.query(ArticleMedia).filter_by(
            article_id=article.id, media_id=hero.id, role="hero"
        ).count() == 1
        assert [(r.operation, r.ok) for r in self.ledger.rows] == [("crawl_image", True)]
        assert db.query(AiUsage).count() == 0, "billed apart, not in the import"
        assert item.photo_check["hero"] == "ai_illustration"
        assert article.is_breaking is False
        assert self.incident == [False], "a road opening is not an incident"

    def test_a_drawing_paid_for_stays_billed_when_filing_it_fails(
        self, db: Session, geo: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A storage outage after the draw rolls the media savepoint back. The
        vendor has billed by then, and the cap and budget count this row."""

        def _outage(*_a: object, **_k: object) -> None:
            raise OSError("disk full")

        monkeypatch.setattr(self.storage, "put", _outage)
        item = queued(db, "i-outage", cls=_cls())
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        assert article.hero_media_id is None and item.photo_check["hero"] == "none"
        assert len(self.drawing.prompts) == 1
        db.rollback()  # the pass's own rollback, had anything later failed
        assert [(r.operation, r.ok) for r in self.ledger.rows] == [("crawl_image", True)]

    def test_a_branded_photo_is_rejected_and_never_edited(
        self, db: Session, geo: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The hard line: the drawing comes from the headline, never the photo."""
        configure(db, **{"crawl.image_scan": True})
        item = queued(db, "i-branded", cls=_cls())
        item.source.images_enabled = True
        item.image_urls = ["https://publisher.example.com/img/branded.jpg"]
        db.commit()

        class _Vision:
            key = "fake"

            def inspect_image(self, raw: bytes) -> ImageVerdict:
                return ImageVerdict("watermark", "channel logo bottom right")

        monkeypatch.setattr("app.services.ingestion_service.get_ai", lambda *_a, **_k: _Vision())
        monkeypatch.setattr(
            ingestion_service, "_download_image",
            lambda url: (_png(), "image/png", url),
        )
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        db.flush()

        hero = db.get(Media, article.hero_media_id)
        assert hero.ai_generated is True
        assert len(self.drawing.prompts) == 1
        assert item.photo_check["candidates"][0]["verdict"] == "watermark"
        assert db.query(Media).filter_by(source_type="syndicated").count() == 0
        # The vision call and the drawing, both committed apart from the import.
        assert [r.operation for r in self.ledger.rows] == ["image_check", "crawl_image"]

    def test_not_drawn_unless_the_caller_asks(self, db: Session, geo: dict) -> None:
        """The web import never passes `illustrate`, so it never pays for one."""
        item = queued(db, "i-web", cls=_cls())
        article = ingestion_service.import_item(db, item, actor_id=None)
        assert article.hero_media_id is None
        assert self.drawing.prompts == []
        assert item.photo_check["hero"] == "none"

    def test_not_drawn_at_the_daily_cap(self, db: Session, geo: dict) -> None:
        """One drawn earlier today and a cap of one: the count is what stops it."""
        configure(db, **{"crawl.ai_illustration_daily_cap": 1})
        db.add(AiUsage(operation="crawl_image", provider="aimlapi", ok=True))
        db.commit()
        item = queued(db, "i-cap", cls=_cls())
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        assert article.hero_media_id is None
        assert self.drawing.prompts == []

    def _incident_hero(self, db: Session, article: Article) -> None:
        """One draw, from the incident prompt, labelled AI and representative."""
        hero = db.get(Media, article.hero_media_id)
        assert hero.ai_generated is True and hero.meta["representative"] is True
        assert self.incident == [True]
        assert len(self.drawing.prompts) == 1

    def test_a_crime_story_gets_the_incident_picture(self, db: Session, geo: dict) -> None:
        item = queued(db, "i-crime", cls=_cls(category_id=geo["crime"]))
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        self._incident_hero(db, article)

    def test_a_crime_source_the_model_filed_elsewhere_is_still_an_incident(
        self, db: Session, geo: dict
    ) -> None:
        item = queued(
            db, "i-crime-desk", cls=_cls(category_id=geo["politics"]),
            default_category_id=geo["crime"],
        )
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        assert article.category_id == geo["politics"]
        self._incident_hero(db, article)

    @pytest.mark.parametrize(
        ("n", "title"),
        enumerate(
            [
                "రోడ్డు ప్రమాదంలో ఇద్దరు మృతి",
                "Two killed as bus overturns",
                "హైదరాబాద్‌లో బాంబు పేలుడు, ముగ్గురు చనిపోయారు",
                "ఉగ్రవాదుల కాల్పులు",
                "సీనియర్ నేత కన్నుమూత",
                "వరదల్లో కొట్టుకుపోయిన ఇద్దరు",
                "గోదావరిలో పడవ బోల్తా — 12 మంది గల్లంతు",
                "బస్సు దగ్ధం, మంటల్లో కాలిపోయిన వాహనం",
                "పాత భవనం కూలింది",
            ]
        ),
    )
    def test_a_death_or_an_accident_gets_the_incident_picture(
        self, db: Session, geo: dict, n: int, title: str
    ) -> None:
        item = queued(db, f"i-stop-{n}", cls=_cls(), title=title)
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        self._incident_hero(db, article)

    def test_an_incident_only_the_body_names_is_still_one(
        self, db: Session, geo: dict
    ) -> None:
        """"Inquiry opens in the village" names nothing; the body does."""
        item = queued(db, "i-stop-body", cls=_cls(), title="గ్రామంలో విచారణ ప్రారంభం")
        item.summary = "నిన్న జరిగిన ఘటనలో ఇద్దరు చనిపోయారు."
        db.commit()
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        assert "చనిపోయారు" in article.body_plain
        self._incident_hero(db, article)

    @pytest.mark.parametrize(
        ("n", "title"),
        enumerate(
            [
                # Measured on the local DB: each was an "incident" on a bare
                # substring, and would have run an ambulance as its hero.
                "కూరగాయల ధరలు భారీగా పెరిగాయి",  # గాయ
                "ఎన్నికలు ప్రశాంతంగా జరిగాయి",  # గాయ
                "ప్రముఖ గాయని సునీత సంగీత కచేరీ",  # గాయ
                "గాయకుడు ఎస్పీ చరణ్ కొత్త ఆల్బమ్",  # గాయ
                "గాయత్రి మంత్ర పఠనంతో ఆలయ వార్షికోత్సవం",  # గాయ
                "విమానాలు సురక్షితంగా దిగాయి",  # గాయ
                "గోవింద నామస్మరణతో మార్మోగిన ఆలయం",  # మరణ
                "స్మృతి మంధాన సెంచరీ",  # మృతి
                "మృత్యుంజయ హోమం",  # మృత్యు
                "ఉగ్రరూపం దాల్చిన గోదావరి",  # ఉగ్ర
                "దాడిశెట్టి రాజా పర్యటన",  # దాడి
                "ప్రమాదకర రసాయనాలపై నిషేధం",  # ప్రమాద, danger
                "Rythu Bharosa application deadline extended",  # dead
            ]
        ),
    )
    def test_a_word_inside_an_ordinary_word_is_not_an_incident(
        self, db: Session, geo: dict, n: int, title: str
    ) -> None:
        item = queued(db, f"i-plain-{n}", cls=_cls(), title=title)
        ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        assert self.incident == [False]

    @pytest.mark.parametrize(
        ("n", "title", "section"),
        [
            (0, "Caste leaders meet in town", None),
            # An incident too, but the sensitive screen outranks the prompt.
            (1, "అత్యాచారం కేసులో నిందితుడు అరెస్ట్", "crime"),
            # The spellings `ai.sensitive` missed, now that crime is drawn.
            (2, "పోక్సో కేసులో నిందితుడు అరెస్ట్", "crime"),
            (3, "రేప్ కేసులో నిందితుడు అరెస్ట్", "crime"),
        ],
    )
    def test_a_sensitive_refusal_is_swallowed(
        self, db: Session, geo: dict, n: int, title: str, section: str | None
    ) -> None:
        cls = _cls(category_id=geo[section]) if section else _cls()
        item = queued(db, f"i-sensitive-{n}", cls=cls, title=title)
        article = ingestion_service.import_item(db, item, actor_id=None, illustrate=True)
        assert article.id is not None and article.hero_media_id is None
        assert self.incident == [section == "crime"], "asked, then refused"
        assert self.drawing.prompts == []
        assert self.ledger.rows == [], "a refused topic costs nothing"
        assert item.status == IngestStatus.IMPORTED
