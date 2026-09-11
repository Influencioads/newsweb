"""Phase K — the three-hourly audio bulletin, and the chunked synthesis under it.

The load-bearing assertions:

  * a bulletin reads only stories that are already published;
  * the kill switch hides one that is already live;
  * `[రాయవలసి ఉంది]` — the keyless provider's "a journalist must write this"
    skeleton — can never be broadcast;
  * long Telugu copy is split by *bytes*, because that is what providers count
    and Telugu costs three of them per character.
"""

from __future__ import annotations

import io
import math
import os
import struct
import wave
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.tts.base import Synthesis, TtsProvider  # noqa: E402
from app.main import app  # noqa: E402
from app.models.bulletin import AudioBulletin  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    BulletinStatus,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import (  # noqa: E402
    audio_concat,
    auth_service,
    bulletin_service,
    settings_service,
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

IST = bulletin_service.IST


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
    from app.models.bulletin import AudioBulletinItem

    db.query(AudioBulletinItem).delete()
    db.query(AudioBulletin).delete()
    db.query(Article).delete()
    db.query(AppSetting).delete()
    db.commit()
    settings_service.invalidate()


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


TELUGU_SUMMARY = (
    "ఆంధ్రప్రదేశ్‌లో కొత్త పథకం ప్రారంభమైంది. లబ్ధిదారులకు నేరుగా సాయం అందుతుంది. "
    "అధికారులు వివరాలు వెల్లడించారు. ప్రజలు హర్షం వ్యక్తం చేశారు. "
)


def publish_story(
    db: Session,
    *,
    title: str,
    when: datetime,
    status=ArticleStatus.PUBLISHED,
    summary: str | None = None,
) -> Article:
    text = summary or TELUGU_SUMMARY
    article = Article(
        short_id=f"b{abs(hash((title, when))) % 100000:05d}",
        slug=f"story-{abs(hash(title)) % 10000}",
        title_te=title,
        summary_te=text,
        body={"type": "doc", "content": []},
        body_plain=text,
        status=status,
        workflow_state=(
            WorkflowState.PUBLISHED
            if status == ArticleStatus.PUBLISHED
            else WorkflowState.DRAFT
        ),
        published_at=when,
    )
    db.add(article)
    db.flush()
    return article


class FakeTts(TtsProvider):
    """Counts calls and returns real, joinable WAV bytes."""

    key = "fake"

    def __init__(self) -> None:
        self.calls = 0
        self.texts: list[str] = []

    def synthesise(self, text: str, *, language: str, voice: str | None = None) -> Synthesis:
        self.calls += 1
        self.texts.append(text)
        rate = 22050
        seconds = max(1, round(len(text) / 12.0))
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(
                b"".join(
                    struct.pack("<h", int(1000 * math.sin(i / 30)))
                    for i in range(rate * seconds)
                )
            )
        return Synthesis(
            audio=buffer.getvalue(), mime="audio/wav", duration_sec=seconds, voice="fake-te"
        )


def install_tts(monkeypatch: pytest.MonkeyPatch, provider: TtsProvider) -> None:
    monkeypatch.setattr(
        "app.services.bulletin_service.get_tts", lambda *_a, **_k: provider
    )


def slot_time(day: date, slot: int, *, minutes: int = -30) -> datetime:
    """A moment inside a slot's window, in UTC."""
    return datetime.combine(day, time(hour=slot), tzinfo=IST) + timedelta(minutes=minutes)


# --------------------------------------------------------------------------- #
# Chunked synthesis — the bug this feature sits on top of
# --------------------------------------------------------------------------- #
class TestChunking:
    def test_telugu_is_split_by_bytes_not_characters(self) -> None:
        """Google caps a request at 5 000 BYTES. Telugu is three per character,
        so the old 5 000-character limit was both too large for the API and too
        small for a feature."""
        text = TELUGU_SUMMARY * 40
        assert len(text.encode("utf-8")) > 4_500
        chunks = audio_concat.split_for_tts(text)
        assert len(chunks) > 1
        for chunk in chunks:
            assert len(chunk.encode("utf-8")) <= audio_concat.MAX_UTF8_BYTES_PER_CALL

    def test_splitting_round_trips_the_words(self) -> None:
        import re

        text = TELUGU_SUMMARY * 40
        rejoined = " ".join(audio_concat.split_for_tts(text))
        normalise = lambda s: re.sub(r"\s+", " ", s).strip()  # noqa: E731
        assert normalise(rejoined) == normalise(text)

    def test_wav_join_sums_the_frames_and_measures_duration(self) -> None:
        provider = FakeTts()
        one = provider.synthesise("x" * 12, language="te-IN")
        two = provider.synthesise("y" * 24, language="te-IN")
        joined, measured = audio_concat.concat_wav([one.audio, two.audio])
        assert measured == one.duration_sec + two.duration_sec
        with wave.open(io.BytesIO(joined)) as handle:
            assert handle.getframerate() == 22050

    def test_mismatched_wav_formats_raise_rather_than_pitch_shift(self) -> None:
        def tone(rate: int) -> bytes:
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(rate)
                out.writeframes(b"\x00\x00" * rate)
            return buffer.getvalue()

        with pytest.raises(ValueError):
            audio_concat.concat_wav([tone(22050), tone(16000)])

    def test_mp3_join_strips_id3_blocks(self) -> None:
        header = b"ID3\x04\x00\x00" + bytes([0, 0, 0, 10]) + b"X" * 10
        frame = b"\xff\xfb\x90\x00DATA"
        trailer = b"TAG" + b"0" * 125
        out = audio_concat.concat_mp3([header + frame, header + frame + trailer])
        assert b"ID3" not in out
        assert b"TAG" not in out
        assert out.count(b"\xff\xfb") == 2


# --------------------------------------------------------------------------- #
# Slots
# --------------------------------------------------------------------------- #
class TestSlots:
    def test_six_slots_from_six_to_nine(self) -> None:
        assert bulletin_service.SLOTS == (6, 9, 12, 15, 18, 21)

    def test_the_6am_window_reaches_back_to_the_previous_evening(self) -> None:
        """Overnight news must be carried, not dropped — that gap is the
        longest in the cycle."""
        start, end = bulletin_service.window_for(date(2026, 9, 11), 6)
        assert start.astimezone(IST).date() == date(2026, 9, 10)
        assert start.astimezone(IST).hour == 21
        assert end.astimezone(IST).hour == 6

    def test_a_late_worker_still_produces_the_slot(self) -> None:
        moment = datetime(2026, 9, 11, 7, 20, tzinfo=IST)
        assert bulletin_service.current_slot(moment) == 6

    def test_but_not_a_stale_one(self) -> None:
        """Publishing a '12 o'clock bulletin' at two in the afternoon is worse
        than publishing nothing."""
        moment = datetime(2026, 9, 11, 14, 0, tzinfo=IST)
        assert bulletin_service.current_slot(moment) is None


# --------------------------------------------------------------------------- #
# Content
# --------------------------------------------------------------------------- #
class TestContent:
    def test_only_published_stories_are_read(self, db: Session) -> None:
        """This is the entire basis on which a bulletin may go live without a
        further approval."""
        day = bulletin_service.today()
        publish_story(db, title="ప్రచురించిన వార్త ఒకటి", when=slot_time(day, 12))
        publish_story(
            db,
            title="డ్రాఫ్ట్‌లో ఉన్న వార్త",
            when=slot_time(day, 12),
            status=ArticleStatus.DRAFT,
        )
        db.commit()

        chosen = bulletin_service.select_stories(db, day, 12, limit=10)
        titles = {a.title_te for a in chosen}
        assert "ప్రచురించిన వార్త ఒకటి" in titles
        assert "డ్రాఫ్ట్‌లో ఉన్న వార్త" not in titles

    def test_the_script_fits_three_minutes(self, db: Session) -> None:
        day = bulletin_service.today()
        articles = [
            publish_story(db, title=f"వార్త శీర్షిక సంఖ్య {i}", when=slot_time(day, 12))
            for i in range(8)
        ]
        db.commit()

        script, spoken = bulletin_service.build_script(
            db, day=day, slot=12, articles=articles
        )
        assert len(spoken) == 8
        assert len(script) <= bulletin_service.MAX_SCRIPT_CHARS
        seconds = len(script) / bulletin_service.CHARS_PER_SECOND
        assert 100 <= seconds <= 210, seconds

    def test_the_heuristic_skeleton_can_never_be_broadcast(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`HeuristicAi.write_draft` returns "[రాయవలసి ఉంది] …" — literally
        "needs writing", meant for a journalist. Speaking it to listeners is a
        failure nobody would catch until a reader complained."""
        configure(db, **{"ai.enabled": True, "bulletin.ai_script_enabled": True})
        day = bulletin_service.today()
        articles = [
            publish_story(db, title=f"శీర్షిక {i}", when=slot_time(day, 12))
            for i in range(3)
        ]
        db.commit()

        script, _spoken = bulletin_service.build_script(
            db, day=day, slot=12, articles=articles
        )
        assert "[రాయవలసి ఉంది]" not in script
        assert "[" not in script

    def test_a_slot_with_no_stories_is_skipped_not_empty(self, db: Session) -> None:
        configure(db, **{"bulletin.enabled": True})
        day = bulletin_service.today()
        bulletin = bulletin_service.get_or_create(db, day, 12)
        bulletin_service.script_bulletin(db, bulletin)
        db.commit()
        assert bulletin.status == BulletinStatus.SKIPPED


# --------------------------------------------------------------------------- #
# Rendering and the kill switch
# --------------------------------------------------------------------------- #
class TestRenderAndSwitches:
    def _prepare(self, db: Session, monkeypatch: pytest.MonkeyPatch, slot: int = 12):
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        for i in range(6):
            publish_story(db, title=f"ముఖ్య వార్త {i}", when=slot_time(day, slot))
        db.commit()
        return provider, day

    def test_run_slot_produces_and_publishes(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True, "voice.enabled": True})
        provider, day = self._prepare(db, monkeypatch)

        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None
        assert bulletin.status == BulletinStatus.PUBLISHED
        assert bulletin.url
        assert provider.calls >= 1
        assert bulletin.duration_sec > 0
        assert len(bulletin.items) >= 1

    def test_run_slot_is_idempotent(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        bulletin_service.run_slot(db, day=day, slot=12)
        bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        rows = db.scalars(
            select(AudioBulletin).where(AudioBulletin.bulletin_date == day)
        ).all()
        assert len(rows) == 1

    def test_requires_approval_holds_it_at_ready(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True, "bulletin.requires_approval": True})
        _provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None
        assert bulletin.status == BulletinStatus.READY
        assert bulletin.published_at is None

    def test_the_kill_switch_hides_a_published_bulletin(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None and bulletin.status == BulletinStatus.PUBLISHED
        assert bulletin_service.serialize(db, bulletin)["available"] is True

        configure(db, **{"bulletin.enabled": False})
        payload = bulletin_service.serialize(db, bulletin)
        assert payload["available"] is False
        # The players branch on this and render nothing — no new client code.
        assert payload["voice_enabled"] is False

    def test_pull_takes_it_off_the_air_but_keeps_the_audio(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None
        url = bulletin.url

        bulletin_service.pull(db, bulletin)
        db.commit()
        assert bulletin.status == BulletinStatus.READY
        assert bulletin.url == url, "the audio is kept so it can go back"
        assert bulletin_service.serialize(db, bulletin)["available"] is False

    def test_a_long_script_takes_several_provider_calls(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The §0.1 regression check: before chunking, a script this long
        returned HTTP 400 and was written off as FAILED forever."""
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        configure(db, **{"bulletin.enabled": True, "bulletin.target_seconds": 200})
        day = bulletin_service.today()
        # Each story needs real copy behind it: the script is bounded by the
        # source text as well as by the target, and short summaries produce a
        # short bulletin no matter what the target says.
        for i in range(8):
            publish_story(
                db,
                title=f"పొడవైన వార్త {i}",
                when=slot_time(day, 12),
                summary=TELUGU_SUMMARY * 4,
            )
        db.commit()

        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None
        assert bulletin.char_count > 1_650, "a real three-minute Telugu script"
        assert len(bulletin.script_te.encode("utf-8")) > 4_500
        assert bulletin.segment_count >= 2
        for text in provider.texts:
            assert len(text.encode("utf-8")) <= audio_concat.MAX_UTF8_BYTES_PER_CALL

    def test_bulletin_characters_count_against_the_same_budget(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """One ceiling, not two — otherwise each half could spend the whole
        allowance and the settings screen would show neither."""
        from app.services import tts_service

        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        before = tts_service.month_chars_used(db)
        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None
        assert tts_service.month_chars_used(db) == before + bulletin.char_count

    def test_an_exhausted_budget_fails_the_bulletin_rather_than_spending(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(
            db,
            **{"bulletin.enabled": True, "voice.monthly_char_budget": 10},
        )
        provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None
        assert bulletin.status == BulletinStatus.FAILED
        assert "budget" in (bulletin.error or "")
        assert provider.calls == 0


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
class TestEndpoints:
    def test_latest_matches_the_article_audio_payload_shape(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The players key off exactly these fields; a different shape would
        mean writing them again."""
        configure(db, **{"bulletin.enabled": True})
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        publish_story(db, title="ఒక ప్రచురిత వార్త", when=slot_time(day, 12))
        db.commit()
        bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()

        body = client.get("/api/v1/public/bulletins/latest").json()
        for key in (
            "available", "url", "mime", "duration_sec", "voice", "provider",
            "fallback", "voice_enabled",
        ):
            assert key in body, key
        assert body["available"] is True
        assert body["slot"] == 12
        assert body["items"]

    def test_an_unpublished_slot_is_404_to_readers(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True, "bulletin.requires_approval": True})
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        publish_story(db, title="మరో వార్త ఇక్కడ", when=slot_time(day, 12))
        db.commit()
        bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()

        response = client.get(f"/api/v1/public/bulletins/{day.isoformat()}/12")
        assert response.status_code == 404

    def test_running_while_disabled_is_refused(
        self, db: Session, client: TestClient
    ) -> None:
        configure(db, **{"bulletin.enabled": False})
        headers = staff_headers(db, role=RoleKey.ADMIN, email="bulletin-admin@test.local")
        response = client.post("/api/v1/cms/bulletins/run", headers=headers, json={})
        assert response.status_code == 422

    def test_editing_the_script_drops_it_back_to_scripted(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The path that lets an editor fix a mispronunciation without
        abandoning the automation."""
        configure(db, **{"bulletin.enabled": True})
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        publish_story(db, title="సరిచేయవలసిన వార్త", when=slot_time(db and day, 12))
        db.commit()
        bulletin = bulletin_service.run_slot(db, day=day, slot=12)
        db.commit()
        assert bulletin is not None

        headers = staff_headers(db, role=RoleKey.ADMIN, email="bulletin-admin@test.local")
        response = client.patch(
            f"/api/v1/cms/bulletins/{bulletin.id}",
            headers=headers,
            json={"script_te": "ఎడిటర్ స్వయంగా రాసిన స్క్రిప్ట్ ఇది. ఇది వినిపిస్తుంది."},
        )
        assert response.status_code == 200
        assert response.json()["status"] == BulletinStatus.SCRIPTED

    def test_no_bulletin_route_touches_article_publishing(self) -> None:
        paths = [r.path for r in app.routes if "bulletin" in getattr(r, "path", "")]
        assert paths
        assert not [p for p in paths if "/articles" in p]
