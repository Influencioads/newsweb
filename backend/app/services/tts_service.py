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


def is_enabled(db: Session, article: Article) -> bool:
    """§20 — both halves of the switch."""
    return settings_service.voice_enabled(db) and bool(article.voice_enabled)


def _month_chars_used(db: Session) -> int:
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return int(db.scalar(
        select(func.coalesce(func.sum(AudioAsset.char_count), 0))
        .where(AudioAsset.created_at >= start, AudioAsset.status == AudioStatus.READY)
    ) or 0)


def existing_ready(db: Session, article: Article) -> AudioAsset | None:
    """The cached rendition for the article's *current* text, if there is one."""
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
