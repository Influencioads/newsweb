"""Assembling and speaking the audio newspaper.

Six named slots a day at 07, 09, 15, 17, 19 and 21 IST, about three
minutes each — each show has its own banner art (web `public/bulletins/`,
mobile `assets/bulletins/`, keyed by the slot hour).

**Why this can go live without an editor pressing Approve.** Everything spoken
is drawn from stories that a human already approved and a *second* human
already published. The machine chooses an order; it writes nothing and does
not decide what is true. That is why
`bulletin.requires_approval` defaults to false — and why it exists at all, for
a newsroom that would rather gate it.

Note the setting is not called `auto_publish`. The behaviour is identical, but
this codebase treats that phrase as meaning "a reader sees unreviewed copy",
which is not what happens here, and a future reviewer grepping for it should
not find a hit.

**The script is deterministic, and read clean.** The greeting, then each
story's headline and published summary, then a fixed close — with a 2.5 s
music sting between every block and no spoken filler ("తర్వాత…", "ఇక…").
No model is asked anything.
"""

from __future__ import annotations

import hashlib
import io
import math
import wave
from array import array
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AiProviderError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.storage import get_storage
from app.integrations.tts import get_tts
from app.models.bulletin import AudioBulletin, AudioBulletinItem
from app.models.content import Article
from app.models.enums import BulletinStatus
from app.services import (
    ai_usage_service,
    audio_concat,
    epaper_service,
    settings_service,
    tts_service,
)
from app.telugu.normalize import normalize_headline, normalize_text

logger = get_logger(__name__)

IST = epaper_service.IST

#: The six slots, as IST hours. A product decision, not a setting — which is
#: why the schedule is a real crontab (built from this tuple in
#: `workers/celery_app.py`) rather than the e-paper's "tick every five minutes
#: and compare the clock to a configured string".
SLOTS: tuple[int, ...] = (7, 9, 15, 17, 19, 21)

#: Both TTS adapters estimate duration at this rate, so the script is sized by
#: it. If that constant ever changes, this must follow — a bulletin that is
#: really four minutes long is not the product that was asked for.
CHARS_PER_SECOND = 12.0

#: Hard ceiling regardless of the configured target: five minutes at 12 cps,
#: the longest bulletin a person can ask the assistant for.
MAX_SCRIPT_CHARS = 3_600

#: How late a slot may still be produced. Past this, a worker that was down
#: declines rather than publishing a stale "1 o'clock bulletin" at three. Must
#: stay under the shortest gap between SLOTS (two hours).
CATCH_UP_MINUTES = 90

#: Below this, a story gets a headline mention only.
MIN_STORY_CHARS = 120

_OPEN_TE = "నమస్తే! మీరు వింటున్నారు {label}, టాప్ తెలుగు న్యూస్ నుంచి."
_CLOSE_TE = "మరిన్ని వార్తల కోసం టాప్ తెలుగు న్యూస్ యాప్ డౌన్‌లోడ్ చేసుకోండి."

#: A line of its own in `script_te` wherever the sting plays. Never sent to
#: the voice: `render` splits on it. An editor who deletes one deletes that
#: sting; one who adds one adds a sting.
MUSIC_MARK = "♪"
_BREAK = f"\n\n{MUSIC_MARK}\n\n"

#: Original procedural music (the tuning lab's synth, no samples): a rising
#: D-F-A pluck into a bright F-major hit, 2.5 s with a long fade. 22.05 kHz
#: mono 16-bit — Sarvam's own format, so the live voice needs no resampling.
_STING = Path(__file__).with_name("bulletin_sting.wav")
_STING_SECONDS = 2.5
#: Silence either side: the last word rings out, then the music, then a breath.
_PAD_BEFORE, _PAD_AFTER = 0.4, 0.25
#: Sting level against this bulletin's own voice (RMS), measured per render so
#: a louder or quieter provider never makes the music jump out.
_STING_REL_DB = -6.0
#: Airtime one sting costs, in script characters.
_STING_CHARS = int((_PAD_BEFORE + _STING_SECONDS + _PAD_AFTER) * CHARS_PER_SECOND)

