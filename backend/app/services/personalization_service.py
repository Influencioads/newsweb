"""Personalized "For You" feed (updated doc §3).

Exactly the §3.2 formula, rule-based (ML deferred until there is data):

    score = category interest + topic interest + location relevance
          + recency + engagement + followed-source preference
          − negative feedback

The interest profile is derived on request from the reader's own trails —
reading sessions and events (what they actually read), explicit onboarding
interests, and follows — then applied to a recency-bounded candidate pool.
Freshness is a multiplicative decay so old stories can never dominate (§3.2
"always include freshness"). `not_interested` events subtract at both the
article level (hard exclusion) and its category (soft penalty).
"""

from __future__ import annotations

import math
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.content import Article, ArticleTag
from app.models.engagement import ArticleEvent, Follow, ReadingSession
from app.models.enums import EventType, FollowTargetType
from app.models.reader import UserPreference
from app.repositories.article_repo import latest

logger = get_logger(__name__)

PROFILE_WINDOW_DAYS = 30
CANDIDATE_POOL = 200
FRESHNESS_TAU_HOURS = 24.0

W_CATEGORY_READ = 1.0      # per article read in that category (capped)
W_CATEGORY_PREF = 3.0      # explicit onboarding interest (§32)
W_CATEGORY_FOLLOW = 4.0
W_TAG_READ = 0.5
W_TAG_FOLLOW = 3.0
W_DISTRICT_HOME = 4.0      # reader's saved home district (§4)
W_DISTRICT_FOLLOW = 3.0
W_MANDAL_HOME = 2.0        # additional, on top of the district match
W_AUTHOR_FOLLOW = 4.0
W_ENGAGEMENT = 1.5         # site-wide signal, normalised 0..1
P_NOT_INTERESTED_CATEGORY = 4.0
CATEGORY_READ_CAP = 6.0


class Profile:
    __slots__ = (
        "category_weights", "tag_weights", "author_ids", "district_ids",
        "home_district_id", "home_mandal_id", "excluded_article_ids",
        "penalised_category_ids",
    )

    def __init__(self) -> None:
        self.category_weights: dict[int, float] = {}
        self.tag_weights: dict[int, float] = {}
        self.author_ids: set[int] = set()
        self.district_ids: set[int] = set()
        self.home_district_id: int | None = None
        self.home_mandal_id: int | None = None
        self.excluded_article_ids: set[int] = set()
        self.penalised_category_ids: set[int] = set()

    @property
    def is_empty(self) -> bool:
        return not (
            self.category_weights or self.tag_weights or self.author_ids
            or self.district_ids or self.home_district_id
        )


def build_profile(db: Session, user_id: int) -> Profile:
    profile = Profile()
    since = utcnow() - timedelta(days=PROFILE_WINDOW_DAYS)

    # --- what they actually read (§3.1: opens, reading time) ---------------
    read_rows = db.execute(
        select(Article.category_id, func.count(ReadingSession.id))
        .join(ReadingSession, ReadingSession.article_id == Article.id)
        .where(ReadingSession.user_id == user_id, ReadingSession.updated_at >= since)
        .group_by(Article.category_id)
    ).all()
    for category_id, count in read_rows:
        if category_id is not None:
            profile.category_weights[category_id] = min(
                float(count) * W_CATEGORY_READ, CATEGORY_READ_CAP
            )

    tag_rows = db.execute(
        select(ArticleTag.tag_id, func.count(ReadingSession.id))
        .join(ReadingSession, ReadingSession.article_id == ArticleTag.article_id)
        .where(ReadingSession.user_id == user_id, ReadingSession.updated_at >= since)
        .group_by(ArticleTag.tag_id)
    ).all()
    for tag_id, count in tag_rows:
        profile.tag_weights[tag_id] = min(float(count) * W_TAG_READ, 3.0)

    # --- explicit choices: onboarding interests + home location (§11) ------
    prefs = db.execute(
        select(UserPreference).where(UserPreference.user_id == user_id)
    ).scalar_one_or_none()
    if prefs is not None:
        profile.home_district_id = prefs.district_id
        profile.home_mandal_id = prefs.mandal_id
        if prefs.category_slugs:
            from app.models.content import Category

            rows = db.execute(
                select(Category.id).where(Category.slug.in_(list(prefs.category_slugs)))
            ).scalars()
            for category_id in rows:
                profile.category_weights[category_id] = (
                    profile.category_weights.get(category_id, 0.0) + W_CATEGORY_PREF
                )

    # --- follows (§12 "followed-source preference") ------------------------
    for follow in db.execute(select(Follow).where(Follow.user_id == user_id)).scalars():
        if follow.target_type == FollowTargetType.CATEGORY:
            profile.category_weights[follow.target_id] = (
                profile.category_weights.get(follow.target_id, 0.0) + W_CATEGORY_FOLLOW
            )
        elif follow.target_type == FollowTargetType.TAG:
            profile.tag_weights[follow.target_id] = (
                profile.tag_weights.get(follow.target_id, 0.0) + W_TAG_FOLLOW
            )
        elif follow.target_type == FollowTargetType.AUTHOR:
            profile.author_ids.add(follow.target_id)
        elif follow.target_type in {FollowTargetType.DISTRICT, FollowTargetType.MANDAL}:
            profile.district_ids.add(follow.target_id)

    # --- negative feedback (§3.2 "− negative feedback") --------------------
    not_interested = db.execute(
        select(ArticleEvent.article_id, Article.category_id)
        .join(Article, Article.id == ArticleEvent.article_id)
        .where(
            ArticleEvent.user_id == user_id,
            ArticleEvent.event_type == EventType.NOT_INTERESTED,
        )
    ).all()
    for article_id, category_id in not_interested:
        profile.excluded_article_ids.add(article_id)
        if category_id is not None:
            profile.penalised_category_ids.add(category_id)

    return profile


