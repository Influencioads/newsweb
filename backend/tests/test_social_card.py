"""Social news cards: the four shapes, the three styles, and the paid picture.

What each test guards, because every one of these fails silently:

  * a portrait card asking the image model for a 16:9 picture pays for pixels
    the crop throws away — so the size sent must follow the slot;
  * a card picture made the story's hero puts a portrait illustration in a
    16:9 slot on live copy;
  * re-rendering after a text edit must reuse the drawn picture, not buy a
    second one;
  * "iPhone 18 Pro" drawn in the Telugu face is a row of boxes, so words are
    split by script;
  * without Raqm the card is unreadable Telugu, so it must be declined.

The real renderer runs only where Pillow can shape Telugu (the API container);
on a host without Raqm those tests skip and the endpoint tests stub the draw.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.errors import AiProviderError  # noqa: E402
from app.core.fonts import telugu_shaping_available  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.ai import catalogue  # noqa: E402
from app.integrations.ai.base import AiProvider, CardText  # noqa: E402
from app.integrations.ai.image import GeneratedImage  # noqa: E402
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
    settings_service,
    social_card_service,
)

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

BODY = (
    "జిల్లా కేంద్రంలో కొత్త పథకం ప్రారంభమైంది. లబ్ధిదారులకు నేరుగా సాయం అందుతుంది. "
    "అధికారులు వివరాలు వెల్లడించారు. ప్రజలు హర్షం వ్యక్తం చేశారు. "
)

shaping = pytest.mark.skipif(
    not telugu_shaping_available(), reason="Pillow on this host cannot shape Telugu (no Raqm)"
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
        short_id=f"c{abs(hash(title)) % 100000:05d}",
        slug=f"card-{abs(hash(title)) % 10000}",
        title_te=title,
        summary_te=BODY[:120],
        body={"type": "doc", "content": []},
        body_plain=BODY,
        status=ArticleStatus.PUBLISHED,
        workflow_state=WorkflowState.PUBLISHED,
        published_at=utcnow(),
    )
    db.add(article)
    db.flush()
    return article


def make_media(db: Session, **kw: object) -> Media:
    media = Media(
        type=MediaType.IMAGE,
        filename="hero.webp",
        mime="image/webp",
        storage_provider="test",
        storage_key=f"images/test/{abs(hash(str(kw))) % 10**6}.webp",
        cdn_url="https://cdn.example/hero.webp",
        width=1600,
        height=900,
        **kw,
    )
    db.add(media)
    db.flush()
    return media


def _jpeg() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (64, 36), (15, 95, 87)).save(out, format="JPEG")
    return out.getvalue()


class _Storage:
    key = "test"

    def __init__(self) -> None:
        self.keys: list[str] = []

    def put(self, key: str, raw: bytes, **kw: object) -> StoredObject:
        self.keys.append(key)
        return StoredObject(
            key=key, url=f"https://cdn.example/{key}", bytes=len(raw), provider="test",
            content_type=str(kw.get("content_type") or ""),
        )


class _FakeImage:
    key = "aimlapi"

    def __init__(self) -> None:
        self.aspects: list[str] = []
        self.prompts: list[str] = []

    def available(self) -> bool:
        return True

    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        self.prompts.append(prompt)
        self.aspects.append(aspect)
        from PIL import Image

        out = io.BytesIO()
        Image.new("RGB", (96, 64), (180, 138, 42)).save(out, format="PNG")
        return GeneratedImage(
            raw=out.getvalue(), mime="image/png", model="openai/gpt-image-2.5-flare",
            usage={"usd_spent": 0.0066},
        )


@pytest.fixture
def stub_render(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Stand in for Pillow's Telugu shaping on a host that has none, and
    record what the renderer was asked to draw."""
    seen: dict = {}

    def _render(inp: social_card_service.CardInput):
        seen["input"] = inp
        return _jpeg(), (["no_photo"] if inp.photo is None else [])

    from PIL import Image

    storage = _Storage()
    seen["storage"] = storage
    monkeypatch.setattr(social_card_service, "unavailable_reason", lambda: None)
    monkeypatch.setattr(social_card_service, "render", _render)
    monkeypatch.setattr(social_card_service, "_load", lambda media: Image.new("RGB", (40, 30)))
    monkeypatch.setattr(social_card_service, "get_storage", lambda *_a, **_k: storage)
    return seen


