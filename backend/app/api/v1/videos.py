"""Video hub (updated doc §15, YouTube links only) — public list + CMS CRUD.

GET    /public/videos                 — published videos, newest first
GET    /public/videos/rails            — category-grouped rails for the hub
GET    /public/videos/{id}             — one video: channel, tags, counts, related
POST   /public/videos/{id}/view        — count a play
POST   /public/videos/{id}/share       — count a share
GET    /public/videos/{id}/comments    — visible threads
POST   /videos/{id}/comments           — add one (signed-in)
POST   /public/videos/{id}/reaction    — the three-way sentiment bar
GET    /cms/videos                    — full library (video.view)
POST   /cms/videos                    — add by YouTube URL (video.upload)
PATCH  /cms/videos/{id}               — edit / publish toggle (video.edit)
DELETE /cms/videos/{id}               — soft delete (video.edit)
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import (
    Principal,
    get_current_principal,
    get_optional_principal,
    require_permission,
)
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Category
from app.models.enums import (
    AuditAction,
    CommentTargetType,
    FollowTargetType,
    ReactionKind,
)
from app.models.geo import District
from app.models.engagement import Follow
from app.models.video import Video
from app.repositories import article_repo
from app.schemas.public import CategoryOut
from app.repositories import engagement_repo
from app.services import audit_service, engagement_service, video_service

router = APIRouter(tags=["videos"])


class ChannelOut(BaseModel):
    """§15 attribution. YouTube's terms require the source be visible, and a
    reader can follow it the same way they follow a category."""

    id: int
    key: str
    name: str
    url: str | None
    avatar_url: str | None
    is_verified: bool
    follower_count: int


class VideoTagOut(BaseModel):
    slug: str
    name_te: str
    name_en: str


class VideoOut(BaseModel):
    id: int
    youtube_id: str
    thumbnail_url: str
    embed_url: str
    watch_url: str
    title_te: str
    title_en: str | None
    description_te: str | None
    category: CategoryOut | None
    published_at: datetime | None
    duration_sec: int | None = None
    view_count: int = 0
    comment_count: int = 0
    share_count: int = 0
    channel: ChannelOut | None = None
    tags: list[VideoTagOut] = []


class VideoDetailOut(VideoOut):
    """The video page payload — one request, like /public/home."""

    reactions: dict = {}
    related: list[VideoOut] = []
    following_channel: bool = False


class VideoRailOut(BaseModel):
    key: str
    title_te: str
    title_en: str | None
    videos: list[VideoOut]


class VideoRailsOut(BaseModel):
    """The hub: a tab per category, then a rail per category (§15).

    `tabs` is every category that actually has video, so a tab never opens on
    an empty shelf.
    """

    tabs: list[CategoryOut]
    rails: list[VideoRailOut]


class VideoListOut(BaseModel):
    videos: list[VideoOut]
    next_offset: int | None = None


def _channel_out(video: Video) -> ChannelOut | None:
    channel = video.channel
    if channel is None:
        return None
    return ChannelOut(
        id=channel.id,
        key=channel.youtube_channel_key,
        name=channel.name,
        url=channel.url,
        avatar_url=channel.avatar_url,
        is_verified=channel.is_verified,
        follower_count=channel.follower_count,
    )


def _video_out(video: Video) -> VideoOut:
    return VideoOut(
        id=video.id,
        youtube_id=video.youtube_id,
        thumbnail_url=video.thumbnail_url,
        embed_url=video.embed_url,
        watch_url=video.watch_url,
        title_te=video.title_te,
        title_en=video.title_en,
        description_te=video.description_te,
        category=CategoryOut.model_validate(video.category) if video.category else None,
        published_at=video.published_at,
        duration_sec=video.duration_sec,
        view_count=video.view_count or 0,
        comment_count=video.comment_count or 0,
        share_count=video.share_count or 0,
        channel=_channel_out(video),
        tags=[
            VideoTagOut(
                slug=link.tag.slug, name_te=link.tag.name_te, name_en=link.tag.name_en
            )
            for link in sorted(video.tags, key=lambda x: x.sort)
            if link.tag
        ],
    )


@router.get("/public/videos", response_model=VideoListOut, summary="Published videos")
def public_videos(
    response: Response,
    category: str | None = Query(default=None, description="Category slug"),
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
) -> VideoListOut:
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    response.headers["CDN-Cache-Control"] = "public, s-maxage=60"
    stmt = (
        select(Video)
        .where(Video.is_published.is_(True), Video.deleted_at.is_(None))
        .order_by(Video.published_at.desc(), Video.id.desc())
        .limit(limit + 1)
        .offset(offset)
    )
    if category:
        category_row = article_repo.get_category_by_slug(db, category)
        stmt = stmt.where(
            Video.category_id == (category_row.id if category_row else -1)
        )
    rows = list(db.execute(stmt).unique().scalars())
    has_more = len(rows) > limit
    return VideoListOut(
        videos=[_video_out(v) for v in rows[:limit]],
        next_offset=offset + limit if has_more else None,
    )


@router.get(
    "/public/videos/rails",
    response_model=VideoRailsOut,
    summary="Video hub: category tabs and a rail per category",
)
def video_rails(
    response: Response,
    per_rail: int = Query(default=8, ge=2, le=20),
    db: Session = Depends(get_db),
) -> VideoRailsOut:
    """One request builds the whole hub.

    Categories with fewer than two videos are skipped rather than shown as a
    one-item shelf, which reads as broken rather than sparse — the same rule
    the homepage sections follow.
    """
    response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    response.headers["CDN-Cache-Control"] = (
        "public, s-maxage=120, stale-while-revalidate=300"
    )

    live = [Video.is_published.is_(True), Video.deleted_at.is_(None)]
    counts = dict(
        db.execute(
            select(Video.category_id, func.count(Video.id))
            .where(*live, Video.category_id.is_not(None))
            .group_by(Video.category_id)
        ).all()
    )

    categories = db.scalars(
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.sort, Category.id)
    ).all()

    tabs: list[CategoryOut] = []
    rails: list[VideoRailOut] = []
    for category in categories:
        if int(counts.get(category.id, 0)) < 2:
            continue
        tabs.append(CategoryOut.model_validate(category))
        rows = (
            db.execute(
                select(Video)
                .where(*live, Video.category_id == category.id)
                .order_by(Video.published_at.desc(), Video.id.desc())
                .limit(per_rail)
            )
            .unique()
            .scalars()
            .all()
        )
        rails.append(
            VideoRailOut(
                key=category.slug,
                title_te=category.name_te,
                title_en=category.name_en,
                videos=[_video_out(v) for v in rows],
            )
        )
    return VideoRailsOut(tabs=tabs, rails=rails)


@router.get(
    "/public/videos/{video_id}", response_model=VideoDetailOut, summary="One video"
)
def public_video(
    video_id: int,
    response: Response,
    anon_id: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> VideoDetailOut:
    video = engagement_service.get_live_video(db, video_id)
    if principal is None:
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        response.headers["CDN-Cache-Control"] = "public, s-maxage=60"

    viewer = None
    if principal is not None:
        viewer = f"user:{principal.id}"
    elif anon_id:
        viewer = f"anon:{anon_id}"

    following = False
    if principal is not None and video.channel_id:
        following = (
            db.scalar(
                select(Follow).where(
                    Follow.user_id == principal.id,
                    Follow.target_type == FollowTargetType.CHANNEL,
                    Follow.target_id == video.channel_id,
                )
            )
            is not None
        )

    payload = VideoDetailOut(
        **_video_out(video).model_dump(),
        reactions=engagement_service.reaction_summary(
            db, target_type=CommentTargetType.VIDEO, target_id=video.id, viewer=viewer
        ),
        related=[_video_out(v) for v in video_service.related(db, video)],
        following_channel=following,
    )
    return payload


@router.post("/public/videos/{video_id}/view", summary="Count a play")
def count_view(video_id: int, db: Session = Depends(get_db)) -> dict:
    video = engagement_service.get_live_video(db, video_id)
    return {"view_count": video_service.record_view(db, video)}


@router.post("/public/videos/{video_id}/share", summary="Count a share")
def count_share(video_id: int, db: Session = Depends(get_db)) -> dict:
    video = engagement_service.get_live_video(db, video_id)
    return {"share_count": video_service.record_share(db, video)}


class VideoReactionIn(BaseModel):
    #: null clears the reader's reaction.
    kind: ReactionKind | None = None
    anon_id: str | None = Field(default=None, max_length=64)


@router.post("/public/videos/{video_id}/reaction", summary="Set my reaction")
def set_video_reaction(
    video_id: int,
    payload: VideoReactionIn,
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> dict:
    return engagement_service.set_reaction(
        db,
        target_type=CommentTargetType.VIDEO,
        target_key=video_id,
        kind=payload.kind,
        user_id=principal.id if principal else None,
        anon_id=payload.anon_id,
    )


class VideoCommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=1000)
    parent_id: int | None = None


@router.get(
    "/public/videos/{video_id}/comments", summary="Visible comments for a video"
)
def list_video_comments(
    video_id: int,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1000),
    db: Session = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> dict:
    video = engagement_service.get_live_video(db, video_id)
    if principal is None:
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        response.headers["CDN-Cache-Control"] = "public, s-maxage=15"
    rows = engagement_repo.comments_for_target(
        db,
        target_type=CommentTargetType.VIDEO,
        target_id=video.id,
        limit=limit,
        offset=offset,
    )
    me = principal.id if principal else None
    return {
        "total_visible": video.comment_count or 0,
        "comments": [
            {
                "id": c.id,
                "parent_id": c.parent_id,
                "body": c.body,
                "author_name_te": c.user.name_te if c.user else "పాఠకుడు",
                "author_name_en": c.user.name_en if c.user else "Reader",
                "is_mine": me is not None and c.user_id == me,
                "created_at": c.created_at,
            }
            for c in rows
        ],
    }


@router.post(
    "/videos/{video_id}/comments", status_code=201, summary="Comment on a video"
)
def add_video_comment(
    video_id: int,
    payload: VideoCommentIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> dict:
    comment = engagement_service.add_comment(
        db,
        video_id=video_id,
        user_id=principal.id,
        body=payload.body,
        parent_id=payload.parent_id,
    )
    return {
        "id": comment.id,
        "parent_id": comment.parent_id,
        "body": comment.body,
        "author_name_te": principal.user.name_te,
        "author_name_en": principal.user.name_en,
        "is_mine": True,
        "created_at": comment.created_at,
    }


# --------------------------------------------------------------------------- #
# CMS
# --------------------------------------------------------------------------- #
class VideoIn(BaseModel):
    youtube_url: str = Field(
        min_length=11, max_length=300, description="Any YouTube URL or a raw id"
    )
    title_te: str = Field(min_length=3, max_length=400)
    title_en: str | None = Field(default=None, max_length=400)
    description_te: str | None = Field(default=None, max_length=2000)
    category_slug: str | None = None
    district_slug: str | None = None


class VideoPatch(BaseModel):
    title_te: str | None = Field(default=None, min_length=3, max_length=400)
    title_en: str | None = Field(default=None, max_length=400)
    description_te: str | None = Field(default=None, max_length=2000)
    category_slug: str | None = None
    is_published: bool | None = None


@router.get("/cms/videos", summary="Video library")
def cms_videos(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("video.view")),
) -> dict:
    rows = list(
        db.execute(
            select(Video)
            .where(Video.deleted_at.is_(None))
            .order_by(Video.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .unique()
        .scalars()
    )
    return {
        "items": [
            {**_video_out(v).model_dump(), "is_published": v.is_published} for v in rows
        ]
    }


@router.post("/cms/videos", status_code=201, summary="Add a video by YouTube link")
def add_video(
    payload: VideoIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("video.upload")),
) -> dict:
    category = (
        db.execute(
            select(Category).where(Category.slug == payload.category_slug)
        ).scalar_one_or_none()
        if payload.category_slug
        else None
    )
    district = (
        db.execute(
            select(District).where(District.slug == payload.district_slug)
        ).scalar_one_or_none()
        if payload.district_slug
        else None
    )
    video = video_service.add_video(
        db,
        youtube_url=payload.youtube_url,
        title_te=payload.title_te,
        title_en=payload.title_en,
        description_te=payload.description_te,
        category_id=category.id if category else None,
        district_id=district.id if district else None,
        created_by=p.id,
    )
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="video",
        entity_id=video.id,
        actor=p.user,
        after={"youtube_id": video.youtube_id, "title_te": video.title_te[:80]},
        request=request,
    )
    return {**_video_out(video).model_dump(), "is_published": video.is_published}


@router.patch("/cms/videos/{video_id}", summary="Edit or publish/unpublish a video")
def edit_video(
    video_id: int,
    payload: VideoPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("video.edit")),
) -> dict:
    video = video_service.get_video(db, video_id)
    changes = payload.model_dump(exclude_unset=True)
    if "category_slug" in changes:
        slug = changes.pop("category_slug")
        category = (
            db.execute(
                select(Category).where(Category.slug == slug)
            ).scalar_one_or_none()
            if slug
            else None
        )
        video.category_id = category.id if category else None
    if changes.get("is_published") and not video.published_at:
        video.published_at = utcnow()
    for key, value in changes.items():
        if value is not None or key in {"title_en", "description_te"}:
            setattr(video, key, value)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="video",
        entity_id=video.id,
        actor=p.user,
        after=payload.model_dump(exclude_unset=True),
        request=request,
    )
    return {**_video_out(video).model_dump(), "is_published": video.is_published}


@router.delete("/cms/videos/{video_id}", summary="Remove a video (soft delete)")
def delete_video(
    video_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("video.edit")),
) -> dict:
    video = video_service.get_video(db, video_id)
    video.deleted_at = utcnow()
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="video",
        entity_id=video.id,
        actor=p.user,
        request=request,
    )
    return {"id": video.id, "deleted": True}