def _score(article: Article, profile: Profile, tag_ids: list[int], now) -> float:
    score = 0.0
    if article.category_id is not None:
        score += profile.category_weights.get(article.category_id, 0.0)
        if article.category_id in profile.penalised_category_ids:
            score -= P_NOT_INTERESTED_CATEGORY
    for tag_id in tag_ids:
        score += profile.tag_weights.get(tag_id, 0.0)
    if article.district_id is not None:
        if article.district_id == profile.home_district_id:
            score += W_DISTRICT_HOME
            if article.mandal_id is not None and article.mandal_id == profile.home_mandal_id:
                score += W_MANDAL_HOME
        if article.district_id in profile.district_ids:
            score += W_DISTRICT_FOLLOW
    if article.author_id is not None and article.author_id in profile.author_ids:
        score += W_AUTHOR_FOLLOW

    # Site-wide engagement, normalised so a viral story nudges rather than
    # dominates a personal feed.
    engagement = min(
        (article.view_count or 0) / 50.0
        + (article.like_count or 0) / 5.0
        + (article.share_count or 0) / 5.0,
        1.0,
    )
    score += W_ENGAGEMENT * engagement

    # Freshness is multiplicative: interest can raise a story, never resurrect
    # last week's front page (§3.2).
    age_hours = (
        (now - article.published_at).total_seconds() / 3600 if article.published_at else 0.0
    )
    return score * math.exp(-max(age_hours, 0.0) / FRESHNESS_TAU_HOURS)


def for_you_feed(
    db: Session, *, user_id: int, limit: int = 20, offset: int = 0
) -> list[Article]:
    """Ranked candidates for this reader. An empty profile (brand-new account)
    degrades to the latest feed — the §31 "sensible default"."""
    profile = build_profile(db, user_id)
    candidates = latest(db, limit=CANDIDATE_POOL)
    if profile.is_empty:
        return candidates[offset : offset + limit]

    candidate_ids = [a.id for a in candidates]
    tags_by_article: dict[int, list[int]] = {}
    if candidate_ids:
        for article_id, tag_id in db.execute(
            select(ArticleTag.article_id, ArticleTag.tag_id).where(
                ArticleTag.article_id.in_(candidate_ids)
            )
        ):
            tags_by_article.setdefault(article_id, []).append(tag_id)

    now = utcnow()
    ranked = sorted(
        (
            (_score(a, profile, tags_by_article.get(a.id, []), now), a)
            for a in candidates
            if a.id not in profile.excluded_article_ids
        ),
        key=lambda pair: pair[0],
        reverse=True,
    )
    return [a for _s, a in ranked[offset : offset + limit]]
