"""Import video catalogue data from the local SQLite development database.

Production usage (the SQLite file must first be copied into the API container):
    python -m scripts.import_videos --source /tmp/news-local.db \
        --admin-email newsadmin@gmail.com --apply

The import is idempotent by YouTube id. It imports video channels and tags, but
never copies users, credentials, sessions, audit events, or reader engagement.
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.db.session import session_scope
from app.models.content import Category, Tag
from app.models.geo import District
from app.models.user import User
from app.models.video import Video, VideoChannel, VideoTag


def _rows(db: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    exists = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return list(db.execute(f"SELECT * FROM {table}")) if exists else []


def run(source: Path, admin_email: str, apply: bool) -> None:
    if not source.is_file():
        raise SystemExit(f"SQLite source not found: {source}")

    src = sqlite3.connect(source)
    src.row_factory = sqlite3.Row
    try:
        src_categories = {r["id"]: r["slug"] for r in _rows(src, "categories")}
        src_districts = {r["id"]: r["slug"] for r in _rows(src, "districts")}
        src_tags = {r["id"]: r["slug"] for r in _rows(src, "tags")}
        channel_rows = _rows(src, "video_channels")
        video_rows = [r for r in _rows(src, "videos") if r["deleted_at"] is None]
        tag_rows = _rows(src, "video_tags")

        with session_scope() as db:
            admin = db.execute(
                select(User).where(User.email == admin_email.strip().lower())
            ).scalar_one_or_none()
            if admin is None:
                raise SystemExit(f"Production admin not found: {admin_email}")

            categories = {c.slug: c for c in db.execute(select(Category)).scalars()}
            districts = {d.slug: d for d in db.execute(select(District)).scalars()}
            tags = {t.slug: t for t in db.execute(select(Tag)).scalars()}
            channels = {
                c.youtube_channel_key: c
                for c in db.execute(select(VideoChannel)).scalars()
            }
            source_channel_keys = {r["id"]: r["youtube_channel_key"] for r in channel_rows}

            for row in channel_rows:
                key = row["youtube_channel_key"]
                channel = channels.get(key)
                if channel is None:
                    channel = VideoChannel(youtube_channel_key=key, name=row["name"])
                    db.add(channel)
                    channels[key] = channel
                channel.name = row["name"]
                channel.url = row["url"]
                channel.avatar_url = row["avatar_url"]
                channel.is_verified = bool(row["is_verified"])
            db.flush()

            existing = {v.youtube_id: v for v in db.execute(select(Video)).scalars()}
            source_video_ids: dict[int, Video] = {}
            created = updated = 0
            for row in video_rows:
                youtube_id = row["youtube_id"]
                video = existing.get(youtube_id)
                if video is None:
                    video = Video(youtube_id=youtube_id, title_te=row["title_te"])
                    db.add(video)
                    existing[youtube_id] = video
                    created += 1
                else:
                    updated += 1
                category = categories.get(src_categories.get(row["category_id"]))
                district = districts.get(src_districts.get(row["district_id"]))
                channel = channels.get(source_channel_keys.get(row["channel_id"]))
                video.title_te = row["title_te"]
                video.title_en = row["title_en"]
                video.description_te = row["description_te"]
                video.category_id = category.id if category else None
                video.district_id = district.id if district else None
                video.channel_id = channel.id if channel else None
                video.duration_sec = row["duration_sec"]
                video.is_published = bool(row["is_published"])
                video.published_at = (
                    datetime.fromisoformat(row["published_at"])
                    if row["published_at"]
                    else None
                )
                video.created_by = admin.id
                video.deleted_at = None
                source_video_ids[row["id"]] = video
            db.flush()

            for video in source_video_ids.values():
                for link in list(video.tags):
                    db.delete(link)
            db.flush()
            for row in tag_rows:
                video = source_video_ids.get(row["video_id"])
                tag = tags.get(src_tags.get(row["tag_id"]))
                if video and tag:
                    db.add(VideoTag(video_id=video.id, tag_id=tag.id, sort=row["sort"]))

            if not apply:
                db.rollback()
                print(f"DRY RUN: would create {created}, update {updated} videos")
                print("Run again with --apply to commit.")
            else:
                print(f"Imported videos: created={created}, updated={updated}")
    finally:
        src.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    run(args.source, args.admin_email, args.apply)
