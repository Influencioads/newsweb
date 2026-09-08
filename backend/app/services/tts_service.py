"""Server-side article audio (updated doc §19–21).

Three rules, in priority order:

  1. **§20** — audio exists only when the global switch *and* the article's own
     flag are both on. Either being off means no player and no provider call.
  2. **§21** — the same words are never paid for twice. The row is keyed by
     `(article_id, sha256(text))`, so a republish that changed nothing re-uses
     the file, and a monthly character budget caps the worst case.
  3. Failure is never fatal. No provider, no key, a 502 from the vendor — all
     end with `None`, and the reader falls back to the on-device voice that
     worked before any of this existed.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AiProviderError
from app.core.logging import get_logger
from app.db.base import utcnow
from app.integrations.storage import get_storage
from app.integrations.tts import get_tts
from app.models.audio import AudioAsset
from app.models.content import Article
from app.models.enums import AudioStatus
from app.services import settings_service

logger = get_logger(__name__)

#: Providers bill per character, and a 4 000-word feature is not a listening
#: experience anyway. Long copy is truncated at a sentence boundary.
MAX_CHARS = 5_000


def spoken_text(article: Article) -> str:
    """What the listener actually hears: headline, then standfirst, then body.

    Built from `body_plain` (already derived on every save) rather than from
    the Tiptap JSON, so captions, embed URLs and pull-quote duplication never
    reach the synthesiser.
    """
    parts = [article.title_te or ""]
    if article.sub_title_te:
        parts.append(article.sub_title_te)
    if article.summary_te:
        parts.append(article.summary_te)
    if article.body_plain:
        parts.append(article.body_plain)
    text = "\n\n".join(p.strip() for p in parts if p and p.strip())
    if len(text) <= MAX_CHARS:
        return text
    clipped = text[:MAX_CHARS]
    stop = max(clipped.rfind("।"), clipped.rfind("."), clipped.rfind("\n"))
    return clipped[: stop + 1] if stop > MAX_CHARS // 2 else clipped


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


#: What an editor may attach by hand. Deliberately narrow: these are the
#: containers every browser and both mobile platforms decode natively.
ALLOWED_AUDIO_MIMES = frozenset({
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac",
    "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm",
})
MAX_AUDIO_BYTES = 50 * 1024 * 1024

#: Marks a rendition that a person uploaded rather than a provider generated.
UPLOAD_PROVIDER = "upload"


def uploaded_asset(db: Session, article: Article) -> AudioAsset | None:
    """The hand-attached file for this article, if there is one."""
    return db.scalar(
        select(AudioAsset).where(
            AudioAsset.article_id == article.id,
            AudioAsset.provider == UPLOAD_PROVIDER,
            AudioAsset.status == AudioStatus.READY,
        ).order_by(AudioAsset.created_at.desc())
    )


def is_enabled(db: Session, article: Article) -> bool:
    """§20 — both halves of the switch, with one deliberate exception.

    The global switch governs *generated* audio: it exists to control TTS spend
    and voice quality. A file an editor attached by hand has neither concern —
    a recorded bulletin or an interview clip is editorial content, not a
    synthesis bill — so it plays whenever the article's own flag is on. The
    settings screen says exactly this, so the switch is not lying about its
    own scope.
    """
    if not article.voice_enabled:
        return False
    if uploaded_asset(db, article) is not None:
        return True
    return settings_service.voice_enabled(db)


def attach_upload(db: Session, article: Article, *, raw: bytes, filename: str,
                  mime: str, duration_sec: int = 0,
                  requested_by: int | None = None) -> AudioAsset:
    """Store an editor's own audio file as this article's rendition (§19).

    Replaces any previous upload rather than accumulating them: the article has
    one attached file, and a second upload means "use this one instead".
    """
    from app.core.errors import FileTooLargeError, UnsupportedMediaTypeError

    if mime not in ALLOWED_AUDIO_MIMES:
        raise UnsupportedMediaTypeError(details={"mime": mime,
                                                 "allowed": sorted(ALLOWED_AUDIO_MIMES)})
    if not raw:
        raise UnsupportedMediaTypeError(details={"file": "empty"})
    if len(raw) > MAX_AUDIO_BYTES:
        raise FileTooLargeError(details={"bytes": len(raw), "max_bytes": MAX_AUDIO_BYTES})

    digest = hashlib.sha256(raw).hexdigest()
    extension = {"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
                 "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav",
                 "audio/ogg": "ogg", "audio/webm": "webm"}.get(mime, "bin")
    key = f"audio/{article.short_id}/upload-{digest[:16]}.{extension}"
    stored = get_storage().put(
        key, raw, content_type=mime,
        cache_control="public, max-age=31536000, immutable",
    )

    previous = uploaded_asset(db, article)
    if previous is not None and previous.content_hash != digest:
        db.delete(previous)
        db.flush()

    row = db.scalar(select(AudioAsset).where(
        AudioAsset.article_id == article.id, AudioAsset.content_hash == digest))
    if row is None:
        row = AudioAsset(article_id=article.id, content_hash=digest)
        db.add(row)
    row.status = AudioStatus.READY
    row.provider = UPLOAD_PROVIDER
    row.voice = filename[:60]
    row.language = str(settings_service.get(db, "voice.language") or "te-IN")
    row.storage_key = key
    row.url = stored.url
    row.mime = mime
    row.bytes = len(raw)
    row.duration_sec = max(0, int(duration_sec))
    # Uploads cost nothing at a provider, so they must not consume the §21
    # character budget.
    row.char_count = 0
    row.error = None
    row.generated_at = utcnow()
    row.requested_by = requested_by
    db.flush()
    article.audio_asset_id = row.id
    db.flush()
    logger.info("audio_uploaded", article_id=article.id, bytes=len(raw), mime=mime)
    return row


def remove_upload(db: Session, article: Article) -> bool:
    """Detach the editor's file. Generated audio, if any, takes over again."""
    row = uploaded_asset(db, article)
    if row is None:
        return False
    if article.audio_asset_id == row.id:
        article.audio_asset_id = None
    if row.storage_key:
        try:
            get_storage().delete(row.storage_key)
        except Exception:  # noqa: BLE001 — an orphaned object is not worth a 500
            logger.warning("audio_object_delete_failed", key=row.storage_key)
    db.delete(row)
    db.flush()
    return True


