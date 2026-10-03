"""The creative studio: an AI design, the story's real photo, our own words.

What each test guards, because each of these fails silently:

  * the reference designs must reach the model as uploaded files on the edit
    route — sent as JSON to the generations route they are simply ignored,
    and the bill arrives anyway;
  * a model other than gpt-image has no edit route, so it must be refused
    before anything is sent or billed;
  * a figure the story never gave, on a card, is read as fact — the copy
    guard must catch Latin and Telugu digits alike;
  * a backdrop is decoration: it must never become the story's hero, never
    show up in the hero picker, and never be drawn for a sensitive story;
  * a text edit must re-render over the same backdrop, not buy another.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.errors import AiSensitiveTopicError, ValidationError  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.ai.base import CardText  # noqa: E402
from app.integrations.ai.image import EDIT_IMAGE_FIELD, AimlapiImage, GeneratedImage  # noqa: E402
from app.integrations.ai.llm import LlmAi  # noqa: E402
from app.integrations.storage import StoredObject  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ai import AiUsage  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    MediaType,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.media import Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import (  # noqa: E402
    ai_image_service,
    auth_service,
    media_service,
    settings_service,
    social_card_service,
)

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

BODY = (
    "జిల్లాలో 120 కోట్లతో కొత్త పథకం ప్రారంభమైంది. 3,500 మంది లబ్ధిదారులకు సాయం అందుతుంది. "
    "అధికారులు వివరాలు వెల్లడించారు."
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
    db.rollback()
    for model in (AiUsage, Article, Media, AppSetting):
        db.query(model).delete()
    db.commit()
    db.expunge_all()
    settings_service.invalidate()


def configure(db: Session, **values: object) -> None:
    settings_service.set_many(db, values, actor_id=None)
    db.commit()


def staff_headers(db: Session, *, role: RoleKey, email: str) -> dict[str, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE)
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL))
        db.flush()
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


def make_article(db: Session, *, title: str = "కొత్త పథకం ప్రారంభం") -> Article:
    article = Article(
        short_id=f"k{abs(hash(title)) % 100000:05d}",
        slug=f"creative-{abs(hash(title)) % 10000}",
        title_te=title,
        summary_te=BODY[:80],
        body={"type": "doc", "content": []},
        body_plain=BODY,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.DRAFT,
        published_at=utcnow(),
    )
    db.add(article)
    db.flush()
    return article


def make_media(db: Session, **kw: object) -> Media:
    media = Media(
        type=MediaType.IMAGE, filename="x.webp", mime="image/webp", storage_provider="test",
        storage_key=f"images/test/{abs(hash(str(kw))) % 10**6}.webp",
        cdn_url="https://cdn.example/x.webp", width=1600, height=900, **kw,
    )
    db.add(media)
    db.flush()
    return media


def _png(size: tuple[int, int] = (96, 64)) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, (180, 138, 42)).save(out, format="PNG")
    return out.getvalue()


class _Storage:
    key = "test"

    def __init__(self) -> None:
        self.keys: list[str] = []
        self.deleted: list[str] = []

    def put(self, key: str, raw: bytes, **kw: object) -> StoredObject:
        self.keys.append(key)
        return StoredObject(
            key=key, url=f"https://cdn.example/{key}", bytes=len(raw), provider="test",
            content_type=str(kw.get("content_type") or ""),
        )

    def delete(self, key: str) -> None:
        self.deleted.append(key)


class _FakeImage:
    """Duck-typed like the real adapter: `generate` and `edit`."""

    key = "aimlapi"

    def __init__(self, *, refuse: bool = False) -> None:
        self.calls: list[tuple[str, str, int]] = []
        self.prompts: list[str] = []
        self.refuse = refuse

    def available(self) -> bool:
        return True

    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        self.calls.append(("generate", aspect, 0))
        self.prompts.append(prompt)
        return GeneratedImage(raw=_png(), mime="image/png", model="openai/gpt-image-2.5-flare",
                              usage={"usd_spent": 0.0066})

    def edit(self, prompt: str, images: list, *, aspect: str = "16:9") -> GeneratedImage:
        if self.refuse:
            raise ValueError("blackforestlabs/flux-2-klein-4b does not take reference images")
        self.calls.append(("edit", aspect, len(images)))
        self.prompts.append(prompt)
        return GeneratedImage(raw=_png(), mime="image/png", model="openai/gpt-image-2.5-flare",
                              usage={"usd_spent": 0.02})


@pytest.fixture
def drawing(db: Session, monkeypatch: pytest.MonkeyPatch) -> _FakeImage:
    """Image generation on, a fake provider, in-memory storage."""
    from PIL import Image

    monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
    configure(db, **{"ai.enabled": True, "ai.image_enabled": True})
    provider = _FakeImage()
    monkeypatch.setattr(ai_image_service, "get_image", lambda **_kw: provider)
    monkeypatch.setattr("app.services.media_service.get_storage", lambda *_a, **_k: _Storage())
    monkeypatch.setattr(social_card_service, "_load", lambda media: Image.new("RGB", (40, 30)))
    return provider


@pytest.fixture
def no_raqm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Let the real renderer run on a host without Raqm.

    Every draw passes `language=`, which basic layout refuses. Dropping it
    draws unshaped Telugu — wrong to read, right in size and position, which
    is all these tests look at. The container, with Raqm, draws it properly.
    """
    from PIL import ImageDraw

    for name in ("text", "textlength"):
        real = getattr(ImageDraw.ImageDraw, name)

        def _plain(self, *a, _real=real, **k):
            k.pop("language", None)
            return _real(self, *a, **k)

        monkeypatch.setattr(ImageDraw.ImageDraw, name, _plain)


