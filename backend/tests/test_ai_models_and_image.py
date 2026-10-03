"""Which model, which voice, and the picture (updated doc §15–19).

Every figure pinned down here was paid for once, on 2026-09-18, with this
project's own aimlapi key. The tests exist because each of these mistakes is
silent — the system keeps working, and the bill or the correction arrives
later:

  * a stale ``AIMLAPI_MODEL=kimi-k3`` in the deploy environment displacing the
    measured default is 29x the cost of the model that was chosen;
  * a bulk call site asking for the editorial model turns a ₹6,100 month into
    a ₹34,000 one against a ₹15,000 budget;
  * ``alloy`` reaching ElevenLabs is a 400 on a call already billed;
  * a WAV stored as ``audio/mpeg`` plays as nothing on the reader's device;
  * an image model asked to illustrate a rape case will cheerfully draw it,
    and a false positive in the screen that stops it silently disables
    illustration for ordinary news — so both directions are asserted.

Nothing here opens a socket. `conftest` blanks every provider credential for
exactly that reason, and each test monkeypatches the provider seam it needs.
"""

from __future__ import annotations

import base64
import io
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.errors import (  # noqa: E402
    AiProviderError,
    AiSensitiveTopicError,
    ValidationError,
)
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
from app.integrations.ai.base import (  # noqa: E402
    AiProvider,
    DraftText,
    ImageVerdict,
    RewriteText,
    TopicIdea,
)
from app.integrations.ai.image import AimlapiImage, GeneratedImage  # noqa: E402
from app.integrations.ai.llm import LlmAi  # noqa: E402
from app.integrations.ai.sensitive import is_sensitive  # noqa: E402
from app.integrations.storage import StoredObject  # noqa: E402
from app.integrations.tts import get_tts  # noqa: E402
from app.integrations.tts.aimlapi import AimlapiTts  # noqa: E402
from app.integrations.tts.base import sniff_mime  # noqa: E402
from app.integrations.tts.base import Synthesis, TtsProvider  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ai import AiSuggestion, AiUsage  # noqa: E402
from app.models.audio import AudioAsset  # noqa: E402
from app.models.bulletin import AudioBulletin, AudioBulletinItem  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    BulletinStatus,
    ContentPolicy,
    IngestStatus,
    RoleKey,
    ScopeType,
    SourceBeat,
    SourceLicence,
    UserStatus,
    WorkflowState,
)
from app.models.ingestion import (  # noqa: E402
    ContentSource,
    IngestedItem,
    IngestedRewrite,
)
from app.models.media import Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import (  # noqa: E402
    ai_image_service,
    ai_service,
    ai_usage_service,
    audio_concat,
    auth_service,
    bulletin_service,
    crawl_service,
    settings_service,
    tts_service,
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
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    # Articles first: they carry the FKs to media and audio.
    for model in (
        AudioBulletinItem,
        AudioBulletin,
        IngestedRewrite,
        IngestedItem,
        ContentSource,
        AiSuggestion,
        AiUsage,
        Article,
        AudioAsset,
        Media,
        AppSetting,
    ):
        db.query(model).delete()
    db.commit()
    # A bulk delete leaves the deleted rows in the identity map, and SQLite
    # hands the same primary key straight back out — the next flush then
    # collides inside the ORM rather than in the database.
    db.expunge_all()
    settings_service.invalidate()


def configure(db: Session, **values: object) -> None:
    settings_service.set_many(db, values, actor_id=None)
    db.commit()


def enable_ai(db: Session, monkeypatch: pytest.MonkeyPatch, **extra: object) -> None:
    """Both halves of the §18 switch, plus aimlapi as the chosen provider."""
    monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
    configure(db, **{"ai.enabled": True, "ai.provider": "aimlapi", **extra})


def staff_user(db: Session, *, role: RoleKey, email: str) -> User:
    """A user holding `role`. Seniority matters: `ai_usage_service._quota_for`
    reads the role level, so a caller that wants a quota to bind has to hold a
    real role rather than an actor id that exists only as an integer."""
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
    return user


def staff_headers(db: Session, *, role: RoleKey, email: str) -> dict[str, str]:
    user = staff_user(db, role=role, email=email)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return {"Authorization": f"Bearer {access}"}


@pytest.fixture
def ledger_session(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stand in for the second connection `session_scope` opens.

    `ai_service.create_draft` and `ai_image_service.generate_for_article` write
    their failure row on a session of their own and commit it *before* the
    re-raise, precisely so the request's own rollback cannot take it away. The
    real thing cannot be exercised here: this module's SQLite lives in one
    `StaticPool` connection, so a second session would share the first one's
    transaction and prove nothing either way.

    Yielding `db` and committing at the same point the production code commits
    reproduces the property the row has to have — a test that follows with
    `db.rollback()` still finds it. A regression that recorded on the request's
    own session without committing fails exactly there.
    """

    @contextmanager
    def _scope() -> Iterator[Session]:
        yield db
        db.commit()

    for module in ("ai_service", "ai_image_service"):
        monkeypatch.setattr(f"app.services.{module}.session_scope", _scope)


TELUGU_BODY = (
    "జిల్లా కేంద్రంలో కొత్త పథకం ప్రారంభమైంది. లబ్ధిదారులకు నేరుగా సాయం అందుతుంది. "
    "అధికారులు వివరాలు వెల్లడించారు. ప్రజలు హర్షం వ్యక్తం చేశారు. "
)


def make_article(
    db: Session,
    *,
    title: str = "కొత్త పథకం ప్రారంభం",
    body: str = "",
    state: WorkflowState = WorkflowState.PUBLISHED,
) -> Article:
    text = body or TELUGU_BODY
    article = Article(
        short_id=f"i{abs(hash(title)) % 100000:05d}",
        slug=f"story-{abs(hash(title)) % 10000}",
        title_te=title,
        summary_te=text[:200],
        body={"type": "doc", "content": []},
        body_plain=text,
        status=ArticleStatus.PUBLISHED,
        workflow_state=state,
        published_at=utcnow(),
    )
    db.add(article)
    db.flush()
    return article


class _Storage:
    """In-memory stand-in, so these tests never write into the repo's var/."""

    key = "test"

    def __init__(self) -> None:
        self.keys: list[str] = []

    def put(self, key: str, raw: bytes, **kw: object) -> StoredObject:
        self.keys.append(key)
        return StoredObject(
            key=key,
            url=f"https://cdn.example/{key}",
            bytes=len(raw),
            provider="test",
            content_type=str(kw.get("content_type") or ""),
        )


# --------------------------------------------------------------------------- #
# The catalogue defaults, and the environment variable that must not win
# --------------------------------------------------------------------------- #
class TestDefaults:
    def test_a_fresh_database_resolves_the_measured_defaults(self, db: Session) -> None:
        """No settings row exists yet, and these four must still be the models
        in use — a blank default would hand the choice back to the deploy
        environment, which is where kimi-k3 lives."""
        assert settings_service.get(db, "ai.model") == catalogue.DEFAULT_TEXT_MODEL
        assert settings_service.get(db, "ai.bulk_model") == catalogue.DEFAULT_BULK_MODEL
        assert (
            settings_service.get(db, "ai.image_model") == catalogue.DEFAULT_IMAGE_MODEL
        )
        assert settings_service.get(db, "voice.model") == catalogue.DEFAULT_TTS_MODEL

    def test_the_bulk_default_is_not_the_editorial_default(self) -> None:
        """One setting for both is the ₹34,000 month the split exists to stop."""
        assert catalogue.DEFAULT_BULK_MODEL != catalogue.DEFAULT_TEXT_MODEL

    def test_the_setting_beats_a_kimi_k3_still_exported_by_the_environment(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The guard against the 29x model creeping back.

        Asserted on `model_name`, which `LlmAi` reads through the same
        `_credentials` that builds the request body — so this is the id that
        would actually be billed, not the settings row.
        """
        monkeypatch.setattr(
            "app.core.config.settings.AIMLAPI_MODEL", "moonshot/kimi-k3"
        )
        editorial = LlmAi("aimlapi", **_llm_kwargs(settings_service.ai_credentials(db)))
        bulk = LlmAi(
            "aimlapi", **_llm_kwargs(settings_service.ai_credentials(db, bulk=True))
        )
        assert editorial.model_name == catalogue.DEFAULT_TEXT_MODEL
        assert bulk.model_name == catalogue.DEFAULT_BULK_MODEL

    def test_a_blank_model_setting_still_falls_back_to_the_environment(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Blank means "use what the deploy says" — the pre-settings behaviour
        an existing install depends on. Only the default may not be blank."""
        monkeypatch.setattr(
            "app.core.config.settings.AIMLAPI_MODEL", "moonshot/kimi-k3"
        )
        configure(db, **{"ai.model": ""})
        provider = LlmAi("aimlapi", **_llm_kwargs(settings_service.ai_credentials(db)))
        assert provider.model_name == "moonshot/kimi-k3"


def _llm_kwargs(credentials: dict[str, str]) -> dict[str, str]:
    """`ai_credentials` carries the provider name too; `LlmAi` takes it first."""
    return {k: v for k, v in credentials.items() if k != "provider"}


# --------------------------------------------------------------------------- #
# Routing — which of the two models each call site actually asks for
# --------------------------------------------------------------------------- #
class _FakeAi(AiProvider):
    """A provider that answers without spending anything."""

    key = "fake"
    model_name = "fake/model"

    def propose_topics(self, *, context: str, limit: int) -> list[TopicIdea]:
        return []

    def write_draft(self, *, topic: str, notes: str, sources: list[dict]) -> DraftText:
        return DraftText(title_te=topic, summary_te="సారాంశం", paragraphs_te=["పేరా."])

    def rewrite_item(self, **_kw: object) -> RewriteText:
        return RewriteText(
            title_te="మన మాటల్లో శీర్షిక",
            summary_te="మన సారాంశం.",
            paragraphs_te=["మొదటి పేరా.", "రెండో పేరా."],
        )


class _Routing:
    """Stands in for a call site's `get_ai` and records what it asked for.

    The model is resolved through `LlmAi` rather than read off the keyword
    argument, because that is the value the request body is built from: a call
    site that passed the right flag but an adapter that let `AIMLAPI_MODEL`
    override it would still be the 29x invoice.
    """

    def __init__(self) -> None:
        self.models: list[str | None] = []

    def __call__(self, provider: str = "", **kw: str) -> _FakeAi:
        self.models.append(LlmAi(provider, **kw).model_name)
        return _FakeAi()


@pytest.fixture
def routing(monkeypatch: pytest.MonkeyPatch) -> _Routing:
    """One recorder installed at all four call sites, with kimi-k3 exported the
    way the deploy environment exports it."""
    recorder = _Routing()
    monkeypatch.setattr("app.core.config.settings.AIMLAPI_MODEL", "moonshot/kimi-k3")
    for module in ("ai_service", "crawl_service", "bulletin_service"):
        monkeypatch.setattr(f"app.services.{module}.get_ai", recorder)
    return recorder


class TestRouting:
    def test_topic_discovery_asks_for_the_bulk_model(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, routing: _Routing
    ) -> None:
        """A daily sweep, most of it discarded unread."""
        enable_ai(db, monkeypatch)
        ai_service.generate_suggestions(db, limit=1, actor_id=None)
        assert routing.models == [catalogue.DEFAULT_BULK_MODEL]

    def test_the_crawl_rewrite_asks_for_the_bulk_model(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, routing: _Routing
    ) -> None:
        """The highest-volume spender in the product: 60 an hour."""
        enable_ai(
            db, monkeypatch, **{"crawl.enabled": True, "crawl.rewrite_enabled": True}
        )
        source = ContentSource(
            slug="publisher",
            name="Publisher",
            feed_url="https://publisher.example.com/feed.xml",
            licence=SourceLicence.RSS_PUBLIC,
            content_policy=ContentPolicy.EXCERPT_ONLY,
            beat=SourceBeat.DISTRICT_LOCAL,
            rewrite_enabled=True,
        )
        db.add(source)
        db.flush()
        item = IngestedItem(
            source_id=source.id,
            guid="g1",
            url="https://publisher.example.com/a1",
            canonical_url="https://publisher.example.com/a1",
            title="ఒక సాధారణ వార్త ఇక్కడ ఉంది",
            summary="ఇది ఒక చిన్న సారాంశం. " * 14,
            language="te",
            fetched_at=utcnow(),
            published_at=utcnow(),
            content_hash="h1",
            status=IngestStatus.NEW,
        )
        db.add(item)
        db.flush()
        crawl_service.rewrite_one(db, item)
        assert routing.models == [catalogue.DEFAULT_BULK_MODEL]

    def test_a_draft_asks_for_the_editorial_model(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, routing: _Routing
    ) -> None:
        """Eight a day, and every word of it reaches a reader."""
        enable_ai(db, monkeypatch)
        suggestion = AiSuggestion(topic_te="జిల్లా బడ్జెట్ కేటాయింపులు", score=0.8)
        db.add(suggestion)
        db.flush()
        ai_service.create_draft(db, suggestion.id, actor_id=None)
        assert routing.models == [catalogue.DEFAULT_TEXT_MODEL]

    def test_the_bulletin_script_asks_for_the_editorial_model(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, routing: _Routing
    ) -> None:
        """Read aloud to a listener who cannot re-read it."""
        enable_ai(db, monkeypatch, **{"bulletin.ai_script_enabled": True})
        bulletin_service._ai_connectives(db, ["మొదటి శీర్షిక", "రెండో శీర్షిక"])
        assert routing.models == [catalogue.DEFAULT_TEXT_MODEL]


# --------------------------------------------------------------------------- #
# Voices — one enum per vendor, and the wrong one is a 400
# --------------------------------------------------------------------------- #
class TestVoices:
    def test_an_openai_voice_never_reaches_elevenlabs(self) -> None:
        assert catalogue.valid_voice("openai/gpt-4o-mini-tts", "alloy") == "alloy"
        assert (
            catalogue.valid_voice("elevenlabs/eleven_turbo_v2_5", "alloy") == "Rachel"
        )

    def test_a_model_that_takes_no_voice_is_sent_none(self) -> None:
        """minimax wants a `voice_setting` object and hume takes no voice at
        all; either one rejects a plain `voice` field."""
        assert catalogue.valid_voice("minimax/speech-2.6-turbo", "alloy") is None
        assert catalogue.valid_voice("hume/octave-2", "Rachel") is None

    def test_an_unknown_model_degrades_to_no_voice(self) -> None:
        """Omitting the field is the only guess that is never a 400."""
        assert catalogue.valid_voice("some/model-we-never-measured", "alloy") is None
        assert catalogue.valid_voice("", "alloy") is None

    def test_the_sentinel_and_a_blank_take_the_models_own_default(self) -> None:
        assert catalogue.valid_voice("alibaba/qwen3-tts-flash", "") == "Cherry"
        assert catalogue.valid_voice("alibaba/qwen3-tts-flash", "default") == "Cherry"


# --------------------------------------------------------------------------- #
# The TTS adapter — three measured response shapes, one of them a lie
# --------------------------------------------------------------------------- #
#: A tagged MP3 — the container elevenlabs, openai and inworld all returned.
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x64" + b"\x00" * 64


def _wav() -> bytes:
    import struct
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"".join(struct.pack("<h", 0) for _ in range(80)))
    return buffer.getvalue()


WAV = _wav()


class _Transport:
    """Answers one measured response shape and keeps the request that got it."""

    def __init__(self, response: httpx.Response, fetched: httpx.Response | None = None):
        self.response, self.fetched = response, fetched
        self.payload: dict = {}

    def post(self, url: str, *, json: dict, **_kw: object) -> httpx.Response:
        self.payload = json
        return self.response

    def get(self, url: str, **_kw: object) -> httpx.Response:
        assert self.fetched is not None, "the envelope path fetched nothing"
        return self.fetched


def _answer(content: bytes, content_type: str) -> httpx.Response:
    return httpx.Response(
        200,
        content=content,
        headers={"content-type": content_type},
        request=httpx.Request("POST", "https://api.aimlapi.com/v1/tts"),
    )


def _envelope(body: dict) -> httpx.Response:
    return httpx.Response(
        200, json=body, request=httpx.Request("POST", "https://api.aimlapi.com/v1/tts")
    )


def _install(monkeypatch: pytest.MonkeyPatch, transport: _Transport) -> None:
    monkeypatch.setattr("app.integrations.tts.aimlapi.httpx.post", transport.post)
    monkeypatch.setattr("app.integrations.tts.aimlapi.httpx.get", transport.get)


class TestTtsShapes:
    def test_raw_bytes_are_accepted_and_the_declared_type_is_not_believed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """elevenlabs answers with the audio itself, declares `audio/wav`, and
        sends MP3. Calling .json() on that is why those models could never
        work, and trusting the header is how a reader gets silence."""
        transport = _Transport(_answer(MP3, "audio/wav"))
        _install(monkeypatch, transport)
        out = AimlapiTts(
            api_key="k", model="elevenlabs/eleven_turbo_v2_5", voice="alloy"
        ).synthesise("హలో", language="te-IN")
        assert out.mime == "audio/mpeg"
        # `alloy` is OpenAI-only; sending it here is a 400 on a billed call.
        assert transport.payload["voice"] == "Rachel"
        assert transport.payload["text"] == "హలో"  # aimlapi's name, not `input`
        assert out.usage == {}  # elevenlabs reports no cost: unknown, not free

    def test_an_envelope_object_is_followed_and_its_spend_recorded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`{"audio": {"url": …}}` — what every model measured actually sent."""
        transport = _Transport(
            _envelope(
                {
                    "audio": {"url": "https://files.example/a.wav"},
                    "meta": {"usage": {"usd_spent": 0.0015}},
                }
            ),
            fetched=_answer(WAV, "application/octet-stream"),
        )
        _install(monkeypatch, transport)
        out = AimlapiTts(api_key="k", model="alibaba/qwen3-tts-flash").synthesise(
            "హలో", language="te-IN"
        )
        assert out.mime == "audio/wav"
        assert out.usage == {"usd_spent": 0.0015}
        assert transport.payload["voice"] == "Cherry"

    def test_an_envelope_string_is_followed_too(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`{"audio": "<url>"}` is the published schema. Both are accepted
        because picking one is guessing which side changes next."""
        transport = _Transport(
            _envelope({"audio": "https://files.example/a.mp3"}),
            fetched=_answer(MP3, "audio/mpeg"),
        )
        _install(monkeypatch, transport)
        out = AimlapiTts(
            api_key="k", model="minimax/speech-2.6-turbo", voice="alloy"
        ).synthesise("హలో", language="te-IN")
        assert out.mime == "audio/mpeg"
        # minimax 400s on a `voice` field, so it must be absent, not empty.
        assert "voice" not in transport.payload

    def test_bytes_that_are_not_audio_are_refused_rather_than_stored(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """An error page the transport accepted must never reach the audio
        column, where it would only surface on the reader's device."""
        _install(monkeypatch, _Transport(_answer(b"<html>nope</html>", "audio/mpeg")))
        with pytest.raises(AiProviderError):
            AimlapiTts(api_key="k", model="openai/tts-1").synthesise(
                "హలో", language="te-IN"
            )


# --------------------------------------------------------------------------- #
# The magic-byte sniff, at the byte
# --------------------------------------------------------------------------- #
class TestSniffMime:
    """The one eleven-bit number the whole ElevenLabs path hangs on.

    An MPEG frame sync is eleven set bits: `FF` and then the top three bits of
    the next byte. Masking that byte with `0xF0` tests four bits instead of
    three, and every real MPEG-1 Layer III frame — `FB`, `FA`, `F3` — then
    fails the test while only MPEG-2.5 (`Ex`) passes it. Since `elevenlabs/*`
    returns exactly those untagged frames, the sniff refused the audio *after*
    the POST had been billed, and the reader got nothing.
    """

    @pytest.mark.parametrize("header", [b"\xff\xfb", b"\xff\xfa", b"\xff\xf3"])
    def test_an_untagged_mpeg1_frame_is_accepted_as_mp3(self, header: bytes) -> None:
        frame = header + b"\x90\x64" + b"\x00" * 64
        assert sniff_mime(frame) == "audio/mpeg"
        # Spelled out rather than described: this is the comparison that was
        # wrong, and it is False for all three of these.
        assert (frame[1] & 0xF0) != 0xE0
        # And the one it is right for, which is why the bug looked like it
        # worked: MPEG-2.5 passes either mask.
        assert (0xE3 & 0xF0) == 0xE0

    def test_the_two_tagged_containers_are_unchanged(self) -> None:
        assert sniff_mime(MP3) == "audio/mpeg"
        assert sniff_mime(WAV) == "audio/wav"

    @pytest.mark.parametrize(
        "raw",
        [
            b"",
            b"\xff",  # a sync byte with nothing after it
            b"\xff\x0b\x90\x64",  # FF, but the next byte is not a sync
            b'{"error": "quota"}',
            b"<html>nope</html>",
            b"RIFF\x00\x00\x00\x00AVI LIST",  # RIFF, but not WAVE
        ],
    )
    def test_everything_else_is_refused(self, raw: bytes) -> None:
        assert sniff_mime(raw) == ""

    def test_the_adapter_keeps_an_untagged_frame_elevenlabs_returned(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """End to end: the exact bytes, the exact declared lie, no raise."""
        raw = b"\xff\xfb\x90\x64" + b"\x00" * 200
        _install(monkeypatch, _Transport(_answer(raw, "audio/wav")))
        out = AimlapiTts(
            api_key="k", model="elevenlabs/eleven_turbo_v2_5"
        ).synthesise("హలో", language="te-IN")
        assert out.mime == "audio/mpeg"
        assert out.audio == raw


# --------------------------------------------------------------------------- #
# Pace — the one tone field aimlapi forwards
# --------------------------------------------------------------------------- #
class TestSpeed:
    def _payload(
        self, monkeypatch: pytest.MonkeyPatch, *, model: str, speed: float
    ) -> dict:
        transport = _Transport(_answer(MP3, "audio/mpeg"))
        _install(monkeypatch, transport)
        AimlapiTts(api_key="k", model=model, speed=speed).synthesise(
            "హలో", language="te-IN"
        )
        return transport.payload

    @pytest.mark.parametrize("asked", [9.0, 100.0, 0.01, -3.0, 0.0])
    def test_an_out_of_range_pace_is_clamped_rather_than_sent(
        self, monkeypatch: pytest.MonkeyPatch, asked: float
    ) -> None:
        """`{"speed": 99}` answered 400 "Validation failed" on a call already
        charged for. A settings row from before this range was known costs the
        listener a slightly-wrong pace; refusing it costs them the audio."""
        low, high = catalogue.TTS_SPEED_RANGE
        sent = self._payload(
            monkeypatch, model="openai/gpt-4o-mini-tts", speed=asked
        ).get("speed", 1.0)
        assert low <= sent <= high
        if asked > high:
            assert sent == high
        elif asked and asked < low:
            assert sent == low

    def test_a_pace_in_range_is_passed_through(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = self._payload(
            monkeypatch, model="openai/gpt-4o-mini-tts", speed=0.95
        )
        assert payload["speed"] == 0.95

    def test_the_models_own_pace_is_omitted_entirely(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """At 1.0 the payload has to stay exactly the shape every response
        branch was measured against."""
        assert "speed" not in self._payload(
            monkeypatch, model="openai/gpt-4o-mini-tts", speed=1.0
        )

    @pytest.mark.parametrize(
        "model",
        [
            "elevenlabs/eleven_turbo_v2_5",
            "minimax/speech-2.6-turbo",
            "alibaba/qwen3-tts-flash",
            "some/model-we-never-measured",
        ],
    )
    def test_no_pace_reaches_a_model_whose_schema_does_not_declare_one(
        self, monkeypatch: pytest.MonkeyPatch, model: str
    ) -> None:
        """aimlapi silently drops an unknown field, so sending it achieves
        nothing — and a screen offering a control nothing forwards is a lie."""
        assert catalogue.tts_accepts_speed(model) is False
        assert "speed" not in self._payload(monkeypatch, model=model, speed=0.5)

    def test_the_factory_carries_the_pace_to_the_adapter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`get_tts` grew the keyword; a factory that dropped it would leave
        the setting looking configured and doing nothing."""
        transport = _Transport(_answer(MP3, "audio/mpeg"))
        _install(monkeypatch, transport)
        get_tts(
            provider="aimlapi",
            api_key="k",
            model="openai/gpt-4o-mini-tts",
            speed=9.0,
        ).synthesise("హలో", language="te-IN")
        assert transport.payload["speed"] == catalogue.TTS_SPEED_RANGE[1]


# --------------------------------------------------------------------------- #
# One article, one ledger row — however many segments it took
# --------------------------------------------------------------------------- #
class _FakeTts(TtsProvider):
    key = "fake"
    model_name = "openai/gpt-4o-mini-tts"

    def __init__(
        self, *, usd: float = 0.0, fail: bool = False, fail_on: int | None = None
    ) -> None:
        #: `fail_on` is the 1-based segment that raises; the ones before it
        #: answer, and are charged. That is the shape of a long article whose
        #: last chunk times out — the expensive half of the call is done.
        self.usd, self.fail, self.fail_on = usd, fail, fail_on
        self.calls = 0
        self.last_usage: dict[str, float | int] = {}

    def synthesise(
        self, text: str, *, language: str, voice: str | None = None
    ) -> Synthesis:
        self.calls += 1
        if self.fail or self.calls == self.fail_on:
            raise AiProviderError(details={"provider": "fake", "error": "boom"})
        self.last_usage = {"usd_spent": self.usd}
        return Synthesis(
            audio=MP3,
            mime="audio/mpeg",
            duration_sec=1,
            voice="fake-te",
            usage={"usd_spent": self.usd},
        )


def _install_tts(
    monkeypatch: pytest.MonkeyPatch, provider: TtsProvider
) -> _Storage:
    storage = _Storage()
    monkeypatch.setattr(tts_service, "get_tts", lambda **_kw: provider)
    monkeypatch.setattr(tts_service, "get_storage", lambda *_a, **_kw: storage)
    return storage


def _usage_rows(db: Session, operation: str) -> list[AiUsage]:
    return list(
        db.scalars(select(AiUsage).where(AiUsage.operation == operation)).all()
    )


class TestTtsLedger:
    def test_a_long_article_bills_the_sum_of_its_segments_once(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Several paid calls, one row. Billing only the last segment is how
        the meter ends up under the real invoice on every long story."""
        configure(db, **{"voice.enabled": True})
        article = make_article(db, body=TELUGU_BODY * 40)
        provider = _FakeTts(usd=0.001)
        _install_tts(monkeypatch, provider)

        asset = tts_service.ensure_audio(db, article, requested_by=None)

        assert asset is not None
        assert provider.calls > 1  # Telugu is three bytes a character
        rows = _usage_rows(db, "tts")
        assert len(rows) == 1
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(
            0.001 * provider.calls
        )
        assert rows[0].model == "openai/gpt-4o-mini-tts"

    def test_a_failed_synthesis_writes_exactly_one_row_and_no_audio(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A provider that 400s on the voice field has still been paid."""
        configure(db, **{"voice.enabled": True})
        article = make_article(db)
        _install_tts(monkeypatch, _FakeTts(fail=True))

        assert tts_service.ensure_audio(db, article, requested_by=None) is None

        rows = _usage_rows(db, "tts")
        assert len(rows) == 1
        assert rows[0].ok is False

    def test_a_failure_on_the_last_segment_still_bills_the_ones_before_it(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The expensive half of a long article is already paid for.

        `synthesise_long` puts the running total back on `last_usage` after
        every segment, so the raise from the last one leaves behind what the
        vendor charged for the first few. Recording the adapter's own
        `last_usage` instead — which holds only the segment that answered
        last — would book a ten-segment story as one, and a story that failed
        on segment one as the same number.
        """
        configure(db, **{"voice.enabled": True})
        article = make_article(db, body=TELUGU_BODY * 40)
        segments = len(audio_concat.split_for_tts(tts_service.spoken_text(article)))
        assert segments > 1, "this fixture has to be long enough to be split"
        provider = _FakeTts(usd=0.001, fail_on=segments)
        _install_tts(monkeypatch, provider)

        assert tts_service.ensure_audio(db, article, requested_by=None) is None

        rows = _usage_rows(db, "tts")
        assert len(rows) == 1
        assert rows[0].ok is False
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(
            0.001 * (segments - 1)
        )
        assert rows[0].cost_paise > 0  # not the zero this test exists to stop


# --------------------------------------------------------------------------- #
# The screen in front of the image model — and what it must let through
# --------------------------------------------------------------------------- #
class TestSensitive:
    @pytest.mark.parametrize(
        ("text", "topic"),
        [
            ("రెండు వర్గాల మధ్య ఘర్షణ చెలరేగింది", "communal"),
            ("Two groups clashed in a communal riot", "communal"),
            ("బాధితురాలిపై అత్యాచారం కేసు నమోదైంది", "sexual_assault"),
            ("Investigators filed a gang rape case", "sexual_assault"),
            # Telugu glues case endings on, so the stem is matched inside the
            # inflected form — "ఆత్మహత్యకు", not "ఆత్మహత్య".
            ("రైతు ఆత్మహత్యకు పాల్పడ్డాడు", "suicide"),
            ("The farmer died by suicide", "suicide"),
            ("మైనర్ బాలికపై కేసు నమోదైంది", "minor"),
            ("A minor girl went missing from the hostel", "minor"),
            # The two topics the negatives below deliberately narrow. Dropping
            # the stems that caused the false positives must not have cost the
            # screen the stories these terms actually name.
            ("దళితులపై దాడి ఘటనలో కేసు నమోదు", "caste"),
            ("Police booked a caste atrocity case", "caste"),
            ("మతమార్పిడి ఆరోపణలపై విచారణ", "religion"),
            ("A blasphemy complaint was filed today", "religion"),
        ],
    )
    def test_the_topics_are_caught_in_telugu_and_in_english(
        self, text: str, topic: str
    ) -> None:
        assert is_sensitive(text) == topic

    @pytest.mark.parametrize(
        "text",
        [
            "కలెక్టరేట్ ఎదుట రైతుల నిరసన, పోలీసులు బందోబస్తు ఏర్పాటు చేశారు",
            "కోర్టు తీర్పుపై పార్టీ నేతలు స్పందించారు",
            "ఆలయ ఉత్సవాలకు భక్తుల తాకిడి పెరిగింది",
            "రాష్ట్ర బడ్జెట్‌లో విద్యకు అధిక కేటాయింపులు",
            "Farmers staged a protest outside the collectorate",
            "The court heard the petition and the party welcomed the verdict",
            # `\b` around the English terms: "riot" sits inside "patriotic" and
            # "rape" inside "grape", and a substring match would refuse both.
            "Patriotic songs opened the Independence Day parade",
            "The grape harvest was the best the district has seen",
            "Two people suffered minor injuries in the collision",
            # The stems these used to trip on: a town whose name starts with
            # "హిందూ", the scheme copy every district page carries, and the
            # child words that sit in every prize-day report.
            "హిందూపురంలో డ్రైనేజీ పనులు ప్రారంభమయ్యాయి",
            "ఎస్సీ, ఎస్టీ కార్పొరేషన్ రుణాలకు దరఖాస్తులు ఆహ్వానం",
            "ఎస్సీ, ఎస్టీ విద్యార్థులకు ఉపకార వేతనాలు మంజూరు",
            "పాఠశాల వార్షికోత్సవంలో బాలిక ప్రథమ బహుమతి గెలుచుకుంది",
            "చిన్నారులకు బహుమతుల పంపిణీ",
            # "కులం" sits inside "వ్యాకులం" — grief, an ordinary word in an
            # ordinary report — which is why the caste stem is "కులా".
            "కుటుంబ సభ్యులు వ్యాకులం వ్యక్తం చేశారు",
            "వ్యాకులంతో ఉన్న ప్రజలకు అధికారుల భరోసా",
            # …and narrowing the stem to "కులా" was not enough on its own: the
            # inflected "వ్యాకులానికి" carries it too. Telugu stems now have to
            # start a word, which is what makes these two safe.
            "ఫలితాల ఆలస్యంతో విద్యార్థులు వ్యాకులానికి గురయ్యారు",
            # The worst of the measured false positives, and the one nothing in
            # the review caught: "మతం" is the tail of "సమ్మతం" — consent — which
            # a district desk files in every council, land and tender notice.
            "కౌన్సిల్ ప్రతిపాదనకు సభ్యులంతా సమ్మతం తెలిపారు",
            "రైతుల సమ్మతానికి అనుగుణంగా భూసేకరణ జరుగుతుంది",
            "ప్రజల అభిమతం మేరకు రహదారి పనులు చేపడతాం",
        ],
    )
    def test_ordinary_civic_copy_is_not_refused(self, text: str) -> None:
        """A false positive is not a safe failure: it silently takes the
        feature away from the news the newsroom actually publishes."""
        assert is_sensitive(text) is None

    @pytest.mark.parametrize(
        ("text", "topic"),
        [
            ("కులాల మధ్య ఘర్షణలో ఇద్దరికి గాయాలు", "communal"),
            ("కులాంతర వివాహంపై కుటుంబ సభ్యుల దాడి", "caste"),
            ("మతపరమైన ఉద్రిక్తత నెలకొంది", "religion"),
            ("మతమార్పిడి ఆరోపణలపై కేసు నమోదైంది", "religion"),
        ],
    )
    def test_the_narrowed_stems_still_catch_an_inflected_real_story(
        self, text: str, topic: str
    ) -> None:
        """Requiring a Telugu stem to start a word must not cost the inflection
        it was a substring for: "కులాల", "కులాంతర" and "మతపరమైన" all still land."""
        assert is_sensitive(text) == topic


# --------------------------------------------------------------------------- #
# Drawing the illustration
# --------------------------------------------------------------------------- #
def _png() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 36), (15, 95, 87)).save(buffer, format="PNG")
    return buffer.getvalue()


class _FakeImage:
    key = "aimlapi"

    def __init__(self, *, usd: float = 0.0202) -> None:
        self.usd, self.prompts = usd, []

    def available(self) -> bool:
        return True

    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        self.prompts.append(prompt)
        return GeneratedImage(
            raw=_png(),
            mime="image/png",
            model="openai/gpt-image-1.5",
            usage={"usd_spent": self.usd},
        )


def _install_image(
    monkeypatch: pytest.MonkeyPatch, provider: _FakeImage | None
) -> _Storage:
    storage = _Storage()
    monkeypatch.setattr(ai_image_service, "get_image", lambda **_kw: provider)
    monkeypatch.setattr(
        "app.services.media_service.get_storage", lambda *_a, **_kw: storage
    )
    return storage


class _FailingImage(_FakeImage):
    """Charged, then unusable — a render that came back as an error page.

    It leaves the cost on `last_usage` before raising, exactly as the real
    adapter does, because the raise itself carries no body.
    """

    last_usage: dict[str, float | int] = {}

    def generate(self, prompt: str, *, aspect: str = "16:9") -> GeneratedImage:
        self.prompts.append(prompt)
        self.last_usage = {"usd_spent": self.usd}
        raise AiProviderError(
            details={"provider": "aimlapi", "error": "expected an image"}
        )


# --------------------------------------------------------------------------- #
# The image adapter — where the draw is billed and the reply is parsed
# --------------------------------------------------------------------------- #
class TestImageAdapter:
    def _install(
        self, monkeypatch: pytest.MonkeyPatch, transport: _Transport
    ) -> None:
        monkeypatch.setattr("app.integrations.ai.image.httpx.post", transport.post)
        monkeypatch.setattr("app.integrations.ai.image.httpx.get", transport.get)

    def test_a_drawn_image_carries_the_model_that_answered_and_its_cost(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transport = _Transport(
            _envelope(
                {
                    # aimlapi resolves aliases, so the id that was billed is
                    # not the id that was asked for.
                    "model": "openai/gpt-image-1.5-2026-09-01",
                    "meta": {"usage": {"usd_spent": 0.0202}},
                    "data": [{"b64_json": base64.b64encode(_png()).decode()}],
                }
            )
        )
        self._install(monkeypatch, transport)

        drawn = AimlapiImage(api_key="k", model="openai/gpt-image-1.5").generate(
            "ఒక దృష్టాంత చిత్రం"
        )

        assert drawn.mime == "image/png"
        assert drawn.model == "openai/gpt-image-1.5-2026-09-01"
        assert drawn.usage == {"usd_spent": 0.0202}
        # The one spelling of a 16:9 frame this family accepts.
        assert transport.payload["size"] == "1536x1024"

    def test_the_cost_is_readable_once_the_body_parses_not_once_it_succeeds(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A draw that is charged and then fails the byte sniff.

        `last_usage` is assigned before the raises, so a charged render that
        came back as an error page lands in the ledger at its real cost rather
        than at zero. Reading it off the return value cannot work — the raise
        carries no body.
        """
        transport = _Transport(
            _envelope(
                {
                    "meta": {"usage": {"usd_spent": 0.0202}},
                    "data": [
                        {"b64_json": base64.b64encode(b"<html>quota</html>").decode()}
                    ],
                }
            )
        )
        self._install(monkeypatch, transport)
        provider = AimlapiImage(api_key="k", model="openai/gpt-image-1.5")

        with pytest.raises(AiProviderError):
            provider.generate("ఒక దృష్టాంత చిత్రం")

        assert provider.last_usage == {"usd_spent": 0.0202}

    def test_a_charged_draw_whose_file_never_arrives_is_costed_too(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The other billed failure: the render happened, the signed URL 404s."""
        transport = _Transport(
            _envelope(
                {
                    "meta": {"usage": {"usd_spent": 0.0102}},
                    "data": [{"url": "https://files.example/a.png"}],
                }
            ),
            fetched=httpx.Response(
                404, request=httpx.Request("GET", "https://files.example/a.png")
            ),
        )
        self._install(monkeypatch, transport)
        provider = AimlapiImage(api_key="k", model="blackforestlabs/flux-2-klein-4b")

        with pytest.raises(AiProviderError):
            provider.generate("ఒక దృష్టాంత చిత్రం")

        assert provider.last_usage == {"usd_spent": 0.0102}
        assert transport.payload["image_size"] == "landscape_16_9"


class TestImageService:
    def test_a_sensitive_topic_is_refused_before_anything_is_spent(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No gentler prompt, no call. A synthetic picture of a real incident
        published under the masthead is not undone by deleting the file."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)
        article = make_article(db, title="బాలికపై అత్యాచారం కేసులో విచారణ")

        with pytest.raises(AiSensitiveTopicError) as raised:
            ai_image_service.generate_for_article(db, article, actor_id=None)

        assert raised.value.details["topic"] == "sexual_assault"
        assert provider.prompts == []
        assert _usage_rows(db, "image") == []

    def test_the_editors_own_brief_is_screened_too(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """"Show the accused" is exactly the steer this has to refuse."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)
        article = make_article(db)

        with pytest.raises(AiSensitiveTopicError):
            ai_image_service.generate_for_article(
                db, article, actor_id=None, brief="draw the rape accused"
            )
        assert provider.prompts == []

    @pytest.mark.parametrize(
        ("title", "topic"),
        [
            ("పోక్సో కేసు నమోదు, నిందితుడు అరెస్ట్", "minor"),
            ("రేప్ కేసులో నిందితుడు అరెస్ట్", "sexual_assault"),
            # Inflected forms the whole-word "అత్యాచారం" used to miss.
            ("మహిళపై అత్యాచారానికి యత్నం, నిందితుడి అరెస్ట్", "sexual_assault"),
            ("Woman sexually assaulted in bus, accused arrested", "sexual_assault"),
        ],
    )
    def test_the_telugu_spellings_of_pocso_and_rape_are_refused(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, title: str, topic: str
    ) -> None:
        """`is_sensitive` misses both, and the crawl now draws crime stories."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)
        article = make_article(db, title=title)

        with pytest.raises(AiSensitiveTopicError) as raised:
            ai_image_service.generate_for_article(db, article, actor_id=None, incident=True)

        assert raised.value.details["topic"] == topic
        assert provider.prompts == []
        # "రేపు" is tomorrow, not "రేప్".
        ai_image_service._screen(make_article(db, title="రేపు ఎన్నికలు"), None)

    def test_an_incident_that_names_a_child_is_a_minors_story(self, db: Session) -> None:
        """A child in a prize-day story is fine; a child in a kidnap is not."""
        article = make_article(db, title="బాలుడి కిడ్నాప్ కేసు ఛేదించిన పోలీసులు")
        ai_image_service._screen(article, None)
        with pytest.raises(AiSensitiveTopicError) as raised:
            ai_image_service._screen(article, None, incident=True)
        assert raised.value.details["topic"] == "minor"
        for plural in ("స్కూల్ బస్సు ప్రమాదం: ఇద్దరు చిన్నారులు మృతి", "రోడ్డు ప్రమాదంలో ముగ్గురు పిల్లలు మృతి"):
            with pytest.raises(AiSensitiveTopicError):
                ai_image_service._screen(make_article(db, title=plural), None, incident=True)

    @pytest.mark.parametrize(
        "brief",
        ["close-up portrait of the Chief Minister smiling", "ముఖ్యమంత్రి ముఖం కనిపించేలా"],
    )
    def test_a_brief_asking_for_a_face_is_refused_before_anything_is_spent(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, brief: str
    ) -> None:
        """A realistic face of a real person is a deepfake, and nothing checks
        the finished picture — so the request for one is where it stops."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)

        with pytest.raises(ValidationError):
            ai_image_service.generate_for_article(
                db, make_article(db), actor_id=None, brief=brief
            )
        assert provider.prompts == []
        assert _usage_rows(db, "image") == []

    def test_prominently_is_not_a_face(self) -> None:
        """ముఖం sits inside ప్రముఖంగా (prominently) and సుముఖంగా (willingly)."""
        assert not ai_image_service._LIKENESS.search("ఆలయ గోపురాన్ని ప్రముఖంగా చూపించండి")
        assert not ai_image_service._LIKENESS.search("సముద్ర తీరం, సుముఖంగా")

    def test_the_picture_lands_labelled_and_becomes_the_hero(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """§7.4 — `ai_generated` is the flag the reader clients render the
        label from, and the prompt and model are the provenance."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)
        article = make_article(db, state=WorkflowState.DRAFT)

        media = ai_image_service.generate_for_article(db, article, actor_id=None)

        assert media.ai_generated is True
        assert media.ai_model == "openai/gpt-image-1.5"
        assert article.title_te in (media.ai_prompt or "")
        assert "documentary PHOTOGRAPH" in (media.ai_prompt or "")
        # Representative, not the event: said in the caption and in `meta`.
        assert media.caption_te == "ప్రతీకాత్మక చిత్రం"
        assert (media.meta or {}).get("representative") is True
        assert "ప్రతీకాత్మక చిత్రం" in (media.alt_te or "")
        assert article.hero_media_id == media.id
        rows = _usage_rows(db, "image")
        assert len(rows) == 1
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(0.0202)

    def test_the_prompt_is_a_realistic_photo_inside_every_limit(
        self, db: Session
    ) -> None:
        """The owner wants realistic, not cartoon (2026-09-30), and a realistic
        picture is only safe inside these lines — so each one is pinned, and
        pinned after the brief that might argue with it."""
        article = make_article(db)
        prompt = ai_image_service.build_prompt(article, brief="the minister's face")
        rules = prompt[prompt.rindex("Non-negotiable"):]

        assert prompt.index("the minister's face") < prompt.rindex("Non-negotiable")
        for line in (
            "realistic, natural-light documentary PHOTOGRAPH",
            "not a cartoon",
            "generic, representative scene",
            "must not depict the specific event",
            "no likeness of any named or famous individual",
            "no figure standing in for a person the story names",
            "Show no clear face",
            "Put no text of any kind",
            "no logos, no signage",
            "no injured, sick or dead people",
            "no blood",
            "no weapons",
            "no children in distress",
            # Every prompt, not only the incident one: the editor's button and
            # the news card never pass `incident`.
            "Show no damage, wreckage, crashed or overturned vehicle, fire",
            "collapsed structure or disaster scene",
        ):
            assert line in rules, line
        assert "illustration" not in prompt.splitlines()[0].lower()
        assert "#0D47A1" not in prompt and "palette" not in prompt
        assert "Incident story" not in prompt

    def test_an_incident_story_is_drawn_as_its_surroundings_not_itself(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)
        article = make_article(db, state=WorkflowState.DRAFT)

        media = ai_image_service.generate_for_article(
            db, article, actor_id=None, incident=True
        )

        prompt = provider.prompts[0]
        assert "Incident story — show ONLY a generic, representative element" in prompt
        assert "Never the incident itself, its damage or its victims" in prompt
        assert prompt.index("Incident story") < prompt.rindex("Non-negotiable")
        assert (media.meta or {}).get("representative") is True

    def test_an_incident_is_one_whoever_asks(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The editor's button and the news card never pass `incident`; the
        story's own words make it one."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)

        ai_image_service.generate_for_article(
            db, make_article(db, title="పాత భవనం కూలింది"), actor_id=None
        )
        ai_image_service.generate_for_article(
            db, make_article(db, title="గాయని సునీత కచేరీ"), actor_id=None
        )

        assert "Incident story" in provider.prompts[0]
        assert "Incident story" not in provider.prompts[1], "a singer, not an injury"

    def test_the_creative_backdrop_is_still_a_text_free_design(
        self, db: Session
    ) -> None:
        """Realism is for news pictures only; a card backdrop stays a design."""
        prompt = ai_image_service.build_backdrop_prompt(
            make_article(db), width=1080, height=1080, references=False
        )
        assert "Draw ONLY an abstract graphic-design background" in prompt
        assert "nothing photographic or photorealistic" in prompt
        assert "#0D47A1" in prompt

    def test_a_picture_an_editor_chose_is_never_replaced_without_force(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        _install_image(monkeypatch, _FakeImage())
        article = make_article(db, state=WorkflowState.DRAFT)

        first = ai_image_service.generate_for_article(db, article, actor_id=None)
        second = ai_image_service.generate_for_article(db, article, actor_id=None)
        assert article.hero_media_id == first.id != second.id

        third = ai_image_service.generate_for_article(
            db, article, actor_id=None, force=True
        )
        assert article.hero_media_id == third.id

    def test_a_published_story_does_not_get_a_new_hero_behind_the_desk(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """This route checks permission and scope but not workflow state, so
        without the gate one POST would put an AI illustration in front of
        readers before any human had seen it — and `force` would paint over a
        photographer's picture on live copy. The media row is still filed."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        _install_image(monkeypatch, _FakeImage())
        article = make_article(db, state=WorkflowState.PUBLISHED)

        media = ai_image_service.generate_for_article(
            db, article, actor_id=None, force=True
        )

        assert media.id is not None
        assert article.hero_media_id is None

    @pytest.mark.parametrize(
        "state",
        [
            WorkflowState.SUBMITTED,
            WorkflowState.IN_REVIEW,
            WorkflowState.APPROVED,
            WorkflowState.SCHEDULED,
            WorkflowState.UPDATE_REVIEW,
            WorkflowState.UNPUBLISHED,
        ],
    )
    def test_no_state_past_the_desk_gets_a_hero_either_even_forced(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, state: WorkflowState
    ) -> None:
        """PUBLISHED is the dangerous one, but the gate is the editable set,
        not a published check — a story in review is somebody else's to change
        too. The picture is still filed and still returned: nothing is lost, it
        simply waits in the library until a human puts it on the story."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        _install_image(monkeypatch, _FakeImage())
        article = make_article(db, title=f"కథనం {state.value}", state=state)

        media = ai_image_service.generate_for_article(
            db, article, actor_id=None, force=True
        )

        assert article.hero_media_id is None
        assert db.get(Media, media.id) is not None
        assert media.ai_generated is True

    def test_a_story_sent_back_for_changes_is_still_editable(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The other half of the same set. A gate that only let DRAFT through
        would take the button away from exactly the copy being rewritten."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        _install_image(monkeypatch, _FakeImage())
        article = make_article(db, state=WorkflowState.CHANGES_REQUESTED)

        media = ai_image_service.generate_for_article(db, article, actor_id=None)

        assert article.hero_media_id == media.id

    def test_a_billed_draw_that_failed_is_recorded_at_its_cost_not_zero(
        self, db: Session, monkeypatch: pytest.MonkeyPatch, ledger_session: None
    ) -> None:
        """The adapter's `last_usage` has to reach the ledger, on a session
        that survives the rollback the re-raise triggers — otherwise an outage
        that costs 2 paise a press is free retries in a loop."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FailingImage()
        _install_image(monkeypatch, provider)
        article = make_article(db, state=WorkflowState.DRAFT)

        with pytest.raises(AiProviderError):
            ai_image_service.generate_for_article(db, article, actor_id=None)

        db.rollback()  # what `get_db` does when the request raises

        rows = _usage_rows(db, "image")
        assert len(rows) == 1
        assert rows[0].ok is False
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(0.0202)
        assert rows[0].model == catalogue.DEFAULT_IMAGE_MODEL

    def test_the_body_is_screened_not_just_the_headline(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """"Inquiry opens into the incident" names nothing; the incident is two
        paragraphs down, and that is the copy an image model must not draw."""
        enable_ai(db, monkeypatch, **{"ai.image_enabled": True})
        provider = _FakeImage()
        _install_image(monkeypatch, provider)
        article = make_article(
            db,
            title="ఘటనపై విచారణ ప్రారంభం",
            body="రెండు వర్గాల మధ్య ఘర్షణ జరిగిన ఘటనపై అధికారులు విచారణ చేపట్టారు.",
        )
        # `make_article` copies the body into the standfirst; clear it, or this
        # would pass on the old screen too.
        article.summary_te = None

        with pytest.raises(AiSensitiveTopicError) as raised:
            ai_image_service.generate_for_article(db, article, actor_id=None)

        assert raised.value.details["topic"] == "communal"
        assert provider.prompts == []

    def test_the_reason_names_which_switch_is_off(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Three causes on two screens: "unavailable" alone sends staff hunting
        for a bug that is really a checkbox."""
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": False, "ai.image_enabled": True})
        assert "AI is switched off" in (ai_image_service.unavailable_reason(db) or "")

        configure(db, **{"ai.enabled": True, "ai.image_enabled": False})
        assert "Image generation is switched off" in (
            ai_image_service.unavailable_reason(db) or ""
        )

        # Switched on, no key anywhere: there is no keyless way to draw.
        configure(db, **{"ai.image_enabled": True})
        assert "key" in (ai_image_service.unavailable_reason(db) or "")


# --------------------------------------------------------------------------- #
# The endpoint
# --------------------------------------------------------------------------- #
class TestImageEndpoint:
    def test_a_switched_off_feature_answers_with_a_reason_not_a_500(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": False})
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")

        response = client.post(
            f"/api/v1/cms/ai/articles/{article.id}/image", json={}, headers=headers
        )

        assert response.status_code == 200
        body = response.json()
        assert body["available"] is False and body["media"] is None
        assert "switched off" in body["reason"]

    def test_no_key_answers_with_a_reason_not_a_500(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": True})
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.DESK_EDITOR, email="desk@example.com")

        response = client.post(
            f"/api/v1/cms/ai/articles/{article.id}/image", json={}, headers=headers
        )

        assert response.status_code == 200
        assert response.json()["available"] is False
        assert "key" in response.json()["reason"]

    def test_it_enforces_the_same_permission_generate_audio_does(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Without this a stringer could spend the newsroom's image budget on
        somebody else's copy."""
        monkeypatch.setattr("app.core.config.settings.AI_ENABLED", True)
        configure(db, **{"ai.enabled": True, "ai.image_enabled": True})
        article = make_article(db)
        headers = staff_headers(db, role=RoleKey.PHOTO_VIDEO, email="photo@example.com")

        for path in ("ai/articles", "articles"):
            url = (
                f"/api/v1/cms/ai/articles/{article.id}/image"
                if path == "ai/articles"
                else f"/api/v1/cms/articles/{article.id}/generate-audio"
            )
            assert client.post(url, json={}, headers=headers).status_code == 403


# --------------------------------------------------------------------------- #
# Text calls that failed — billed, and counted
# --------------------------------------------------------------------------- #
class _BilledAi(_FakeAi):
    """Answers, and reports what the answer cost."""

    last_usage: dict[str, float | int] = {"usd_spent": 0.0089}

    def write_draft(self, **_kw: object) -> DraftText:
        return DraftText(
            title_te="కలిపే వాక్యాలు",
            summary_te="సారాంశం.",
            # Long enough to survive `_ai_connectives`' own usability filter,
            # which drops anything under eight characters.
            paragraphs_te=["తర్వాత ఈ వార్త.", "ఇక మరో వార్త."],
        )


class _FailingAi(_BilledAi):
    """A reasoning model that spent its output budget on thinking: the answer
    came back cut off, `_parse_json` raised, and the call was already billed."""

    def write_draft(self, **_kw: object) -> DraftText:
        raise AiProviderError(
            details={"provider": "fake", "error": "no JSON in model response"}
        )


class TestDraftLedger:
    def test_a_failed_draft_is_billed_on_a_row_the_rollback_cannot_take(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        ledger_session: None,
    ) -> None:
        """One row, `ok=False`, still there after the request unwinds — and
        therefore counted by `calls_today`. Without it `check_quota` never
        advances and the editor can press the button again, forever, at the
        editorial model's price."""
        enable_ai(db, monkeypatch)
        monkeypatch.setattr(ai_service, "get_ai", lambda **_kw: _FailingAi())
        actor = staff_user(db, role=RoleKey.REPORTER, email="reporter@example.com")
        suggestion = AiSuggestion(topic_te="జిల్లా బడ్జెట్ కేటాయింపులు", score=0.8)
        db.add(suggestion)
        db.flush()

        with pytest.raises(AiProviderError):
            ai_service.create_draft(db, suggestion.id, actor_id=actor.id)

        db.rollback()  # what `get_db` does when the request raises

        rows = _usage_rows(db, "draft")
        assert len(rows) == 1
        assert rows[0].ok is False
        assert rows[0].actor_id == actor.id
        assert rows[0].model == "fake/model"
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(0.0089)
        assert ai_usage_service.calls_today(db, actor.id) == 1


# --------------------------------------------------------------------------- #
# The bulletin — unattended, so nothing here surfaces except on the meter
# --------------------------------------------------------------------------- #
def _scripted_bulletin(db: Session, *, script: str = "") -> AudioBulletin:
    text = script or TELUGU_BODY
    row = AudioBulletin(
        bulletin_date=date(2026, 9, 18),
        slot=7,
        slot_label_te=bulletin_service.slot_label_te(7),
        script_te=text,
        script_hash="0" * 64,
        char_count=len(text),
        status=BulletinStatus.SCRIPTED,
    )
    db.add(row)
    db.flush()
    return row


class TestBulletinLedger:
    def test_the_connectives_call_is_recorded_when_it_answers(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`check_budget` runs before this call and reads a total this surface
        only contributes to because of this row."""
        enable_ai(db, monkeypatch, **{"bulletin.ai_script_enabled": True})
        monkeypatch.setattr(bulletin_service, "get_ai", lambda **_kw: _BilledAi())

        assert bulletin_service._ai_connectives(db, ["మొదటి శీర్షిక"]) is not None

        rows = _usage_rows(db, "draft")
        assert len(rows) == 1
        assert rows[0].ok is True
        assert rows[0].model == "fake/model"
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(0.0089)

    def test_the_connectives_call_is_recorded_when_it_fails(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The failure is swallowed — a bulletin still goes out with the fixed
        connectives — so the ledger is the only place it is visible at all."""
        enable_ai(db, monkeypatch, **{"bulletin.ai_script_enabled": True})
        monkeypatch.setattr(bulletin_service, "get_ai", lambda **_kw: _FailingAi())

        assert bulletin_service._ai_connectives(db, ["మొదటి శీర్షిక"]) is None

        rows = _usage_rows(db, "draft")
        assert len(rows) == 1
        assert rows[0].ok is False
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(0.0089)

    def test_a_refused_budget_is_not_recorded_as_an_outage(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The inner try is only around the call. A budget that refused before
        the provider was touched spent nothing, and a row for it would make the
        AI screen's failure count read as outages that never happened."""
        enable_ai(db, monkeypatch, **{"bulletin.ai_script_enabled": True})
        monkeypatch.setattr(bulletin_service, "get_ai", lambda **_kw: _BilledAi())
        monkeypatch.setattr(
            "app.core.config.settings.AI_MONTHLY_BUDGET_INR", 0.01
        )
        ai_usage_service.record(
            db, operation="draft", provider="fake", usage={"usd_spent": 1.0}
        )

        assert bulletin_service._ai_connectives(db, ["మొదటి శీర్షిక"]) is None

        # Only the seed row above.
        assert len(_usage_rows(db, "draft")) == 1

    def _install_bulletin_tts(
        self, monkeypatch: pytest.MonkeyPatch, provider: TtsProvider
    ) -> None:
        monkeypatch.setattr(bulletin_service, "get_tts", lambda **_kw: provider)
        monkeypatch.setattr(
            bulletin_service, "get_storage", lambda *_a, **_kw: _Storage()
        )

    def test_a_rendered_bulletin_writes_one_row_for_all_its_segments(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Six unattended slots a day, sharing a budget with article audio."""
        bulletin = _scripted_bulletin(db, script=TELUGU_BODY * 40)
        segments = len(audio_concat.split_for_tts(bulletin.script_te or ""))
        assert segments > 1
        provider = _FakeTts(usd=0.001)
        self._install_bulletin_tts(monkeypatch, provider)

        out = bulletin_service.render(db, bulletin, requested_by=None)

        assert out.status == BulletinStatus.READY
        rows = _usage_rows(db, "tts")
        assert len(rows) == 1
        assert rows[0].ok is True
        assert rows[0].model == "openai/gpt-4o-mini-tts"
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(0.001 * segments)

    def test_a_failed_render_bills_the_segments_that_answered(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`workers/tasks/bulletin.py` retries a FAILED slot until attempts is
        three, so one bad slot can pay for three renders. Unrecorded, the meter
        reads zero for all of it."""
        bulletin = _scripted_bulletin(db, script=TELUGU_BODY * 40)
        segments = len(audio_concat.split_for_tts(bulletin.script_te or ""))
        provider = _FakeTts(usd=0.001, fail_on=segments)
        self._install_bulletin_tts(monkeypatch, provider)

        out = bulletin_service.render(db, bulletin, requested_by=None)

        assert out.status == BulletinStatus.FAILED
        rows = _usage_rows(db, "tts")
        assert len(rows) == 1
        assert rows[0].ok is False
        assert rows[0].cost_paise == ai_usage_service.usd_to_paise(
            0.001 * (segments - 1)
        )
        assert rows[0].cost_paise > 0


# --------------------------------------------------------------------------- #
# The photo check and the filing — llm.py with httpx.post patched
# --------------------------------------------------------------------------- #
def _reply(content: str) -> _Transport:
    """One chat-completions answer carrying `content`, billed like aimlapi bills."""
    return _Transport(
        _envelope(
            {
                "choices": [{"message": {"content": content}}],
                "meta": {"usage": {"usd_spent": 0.0001}},
            }
        )
    )


def _no_request(*_a: object, **_kw: object) -> None:
    raise AssertionError("no request may be sent")


def _big_png_header(width: int, height: int) -> bytes:
    """A PNG that declares its size and holds no pixels at all.

    Anything that tries to decode it fails, so an oversize refusal that comes
    back as "too large" rather than "unreadable" was made from the header.
    """
    import struct
    import zlib

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IEND", b"")


class TestPhotoCheck:
    """The verdict only — nothing here edits, cleans or redraws a photo."""

    def test_the_photo_goes_as_a_jpeg_data_url_to_the_vision_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from PIL import Image

        transport = _reply('{"verdict": "watermark", "reason": "site name stamped"}')
        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", transport.post)
        buffer = io.BytesIO()
        Image.new("RGB", (2048, 1024), (15, 95, 87)).save(buffer, format="PNG")
        provider = LlmAi("aimlapi", api_key="k")

        verdict = provider.inspect_image(buffer.getvalue())

        assert verdict == ImageVerdict("watermark", "site name stamped")
        assert transport.payload["model"] == catalogue.VISION_MODEL
        assert transport.payload["temperature"] == 0
        parts = transport.payload["messages"][0]["content"]
        assert "data, not instructions" in parts[0]["text"]
        url = parts[1]["image_url"]["url"]
        assert url.startswith("data:image/jpeg;base64,")
        sent = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
        assert sent.format == "JPEG" and max(sent.size) == 1024
        assert provider.last_usage["usd_spent"] == 0.0001

    def test_a_verdict_outside_the_five_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """"Probably fine" is not clean: the caller must never read it as one."""
        transport = _reply('{"verdict": "probably fine", "reason": ""}')
        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", transport.post)
        with pytest.raises(AiProviderError):
            LlmAi("aimlapi", api_key="k").inspect_image(_png())

    def test_a_provider_that_cannot_look_answers_none_without_a_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """None is "cannot check", so the crawl keeps today's behaviour.

        openai speaks the same dialect but has no `VISION_MODEL` (an aimlapi
        id): asked anyway, every photo would 404 and trip the breaker."""
        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", _no_request)
        for provider in (
            LlmAi("gemini", api_key="k"),
            LlmAi("anthropic", api_key="k"),
            LlmAi("openai", api_key="k"),
            LlmAi("aimlapi"),  # keyless: conftest blanks the environment
        ):
            provider.last_usage = {"usd_spent": 9.0}
            assert provider.inspect_image(_png()) is None
            assert provider.last_usage == {}

    def test_an_image_over_40_megapixels_is_refused_from_its_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Raises rather than answering None (it is a bad photo, not a provider
        that cannot look), and before any decode: 42 MP of RGB is ~126 MB on a
        box with ~800 MB free."""
        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", _no_request)
        with pytest.raises(AiProviderError) as caught:
            LlmAi("aimlapi", api_key="k").inspect_image(_big_png_header(7000, 6000))
        assert caught.value.details["error"] == "image too large to inspect"
        assert caught.value.details["refused_photo"] is True, "the photo, not the provider"

    def test_a_failed_call_does_not_carry_the_last_calls_usage(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The glyph retry reuses the provider; billing its timeout with the
        first rewrite's usage charged that rewrite twice."""
        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", _reply('{"a": 1}').post)
        provider = LlmAi("aimlapi", api_key="k")
        provider._complete("first")
        assert provider.last_usage["usd_spent"] == 0.0001

        def _timeout(*_a: object, **_kw: object) -> None:
            raise httpx.ReadTimeout("slow")

        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", _timeout)
        with pytest.raises(AiProviderError):
            provider._complete("second")
        assert provider.last_usage == {}


_TAXONOMY = {
    "categories": [
        {"slug": "politics", "name": "రాజకీయాలు", "children": []},
        {
            "slug": "sports",
            "name": "క్రీడలు",
            "children": [{"slug": "cricket", "name": "క్రికెట్"}],
        },
    ],
    "districts": ["Guntur", "Krishna"],
}

_REWRITE_ANSWER = {
    "title_te": "గుంటూరులో కొత్త స్టేడియం",
    "summary_te": "సారాంశం.",
    "paragraphs_te": ["మొదటి పేరా.", "రెండో పేరా."],
    "confidence": 0.8,
    "unverified": False,
    "refused": False,
    "refusal_reason": None,
}

#: The JSON contract as it stood before classification existed. A rewrite with
#: no taxonomy must still end on exactly these words.
_OLD_CONTRACT_TAIL = (
    'Return JSON: {"title_te": "under 100 characters", "summary_te": '
    '"about 40 words", "paragraphs_te": ["...", "..."], "confidence": '
    '0.0-1.0, "unverified": true|false, "refused": false, '
    '"refusal_reason": null}. '
    "Write four to eight paragraphs, about 220 words in total."
)


class TestRewriteFiling:
    def _rewrite(
        self, monkeypatch: pytest.MonkeyPatch, answer: dict, **kw: object
    ) -> tuple[RewriteText, str]:
        import json

        transport = _reply(json.dumps(answer, ensure_ascii=False))
        monkeypatch.setattr("app.integrations.ai.llm.httpx.post", transport.post)
        out = LlmAi("aimlapi", api_key="k").rewrite_item(
            headline="Stadium",
            body_text="పదాలు " * 60,
            publisher="P",
            source_url="https://p.example/a",
            credit_source=False,
            **kw,
        )
        return out, transport.payload["messages"][0]["content"]

    def test_the_offered_taxonomy_is_in_the_prompt_and_the_filing_comes_back(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        answer = {
            **_REWRITE_ANSWER,
            "category": "sports",
            "subcategory": "cricket",
            "district": "Guntur",
            "place": "తెనాలి",
            "tags": [{"name_te": "గుంటూరు", "type": "place"}, "not a tag"],
            "breaking": True,
        }
        out, prompt = self._rewrite(monkeypatch, answer, taxonomy=_TAXONOMY)

        for offered in ("politics", "sports", "cricket", "Guntur", "Krishna"):
            assert offered in prompt
        assert out.classification == {
            "category": "sports",
            "subcategory": "cricket",
            "district": "Guntur",
            "place": "తెనాలి",
            "tags": [{"name_te": "గుంటూరు", "type": "place"}],
            "breaking": True,
        }

    def test_breaking_is_a_literal_true_or_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        answer = {**_REWRITE_ANSWER, "category": 7, "breaking": "true"}
        out, _ = self._rewrite(monkeypatch, answer, taxonomy=_TAXONOMY)
        assert out.classification["category"] is None
        assert out.classification["breaking"] is False

    def test_without_a_taxonomy_the_prompt_is_the_old_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        out, prompt = self._rewrite(monkeypatch, {**_REWRITE_ANSWER, "category": "x"})
        assert prompt.endswith(_OLD_CONTRACT_TAIL)
        assert '"category"' not in prompt and '"breaking"' not in prompt
        assert out.classification is None
