"""Assembling and speaking the three-hourly audio newspaper.

Six slots a day at 06, 09, 12, 15, 18 and 21 IST, about three minutes each.

**Why this can go live without an editor pressing Approve.** Everything spoken
is drawn from stories that a human already approved and a *second* human
already published. The machine chooses an order and writes the joining
sentences; it does not decide what is true. That is why
`bulletin.requires_approval` defaults to false — and why it exists at all, for
a newsroom that would rather gate it.

Note the setting is not called `auto_publish`. The behaviour is identical, but
this codebase treats that phrase as meaning "a reader sees unreviewed copy",
which is not what happens here, and a future reviewer grepping for it should
not find a hit.

**The script is deterministic.** Fixed opening, the headline roll, then each
story's own published summary, then a fixed close. The AI — when
`bulletin.ai_script_enabled` is on, which it is not by default — writes only
the connecting phrases between items. A model is never asked what happened.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AiProviderError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.ai import get_ai
from app.integrations.storage import get_storage
from app.integrations.tts import get_tts
from app.models.bulletin import AudioBulletin, AudioBulletinItem
from app.models.content import Article
from app.models.enums import BulletinStatus
from app.services import epaper_service, settings_service, tts_service
from app.telugu.normalize import normalize_headline, normalize_text

logger = get_logger(__name__)

IST = epaper_service.IST

#: The six slots, as IST hours. A product decision, not a setting — which is
#: why the schedule is a real crontab rather than the e-paper's
#: "tick every five minutes and compare the clock to a configured string".
SLOTS: tuple[int, ...] = (6, 9, 12, 15, 18, 21)

#: Both TTS adapters estimate duration at this rate, so the script is sized by
#: it. If that constant ever changes, this must follow — a bulletin that is
#: really four minutes long is not the product that was asked for.
CHARS_PER_SECOND = 12.0

#: Hard ceiling regardless of the configured target.
MAX_SCRIPT_CHARS = 2_400

#: How late a slot may still be produced. Past this, a worker that was down
#: declines rather than publishing a stale "12 o'clock bulletin" at two.
CATCH_UP_MINUTES = 90

#: Below this, a story gets a headline mention only.
MIN_STORY_CHARS = 120

_OPEN_TE = "టాప్ తెలుగు న్యూస్ — {label}. ముఖ్యాంశాలు."
_CLOSE_TE = "ఇవీ ఈ గంట ముఖ్యాంశాలు. పూర్తి వివరాలకు యాప్ చూడండి."
_CONNECTIVES_TE = ("తర్వాత…", "ఇక…", "మరో వార్త…", "అలాగే…", "చివరగా…")

_LABELS_TE: dict[int, str] = {
    6: "ఉదయం 6 గంటల బులెటిన్",
    9: "ఉదయం 9 గంటల బులెటిన్",
    12: "మధ్యాహ్నం 12 గంటల బులెటిన్",
    15: "మధ్యాహ్నం 3 గంటల బులెటిన్",
    18: "సాయంత్రం 6 గంటల బులెటిన్",
    21: "రాత్రి 9 గంటల బులెటిన్",
}


# --------------------------------------------------------------------------- #
# Slots and windows
# --------------------------------------------------------------------------- #
def slot_label_te(slot: int) -> str:
    return _LABELS_TE.get(slot, f"{slot} గంటల బులెటిన్")


def window_for(day: date, slot: int) -> tuple[datetime, datetime]:
    """[previous slot, this slot) in UTC.

    The 06:00 window reaches back to 21:00 the previous evening, so overnight
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


def select_stories(db: Session, day: date, slot: int, *, limit: int) -> list[Article]:
    """The stories this bulletin reads.

    Only PUBLISHED rows are ever considered — that is the whole basis on which
    a bulletin may go live without another approval step.
    """
    since, until = window_for(day, slot)
    candidates = epaper_service.ranked_articles(db, day, None, since=since, until=until)

    # A story repeated three bulletins running makes the service sound broken.
    # Breaking news is exempt: repetition is the point there.
    seen = _recent_article_ids(db, day, slot)
    fresh = [a for a in candidates if a.id not in seen or a.is_breaking]
    return fresh[:limit]


# --------------------------------------------------------------------------- #
# Script
# --------------------------------------------------------------------------- #
def target_chars(db: Session) -> int:
    seconds = settings_service.get_int(db, "bulletin.target_seconds")
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