def _card(client: TestClient, article: Article, headers: dict, **body: object):
    payload = {"headline": "ధరల పెరుగుదలపై మౌనం వీడాలి", "summary": "సారాంశం", **body}
    return client.post(
        f"/api/v1/cms/ai/articles/{article.id}/social-card", json=payload, headers=headers
    )


# --------------------------------------------------------------------------- #
# Pure pieces
# --------------------------------------------------------------------------- #
class TestScriptRuns:
    def test_latin_and_telugu_in_one_word_take_their_own_faces(self) -> None:
        assert social_card_service._runs("UPIలో") == [("UPI", False), ("లో", True)]
        assert social_card_service._runs("iPhone") == [("iPhone", False)]

    def test_digits_ride_with_the_telugu_they_belong_to(self) -> None:
        assert social_card_service._runs("2026లో") == [("2026లో", True)]
        assert social_card_service._runs("₹2,000") == [("₹2,000", False)]

    def test_a_joiner_stays_inside_the_telugu_run(self) -> None:
        word = "వెబ్‌సైట్"
        assert social_card_service._runs(word) == [(word, True)]

    def test_dandas_and_telugu_digits_take_the_telugu_face(self) -> None:
        # Noto Sans has neither; drawn in it they are boxes.
        assert social_card_service._runs("ముగిసింది।") == [("ముగిసింది।", True)]
        assert social_card_service._runs("Rs౧౦") == [("Rs", False), ("౧౦", True)]


class _MonoDraw:
    """A fake ImageDraw where every character is half the font size wide, so
    the fitting arithmetic can be checked on a host without Raqm."""

    def textlength(self, text: str, font, language: str = "") -> float:
        return len(text) * font.size * 0.5


class TestFit:
    def test_the_floor_size_is_tried_before_anything_is_cut(self) -> None:
        # Fits at 35 (width 70) and at nothing larger; hi is even, lo is odd.
        block = social_card_service._fit(
            _MonoDraw(), "aaaa", weight="bold", width=70, height=500,
            max_lines=1, hi=52, lo=35, leading=1.4,
        )
        assert (block.size, block.truncated, block.lines) == (35, False, [["aaaa"]])

    def test_a_word_wider_than_the_box_is_cut_not_run_off_the_card(self) -> None:
        draw = _MonoDraw()
        block = social_card_service._fit(
            draw, "https://" + "x" * 90, weight="bold", width=400, height=500,
            max_lines=2, hi=40, lo=30, leading=1.4,
        )
        assert block.truncated and block.lines[0][0].endswith("…")
        assert all(
            social_card_service._line_width(draw, ln, "bold", block.size) <= 400
            for ln in block.lines
        )

    def test_the_ellipsis_marks_dropped_words_only(self) -> None:
        block = social_card_service._fit(
            _MonoDraw(), "aa bb cc dd ee ff", weight="bold", width=100, height=42,
            max_lines=1, hi=30, lo=30, leading=1.4,
        )
        assert block.truncated and block.lines == [["aa", "bb…"]]


class TestCover:
    def test_a_banner_photo_is_cropped_without_scaling_it_whole(self) -> None:
        from PIL import Image

        # Scaled whole first, this was 192000x1920 — gigabytes on a 9:16 card.
        out = social_card_service._cover(Image.new("RGB", (1600, 16), (9, 9, 9)), 1080, 1920)
        assert out.size == (1080, 1920)

    @pytest.mark.parametrize("size", [(1600, 900), (900, 1600), (1080, 902), (7, 3)])
    def test_float_rounding_never_puts_the_crop_outside_the_photo(self, size) -> None:
        from PIL import Image

        for w, h in [(1080, 902), (1080, 1920), (960, 1080), (1080, 1350)]:
            assert social_card_service._cover(Image.new("RGB", size), w, h).size == (w, h)


