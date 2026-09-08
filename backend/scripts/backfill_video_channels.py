"""Give existing videos a channel row and category tags (updated doc §15).

Videos seeded before the video hub stored their publisher as text inside
`description_te` ("I News · YouTube") because there was nowhere else to put it.
The channel is now a real row, so this lifts the name out of that string into
`video_channels` and links it — which is what makes attribution consistent and
"follow this channel" possible.

Idempotent: a video that already has a channel is left alone, and channels are
matched by key so two videos from the same publisher share one row.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.backfill_video_channels
"""

from __future__ import annotations

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.environ.setdefault("DATABASE_URL", "sqlite:///./var/news-local.db")

from sqlalchemy import select  # noqa: E402

from app.db.session import session_scope  # noqa: E402
from app.models.video import Video  # noqa: E402
from app.services import video_service  # noqa: E402


def publisher_from_description(description: str | None) -> str | None:
    """The seeder wrote "<Publisher> · YouTube"; take the part before the dot."""
    if not description:
        return None
    name = description.split("·")[0].strip()
    return name or None


def run() -> None:
    linked = tagged = 0
    with session_scope() as db:
        videos = db.scalars(select(Video).where(Video.deleted_at.is_(None))).all()
        for video in videos:
            if video.channel_id is None:
                name = publisher_from_description(video.description_te)
                if name:
                    video.channel_id = video_service.get_or_create_channel(db, name=name).id
                    linked += 1
            if not video.tags and video.category is not None:
                # The category is the one tag we can state as fact. Inventing
                # topic tags from a headline would produce confident nonsense.
                video_service.apply_tags(db, video, [video.category.name_te])
                tagged += 1
        db.flush()

        channels = {v.channel.name for v in videos if v.channel}
        print(f"videos linked to a channel : {linked}")
        print(f"videos given a category tag: {tagged}")
        print(f"distinct channels          : {len(channels)}")
        for name in sorted(channels)[:12]:
            print(f"  · {name}")


if __name__ == "__main__":
    run()