#: Each slot's show name — stored on the row as `slot_label_te`, shown by every
#: client and spoken in the opening line. Rename here; one key per SLOTS hour
#: (a test holds the two in step).
_LABELS_TE: dict[int, str] = {
    7: "గరం చాయ్ న్యూస్",  # Garam Chai News
    9: "మసాలా దోశ న్యూస్",  # Masala Dosa News
    15: "చాయ్ బిస్కెట్ న్యూస్",  # Chai Biscuit News
    17: "మిర్చి బజ్జీ న్యూస్",  # Mirchi Bajji News
    19: "చాట్ మసాలా న్యూస్",  # Chat Masala News
    21: "ఫుల్ మీల్స్ న్యూస్",  # Full Meals News
}


# --------------------------------------------------------------------------- #
# Slots and windows
# --------------------------------------------------------------------------- #
def slot_label_te(slot: int) -> str:
    return _LABELS_TE.get(slot, f"{slot} గంటల బులెటిన్")


def window_for(day: date, slot: int) -> tuple[datetime, datetime]:
    """[previous slot, this slot) in UTC.

    The 07:00 window reaches back to 21:00 the previous evening, so overnight
    news is carried rather than dropped — the gap between the last bulletin of
    one day and the first of the next is the longest of the cycle.
    """
    end = datetime.combine(day, time(hour=slot), tzinfo=IST)
    index = SLOTS.index(slot) if slot in SLOTS else 0
    if index == 0:
        start = datetime.combine(day - timedelta(days=1), time(hour=SLOTS[-1]), tzinfo=IST)
    else:
        start = datetime.combine(day, time(hour=SLOTS[index - 1]), tzinfo=IST)
    return start.astimezone(utcnow().tzinfo), end.astimezone(utcnow().tzinfo)


def current_slot(now: datetime | None = None) -> int | None:
    """The slot this moment belongs to, or None if we are too late for it."""
    moment = (now or utcnow()).astimezone(IST)
    candidates = [s for s in SLOTS if s <= moment.hour]
    if not candidates:
        return None
    slot = max(candidates)
    slot_time = moment.replace(hour=slot, minute=0, second=0, microsecond=0)
    if (moment - slot_time) > timedelta(minutes=CATCH_UP_MINUTES):
        return None
    return slot