class TestPlacement:
    def test_a_wide_collage_in_a_tall_slot_is_shown_whole(self) -> None:
        """A cover-crop would keep 32% of it and could land between the panels."""
        from PIL import Image

        photo = Image.new("RGB", (1024, 576), (255, 0, 0))
        placed = social_card_service._placed(photo, 1080, 1920, 0.3)
        assert placed.size == (1080, 1920)
        # Full width, both edges of the photo present, a darkened backdrop around it.
        top = int(1920 * 0.3 - 608 / 2)
        assert placed.getpixel((2, top + 300))[0] > 240
        assert placed.getpixel((1077, top + 300))[0] > 240
        assert placed.getpixel((540, 20))[0] < 140

    def test_a_close_shape_is_still_cover_cropped(self) -> None:
        from PIL import Image

        photo = Image.new("RGB", (1024, 576), (255, 0, 0))
        placed = social_card_service._placed(photo, 1080, 540, 0.5)
        assert placed.getpixel((540, 5))[0] > 240 and placed.getpixel((540, 535))[0] > 240


class TestPhotoLabel:
    def test_a_borrowed_photo_carries_no_credit_but_ai_and_stand_ins_are_labelled(self) -> None:
        borrowed = Media(credit="NTV Telugu", source_type="syndicated", ai_generated=False, meta={})
        drawn = Media(credit=None, source_type="own", ai_generated=True, meta={})
        stand_in = Media(credit=None, source_type="own", ai_generated=False, meta={"representative": True})
        assert social_card_service._photo_label(borrowed) is None
        assert social_card_service._photo_label(drawn) == "AI చిత్రం"
        scene = Media(credit=None, source_type="own", ai_generated=True, meta={"representative": True})
        assert social_card_service._photo_label(scene) == "ప్రతీకాత్మక AI చిత్రం"
        assert social_card_service._photo_label(stand_in) == "ప్రతీకాత్మక చిత్రం"


class TestPictureShape:
    @pytest.mark.parametrize(
        ("template", "aspect", "slot"),
        [
            ("panel", "4:5", "16:9"),
            ("panel", "9:16", "16:9"),
            ("panel", "16:9", "4:5"),
            ("overlay", "9:16", "9:16"),
            ("overlay", "1:1", "1:1"),
            ("frame", "4:5", "16:9"),
            ("frame", "16:9", "1:1"),
        ],
    )
    def test_the_model_draws_the_slot_not_the_card(self, template, aspect, slot) -> None:
        assert social_card_service.photo_aspect(template, aspect) == slot

    @pytest.mark.parametrize(
        ("aspect", "size"),
        [("16:9", "1536x1024"), ("1:1", "1024x1024"), ("4:5", "1024x1536"), ("9:16", "1024x1536")],
    )
    def test_gpt_image_gets_one_of_its_three_sizes(self, aspect, size) -> None:
        args = catalogue.image_size_args("openai/gpt-image-2.5-flare", aspect)
        assert args == {"size": size, "quality": "low"}

    def test_other_families_keep_their_own_spelling(self) -> None:
        assert catalogue.image_size_args("google/gemini-3-pro-image", "9:16") == {
            "aspect_ratio": "9:16"
        }
        assert catalogue.image_size_args("blackforestlabs/flux-2-klein-4b", "1:1") == {
            "image_size": "square_hd"
        }
        assert catalogue.image_size_args("bytedance/seedream-v4", "9:16") == {}

    def test_gpt_image_2_5_is_the_default_and_selectable(self) -> None:
        assert catalogue.DEFAULT_IMAGE_MODEL == "openai/gpt-image-2.5-flare"
        assert catalogue.DEFAULT_IMAGE_MODEL in {c.id for c in catalogue.IMAGE}

    def test_a_card_prompt_composes_for_its_slot_and_keeps_the_rules_last(
        self, db: Session
    ) -> None:
        article = make_article(db)
        card = ai_image_service.build_prompt(article, aspect="4:5")
        hero = ai_image_service.build_prompt(article)
        assert "Compose it 4:5" in card and "16:9" not in card
        assert "Compose it wide, 16:9" in hero
        for prompt in (card, hero):
            assert "Put no text of any kind" in prompt
            assert prompt.rindex("Non-negotiable") > prompt.index(article.title_te)


