"""YouTube-link videos (updated doc §15, product decision: YouTube only)."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.db.base import utcnow
from app.models.video import Video

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def parse_youtube_id(url_or_id: str) -> str:
    """Extract the 11-char video id from any YouTube URL shape an editor will
    realistically paste — watch, youtu.be, shorts, embed, live — or a raw id.

    Raises ValidationError when nothing id-shaped is found.
    """
    value = (url_or_id or "").strip()
    if _ID_RE.match(value):
        return value

    try:
        parsed = urlparse(value)
    except ValueError:
        parsed = None

    candidate = ""
    if parsed and parsed.netloc:
        host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")
        path = parsed.path.strip("/")
        if host == "youtu.be":
            candidate = path.split("/")[0]
        elif host in {"youtube.com", "youtube-nocookie.com", "music.youtube.com"}:
            if path == "watch":
                candidate = (parse_qs(parsed.query).get("v") or [""])[0]
            else:
                parts = path.split("/")
                if parts and parts[0] in {"shorts", "embed", "live", "v"} and len(parts) > 1:
                    candidate = parts[1]

    if not _ID_RE.match(candidate):
        raise ValidationError(
            message_en="That does not look like a YouTube link.",
            message_te="అది YouTube లింక్ లాగా లేదు.",
            details={"url": value[:200]},
        )
    return candidate


def add_video(
    db: Session,
    *,
    youtube_url: str,
    title_te: str,
    title_en: str | None,
    description_te: str | None,
    category_id: int | None,
    district_id: int | None,
    created_by: int,
) -> Video:
    youtube_id = parse_youtube_id(youtube_url)
    existing = db.execute(
        select(Video).where(Video.youtube_id == youtube_id, Video.deleted_at.is_(None))
    ).scalar_one_or_none()
    if existing is not None:
        raise ValidationError(
            message_en="That video is already in the library.",
            message_te="ఆ వీడియో ఇప్పటికే లైబ్రరీలో ఉంది.",
            details={"video_id": existing.id},
        )

    video = Video(
        youtube_id=youtube_id,
        title_te=title_te.strip(),
        title_en=(title_en or "").strip() or None,
        description_te=(description_te or "").strip() or None,
        category_id=category_id,
        district_id=district_id,
        is_published=True,
        published_at=utcnow(),
        created_by=created_by,
    )
    db.add(video)
    db.flush()
    return video


def get_video(db: Session, video_id: int) -> Video:
    video = db.get(Video, video_id)
    if video is None or video.deleted_at is not None:
        raise NotFoundError()
    return video