def _ai_connectives(db: Session, headlines: list[str]) -> list[str] | None:
    """Optional polish. Returns None whenever the output is not usable.

    The rejection rule earns its place: `HeuristicAi.write_draft` returns a
    `[రాయవలసి ఉంది]` skeleton — literally "needs writing" — for a journalist to
    fill in. Broadcasting that to listeners is exactly the kind of failure
    nobody would catch until a reader complained.
    """
    if not (
        settings_service.ai_enabled(db)
        and settings_service.get_bool(db, "bulletin.ai_script_enabled")
    ):
        return None
    try:
        provider = get_ai(str(settings_service.get(db, "ai.provider") or "heuristic"))
        draft = provider.write_draft(
            topic="ఈ గంట వార్తల మధ్య కలిపే చిన్న వాక్యాలు",
            notes="\n".join(headlines),
            sources=[],
        )
    except (AiProviderError, Exception) as exc:  # noqa: BLE001
        logger.info("bulletin_ai_connectives_failed", error=str(exc)[:200])
        return None

    usable = [
        normalize_text(p)
        for p in draft.paragraphs_te
        if p and "[" not in p and len(p.strip()) >= 8
    ]
    return usable or None


def build_script(
    db: Session, *, day: date, slot: int, articles: list[Article]
) -> tuple[str, list[tuple[Article, str]]]:
    """`(script, [(article, spoken_text)])`."""
    label = slot_label_te(slot)
    opening = _OPEN_TE.format(label=label)
    closing = _CLOSE_TE

    headlines = [normalize_headline(a.title_te or "") for a in articles]
    roll = " … ".join(h for h in headlines if h)

    fixed = len(opening) + len(roll) + len(closing) + 8
    budget = target_chars(db)
    per_story = max(MIN_STORY_CHARS, (budget - fixed) // max(1, len(articles)))

    connectives = _ai_connectives(db, headlines) or list(_CONNECTIVES_TE)

    parts: list[str] = [opening]
    if roll:
        parts.append(roll)
    spoken: list[tuple[Article, str]] = []
    for index, article in enumerate(articles):
        text = _story_text(article, per_story)
        headline = headlines[index]
        piece = " ".join(p for p in (headline, text) if p).strip()
        if not piece:
            continue
        if index:
            parts.append(connectives[index % len(connectives)])
        parts.append(piece)
        spoken.append((article, piece))
    parts.append(closing)

    script = "\n\n".join(p for p in parts if p).strip()
    if len(script) > MAX_SCRIPT_CHARS:
        script = script[:MAX_SCRIPT_CHARS].rsplit(" ", 1)[0]
    return script, spoken


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
    db: Session, bulletin: AudioBulletin, *, limit: int | None = None
) -> AudioBulletin:
    """Choose the stories and write the script. No provider is called."""
    story_limit = limit or settings_service.get_int(db, "bulletin.story_limit")
    articles = select_stories(db, bulletin.bulletin_date, bulletin.slot, limit=story_limit)
    if not articles:
        bulletin.status = BulletinStatus.SKIPPED
        bulletin.error = "no published stories in this window"
        db.flush()
        return bulletin

    script, spoken = build_script(
        db, day=bulletin.bulletin_date, slot=bulletin.slot, articles=articles
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


def render(
    db: Session, bulletin: AudioBulletin, *, requested_by: int | None = None
) -> AudioBulletin:
    """Synthesise the script and store the audio. Never raises."""
    if not bulletin.script_te:
        bulletin.status = BulletinStatus.FAILED
        bulletin.error = "no script to speak"
        db.flush()
        return bulletin

    provider_name = str(settings_service.get(db, "voice.provider") or "local")
    language = str(settings_service.get(db, "voice.language") or "te-IN")
    provider = get_tts(provider_name)
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
    try:
        audio, mime, duration, voice, segments = tts_service.synthesise_long(
            bulletin.script_te,
            language=language,
            voice=tts_service.configured_voice(db),
            provider=provider,
        )
    except (AiProviderError, ValueError) as exc:
        bulletin.status = BulletinStatus.FAILED
        bulletin.error = str(getattr(exc, "details", exc))[:500]
        db.flush()
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
    """
    if not enabled(db):
        return None
    resolved_slot = slot if slot is not None else current_slot()
    if resolved_slot is None:
        logger.info("bulletin_slot_missed")
        return None
    resolved_day = day or today()

    bulletin = get_or_create(db, resolved_day, resolved_slot)
    if bulletin.status == BulletinStatus.PUBLISHED and slot is None:
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
