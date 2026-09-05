"""Video hub (updated doc §15, YouTube links only) — public list + CMS CRUD.

    GET    /public/videos                 — published videos, newest first
    GET    /cms/videos                    — full library (video.view)
    POST   /cms/videos                    — add by YouTube URL (video.upload)
    PATCH  /cms/videos/{id}               — edit / publish toggle (video.edit)
    DELETE /cms/videos/{id}               — soft delete (video.edit)
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Category
from app.models.enums import AuditAction
from app.models.geo import District
from app.models.video import Video
from app.repositories import article_repo
from app.schemas.public import CategoryOut
from app.services import audit_service, video_service

router = APIRouter(tags=["videos"])


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


class VideoListOut(BaseModel):
    videos: list[VideoOut]
    next_offset: int | None = None


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
    )


@router.get("/public/videos", response_model=VideoListOut, summary="Published videos")
def public_videos(
    response: Response,
    category: str | None = Query(default=None, description="Category slug"),
    offset: int = Query(default=0, ge=0, le=1000),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
) -> VideoListOut:
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=60"
    stmt = (
        select(Video)
        .where(Video.is_published.is_(True), Video.deleted_at.is_(None))
        .order_by(Video.published_at.desc(), Video.id.desc())
        .limit(limit + 1)
        .offset(offset)
    )
    if category:
        category_row = article_repo.get_category_by_slug(db, category)
        stmt = stmt.where(Video.category_id == (category_row.id if category_row else -1))
    rows = list(db.execute(stmt).unique().scalars())
    has_more = len(rows) > limit
    return VideoListOut(
        videos=[_video_out(v) for v in rows[:limit]],
        next_offset=offset + limit if has_more else None,
    )


# --------------------------------------------------------------------------- #
# CMS
# --------------------------------------------------------------------------- #
class VideoIn(BaseModel):
    youtube_url: str = Field(min_length=11, max_length=300, description="Any YouTube URL or a raw id")
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
        ).unique().scalars()
    )
    return {
        "items": [
            {**_video_out(v).model_dump(), "is_published": v.is_published}
            for v in rows
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
        db.execute(select(Category).where(Category.slug == payload.category_slug)).scalar_one_or_none()
        if payload.category_slug
        else None
    )
    district = (
        db.execute(select(District).where(District.slug == payload.district_slug)).scalar_one_or_none()
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
            db.execute(select(Category).where(Category.slug == slug)).scalar_one_or_none()
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
        db, action=AuditAction.UPDATE, entity_type="video", entity_id=video.id,
        actor=p.user, after=payload.model_dump(exclude_unset=True), request=request,
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
        db, action=AuditAction.DELETE, entity_type="video", entity_id=video.id,
        actor=p.user, request=request,
    )
    return {"id": video.id, "deleted": True}
