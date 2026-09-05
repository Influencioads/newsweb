"""Reader interactions (updated doc §22 "Interactions" + §12 Follow).

    POST /public/events                       — behaviour beacon (anonymous OK)
    GET  /public/articles/{short_id}/comments — visible comments
    POST /articles/{short_id}/like|bookmark   — signed-in state (DELETE undoes)
    GET  /articles/{short_id}/me              — my like/bookmark flags
    POST /articles/{short_id}/comments        — add a comment
    POST /articles/{short_id}/report          — report an article
    POST /comments/{id}/report · DELETE /comments/{id}
    POST /follow · DELETE /follow · GET /users/me/follows
    GET  /users/me/bookmarks | /history | /following

The beacon accepts anonymous traffic; everything stateful requires a session.
Analytics must never block reading (§31): the beacon returns 202 after one
batched insert and the client fires it without awaiting.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.deps import Principal, get_current_principal, get_optional_principal
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.enums import FollowTargetType, ReportTargetType
from app.repositories import engagement_repo
from app.schemas.engagement import (
    BeaconIn,
    BeaconOut,
    BookmarksOut,
    CommentIn,
    CommentListOut,
    CommentOut,
    EngagementCountsOut,
    FollowIn,
    FollowListOut,
    FollowOut,
    FollowStateOut,
    FollowingFeedOut,
    HistoryItemOut,
    HistoryOut,
    MyArticleFlagsOut,
    ReportIn,
)
from app.schemas.public import ArticleCardOut
from app.services import engagement_service

router = APIRouter(tags=["interactions"])


def _cards(articles, db: Session) -> list[ArticleCardOut]:
    from app.api.v1.public import _cards as project_cards, _district_map

    return project_cards(list(articles), db, _district_map(db))


# --------------------------------------------------------------------------- #
# beacon
# --------------------------------------------------------------------------- #
@router.post(
    "/public/events",
    response_model=BeaconOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Reader-behaviour beacon (batched, anonymous allowed)",
    description=(
        "Accepts view / read / scroll / share / not_interested events (§3.1). "
        "Views deduplicate per viewer per day (§8), read seconds accumulate, "
        "scroll keeps the maximum. Fire-and-forget from the client."
    ),
)
def ingest_events(
    payload: BeaconIn,
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
    _rl: None = Depends(rate_limit("events", 30)),
) -> BeaconOut:
    accepted = engagement_service.ingest_beacon(
        db,
        events=[e.model_dump() for e in payload.events],
        user_id=principal.id if principal else None,
        anon_id=payload.anon_id,
    )
    return BeaconOut(accepted=accepted)


# --------------------------------------------------------------------------- #
# like / bookmark / flags
# --------------------------------------------------------------------------- #
@router.post("/articles/{short_id}/like", response_model=EngagementCountsOut, summary="Like")
def like(
    short_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> EngagementCountsOut:
    article = engagement_service.set_like(db, short_id=short_id, user_id=principal.id, liked=True)
    return EngagementCountsOut.model_validate(article, from_attributes=True)


@router.delete("/articles/{short_id}/like", response_model=EngagementCountsOut, summary="Unlike")
def unlike(
    short_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> EngagementCountsOut:
    article = engagement_service.set_like(db, short_id=short_id, user_id=principal.id, liked=False)
    return EngagementCountsOut.model_validate(article, from_attributes=True)


@router.post("/articles/{short_id}/bookmark", response_model=MyArticleFlagsOut, summary="Bookmark")
def bookmark(
    short_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> MyArticleFlagsOut:
    article = engagement_service.set_bookmark(
        db, short_id=short_id, user_id=principal.id, bookmarked=True
    )
    liked, bookmarked = engagement_repo.my_flags(db, article_id=article.id, user_id=principal.id)
    return MyArticleFlagsOut(liked=liked, bookmarked=bookmarked)


@router.delete(
    "/articles/{short_id}/bookmark", response_model=MyArticleFlagsOut, summary="Remove bookmark"
)
def unbookmark(
    short_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> MyArticleFlagsOut:
    article = engagement_service.set_bookmark(
        db, short_id=short_id, user_id=principal.id, bookmarked=False
    )
    liked, bookmarked = engagement_repo.my_flags(db, article_id=article.id, user_id=principal.id)
    return MyArticleFlagsOut(liked=liked, bookmarked=bookmarked)


@router.get(
    "/articles/{short_id}/me",
    response_model=MyArticleFlagsOut,
    summary="My like/bookmark state for an article",
    description="Asked separately so the article payload itself stays cacheable at the edge.",
)
def my_article_flags(
    short_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> MyArticleFlagsOut:
    article = engagement_service.get_live_article(db, short_id)
    liked, bookmarked = engagement_repo.my_flags(db, article_id=article.id, user_id=principal.id)
    return MyArticleFlagsOut(liked=liked, bookmarked=bookmarked)


# --------------------------------------------------------------------------- #
# comments
# --------------------------------------------------------------------------- #
def _comment_out(comment, me_id: int | None) -> CommentOut:
    return CommentOut(
        id=comment.id,
        parent_id=comment.parent_id,
        body=comment.body,
        author_name_te=comment.user.name_te if comment.user else "పాఠకుడు",
        author_name_en=comment.user.name_en if comment.user else "Reader",
        is_mine=me_id is not None and comment.user_id == me_id,
        created_at=comment.created_at,
    )


@router.get(
    "/public/articles/{short_id}/comments",
    response_model=CommentListOut,
    summary="Visible comments for an article",
)
def list_comments(
    short_id: str,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1000),
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> CommentListOut:
    article = engagement_service.get_live_article(db, short_id)
    if principal is None:
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        response.headers["CDN-Cache-Control"] = "public, s-maxage=15"
    comments = engagement_repo.comments_for_article(
        db, article_id=article.id, limit=limit, offset=offset
    )
    return CommentListOut(
        total_visible=article.comment_count,
        comments=[_comment_out(c, principal.id if principal else None) for c in comments],
    )


@router.post(
    "/articles/{short_id}/comments",
    response_model=CommentOut,
    status_code=201,
    summary="Add a comment (signed-in readers)",
)
def add_comment(
    short_id: str,
    payload: CommentIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("comment", 6)),
) -> CommentOut:
    comment = engagement_service.add_comment(
        db,
        short_id=short_id,
        user_id=principal.id,
        body=payload.body,
        parent_id=payload.parent_id,
    )
    comment.user = principal.user
    return _comment_out(comment, principal.id)


@router.delete("/comments/{comment_id}", summary="Delete my comment")
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> dict:
    engagement_service.delete_own_comment(db, comment_id=comment_id, user_id=principal.id)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# reports
# --------------------------------------------------------------------------- #
@router.post(
    "/articles/{short_id}/report",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Report an article",
)
def report_article(
    short_id: str,
    payload: ReportIn,
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
    _rl: None = Depends(rate_limit("report", 6)),
) -> dict:
    article = engagement_service.get_live_article(db, short_id)
    engagement_service.add_report(
        db,
        target_type=ReportTargetType.ARTICLE,
        target_id=article.id,
        user_id=principal.id if principal else None,
        reason=payload.reason,
        note=payload.note,
    )
    return {"ok": True}


@router.post(
    "/comments/{comment_id}/report",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Report a comment",
)
def report_comment(
    comment_id: int,
    payload: ReportIn,
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
    _rl: None = Depends(rate_limit("report", 6)),
) -> dict:
    engagement_service.add_report(
        db,
        target_type=ReportTargetType.COMMENT,
        target_id=comment_id,
        user_id=principal.id if principal else None,
        reason=payload.reason,
        note=payload.note,
    )
    return {"ok": True}


# --------------------------------------------------------------------------- #
# follows (§12)
# --------------------------------------------------------------------------- #
@router.post("/follow", response_model=FollowStateOut, summary="Follow a category/tag/place/author")
def follow(
    payload: FollowIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
    _rl: None = Depends(rate_limit("follow", 30)),
) -> FollowStateOut:
    engagement_service.set_follow(
        db,
        user_id=principal.id,
        target_type=payload.target_type,
        slug=payload.slug,
        following=True,
    )
    return FollowStateOut(following=True)


@router.delete("/follow", response_model=FollowStateOut, summary="Unfollow")
def unfollow(
    payload: FollowIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> FollowStateOut:
    engagement_service.set_follow(
        db,
        user_id=principal.id,
        target_type=payload.target_type,
        slug=payload.slug,
        following=False,
    )
    return FollowStateOut(following=False)


@router.get("/users/me/follows", response_model=FollowListOut, summary="Everything I follow")
def my_follows(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> FollowListOut:
    from app.models.content import Category, Tag
    from app.models.geo import District, Mandal
    from app.models.user import User
    from sqlalchemy import select

    rows = engagement_repo.follows_for_user(db, user_id=principal.id)
    by_type: dict[FollowTargetType, list[int]] = {}
    for f in rows:
        by_type.setdefault(f.target_type, []).append(f.target_id)

    lookups: dict[FollowTargetType, dict[int, tuple[str, str, str]]] = {}
    model_for = {
        FollowTargetType.CATEGORY: (Category, Category.slug),
        FollowTargetType.TAG: (Tag, Tag.slug),
        FollowTargetType.DISTRICT: (District, District.slug),
        FollowTargetType.MANDAL: (Mandal, Mandal.slug),
        FollowTargetType.AUTHOR: (User, User.author_slug),
    }
    for target_type, ids in by_type.items():
        model, _slug_col = model_for[target_type]
        found = db.execute(select(model).where(model.id.in_(ids))).scalars()
        lookups[target_type] = {
            row.id: (
                getattr(row, "slug", None) or getattr(row, "author_slug", "") or "",
                row.name_te,
                row.name_en,
            )
            for row in found
        }

    follows = []
    for f in rows:
        info = lookups.get(f.target_type, {}).get(f.target_id)
        if info is None:
            continue  # target deleted since
        slug, name_te, name_en = info
        follows.append(
            FollowOut(target_type=f.target_type, slug=slug, name_te=name_te, name_en=name_en)
        )
    return FollowListOut(follows=follows)


# --------------------------------------------------------------------------- #
# my library: bookmarks, history, following feed
# --------------------------------------------------------------------------- #
@router.get("/users/me/bookmarks", response_model=BookmarksOut, summary="My saved articles")
def my_bookmarks(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=1000),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> BookmarksOut:
    rows = engagement_repo.bookmarked_articles(
        db, user_id=principal.id, limit=limit + 1, offset=offset
    )
    has_more = len(rows) > limit
    return BookmarksOut(
        articles=_cards(rows[:limit], db),
        next_offset=offset + limit if has_more else None,
    )


@router.get("/users/me/history", response_model=HistoryOut, summary="My reading history")
def my_history(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=1000),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> HistoryOut:
    rows = engagement_repo.reading_history(
        db, user_id=principal.id, limit=limit + 1, offset=offset
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    cards = _cards([a for a, _s in rows], db)
    items = [
        HistoryItemOut(
            article=card,
            seconds=session.seconds,
            max_scroll_pct=session.max_scroll_pct,
            last_read_at=session.updated_at,
        )
        for card, (_a, session) in zip(cards, rows)
    ]
    return HistoryOut(items=items, next_offset=offset + limit if has_more else None)


@router.get(
    "/users/me/following",
    response_model=FollowingFeedOut,
    summary="Stories from everything I follow (§12)",
)
def my_following_feed(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=1000),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> FollowingFeedOut:
    rows = engagement_repo.following_feed(
        db, user_id=principal.id, limit=limit + 1, offset=offset
    )
    has_more = len(rows) > limit
    return FollowingFeedOut(
        articles=_cards(rows[:limit], db),
        next_offset=offset + limit if has_more else None,
    )


@router.get(
    "/users/me/for-you",
    response_model=FollowingFeedOut,
    summary="Personalized feed (§3.2, rule-based)",
    description=(
        "score = category interest + topic interest + location relevance + "
        "recency + engagement + followed-source preference − negative feedback. "
        "The profile is derived from the reader's own reading trail, onboarding "
        "interests and follows; freshness decays multiplicatively so old "
        "stories never dominate. A brand-new account gets the latest feed."
    ),
)
def my_for_you_feed(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0, le=200),
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> FollowingFeedOut:
    from app.services import personalization_service

    rows = personalization_service.for_you_feed(
        db, user_id=principal.id, limit=limit + 1, offset=offset
    )
    has_more = len(rows) > limit
    return FollowingFeedOut(
        articles=_cards(rows[:limit], db),
        next_offset=offset + limit if has_more else None,
    )
