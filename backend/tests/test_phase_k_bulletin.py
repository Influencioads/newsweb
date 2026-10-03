"""Phase K — the daily audio bulletins, and the chunked synthesis under it.

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
        self.voices: list[str | None] = []

    def synthesise(self, text: str, *, language: str, voice: str | None = None) -> Synthesis:
        self.calls += 1
        self.texts.append(text)
        self.voices.append(voice)
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

    def test_neha_is_sent_one_sentence_at_a_time(self) -> None:
        """Sarvam cuts the end off a long passage in her voice; one sentence
        per request comes back whole."""
        from app.services import tts_service

        whole, split = FakeTts(), FakeTts()
        tts_service.synthesise_long(TELUGU_SUMMARY, language="te-IN", voice="ritu", provider=whole)
        tts_service.synthesise_long(TELUGU_SUMMARY, language="te-IN", voice="neha", provider=split)
        assert (whole.calls, split.calls) == (1, 4)
        assert " ".join(split.texts) == whole.texts[0]

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
    def test_six_slots_from_seven_to_nine(self) -> None:
        assert bulletin_service.SLOTS == (7, 9, 15, 17, 19, 21)

    def test_every_slot_has_a_name_and_only_slots_do(self) -> None:
        """A slot without a name would speak the generic fallback; a name
        without a slot is a rename that never went on air."""
        assert set(bulletin_service._LABELS_TE) == set(bulletin_service.SLOTS)
        assert bulletin_service.slot_label_te(7) == "గరం చాయ్ న్యూస్"

    def test_the_catch_up_window_is_shorter_than_any_gap(self) -> None:
        """Otherwise a late worker could produce the previous slot twice."""
        slots = bulletin_service.SLOTS
        gap = min(b - a for a, b in zip(slots, slots[1:], strict=False))
        assert bulletin_service.CATCH_UP_MINUTES < gap * 60

    def test_the_7am_window_reaches_back_to_the_previous_evening(self) -> None:
        """Overnight news must be carried, not dropped — that gap is the
        longest in the cycle. Each edge is a recording time, quarter to."""
        start, end = bulletin_service.window_for(date(2026, 9, 11), 7)
        assert start.astimezone(IST) == datetime(2026, 9, 10, 20, 45, tzinfo=IST)
        assert end.astimezone(IST) == datetime(2026, 9, 11, 6, 45, tzinfo=IST)

    def test_windows_meet_so_no_story_falls_between_recordings(self) -> None:
        day = date(2026, 9, 11)
        slots = bulletin_service.SLOTS
        for before, after in zip(slots, slots[1:], strict=False):
            assert bulletin_service.window_for(day, before)[1] == bulletin_service.window_for(day, after)[0]

    def test_the_recording_is_made_quarter_to_and_finds_only_its_slot(self) -> None:
        at = lambda h, m=0: datetime(2026, 9, 11, h, m, tzinfo=IST)  # noqa: E731
        assert bulletin_service.upcoming_slot(at(6, 45)) == 7
        assert bulletin_service.upcoming_slot(at(6, 30)) == 7  # a late worker
        assert bulletin_service.upcoming_slot(at(6, 10)) is None
        assert bulletin_service.upcoming_slot(at(7)) is None  # the hour airs it
        assert bulletin_service.upcoming_slot(at(20, 45)) == 21
        slots = bulletin_service.SLOTS
        gap = min(b - a for a, b in zip(slots, slots[1:], strict=False))
        assert 5 < bulletin_service.LEAD_MINUTES and 2 * bulletin_service.LEAD_MINUTES < gap * 60

    def test_the_beat_records_at_quarter_to_and_airs_on_the_hour(self) -> None:
        from app.workers.celery_app import celery

        beat = celery.conf.beat_schedule
        prepare, air = beat["bulletin-prepare"]["schedule"], beat["bulletin-slots"]["schedule"]
        assert (prepare.minute, prepare.hour) == ({45}, {6, 8, 14, 16, 18, 20})
        assert (air.minute, air.hour) == ({0}, set(bulletin_service.SLOTS))
        assert beat["bulletin-prepare"]["options"]["expires"] == 600

    def test_each_slot_has_its_anchor_a_woman_and_a_man_in_turn(self) -> None:
        from app.integrations.ai import catalogue

        anchors = [bulletin_service._ANCHORS[s] for s in bulletin_service.SLOTS]
        assert set(bulletin_service._ANCHORS) == set(bulletin_service.SLOTS)
        assert anchors == ["shreya", "soham", "neha", "sunny", "ritu", "rohan"]
        assert set(anchors) <= set(catalogue.tts_voices("sarvam/bulbul:v3"))

    def test_a_late_worker_still_produces_the_slot(self) -> None:
        moment = datetime(2026, 9, 11, 8, 20, tzinfo=IST)
        assert bulletin_service.current_slot(moment) == 7

    def test_but_not_a_stale_one(self) -> None:
        """Publishing a '1 o'clock bulletin' at quarter to three is worse than
        publishing nothing."""
        moment = datetime(2026, 9, 11, 14, 45, tzinfo=IST)
        assert bulletin_service.current_slot(moment) is None


# --------------------------------------------------------------------------- #
# Content
# --------------------------------------------------------------------------- #
class TestContent:
    def test_only_published_stories_are_read(self, db: Session) -> None:
        """This is the entire basis on which a bulletin may go live without a
        further approval."""
        day = bulletin_service.today()
        publish_story(db, title="ప్రచురించిన వార్త ఒకటి", when=slot_time(day, 15))
        publish_story(
            db,
            title="డ్రాఫ్ట్‌లో ఉన్న వార్త",
            when=slot_time(day, 15),
            status=ArticleStatus.DRAFT,
        )
        db.commit()

        chosen = bulletin_service.select_stories(db, day, 15, limit=10)
        titles = {a.title_te for a in chosen}
        assert "ప్రచురించిన వార్త ఒకటి" in titles
        assert "డ్రాఫ్ట్‌లో ఉన్న వార్త" not in titles

    def test_the_script_fits_three_minutes(self, db: Session) -> None:
        day = bulletin_service.today()
        articles = [
            publish_story(db, title=f"వార్త శీర్షిక సంఖ్య {i}", when=slot_time(day, 15))
            for i in range(8)
        ]
        db.commit()

        script, spoken = bulletin_service.build_script(
            db, day=day, slot=15, articles=articles
        )
        assert len(spoken) == 8
        assert len(script) <= bulletin_service.MAX_SCRIPT_CHARS
        seconds = len(script) / bulletin_service.CHARS_PER_SECOND
        assert 100 <= seconds <= 210, seconds
        # Each story's headline ends in a full stop, so the voice pauses before the story.
        assert all(piece.startswith("వార్త శీర్షిక సంఖ్య ") and ". " in piece for _a, piece in spoken)

    def test_it_greets_then_reads_each_story_clean_between_stings(self, db: Session) -> None:
        """Greeting ♪ story ♪ story ♪ close — no headline roll, no spoken filler."""
        day = bulletin_service.today()
        articles = [
            publish_story(db, title=f"శీర్షిక {i}", when=slot_time(day, 7)) for i in range(3)
        ]
        db.commit()

        script, spoken = bulletin_service.build_script(db, day=day, slot=7, articles=articles)
        blocks = [b.strip() for b in script.split(bulletin_service.MUSIC_MARK)]
        assert blocks[0] == "నమస్తే! మీరు వింటున్నారు గరం చాయ్ న్యూస్, టాప్ తెలుగు న్యూస్ నుంచి."
        assert blocks[1:-1] == [piece for _a, piece in spoken]
        assert blocks[-1] == bulletin_service._CLOSE_TE

    def test_a_slot_with_no_stories_is_skipped_not_empty(self, db: Session) -> None:
        configure(db, **{"bulletin.enabled": True})
        day = bulletin_service.today()
        bulletin = bulletin_service.get_or_create(db, day, 15)
        bulletin_service.script_bulletin(db, bulletin)
        db.commit()
        assert bulletin.status == BulletinStatus.SKIPPED

    def test_rescripting_refreshes_a_renamed_slot(self, db: Session) -> None:
        """A row made before a rename must show the name its opener now says."""
        configure(db, **{"bulletin.enabled": True})
        bulletin = bulletin_service.get_or_create(db, bulletin_service.today(), 9)
        bulletin.slot_label_te = "ఉదయం 9 గంటల బులెటిన్"
        bulletin_service.script_bulletin(db, bulletin)
        assert bulletin.slot_label_te == bulletin_service.slot_label_te(9)


# --------------------------------------------------------------------------- #
# Rendering and the kill switch
# --------------------------------------------------------------------------- #
class TestRenderAndSwitches:
    def _prepare(self, db: Session, monkeypatch: pytest.MonkeyPatch, slot: int = 15):
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

        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
        db.commit()
        assert bulletin is not None
        assert bulletin.status == BulletinStatus.PUBLISHED
        assert bulletin.url
        assert provider.calls >= 1
        assert bulletin.duration_sec > 0
        assert len(bulletin.items) >= 1

    def test_a_sting_plays_between_blocks_and_is_never_spoken(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
        db.commit()
        assert bulletin is not None and bulletin.status == BulletinStatus.PUBLISHED

        stings = bulletin.script_te.count(bulletin_service.MUSIC_MARK)
        assert stings == len(bulletin.items) + 1
        assert not any(bulletin_service.MUSIC_MARK in t for t in provider.texts)
        voiced = sum(max(1, round(len(t) / 12.0)) for t in provider.texts)
        # 0.4 s + 2.5 s sting + 0.25 s, each
        assert abs(bulletin.duration_sec - (voiced + stings * 3.15)) <= 1

    def test_the_sting_takes_the_voice_format_and_sits_under_it(self) -> None:
        rate = 8000  # far from the asset's 22.05 kHz: the resample path
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(rate)
            out.writeframes(
                b"".join(struct.pack("<h", int(1000 * math.sin(i / 3))) for i in range(rate))
            )

        sting = bulletin_service._sting_like([buffer.getvalue()])
        assert sting is not None
        with wave.open(io.BytesIO(sting)) as w:
            assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, rate)
            assert abs(w.getnframes() / rate - 3.15) < 0.01
            frames = w.readframes(w.getnframes())
        samples = struct.unpack(f"<{len(frames) // 2}h", frames)
        music = samples[int(0.4 * rate) : int(0.4 * rate) + int(2.5 * rate)]
        assert not any(samples[: int(0.4 * rate)])  # the silence before it
        level = math.sqrt(sum(s * s for s in music) / len(music))
        # The voice RMS is ~707; the sting sits 6 dB under it.
        assert 707 * 10 ** (-7 / 20) < level < 707 * 10 ** (-5 / 20)

    def test_run_slot_is_idempotent(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        bulletin_service.run_slot(db, day=day, slot=15)
        bulletin_service.run_slot(db, day=day, slot=15)
        db.commit()
        rows = db.scalars(
            select(AudioBulletin).where(AudioBulletin.bulletin_date == day)
        ).all()
        assert len(rows) == 1

    def test_recorded_at_quarter_to_held_then_aired_on_the_hour(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        provider, day = self._prepare(db, monkeypatch)

        bulletin = bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-15))
        db.commit()
        assert bulletin is not None and bulletin.slot == 15
        assert bulletin.status == BulletinStatus.READY and bulletin.url
        assert bulletin.published_at is None
        assert bulletin_service.serialize(db, bulletin)["available"] is False
        calls, digest = provider.calls, bulletin.script_hash

        # Twice at quarter to records once.
        assert bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-14)) is bulletin
        monkeypatch.setattr(bulletin_service, "current_slot", lambda now=None: 15)
        assert bulletin_service.run_slot(db) is bulletin
        db.commit()
        assert bulletin.status == BulletinStatus.PUBLISHED and bulletin.published_at
        assert (provider.calls, bulletin.script_hash) == (calls, digest), "aired, not re-recorded"

    def test_a_recording_an_editor_pulled_stays_off_at_the_hour(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        staff_headers(db, role=RoleKey.ADMIN, email="bulletin-admin@test.local")
        editor = db.scalars(select(User).where(User.email == "bulletin-admin@test.local")).one()
        bulletin = bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-15))
        assert bulletin is not None
        bulletin_service.publish(db, bulletin, actor_id=editor.id)
        bulletin_service.pull(db, bulletin, actor_id=editor.id)
        db.commit()

        monkeypatch.setattr(bulletin_service, "current_slot", lambda now=None: 15)
        bulletin_service.run_slot(db)
        db.commit()
        assert bulletin.status == BulletinStatus.READY

    def test_the_hour_produces_a_slot_whose_recording_is_missing_or_failed(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(bulletin_service, "current_slot", lambda now=None: 15)
        configure(db, **{"bulletin.enabled": True, "voice.monthly_char_budget": 10})
        _provider, day = self._prepare(db, monkeypatch)
        failed = bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-15))
        db.commit()
        assert failed is not None and failed.status == BulletinStatus.FAILED

        configure(db, **{"voice.monthly_char_budget": 2_000_000})
        assert bulletin_service.run_slot(db) is failed
        db.commit()
        assert failed.status == BulletinStatus.PUBLISHED and failed.url

        _purge(db)
        configure(db, **{"bulletin.enabled": True})
        self._prepare(db, monkeypatch)
        missing = bulletin_service.run_slot(db)  # no recording at all
        db.commit()
        assert missing is not None and missing.status == BulletinStatus.PUBLISHED

    def test_a_hand_edit_before_the_hour_is_what_airs(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-15))
        assert bulletin is not None
        edited = "ఎడిటర్ సరిచేసిన స్క్రిప్ట్ ఇది. ఇదే ప్రసారమవుతుంది."
        bulletin.script_te, bulletin.status = edited, BulletinStatus.SCRIPTED  # the PATCH route
        db.commit()

        monkeypatch.setattr(bulletin_service, "current_slot", lambda now=None: 15)
        bulletin_service.run_slot(db)
        db.commit()
        assert bulletin.script_te == edited and "ఎడిటర్ సరిచేసిన" in provider.texts[-1]
        assert bulletin.status == BulletinStatus.PUBLISHED

    def test_the_retry_airs_a_missed_hour_but_never_early_or_stale(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The hour's beat lost (a deploy at 15:00): the :15 retry airs it —
        but not hours later, after an outage or the kill switch."""
        from contextlib import contextmanager

        from app.workers.tasks import bulletin as bulletin_tasks

        @contextmanager
        def session() -> Iterator[Session]:
            yield db
            db.commit()

        monkeypatch.setattr(bulletin_tasks, "session_scope", session)
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        stale = bulletin_service.CATCH_UP_MINUTES + 15
        for minutes, status in ((-10, BulletinStatus.READY), (stale, BulletinStatus.READY),
                                (15, BulletinStatus.PUBLISHED)):
            _purge(db)
            configure(db, **{"bulletin.enabled": True})
            self._prepare(db, monkeypatch)
            bulletin = bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-15))
            db.commit()
            assert bulletin is not None
            moment = slot_time(day, 15, minutes=minutes)
            monkeypatch.setattr(bulletin_service, "utcnow", lambda moment=moment: moment)
            assert bulletin_tasks.retry() == {"retried": 0}
            assert bulletin.status == status, minutes
            monkeypatch.undo()
            monkeypatch.setattr(bulletin_tasks, "session_scope", session)

    def test_the_slot_anchor_reads_it_on_sarvam(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = FakeTts()
        provider.key = "sarvam"
        provider.model_name = "bulbul:v3"  # type: ignore[attr-defined]
        configure(db, **{"bulletin.enabled": True, "voice.voice_name": "ritu"})
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        publish_story(db, title="సాయంత్రం వార్త", when=slot_time(day, 17))
        db.commit()
        bulletin_service.run_slot(db, day=day, slot=17)
        assert set(provider.voices) == {"sunny"}

        # Any other speech model reads with the Voice setting.
        other = FakeTts()
        install_tts(monkeypatch, other)
        bulletin_service.regenerate(db, bulletin_service.get(db, day, 17), rescript=False)
        assert set(other.voices) == {"ritu"}

    def test_the_kill_switch_hides_a_published_bulletin(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        _provider, day = self._prepare(db, monkeypatch)
        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
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
        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
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
                when=slot_time(day, 15),
                summary=TELUGU_SUMMARY * 4,
            )
        db.commit()

        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
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
        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
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
        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
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
        publish_story(db, title="ఒక ప్రచురిత వార్త", when=slot_time(day, 15))
        db.commit()
        bulletin_service.run_slot(db, day=day, slot=15)
        db.commit()

        body = client.get("/api/v1/public/bulletins/latest").json()
        for key in (
            "available", "url", "mime", "duration_sec", "voice", "provider",
            "fallback", "voice_enabled",
        ):
            assert key in body, key
        assert body["available"] is True
        assert body["slot"] == 15
        assert body["items"]

    def test_an_unpublished_slot_is_404_to_readers(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure(db, **{"bulletin.enabled": True})
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        publish_story(db, title="మరో వార్త ఇక్కడ", when=slot_time(day, 15))
        db.commit()
        # Recorded ahead of its hour: the file exists, readers cannot have it yet.
        bulletin_service.prepare_slot(db, now=slot_time(day, 15, minutes=-15))
        db.commit()

        response = client.get(f"/api/v1/public/bulletins/{day.isoformat()}/15")
        assert response.status_code == 404

    def test_running_while_disabled_is_refused(
        self, db: Session, client: TestClient
    ) -> None:
        configure(db, **{"bulletin.enabled": False})
        headers = staff_headers(db, role=RoleKey.ADMIN, email="bulletin-admin@test.local")
        response = client.post("/api/v1/cms/bulletins/run", headers=headers, json={})
        assert response.status_code == 422

    def test_the_desk_gets_every_slot_name(self, db: Session, client: TestClient) -> None:
        """So the "Run now" buttons say which bulletin they make, not just the hour."""
        headers = staff_headers(db, role=RoleKey.ADMIN, email="bulletin-admin@test.local")
        body = client.get("/api/v1/cms/bulletins", headers=headers).json()
        assert set(body["slot_labels"]) == {str(slot) for slot in bulletin_service.SLOTS}
        assert body["slot_labels"]["7"] == "గరం చాయ్ న్యూస్"

    def test_editing_the_script_drops_it_back_to_scripted(
        self, db: Session, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The path that lets an editor fix a mispronunciation without
        abandoning the automation."""
        configure(db, **{"bulletin.enabled": True})
        provider = FakeTts()
        install_tts(monkeypatch, provider)
        day = bulletin_service.today()
        publish_story(db, title="సరిచేయవలసిన వార్త", when=slot_time(db and day, 15))
        db.commit()
        bulletin = bulletin_service.run_slot(db, day=day, slot=15)
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