# --------------------------------------------------------------------------- #
# The adapter's edit route
# --------------------------------------------------------------------------- #
class TestEditRoute:
    def test_references_go_as_multipart_files_to_the_edits_route(self, monkeypatch) -> None:
        import base64

        seen: dict = {}

        def _post(url: str, **kw: object) -> httpx.Response:
            seen["url"], seen["kw"] = url, kw
            return httpx.Response(
                200,
                json={"model": "openai/gpt-image-2.5-flare", "meta": {"usage": {"usd_spent": 0.02}},
                      "data": [{"b64_json": base64.b64encode(_png()).decode()}]},
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr("app.integrations.ai.image.httpx.post", _post)
        provider = AimlapiImage(api_key="k", base_url="https://api.aimlapi.com/v1/chat/completions")
        refs = [("a.png", _png(), "image/png"), ("b.png", _png(), "image/png")]

        drawn = provider.edit("a design", refs, aspect="1080:1350")

        assert seen["url"] == "https://api.aimlapi.com/v1/images/edits"
        assert "json" not in seen["kw"]
        assert seen["kw"]["files"] == [(EDIT_IMAGE_FIELD, refs[0]), (EDIT_IMAGE_FIELD, refs[1])]
        assert seen["kw"]["data"] == {
            "model": "openai/gpt-image-2.5-flare", "prompt": "a design",
            "size": "1024x1536", "quality": "low",
        }
        # httpx must write the multipart boundary itself.
        assert "Content-Type" not in seen["kw"]["headers"]
        assert drawn.mime == "image/png" and provider.last_usage == {"usd_spent": 0.02}

    def test_the_generations_route_is_unchanged(self) -> None:
        provider = AimlapiImage(api_key="k", base_url="https://x.example/v1/images/generations")
        assert provider._endpoint() == "https://x.example/v1/images/generations"
        assert provider._endpoint("edits") == "https://x.example/v1/images/edits"

    @pytest.mark.parametrize(
        ("model", "count"),
        [("blackforestlabs/flux-2-klein-4b", 1), ("openai/gpt-image-2.5-flare", 5),
         ("openai/gpt-image-2.5-flare", 0)],
    )
    def test_refused_before_anything_is_sent(self, monkeypatch, model, count) -> None:
        def _post(*_a, **_k):  # pragma: no cover - the point is it is never reached
            raise AssertionError("sent")

        monkeypatch.setattr("app.integrations.ai.image.httpx.post", _post)
        with pytest.raises(ValueError):
            AimlapiImage(api_key="k", model=model).edit(
                "p", [("a.png", b"x", "image/png")] * count
            )


# --------------------------------------------------------------------------- #
# The copy guard
# --------------------------------------------------------------------------- #
class TestInventedNumbers:
    def test_latin_and_telugu_digits_and_grouping(self) -> None:
        invented = social_card_service._invented_numbers
        assert invented("120 కోట్లు, 3500 మంది", BODY) == set()
        # Telugu digits read as the Latin ones; grouping commas are ignored.
        assert invented("౧౨౦ కోట్లు", BODY) == set()
        assert invented("3,500 మంది", "3500 మంది") == set()
        assert invented("₹60/kg", BODY) == {"60"}
        assert invented("౬౦ కిలోలు", BODY) == {"60"}

    def test_a_model_figure_the_story_lacks_falls_back_with_a_warning(
        self, db: Session, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.provider": "aimlapi"})

        class _Fake(LlmAi):
            def card_text(self, **_kw) -> CardText:
                return CardText(headline="కిలో ₹60కే ఉల్లి", summary="స", engine="ai")

        real = social_card_service.get_ai
        monkeypatch.setattr(
            social_card_service, "get_ai",
            lambda *a, **k: _Fake("aimlapi", api_key="k") if k else real(*a),
        )
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        body = client.post(
            f"/api/v1/cms/ai/articles/{article.id}/social-card/text", json={}, headers=headers
        ).json()
        assert body["engine"] == "heuristic" and body["headline"] == article.title_te
        assert body["warnings"] == ["unverified_figure"]


# --------------------------------------------------------------------------- #
# The renderer at a custom size over a backdrop
# --------------------------------------------------------------------------- #
class TestRender:
    @pytest.mark.parametrize("template", social_card_service.TEMPLATES)
    @pytest.mark.parametrize("size", [(1200, 630), (1080, 1350), (500, 1500)])
    def test_a_custom_canvas_over_a_backdrop(self, no_raqm, template, size) -> None:
        from PIL import Image

        backdrop = Image.new("RGB", (1536, 1024), (0, 255, 0))  # pure green: easy to count
        # The full-photo card is all photo when there is one (make_card draws
        # no backdrop for it), so there the design shows only without a photo.
        photo = None if template == "overlay" else Image.new("RGB", (1600, 900), (120, 90, 60))
        raw, warnings = social_card_service.render(
            social_card_service.CardInput(
                aspect=social_card_service.nearest_aspect(*size), template=template,
                headline="iPhone 18 Pro యూజర్ల కష్టాలు", summary=BODY, tag="టెక్",
                photo=photo, backdrop=backdrop, size=size,
            )
        )
        image = Image.open(io.BytesIO(raw))
        assert image.size == size
        assert ("no_photo" in warnings) == (photo is None)
        # The design shows through: a real share of the card is the backdrop's green
        # (the white logo band at the foot covers ~14% of a photo card).
        small = image.convert("RGB").resize((size[0] // 10, size[1] // 10))
        green = sum(1 for r, g, b in small.getdata() if g > 150 and g > r + 60 and g > b + 60)
        assert green > small.width * small.height // 25

    def test_the_named_shapes_are_unchanged(self) -> None:
        assert social_card_service.ASPECTS["4:5"] == (1080, 1350)
        assert social_card_service.nearest_aspect(1200, 630) == "16:9"
        assert social_card_service.nearest_aspect(1080, 1350) == "4:5"
        assert social_card_service.nearest_aspect(1080, 1920) == "9:16"


# --------------------------------------------------------------------------- #
# Drawing the backdrop
# --------------------------------------------------------------------------- #
class TestBackdrop:
    def test_references_take_the_edit_route_and_the_result_is_filed_not_hero(
        self, db: Session, drawing: _FakeImage
    ) -> None:
        article = make_article(db)
        refs = [make_media(db, meta={"design_reference": True}).id for _ in range(2)]

        media = ai_image_service.generate_backdrop(
            db, article, reference_media_ids=refs, width=1080, height=1350, actor_id=None,
            brief="bold diagonal bands",
        )

        assert drawing.calls == [("edit", "1080:1350", 2)]
        prompt = drawing.prompts[0]
        assert article.title_te not in prompt  # the design never depicts the story
        assert prompt.rindex("Non-negotiable") > prompt.index("bold diagonal bands")
        assert "Put no text of any kind" in prompt and "#0D47A1" not in prompt
        assert media.ai_generated and media.meta == {"creative_backdrop": True, "article_id": article.id}
        assert article.hero_media_id is None
        rows = db.query(AiUsage).filter(AiUsage.operation == "creative").all()
        assert len(rows) == 1 and rows[0].ok

    def test_without_references_the_plain_route_draws_in_our_palette(
        self, db: Session, drawing: _FakeImage
    ) -> None:
        article = make_article(db)
        ai_image_service.generate_backdrop(
            db, article, reference_media_ids=[], width=1200, height=630, actor_id=None
        )
        assert drawing.calls == [("generate", "1200:630", 0)]
        assert "#0D47A1" in drawing.prompts[0]

    def test_a_sensitive_story_gets_no_backdrop_and_no_bill(
        self, db: Session, drawing: _FakeImage
    ) -> None:
        article = make_article(db, title="బాలికపై అత్యాచారం కేసులో విచారణ")
        with pytest.raises(AiSensitiveTopicError):
            ai_image_service.generate_backdrop(
                db, article, reference_media_ids=[], width=1080, height=1080, actor_id=None
            )
        assert drawing.calls == [] and db.query(AiUsage).count() == 0

    def test_a_model_without_an_edit_route_is_a_clear_refusal(
        self, db: Session, drawing: _FakeImage
    ) -> None:
        drawing.refuse = True
        article = make_article(db)
        ref = make_media(db, meta={"design_reference": True})
        with pytest.raises(ValidationError) as raised:
            ai_image_service.generate_backdrop(
                db, article, reference_media_ids=[ref.id], width=1080, height=1080, actor_id=None
            )
        assert "GPT Image" in raised.value.message_en
        assert db.query(AiUsage).count() == 0

    def test_only_a_design_reference_can_be_a_reference(
        self, db: Session, drawing: _FakeImage
    ) -> None:
        from app.core.errors import NotFoundError

        article = make_article(db)
        photo = make_media(db)
        with pytest.raises(NotFoundError):
            ai_image_service.generate_backdrop(
                db, article, reference_media_ids=[photo.id], width=1080, height=1080, actor_id=None
            )
        assert drawing.calls == []


# --------------------------------------------------------------------------- #
# The reference library routes
# --------------------------------------------------------------------------- #
class TestReferenceRoutes:
    def _upload(self, client: TestClient, headers: dict):
        return client.post(
            "/api/v1/cms/ai/creative/references",
            files={"file": ("ref.png", _png((200, 120)), "image/png")},
            headers=headers,
        )

    def test_upload_list_and_kept_out_of_the_hero_picker(
        self, db: Session, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr(media_service, "get_storage", lambda *_a, **_k: _Storage())
        desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        photo = make_media(db)
        backdrop = make_media(db, meta={"creative_backdrop": True})
        db.commit()

        uploaded = self._upload(client, desk)

        assert uploaded.status_code == 201, uploaded.text
        ref_id = uploaded.json()["id"]
        listed = client.get("/api/v1/cms/ai/creative/references", headers=desk).json()["items"]
        assert [r["id"] for r in listed] == [ref_id]
        library = client.get("/api/v1/cms/media", headers=desk).json()
        assert [m["id"] for m in library["items"]] == [photo.id]
        assert library["total"] == 1
        assert backdrop.id not in {m["id"] for m in library["items"]}

    def test_the_article_list_carries_the_hero_as_a_thumbnail(
        self, db: Session, client: TestClient
    ) -> None:
        article = make_article(db)
        hero = make_media(db)
        article.hero_media_id = hero.id
        make_article(db, title="ఫోటో లేని కథనం")
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        rows = client.get("/api/v1/cms/articles", headers=headers).json()["articles"]
        thumbs = {r["id"]: (r["hero_media"] or {}).get("url") for r in rows}
        assert thumbs[article.id] == hero.cdn_url
        assert list(thumbs.values()).count(None) == 1

    def test_the_filter_compiles_for_mysql(self) -> None:
        stmt = select(Media.id).where(~media_service.meta_flag("design_reference"))
        sql = str(stmt.compile(dialect=mysql.dialect())).upper()
        assert "JSON_EXTRACT" in sql and "NULLS" not in sql

    def test_permissions(self, db: Session, client: TestClient, monkeypatch) -> None:
        storage = _Storage()
        monkeypatch.setattr(media_service, "get_storage", lambda *_a, **_k: storage)
        stringer = staff_headers(db, role=RoleKey.STRINGER, email="stringer@example.com")
        desk = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        chief = staff_headers(db, role=RoleKey.EDITOR_IN_CHIEF, email="chief@example.com")

        assert client.get("/api/v1/cms/ai/creative/references", headers=stringer).status_code == 403
        ref_id = self._upload(client, desk).json()["id"]
        # Desk editors upload but do not delete media.
        assert client.delete(f"/api/v1/cms/ai/creative/references/{ref_id}", headers=desk).status_code == 403
        # Not a general media delete: a story photo is not a reference.
        photo = make_media(db)
        db.commit()
        assert client.delete(f"/api/v1/cms/ai/creative/references/{photo.id}", headers=chief).status_code == 404

        removed = client.delete(f"/api/v1/cms/ai/creative/references/{ref_id}", headers=chief)

        assert removed.status_code == 200 and storage.deleted
        assert client.get("/api/v1/cms/ai/creative/references", headers=chief).json()["items"] == []


# --------------------------------------------------------------------------- #
# The card route with the studio's fields
# --------------------------------------------------------------------------- #
@pytest.fixture
def stub_render(monkeypatch: pytest.MonkeyPatch) -> dict:
    seen: dict = {}

    def _render(inp: social_card_service.CardInput):
        seen["input"] = inp
        from PIL import Image

        out = io.BytesIO()
        Image.new("RGB", inp.size or social_card_service.ASPECTS[inp.aspect]).save(out, format="JPEG")
        return out.getvalue(), []

    storage = _Storage()
    seen["storage"] = storage
    monkeypatch.setattr(social_card_service, "unavailable_reason", lambda: None)
    monkeypatch.setattr(social_card_service, "render", _render)
    monkeypatch.setattr(social_card_service, "get_storage", lambda *_a, **_k: storage)
    return seen


def _card(client: TestClient, article: Article, headers: dict, **body: object):
    payload = {"headline": "కొత్త పథకం", "summary": "సారాంశం", **body}
    return client.post(
        f"/api/v1/cms/ai/articles/{article.id}/social-card", json=payload, headers=headers
    )


class TestCardRoute:
    def test_custom_size_backdrop_reuse_and_save(
        self, db: Session, client: TestClient, drawing: _FakeImage, stub_render: dict
    ) -> None:
        article = make_article(db)
        hero = make_media(db, credit="పీటీఐ", source_type="syndicated")
        article.hero_media_id = hero.id
        ref = make_media(db, meta={"design_reference": True})
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")

        first = _card(client, article, headers, width=1200, height=630, template="frame",
                      use_ai_backdrop=True, reference_media_ids=[ref.id], save=True)

        assert first.status_code == 200, first.text
        card = first.json()["card"]
        assert (card["width"], card["height"], card["aspect"]) == (1200, 630, "16:9")
        assert card["filename"].endswith("-1200x630.jpg")
        assert stub_render["input"].size == (1200, 630)
        assert stub_render["input"].backdrop is not None
        assert card["photo"]["media_id"] == hero.id  # the story's own photo
        saved = db.get(Media, card["media_id"])
        assert saved.meta == {"creative": True, "article_id": article.id, "size": [1200, 630]}
        assert saved.credit == "పీటీఐ" and saved.ai_generated is False
        db.refresh(article)
        assert article.hero_media_id == hero.id

        # A text edit: same backdrop, no second drawing.
        again = _card(client, article, headers, width=1200, height=630, template="frame",
                      headline="సవరించిన శీర్షిక", backdrop_media_id=card["backdrop"]["media_id"])
        assert again.json()["card"]["backdrop"]["media_id"] == card["backdrop"]["media_id"]
        assert len(drawing.calls) == 1

    def test_no_backdrop_is_bought_for_a_full_photo_card(
        self, db: Session, client: TestClient, drawing: _FakeImage, stub_render: dict
    ) -> None:
        article = make_article(db)
        article.hero_media_id = make_media(db).id
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        card = _card(client, article, headers, template="overlay", use_ai_backdrop=True).json()["card"]
        assert card["backdrop"] is None and drawing.calls == []
        assert db.query(AiUsage).count() == 0

    def test_a_reused_backdrop_is_screened_against_the_new_story(
        self, db: Session, client: TestClient, drawing: _FakeImage, stub_render: dict
    ) -> None:
        clean = make_article(db)
        flagged = make_article(db, title="బాలికపై అత్యాచారం కేసులో విచారణ")
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        held = _card(client, clean, headers, use_ai_backdrop=True).json()["card"]["backdrop"]["media_id"]
        reused = _card(client, flagged, headers, backdrop_media_id=held)
        assert reused.status_code == 422
        assert reused.json()["error"]["code"] == "AI_REQUIRES_HUMAN_ONLY"

    def test_a_large_card_is_filed_at_library_size(
        self, db: Session, client: TestClient, drawing: _FakeImage, stub_render: dict
    ) -> None:
        article = make_article(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        card = _card(client, article, headers, width=4096, height=2048, save=True).json()["card"]
        saved = db.get(Media, card["media_id"])
        assert (saved.width, saved.height) == (1600, 800)
        assert saved.meta["size"] == [4096, 2048]  # the download stays full size

    def test_a_figure_the_story_lacks_is_flagged_on_the_card(
        self, db: Session, client: TestClient, stub_render: dict
    ) -> None:
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        warned = _card(client, article, headers, headline="₹60 కోట్ల పథకం").json()["card"]
        clean = _card(client, article, headers, headline="120 కోట్ల పథకం").json()["card"]
        assert "unverified_figure" in warned["warnings"]
        assert "unverified_figure" not in clean["warnings"]

    def test_bad_sizes_and_foreign_backdrops_are_refused(
        self, db: Session, client: TestClient, stub_render: dict
    ) -> None:
        article = make_article(db)
        photo = make_media(db)
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        assert _card(client, article, headers, width=1080).status_code == 422
        assert _card(client, article, headers, width=100, height=100).status_code == 422
        assert _card(client, article, headers, reference_media_ids=[1, 2, 3, 4, 5]).status_code == 422
        assert _card(client, article, headers, backdrop_media_id=photo.id).status_code == 404

    def test_the_backdrop_takes_the_card_permission(
        self, db: Session, client: TestClient, stub_render: dict
    ) -> None:
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.PHOTO_VIDEO, email="photo@example.com")
        assert _card(client, article, headers, use_ai_backdrop=True).status_code == 403