def today(now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(IST).date()


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #
def _recent_article_ids(db: Session, day: date, slot: int, *, back: int = 2) -> set[int]:
    """Stories already carried in the last couple of bulletins."""
    index = SLOTS.index(slot) if slot in SLOTS else 0
    previous = [SLOTS[i] for i in range(max(0, index - back), index)]
    if not previous:
        return set()
    rows = db.execute(
        select(AudioBulletinItem.article_id)
        .join(AudioBulletin, AudioBulletinItem.bulletin_id == AudioBulletin.id)
        .where(AudioBulletin.bulletin_date == day, AudioBulletin.slot.in_(previous))
    ).all()
    return {int(r[0]) for r in rows}


def select_stories(
    db: Session,
    day: date,
    slot: int,
    *,
    limit: int,
    category_ids: list[int] | None = None,
    district_id: int | None = None,
    since: datetime | None = None,
) -> list[Article]:
    """The stories this bulletin reads.

    Only PUBLISHED rows are ever considered — that is the whole basis on which
    a bulletin may go live without another approval step.

    `since` widens the window back from the slot (a topic or district bulletin
    finds too little in two hours); the category is matched in SQL, the
    district in Python over a window that is already small.
    """
    start, until = window_for(day, slot)
    candidates = epaper_service.ranked_articles(
        db, day, category_ids, since=since or start, until=until
    )
    if district_id is not None:
        candidates = [a for a in candidates if a.district_id == district_id]

    # A story repeated three bulletins running makes the service sound broken.
    # Breaking news is exempt: repetition is the point there.
    seen = _recent_article_ids(db, day, slot)
    fresh = [a for a in candidates if a.id not in seen or a.is_breaking]
    return fresh[:limit]


# --------------------------------------------------------------------------- #
# Script
# --------------------------------------------------------------------------- #
def target_chars(db: Session, seconds: int | None = None) -> int:
    """`seconds` is a length a person asked for; the setting otherwise."""
    seconds = seconds or settings_service.get_int(db, "bulletin.target_seconds")
    return min(MAX_SCRIPT_CHARS, int(seconds * CHARS_PER_SECOND))


def _story_text(article: Article, budget: int) -> str:
    """One story's spoken text, clipped at a sentence boundary."""
    body = normalize_text(article.summary_te or article.body_plain or "")
    if not body:
        return ""
    if len(body) <= budget:
        return body
    clipped = body[:budget]
    stop = max(clipped.rfind("।"), clipped.rfind("."), clipped.rfind("\n"))
    return clipped[: stop + 1] if stop > budget // 3 else clipped


def build_script(
    db: Session,
    *,
    day: date,
    slot: int,
    articles: list[Article],
    seconds: int | None = None,
) -> tuple[str, list[tuple[Article, str]]]:
    """`(script, [(article, spoken_text)])`, at most `target_chars` long.

    Greeting ♪ story ♪ story … ♪ close. Each story costs its headline, its
    body and the airtime of one sting, not its body alone — budgeting the body
    alone once overshot, and the hard cut then removed the close and half the
    last story. A story that still does not fit is dropped whole, and the
    close is always spoken.
    """
    opening = _OPEN_TE.format(label=slot_label_te(slot))
    closing = _CLOSE_TE
    budget = target_chars(db, seconds)

    headlines = [normalize_headline(a.title_te or "") for a in articles]
    joint = len(_BREAK) + _STING_CHARS
    fixed = len(opening) + len(closing) + 2 * joint
    overhead = sum(len(h) + 1 + joint for h in headlines)
    per_story = max(MIN_STORY_CHARS, (budget - fixed - overhead) // max(1, len(articles)))

    stories: list[tuple[Article, str, str]] = []
    for article, headline in zip(articles, headlines):
        # A full stop after the headline: joined by a bare space the voice ran
        # the headline straight into the story. ". " buys ~0.5 s (measured on
        # Sarvam, see tts_text) — a headline that already ends a sentence keeps its own.
        body = _story_text(article, per_story)
        head = headline if not headline or headline[-1] in ".।?!" else f"{headline}."
        piece = " ".join(p for p in (head, body) if p).strip() if body else headline
        if piece:
            stories.append((article, headline, piece))

    def assemble(chosen: list[tuple[Article, str, str]]) -> str:
        return _BREAK.join([opening, *(piece for _a, _h, piece in chosen), closing])

    def airtime(script: str) -> int:
        return len(script) + script.count(MUSIC_MARK) * _STING_CHARS

    script = assemble(stories)
    while airtime(script) > budget and len(stories) > 1:
        stories.pop()
        script = assemble(stories)
    if len(script) > MAX_SCRIPT_CHARS:
        # One story longer than the cap on its own: cut it, keep the close.
        head = script[: MAX_SCRIPT_CHARS - len(closing) - len(_BREAK)].rsplit(" ", 1)[0]
        script = f"{head}{_BREAK}{closing}"
    return script, [(article, piece) for article, _headline, piece in stories]


# --------------------------------------------------------------------------- #
# Rows
# --------------------------------------------------------------------------- #
def get_or_create(db: Session, day: date, slot: int) -> AudioBulletin:
    row = db.scalar(
        select(AudioBulletin)
        .options(selectinload(AudioBulletin.items))
        .where(AudioBulletin.bulletin_date == day, AudioBulletin.slot == slot)
    )
    if row is None:
        row = AudioBulletin(
            bulletin_date=day, slot=slot, slot_label_te=slot_label_te(slot)
        )
        db.add(row)
        db.flush()
    return row


def script_bulletin(
    db: Session,
    bulletin: AudioBulletin,
    *,
    limit: int | None = None,
    articles: list[Article] | None = None,
    seconds: int | None = None,
) -> AudioBulletin:
    """Choose the stories and write the script. No provider is called.

    `articles` replaces the selection (stories a person picked, already
    PUBLISHED); `seconds` replaces `bulletin.target_seconds` for this one.
    """
    # The opener speaks the name from `_LABELS_TE`; a row made under an older
    # name must show the one it now says.
    bulletin.slot_label_te = slot_label_te(bulletin.slot)
    if articles is None:
        story_limit = limit or settings_service.get_int(db, "bulletin.story_limit")
        articles = select_stories(db, bulletin.bulletin_date, bulletin.slot, limit=story_limit)
    if not articles:
        bulletin.status = BulletinStatus.SKIPPED
        bulletin.error = "no published stories in this window"
        db.flush()
        return bulletin

    script, spoken = build_script(
        db, day=bulletin.bulletin_date, slot=bulletin.slot, articles=articles, seconds=seconds
    )

    bulletin.items.clear()
    db.flush()
    for position, (article, text) in enumerate(spoken, start=1):
        # Appended to the relationship rather than inserted by foreign key, so
        # the in-memory collection matches the database immediately. Inserting
        # by FK leaves `bulletin.items` empty until a refresh, which shows up
        # as a bulletin that plays audio with an empty transcript.
        bulletin.items.append(
            AudioBulletinItem(
                article_id=article.id,
                position=position,
                headline_te=normalize_headline(article.title_te or "")[:400],
                spoken_te=text,
            )
        )

    bulletin.script_te = script
    bulletin.script_hash = hashlib.sha256(script.encode("utf-8")).hexdigest()
    bulletin.char_count = len(script)
    bulletin.status = BulletinStatus.SCRIPTED
    bulletin.error = None
    db.flush()
    return bulletin


def _rms(samples: array) -> float:
    return math.sqrt(sum(s * s for s in samples) / len(samples)) if samples else 0.0


def _sting_like(clips: list[bytes]) -> bytes | None:
    """The sting, padded with silence, as a WAV in the voice's own format and
    `_STING_REL_DB` under its level. None when the voice is not mono 16-bit."""
    with wave.open(io.BytesIO(clips[0])) as w:
        channels, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
    if (channels, width) != (1, 2):
        # ponytail: every TTS adapter returns mono 16-bit; another format airs without music.
        return None
    voice = array("h")
    for clip in clips:
        with wave.open(io.BytesIO(clip)) as w:
            voice.frombytes(w.readframes(w.getnframes()))
    with wave.open(str(_STING)) as w:
        src_rate = w.getframerate()
        src = array("h", w.readframes(w.getnframes()))

    gain = _rms(voice) / max(_rms(src), 1.0) * 10 ** (_STING_REL_DB / 20)
    # ponytail: linear-interpolation resample (none at all for Sarvam's 22.05 kHz);
    # use a polyphase resampler if a provider ever runs well below that.
    step, last = src_rate / rate, len(src) - 1
    music = array("h")
    for i in range(int(len(src) / step)):
        pos = i * step
        j = int(pos)
        sample = src[j] + (src[min(j + 1, last)] - src[j]) * (pos - j)
        music.append(max(-32768, min(32767, round(sample * gain))))

    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(
            bytes(2 * int(_PAD_BEFORE * rate))
            + music.tobytes()
            + bytes(2 * int(_PAD_AFTER * rate))
        )
    return out.getvalue()


def _join(takes: list[tuple[bytes, str, int, str, int]]) -> tuple[bytes, str, int, str, int]:
    """One file from the per-block takes, the sting between each pair, in
    `synthesise_long`'s shape: `(audio, mime, duration_sec, voice, segments)`."""
    clips = [t[0] for t in takes]
    mime = takes[0][1]
    # ponytail: an MP3 voice airs without music — WAV frames cannot be spliced
    # into an MP3 stream. Add an encoder if an MP3 provider ever goes live.
    sting = _sting_like(clips) if mime in ("audio/wav", "audio/x-wav") else None
    if sting:
        clips = [part for clip in clips for part in (clip, sting)][:-1]
    audio, measured = audio_concat.concat(clips, mime)
    estimated = sum(t[2] for t in takes)
    return audio, mime, measured or estimated, takes[-1][3], sum(t[4] for t in takes)


def render(
    db: Session, bulletin: AudioBulletin, *, requested_by: int | None = None
) -> AudioBulletin:
    """Synthesise the script and store the audio. Never raises."""
    if not bulletin.script_te:
        bulletin.status = BulletinStatus.FAILED
        bulletin.error = "no script to speak"
        db.flush()
        return bulletin

    _tts = settings_service.tts_credentials(db)
    provider_name = _tts["provider"]
    language = str(settings_service.get(db, "voice.language") or "te-IN")
    provider = get_tts(**_tts)
    if not provider.available():
        bulletin.status = BulletinStatus.FAILED
        bulletin.error = f"tts provider {provider_name} unavailable"
        bulletin.attempts += 1
        db.flush()
        return bulletin

    # One budget with article audio — see tts_service.month_chars_used.
    budget = settings_service.get_int(db, "voice.monthly_char_budget")
    if budget and tts_service.month_chars_used(db) + len(bulletin.script_te) > budget:
        bulletin.status = BulletinStatus.FAILED
        bulletin.error = "monthly character budget exhausted"
        bulletin.attempts += 1
        db.flush()
        logger.warning("bulletin_budget_exceeded", slot=bulletin.slot)
        return bulletin

    bulletin.attempts += 1
    # Each block between two MUSIC_MARK lines is voiced on its own, so the
    # sting can sit between them. One ledger row still covers the lot:
    # `synthesise_long` leaves only its own block's total on `last_usage`.
    blocks = [b.strip() for b in bulletin.script_te.split(MUSIC_MARK) if b.strip()]
    takes: list[tuple[bytes, str, int, str, int]] = []
    spent: dict[str, float | int] = {}
    try:
        for block in blocks:
            provider.last_usage = {}
            try:
                takes.append(
                    tts_service.synthesise_long(
                        block,
                        language=language,
                        voice=tts_service.configured_voice(db),
                        provider=provider,
                    )
                )
            finally:
                for name, amount in (provider.last_usage or {}).items():
                    spent[name] = spent.get(name, 0) + amount
                provider.last_usage = dict(spent)
        audio, mime, duration, voice, segments = _join(takes)
    except (AiProviderError, ValueError) as exc:
        bulletin.status = BulletinStatus.FAILED
        bulletin.error = str(getattr(exc, "details", exc))[:500]
        db.flush()
        # The segments that answered before the failing one are charged, and
        # `workers/tasks/bulletin.py` retries a FAILED slot until attempts == 3
        # — so one bad slot can pay for three renders. Unrecorded, the meter
        # reads zero for all of it.
        ai_usage_service.record(
            db,
            operation="tts",
            provider=provider.key,
            model=getattr(provider, "model_name", None),
            actor_id=requested_by,
            usage=getattr(provider, "last_usage", None),
            ok=False,
            error=bulletin.error,
        )
        logger.warning("bulletin_render_failed", slot=bulletin.slot)
        return bulletin

    digest = (bulletin.script_hash or "")[:12]
    extension = "mp3" if mime == "audio/mpeg" else "wav"
    key = (
        f"bulletins/{bulletin.bulletin_date.isoformat()}/"
        f"{bulletin.slot:02d}-r{bulletin.revision}-{digest}.{extension}"
    )
    stored = get_storage().put(
        key,
        audio,
        content_type=mime,
        # Content-addressed: a regenerate bumps the revision and the hash, so a
        # new render is a new object rather than a stale CDN copy of the old.
        cache_control="public, max-age=31536000, immutable",
    )

    bulletin.storage_key = key
    bulletin.url = stored.url
    bulletin.mime = mime
    bulletin.bytes = len(audio)
    bulletin.duration_sec = duration
    bulletin.segment_count = segments
    bulletin.provider = provider.key
    bulletin.voice = voice
    bulletin.language = language
    bulletin.generated_at = utcnow()
    bulletin.error = None
    bulletin.status = BulletinStatus.READY
    bulletin.requested_by = requested_by
    db.flush()
    # One row for the whole bulletin, however many segments it took — the same
    # shape `ensure_audio` writes, so six unattended slots a day show up on the
    # AI meter next to the article audio they share a budget with.
    ai_usage_service.record(
        db,
        operation="tts",
        provider=provider.key,
        model=getattr(provider, "model_name", None),
        actor_id=requested_by,
        usage=getattr(provider, "last_usage", None),
    )
    logger.info(
        "bulletin_rendered",
        slot=bulletin.slot,
        seconds=duration,
        chars=bulletin.char_count,
        segments=segments,
    )
    return bulletin


def publish(
    db: Session, bulletin: AudioBulletin, *, actor_id: int | None = None
) -> AudioBulletin:
    if bulletin.status not in (BulletinStatus.READY, BulletinStatus.PUBLISHED):
        raise ConflictError(
            message_en="This bulletin has no audio to publish yet.",
            message_te="ఈ బులెటిన్‌కు ఇంకా ఆడియో సిద్ధం కాలేదు.",
        )
    bulletin.status = BulletinStatus.PUBLISHED
    bulletin.published_at = utcnow()
    bulletin.approved_by = actor_id
    db.flush()
    return bulletin


def pull(db: Session, bulletin: AudioBulletin, *, actor_id: int | None = None) -> AudioBulletin:
    """Take a live bulletin off the air. The audio is kept."""
    bulletin.status = BulletinStatus.READY
    bulletin.published_at = None
    bulletin.approved_by = actor_id
    db.flush()
    return bulletin


def regenerate(
    db: Session, bulletin: AudioBulletin, *, actor_id: int | None = None, rescript: bool = True
) -> AudioBulletin:
    """Rebuild and re-render, as a new revision.

    `rescript=False` keeps a script an editor has edited by hand — which is the
    path that lets somebody fix a mispronunciation or drop a story without
    abandoning the automation.
    """
    bulletin.revision += 1
    bulletin.attempts = 0
    if rescript:
        script_bulletin(db, bulletin)
        if bulletin.status == BulletinStatus.SKIPPED:
            return bulletin
    render(db, bulletin, requested_by=actor_id)
    if bulletin.status == BulletinStatus.READY and not requires_approval(db):
        publish(db, bulletin, actor_id=actor_id)
    return bulletin


def requires_approval(db: Session) -> bool:
    return settings_service.get_bool(db, "bulletin.requires_approval")


def enabled(db: Session) -> bool:
    return settings_service.get_bool(db, "bulletin.enabled")


def run_slot(
    db: Session,
    *,
    day: date | None = None,
    slot: int | None = None,
    requested_by: int | None = None,
) -> AudioBulletin | None:
    """Produce one slot, end to end. Idempotent.

    `(bulletin_date, slot)` is unique, so a double-fire updates the same row
    rather than producing two bulletins for nine o'clock.

    The beat (no slot, nobody asking) leaves alone a row that is live, and a
    row a person made (`requested_by`: the assistant, Run now, Regenerate).
    That one is theirs — held at READY for a human to publish, or already
    reviewed by one — and the hour striking must neither re-record it with
    other news nor put it on air. (Before the assistant, the beat re-scripted
    a Run-now bulletin still awaiting approval; a person's work now stands.)
    """
    if not enabled(db):
        return None
    resolved_slot = slot if slot is not None else current_slot()
    if resolved_slot is None:
        logger.info("bulletin_slot_missed")
        return None
    resolved_day = day or today()

    bulletin = get_or_create(db, resolved_day, resolved_slot)
    if slot is None and (
        bulletin.status == BulletinStatus.PUBLISHED
        or (requested_by is None and bulletin.requested_by is not None)
    ):
        return bulletin

    script_bulletin(db, bulletin)
    if bulletin.status == BulletinStatus.SKIPPED:
        return bulletin

    render(db, bulletin, requested_by=requested_by)
    if bulletin.status == BulletinStatus.READY and not requires_approval(db):
        publish(db, bulletin, actor_id=None)
    return bulletin


# --------------------------------------------------------------------------- #
# Reading
# --------------------------------------------------------------------------- #
def latest_published(db: Session) -> AudioBulletin | None:
    return db.scalar(
        select(AudioBulletin)
        .options(selectinload(AudioBulletin.items))
        .where(AudioBulletin.status == BulletinStatus.PUBLISHED)
        .order_by(AudioBulletin.bulletin_date.desc(), AudioBulletin.slot.desc())
    )


def get(db: Session, day: date, slot: int) -> AudioBulletin:
    row = db.scalar(
        select(AudioBulletin)
        .options(selectinload(AudioBulletin.items))
        .where(AudioBulletin.bulletin_date == day, AudioBulletin.slot == slot)
    )
    if row is None:
        raise NotFoundError()
    return row


def for_day(db: Session, day: date) -> list[AudioBulletin]:
    return list(
        db.scalars(
            select(AudioBulletin)
            .options(selectinload(AudioBulletin.items))
            .where(AudioBulletin.bulletin_date == day)
            .order_by(AudioBulletin.slot)
        ).all()
    )


def serialize(db: Session, bulletin: AudioBulletin | None, *, include_script: bool = True) -> dict[str, Any]:
    """A superset of the article-audio payload.

    Deliberately the same shape, so the web and mobile players work against a
    bulletin without a second implementation. `voice_enabled` maps to
    `bulletin.enabled`, which means flipping the kill switch makes both players
    render nothing through the branch they already have.
    """
    live = enabled(db)
    if bulletin is None or not bulletin.is_live or not live:
        return {
            "available": False,
            "url": None,
            "mime": None,
            "duration_sec": 0,
            "voice": None,
            "provider": None,
            "fallback": None,
            "voice_enabled": live,
            "date": bulletin.bulletin_date.isoformat() if bulletin else None,
            "slot": bulletin.slot if bulletin else None,
            "slot_label_te": bulletin.slot_label_te if bulletin else None,
            "items": [],
        }
    return {
        "available": True,
        "url": bulletin.url,
        "mime": bulletin.mime,
        "duration_sec": bulletin.duration_sec,
        "voice": bulletin.voice,
        "provider": bulletin.provider,
        "fallback": None,
        "voice_enabled": True,
        "date": bulletin.bulletin_date.isoformat(),
        "slot": bulletin.slot,
        "slot_label_te": bulletin.slot_label_te,
        "published_at": bulletin.published_at,
        "script_te": bulletin.script_te if include_script else None,
        "items": [
            {
                "position": item.position,
                "article_id": item.article_id,
                "short_id": item.article.short_id if item.article else None,
                # The canonical reader path, built server-side by the same
                # property every other feed uses — the client must not have to
                # reconstruct /{category}/{slug}-{shortId} for itself.
                "url": item.article.url_path if item.article else None,
                "headline_te": item.headline_te,
            }
            for item in bulletin.items
        ],
    }
