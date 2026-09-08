"""YouTube-link videos (updated doc §15, product decision: YouTube only)."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.db.base import utcnow
from app.models.content import Tag
from app.models.enums import TagType
from app.models.video import Video, VideoChannel, VideoTag
from app.telugu.normalize import normalize_text
from app.telugu.transliterate import slugify

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


def link_for_article(db: Session, youtube_url: str, *, article) -> Video:
    """Attach a pasted YouTube URL to an article (§1 "video" field).

    Unlike `add_video`, a link that is already in the library is *reused*
    rather than rejected — two stories legitimately reference the same clip,
    and an editor pasting a known URL should not see an error.
    """
    youtube_id = parse_youtube_id(youtube_url)
    existing = db.execute(
        select(Video).where(Video.youtube_id == youtube_id, Video.deleted_at.is_(None))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    video = Video(
        youtube_id=youtube_id,
        title_te=(article.title_te or "వీడియో")[:400],
        title_en=(article.title_en or None),
        category_id=article.category_id,
        district_id=article.district_id,
        is_published=True,
        published_at=utcnow(),
        created_by=article.updated_by or article.created_by,
    )
    db.add(video)
    db.flush()
    return video


def get_video(db: Session, video_id: int) -> Video:
    video = db.get(Video, video_id)
    if video is None or video.deleted_at is not None:
        raise NotFoundError()
    return video


# --------------------------------------------------------------------------- #
# channels (§15) — the publisher behind a video
# --------------------------------------------------------------------------- #
def channel_key(name: str, youtube_channel_id: str | None = None) -> str:
    """Stable identity for a channel.

    Prefers YouTube's own id; falls back to a slug of the display name, because
    oEmbed returns `author_name` but not always `author_id`. Two videos from
    the same publisher must land on the same row either way, or "follow" would
    mean a different thing per video.
    """
    if youtube_channel_id:
        return youtube_channel_id[:80]
    return (slugify(name) or "channel")[:80]


def get_or_create_channel(
    db: Session,
    *,
    name: str,
    youtube_channel_id: str | None = None,
    url: str | None = None,
    avatar_url: str | None = None,
) -> VideoChannel:
    key = channel_key(name, youtube_channel_id)
    channel = db.execute(
        select(VideoChannel).where(VideoChannel.youtube_channel_key == key)
    ).scalar_one_or_none()
    if channel is None:
        channel = VideoChannel(youtube_channel_key=key, name=name[:200], url=url,
                               avatar_url=avatar_url)
        db.add(channel)
        db.flush()
        return channel
    # A publisher that renames itself should not fork into two rows.
    if name and channel.name != name[:200]:
        channel.name = name[:200]
    if url and not channel.url:
        channel.url = url
    if avatar_url and not channel.avatar_url:
        channel.avatar_url = avatar_url
    return channel


# --------------------------------------------------------------------------- #
# tags (§15 hashtag chips) — the same tags articles use
# --------------------------------------------------------------------------- #
def apply_tags(db: Session, video: Video, names: list[str]) -> None:
    """Replace a video's tags, creating any name that does not exist yet.

    Deliberately shares the `tags` table with articles: a reader tapping
    #Politics on a video should land on the same page as #Politics on a story,
    not a parallel universe of video-only tags.
    """
    wanted: list[Tag] = []
    seen: set[str] = set()
    for raw in names[:25]:
        name = normalize_text(raw).strip()
        if not name:
            continue
        slug = slugify(name)[:100]
        if not slug or slug in seen:
            continue
        seen.add(slug)
        tag = db.scalar(select(Tag).where(Tag.slug == slug))
        if tag is None:
            tag = Tag(slug=slug, name_te=name[:140], name_en=name[:140], type=TagType.TOPIC)
            db.add(tag)
            db.flush()
        wanted.append(tag)

    existing = {link.tag_id: link for link in video.tags}
    keep = {t.id for t in wanted}
    for tag_id, link in list(existing.items()):
        if tag_id not in keep:
            video.tags.remove(link)
    for position, tag in enumerate(wanted):
        link = existing.get(tag.id)
        if link is None:
            video.tags.append(VideoTag(tag_id=tag.id, sort=position))
        else:
            link.sort = position
    db.flush()


def record_view(db: Session, video: Video) -> int:
    """Count one play (§15).

    A plain increment rather than the article beacon's unique-viewer dedup:
    `videos.view_count` is a display figure next to the title, not a trending
    input, so it cannot distort a ranking. Trending still reads only
    `article_events`.
    """
    video.view_count = (video.view_count or 0) + 1
    db.flush()
    return video.view_count


def record_share(db: Session, video: Video) -> int:
    video.share_count = (video.share_count or 0) + 1
    db.flush()
    return video.share_count


def related(db: Session, video: Video, *, limit: int = 8) -> list[Video]:
    """Videos to watch next: same channel first, then same category, then recent.

    Same order of specificity as the article `related` query, for the same
    reason — the closest match is the most useful, and the fallbacks stop the
    rail being empty on a young library.
    """
    picked: list[Video] = []
    seen = {video.id}
    live = [Video.is_published.is_(True), Video.deleted_at.is_(None)]

    for predicate in (
        Video.channel_id == video.channel_id if video.channel_id else None,
        Video.category_id == video.category_id if video.category_id else None,
        None,
    ):
        if len(picked) >= limit:
            break
        stmt = select(Video).where(*live, Video.id.notin_(seen))
        if predicate is not None:
            stmt = stmt.where(predicate)
        stmt = stmt.order_by(Video.published_at.desc()).limit(limit - len(picked))
        for row in db.execute(stmt).unique().scalars():
            if row.id not in seen:
                picked.append(row)
                seen.add(row.id)
    return picked[:limit]