# --------------------------------------------------------------------------- #
# The words
# --------------------------------------------------------------------------- #
class TestCardText:
    def test_the_keyless_answer_is_our_own_headline_and_standfirst(self) -> None:
        class _Keyless(AiProvider):
            def propose_topics(self, **_kw):  # pragma: no cover
                raise NotImplementedError

            def write_draft(self, **_kw):  # pragma: no cover
                raise NotImplementedError

            def rewrite_item(self, **_kw):  # pragma: no cover
                raise NotImplementedError

        text = _Keyless().card_text(headline="శీర్షిక", summary="", body=BODY * 4)
        assert text.headline == "శీర్షిక" and text.engine == "heuristic"
        assert len(text.summary) <= 171 and text.summary.endswith("…")

    def test_the_model_answer_is_parsed_and_clipped(self, monkeypatch) -> None:
        llm = LlmAi("aimlapi", api_key="k")
        seen: dict = {}

        def _complete(prompt: str, rules: str = "") -> str:
            seen["rules"], seen["prompt"] = rules, prompt
            return '```json\n{"headline": "' + "హ" * 200 + '", "summary": "స", "tag": "రాజకీయం"}\n```'

        monkeypatch.setattr(llm, "_complete", _complete)
        text = llm.card_text(headline="శీర్షిక", summary="సారాంశం", body=BODY)
        assert text.engine == "ai" and text.tag == "రాజకీయం"
        assert len(text.headline) <= 91
        # Our own story: no instruction to credit a publisher may ride along.
        assert "Attribute every factual claim" not in seen["rules"]
        assert "Name no other publication" in seen["prompt"]

    def test_a_model_answer_without_a_headline_is_an_error(self, monkeypatch) -> None:
        llm = LlmAi("aimlapi", api_key="k")
        monkeypatch.setattr(llm, "_complete", lambda *_a, **_k: '{"summary": "x"}')
        with pytest.raises(AiProviderError):
            llm.card_text(headline="h", summary="", body="")

    def test_ai_off_answers_without_spending(self, db: Session, client: TestClient) -> None:
        article = make_article(db, title="ఈ రోజు ముఖ్యాంశం")
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        response = client.post(
            f"/api/v1/cms/ai/articles/{article.id}/social-card/text", json={}, headers=headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["engine"] == "heuristic" and body["headline"] == "ఈ రోజు ముఖ్యాంశం"
        assert body["tag"]
        assert db.query(AiUsage).count() == 0

    def test_a_stray_script_falls_back_to_our_own_words(self, db, client, monkeypatch) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.provider": "aimlapi"})

        class _Fake(LlmAi):
            def card_text(self, **_kw) -> CardText:
                return CardText(headline="ఎစ်ဘభై కోట్లు", summary="స", engine="ai")

        real_get_ai = social_card_service.get_ai
        monkeypatch.setattr(
            social_card_service,
            "get_ai",
            lambda *a, **k: _Fake("aimlapi", api_key="k") if k else real_get_ai(*a),
        )
        article = make_article(db, title="ఎనభై కోట్లు")
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        body = client.post(
            f"/api/v1/cms/ai/articles/{article.id}/social-card/text", json={}, headers=headers
        ).json()
        assert body["engine"] == "heuristic" and body["headline"] == "ఎనభై కోట్లు"

    def test_ai_on_records_the_call(self, db, client, monkeypatch) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.provider": "aimlapi"})

        class _Fake(LlmAi):
            def card_text(self, **_kw) -> CardText:
                self.last_usage = {"usd_spent": 0.001}
                return CardText(headline="హుక్", summary="సారాంశం", tag="", engine="ai")

        monkeypatch.setattr(
            social_card_service, "get_ai", lambda *a, **k: _Fake("aimlapi", api_key="k")
        )
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        response = client.post(
            f"/api/v1/cms/ai/articles/{article.id}/social-card/text", json={}, headers=headers
        )
        assert response.status_code == 200
        assert response.json()["engine"] == "ai"
        rows = db.query(AiUsage).filter(AiUsage.operation == "card_text").all()
        assert len(rows) == 1 and rows[0].ok


# --------------------------------------------------------------------------- #
# The endpoint
# --------------------------------------------------------------------------- #
class TestCardEndpoint:
    def test_no_telugu_shaping_is_a_reason_not_a_broken_card(
        self, db: Session, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr(social_card_service, "telugu_shaping_available", lambda: False)
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        response = _card(client, article, headers)
        assert response.status_code == 200
        assert response.json()["available"] is False
        assert "Raqm" in response.json()["reason"]

    def test_story_photo_card_is_stored_and_described(
        self, db, client, stub_render
    ) -> None:
        article = make_article(db)
        hero = make_media(db, credit="పీటీఐ", source_type="syndicated")
        article.hero_media_id = hero.id
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")

        response = _card(client, article, headers, aspect="9:16", template="overlay")

        assert response.status_code == 200
        card = response.json()["card"]
        assert (card["width"], card["height"], card["aspect"]) == (1080, 1920, "9:16")
        assert card["filename"] == f"toptelugunews-{article.short_id}-9x16.jpg"
        assert card["photo"]["media_id"] == hero.id and card["warnings"] == []
        assert stub_render["storage"].keys[0].startswith(f"social-cards/{article.short_id}/")
        # No photo credit on the card (owner's decision).
        assert stub_render["input"].photo_label is None

    def test_no_photo_ignores_a_media_id_and_says_so(self, db, client, stub_render) -> None:
        article = make_article(db)
        hero = make_media(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        response = _card(client, article, headers, photo="none", photo_media_id=hero.id)
        card = response.json()["card"]
        assert card["photo"] is None and card["warnings"] == ["no_photo"]

    def test_an_unknown_picture_is_a_404(self, db, client, stub_render) -> None:
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        assert _card(client, article, headers, photo_media_id=987654).status_code == 404

    def test_a_blank_headline_is_refused(self, db, client, stub_render) -> None:
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        assert _card(client, article, headers, headline="   ").status_code == 422
        assert _card(client, article, headers, aspect="3:2").status_code == 422

    def test_it_takes_the_same_permission_as_drawing_an_image(
        self, db, client, stub_render
    ) -> None:
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.PHOTO_VIDEO, email="photo@example.com")
        assert _card(client, article, headers).status_code == 403
        assert (
            client.post(
                f"/api/v1/cms/ai/articles/{article.id}/social-card/text",
                json={},
                headers=headers,
            ).status_code
            == 403
        )

    def test_an_ai_picture_is_drawn_once_in_the_slot_shape_and_never_made_hero(
        self, db, client, stub_render, monkeypatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": True})
        provider = _FakeImage()
        monkeypatch.setattr(ai_image_service, "get_image", lambda **_kw: provider)
        monkeypatch.setattr("app.services.media_service.get_storage", lambda *_a, **_k: _Storage())
        article = make_article(db)
        article.workflow_state = WorkflowState.DRAFT
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")

        first = _card(client, article, headers, photo="ai", aspect="4:5", template="panel")

        assert first.status_code == 200, first.text
        photo = first.json()["card"]["photo"]
        assert photo["ai_generated"] is True
        assert provider.aspects == ["16:9"]  # a 4:5 panel card's picture band
        db.refresh(article)
        assert article.hero_media_id is None
        assert stub_render["input"].photo_label == "ప్రతీకాత్మక AI చిత్రం"

        # The editor fixes a typo: same picture, no second drawing.
        again = _card(
            client, article, headers, photo="ai", photo_media_id=photo["media_id"],
            headline="సవరించిన శీర్షిక",
        )
        assert again.json()["card"]["photo"]["media_id"] == photo["media_id"]
        assert len(provider.prompts) == 1

    def test_a_failed_store_after_a_paid_draw_hands_back_the_picture(
        self, db, client, stub_render, monkeypatch
    ) -> None:
        from app.core.errors import StorageError

        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": True})
        provider = _FakeImage()
        monkeypatch.setattr(ai_image_service, "get_image", lambda **_kw: provider)
        monkeypatch.setattr("app.services.media_service.get_storage", lambda *_a, **_k: _Storage())
        broken = _Storage()

        def _fail(*_a, **_k):
            raise StorageError(details={"error": "bucket down"})

        broken.put = _fail
        monkeypatch.setattr(social_card_service, "get_storage", lambda *_a, **_k: broken)
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")

        failed = _card(client, article, headers, photo="ai")

        assert failed.status_code >= 500
        held = failed.json()["error"]["details"]["photo_media_id"]
        monkeypatch.setattr(social_card_service, "get_storage", lambda *_a, **_k: _Storage())
        retry = _card(client, article, headers, photo="ai", photo_media_id=held)
        assert retry.json()["card"]["photo"]["media_id"] == held
        assert len(provider.prompts) == 1

    def test_a_picture_that_will_not_load_still_reports_its_id(
        self, db, client, stub_render, monkeypatch
    ) -> None:
        monkeypatch.setattr(social_card_service, "_load", lambda media: None)
        article = make_article(db)
        hero = make_media(db)
        article.hero_media_id = hero.id
        db.commit()
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        card = _card(client, article, headers).json()["card"]
        assert card["photo"]["media_id"] == hero.id and "no_photo" in card["warnings"]

    def test_ai_picture_switched_off_is_a_reason(self, db, client, stub_render, monkeypatch) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": False})
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")
        body = _card(client, article, headers, photo="ai").json()
        assert body["available"] is False and "switched off" in body["reason"]


# --------------------------------------------------------------------------- #
# The real renderer — only where Telugu can be shaped
# --------------------------------------------------------------------------- #
@shaping
class TestRender:
    @pytest.mark.parametrize("template", social_card_service.TEMPLATES)
    @pytest.mark.parametrize("aspect", list(social_card_service.ASPECTS))
    def test_every_shape_and_style_renders_at_its_platform_size(self, aspect, template) -> None:
        from PIL import Image

        photo = Image.new("RGB", (1600, 900), (120, 90, 60))
        raw, warnings = social_card_service.render(
            social_card_service.CardInput(
                aspect=aspect, template=template,
                headline="iPhone 18 Pro యూజర్ల కష్టాలు", summary=BODY, tag="టెక్",
                photo=photo, photo_label="AI చిత్రం",
            )
        )
        image = Image.open(io.BytesIO(raw))
        assert image.format == "JPEG"
        assert image.size == social_card_service.ASPECTS[aspect]
        assert "no_photo" not in warnings

    def test_a_long_tag_shrinks_to_the_room_it_has(self) -> None:
        chip = social_card_service._chip("ANDHRA PRADESH ASSEMBLY ELECTION", 34, (0, 0, 0), (9, 9, 9), max_width=300)
        assert chip.width <= 300

    def test_a_glyph_neither_face_has_is_reported(self) -> None:
        _raw, warnings = social_card_service.render(
            social_card_service.CardInput(aspect="1:1", template="panel", headline="శుభవార్త 🎉")
        )
        assert "unsupported_characters" in warnings

    def test_an_overlong_headline_is_cut_and_reported(self) -> None:
        raw, warnings = social_card_service.render(
            social_card_service.CardInput(
                aspect="1:1", template="frame", headline="చాలా పొడవైన శీర్షిక " * 20,
                summary="",
            )
        )
        assert raw and "headline_truncated" in warnings and "no_photo" in warnings