def _month_chars_used(db: Session) -> int:
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return int(db.scalar(
        select(func.coalesce(func.sum(AudioAsset.char_count), 0))
        .where(AudioAsset.created_at >= start, AudioAsset.status == AudioStatus.READY)
    ) or 0)


def existing_ready(db: Session, article: Article) -> AudioAsset | None:
    """Whatever this article should play right now.

    An editor's own file always wins: attaching one is an explicit decision
    that this recording, not a synthesised reading, is the audio for the story.
    """
    upload = uploaded_asset(db, article)
    if upload is not None:
        return upload
    digest = content_hash(spoken_text(article))
    return db.scalar(
        select(AudioAsset).where(
            AudioAsset.article_id == article.id,
            AudioAsset.content_hash == digest,
            AudioAsset.status == AudioStatus.READY,
        )
    )


def ensure_audio(db: Session, article: Article, *, requested_by: int | None = None,
                 force: bool = False) -> AudioAsset | None:
    """Return a ready rendition, generating one only if necessary.

    Returns None whenever audio is not possible — switched off, no provider,
    budget exhausted, or the provider failed. Callers treat None as "use the
    device voice", never as an error.
    """
    if not is_enabled(db, article):
        return None

    # Never spend on synthesis for a story that already has an editor's file.
    upload = uploaded_asset(db, article)
    if upload is not None:
        if article.audio_asset_id != upload.id:
            article.audio_asset_id = upload.id
        return upload

    text = spoken_text(article)
    if not text:
        return None
    digest = content_hash(text)

    row = db.scalar(select(AudioAsset).where(
        AudioAsset.article_id == article.id, AudioAsset.content_hash == digest))
    if row is not None and row.status == AudioStatus.READY and not force:
        # §21 cache hit — the words did not change, so nothing is spent.
        if article.audio_asset_id != row.id:
            article.audio_asset_id = row.id
        return row
    if row is not None and row.status == AudioStatus.FAILED and not force:
        # Do not retry a known failure on every page view.
        return None

    provider_name = str(settings_service.get(db, "voice.provider") or "local")
    language = str(settings_service.get(db, "voice.language") or "te-IN")
    provider = get_tts(provider_name)
    if not provider.available():
        logger.info("tts_provider_unavailable", provider=provider_name, article_id=article.id)
        return None

    budget = settings_service.get_int(db, "voice.monthly_char_budget")
    if budget and _month_chars_used(db) + len(text) > budget:
        logger.warning("tts_budget_exceeded", article_id=article.id, budget=budget)
        return None

    if row is None:
        row = AudioAsset(article_id=article.id, content_hash=digest, requested_by=requested_by)
        db.add(row)
    row.status = AudioStatus.GENERATING
    row.provider = provider.key
    row.language = language
    row.char_count = len(text)
    db.flush()

    try:
        result = provider.synthesise(text, language=language)
    except AiProviderError as exc:
        row.status = AudioStatus.FAILED
        row.error = str(exc.details)[:500]
        db.flush()
        logger.warning("tts_failed", article_id=article.id, provider=provider.key)
        return None

    extension = "mp3" if result.mime == "audio/mpeg" else "wav"
    key = f"audio/{article.short_id}/{digest[:16]}.{extension}"
    stored = get_storage().put(
        key, result.audio, content_type=result.mime,
        # Immutable by construction: the hash is in the key, so a change is a
        # different object rather than a new version of this one.
        cache_control="public, max-age=31536000, immutable",
    )

    row.status = AudioStatus.READY
    row.storage_key = key
    row.url = stored.url
    row.mime = result.mime
    row.bytes = len(result.audio)
    row.duration_sec = result.duration_sec
    row.voice = result.voice
    row.generated_at = utcnow()
    row.error = None
    article.audio_asset_id = row.id
    db.flush()
    logger.info("tts_generated", article_id=article.id, provider=provider.key,
                chars=row.char_count, bytes=row.bytes)
    return row


def usage_summary(db: Session) -> dict[str, int]:
    """§21 reporting for the settings screen."""
    budget = settings_service.get_int(db, "voice.monthly_char_budget")
    used = _month_chars_used(db)
    return {
        "chars_this_month": used,
        "monthly_budget": budget,
        "percent_used": round(used * 100 / budget) if budget else 0,
        "assets_ready": int(db.scalar(select(func.count(AudioAsset.id)).where(
            AudioAsset.status == AudioStatus.READY)) or 0),
        "assets_failed": int(db.scalar(select(func.count(AudioAsset.id)).where(
            AudioAsset.status == AudioStatus.FAILED)) or 0),
    }
