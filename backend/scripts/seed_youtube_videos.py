"""Seed the video library with real, working, category-related YouTube links.

For each nav category this runs a Telugu YouTube search, takes the first
few result ids, and keeps only those that YouTube's public oEmbed endpoint
confirms are live embeddable videos — the stored title is the video's real
title, never invented. Videos land through video_service.add_video, the same
path the CMS uses (dupes rejected, audit-ready).

No API key involved: the results page and oEmbed are public endpoints, and
the run is a couple of dozen requests. Idempotent — existing youtube_ids are
skipped.

Usage (from backend/):
    .venv/Scripts/python.exe -m scripts.seed_youtube_videos
"""

from __future__ import annotations

import sys

# Windows consoles default to cp1252; Telugu titles and arrows must not crash a run.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import os
import re
import time
from urllib.parse import quote

os.environ.setdefault("DATABASE_URL", "sqlite:///./var/news-local.db")

import httpx
from sqlalchemy import select

from app.db.session import session_scope
from app.models.content import Category
from app.models.user import User
from app.models.video import Video
from app.services import video_service

#: category slug -> (telugu search query, videos to keep)
SEARCHES: dict[str, str] = {
    "national": "జాతీయ వార్తలు తెలుగు",
    "world": "అంతర్జాతీయ వార్తలు తెలుగు",
    "politics": "ఆంధ్రప్రదేశ్ రాజకీయ వార్తలు",
    "cinema": "టాలీవుడ్ సినిమా వార్తలు",
    "sports": "క్రికెట్ వార్తలు తెలుగు",
    "business": "బిజినెస్ వార్తలు తెలుగు",
    "jobs": "ఉద్యోగ నోటిఫికేషన్ తెలుగు",
    "health": "ఆరోగ్య చిట్కాలు తెలుగు",
    "lifestyle": "లైఫ్ స్టైల్ తెలుగు",
    "travel": "ఆంధ్రప్రదేశ్ పర్యాటక ప్రదేశాలు",
    "food": "తెలుగు వంటలు",
    "crime": "క్రైమ్ వార్తలు తెలుగు",
    "devotional": "తిరుమల భక్తి",
    "inspiring": "స్ఫూర్తి కథలు తెలుగు",
    "zero-to-hero": "తెలుగు విజయగాథ స్ఫూర్తి",
    "best-deals": "బెస్ట్ డీల్స్ ఆఫర్స్ తెలుగు",
    "andhra-pradesh": "ఆంధ్రప్రదేశ్ వార్తలు",
    "telangana": "తెలంగాణ వార్తలు",
}
PER_CATEGORY = 2

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "te-IN,te;q=0.9,en;q=0.8",
    "Cookie": "CONSENT=YES+cb; SOCS=CAI",
}


def search_video_ids(client: httpx.Client, query: str) -> list[str]:
    url = f"https://www.youtube.com/results?search_query={quote(query)}"
    resp = client.get(url)
    resp.raise_for_status()
    ids = re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', resp.text)
    seen: set[str] = set()
    ordered: list[str] = []
    for vid in ids:
        if vid not in seen:
            seen.add(vid)
            ordered.append(vid)
    return ordered


def oembed(client: httpx.Client, video_id: str) -> dict | None:
    """None unless YouTube confirms the video exists and is embeddable."""
    try:
        resp = client.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
        )
        if resp.status_code != 200:
            return None
        return resp.json()
    except (httpx.HTTPError, ValueError):
        return None


def run() -> None:
    added = 0
    with httpx.Client(headers=_HEADERS, timeout=20.0, follow_redirects=True) as client, \
            session_scope() as db:
        editor = db.execute(
            select(User).where(User.email == "srinivas@seed.example.com")
        ).scalar_one_or_none()
        categories = {c.slug: c for c in db.execute(select(Category)).scalars()}
        existing = {
            v.youtube_id
            for v in db.execute(select(Video).where(Video.deleted_at.is_(None))).scalars()
        }

        for slug, query in SEARCHES.items():
            category = categories.get(slug)
            if category is None:
                continue
            have = db.execute(
                select(Video).where(Video.category_id == category.id, Video.deleted_at.is_(None))
            ).scalars().all()
            need = PER_CATEGORY - len(have)
            if need <= 0:
                print(f"  {slug:14s} already has {len(have)} videos")
                continue

            try:
                candidates = search_video_ids(client, query)
            except httpx.HTTPError as exc:
                print(f"  {slug:14s} search failed: {exc}")
                continue

            kept = 0
            for video_id in candidates:
                if kept >= need:
                    break
                if video_id in existing:
                    continue
                meta = oembed(client, video_id)
                if meta is None or not meta.get("title"):
                    continue
                title = str(meta["title"])[:390]
                author = str(meta.get("author_name") or "YouTube")[:180]
                try:
                    video_service.add_video(
                        db,
                        youtube_url=video_id,
                        title_te=title,
                        title_en=None,
                        description_te=f"{author} · YouTube",
                        category_id=category.id,
                        district_id=None,
                        created_by=editor.id if editor else 0,
                    )
                except Exception as exc:  # noqa: BLE001 — dupe or validation; move on
                    print(f"  {slug:14s} skip {video_id}: {exc}")
                    continue
                existing.add(video_id)
                kept += 1
                added += 1
                print(f"  {slug:14s} + {video_id}  {title[:52]}")
                time.sleep(0.3)

    print(f"\nvideos added: {added}")


if __name__ == "__main__":
    run()
