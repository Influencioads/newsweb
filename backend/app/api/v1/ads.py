"""House ads (updated doc §26).

    GET  /public/ads?placement=&category=&district=  — one campaign, weighted pick
    POST /public/ads/{id}/click                      — click counter
    GET/POST/PATCH/DELETE /cms/ads                   — campaign CRUD (ads.manage)

Every served ad carries the "ప్రకటన" label — §26's clear commercial labeling
is a payload field the clients render, not a convention they remember.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.ratelimit import rate_limit
from app.core.errors import NotFoundError, ValidationError
from app.db.base import utcnow
from app.db.session import get_db
from app.models.creator import AdCampaign
from app.models.enums import AdPlacement, AuditAction
from app.repositories import article_repo
from app.services import audit_service

router = APIRouter(tags=["ads"])


class AdOut(BaseModel):
    id: int
    placement: AdPlacement
    image_url: str
    target_url: str
    label_te: str = "ప్రకటన"
    label_en: str = "Advertisement"


@router.get(
    "/public/ads",
    response_model=AdOut | None,
    summary="Serve one house ad for a slot (§26)",
    description=(
        "Weighted random among active campaigns inside their schedule window "
        "that match the category/district (untargeted campaigns match "
        "everywhere). Null when nothing fits — the slot collapses."
    ),
)
def serve_ad(
    response: Response,
    placement: AdPlacement = Query(),
    category: str | None = Query(default=None, description="Category slug context"),
    district: str | None = Query(default=None, description="District slug context"),
    db: Session = Depends(get_db),
) -> AdOut | None:
    # Rotation must rotate: never edge-cache the pick itself.
    response.headers["Cache-Control"] = "no-store"

    category_row = article_repo.get_category_by_slug(db, category) if category else None
    district_row = article_repo.get_district_by_slug(db, district) if district else None

    now = utcnow()
    candidates = [
        c
        for c in db.execute(
            select(AdCampaign).where(
                AdCampaign.placement == placement,
                AdCampaign.is_active.is_(True),
                AdCampaign.starts_at <= now,
                AdCampaign.ends_at > now,
            )
        ).scalars()
        if (c.category_id is None or (category_row and c.category_id == category_row.id))
        and (c.district_id is None or (district_row and c.district_id == district_row.id))
    ]
    if not candidates:
        return None

    chosen = random.choices(candidates, weights=[max(c.weight, 1) for c in candidates])[0]
    chosen.impressions = (chosen.impressions or 0) + 1
    return AdOut(
        id=chosen.id,
        placement=chosen.placement,
        image_url=chosen.image_url,
        target_url=chosen.target_url,
    )


@router.post("/public/ads/{ad_id}/click", status_code=202, summary="Record an ad click")
def ad_click(
    ad_id: int,
    db: Session = Depends(get_db),
    _rl: None = Depends(rate_limit("ad_click", 30)),
) -> dict:
    campaign = db.get(AdCampaign, ad_id)
    if campaign is not None:
        campaign.clicks = (campaign.clicks or 0) + 1
    # Always 202 — a dead id must not error a reader's click-through.
    return {"ok": True}


# --------------------------------------------------------------------------- #
# CMS (§19 Ads, permission ads.manage)
# --------------------------------------------------------------------------- #
class AdIn(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    image_url: HttpUrl
    target_url: HttpUrl
    placement: AdPlacement
    category_slug: str | None = None
    district_slug: str | None = None
    duration_days: float = Field(default=7, gt=0, le=90)
    weight: int = Field(default=1, ge=1, le=100)


class AdPatch(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=160)
    is_active: bool | None = None
    weight: int | None = Field(default=None, ge=1, le=100)
    ends_at: datetime | None = None


def _ad_row(campaign: AdCampaign) -> dict:
    return {
        "id": campaign.id,
        "name": campaign.name,
        "image_url": campaign.image_url,
        "target_url": campaign.target_url,
        "placement": campaign.placement,
        "category_id": campaign.category_id,
        "district_id": campaign.district_id,
        "starts_at": campaign.starts_at,
        "ends_at": campaign.ends_at,
        "is_active": campaign.is_active,
        "weight": campaign.weight,
        "impressions": campaign.impressions,
        "clicks": campaign.clicks,
        "ctr_percent": round(campaign.clicks / campaign.impressions * 100, 2)
        if campaign.impressions
        else 0.0,
    }


@router.get("/cms/ads", summary="Campaign list with §26 impression/click analytics")
def list_ads(
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("ads.manage")),
) -> dict:
    rows = list(
        db.execute(select(AdCampaign).order_by(AdCampaign.created_at.desc()).limit(100)).scalars()
    )
    return {"items": [_ad_row(c) for c in rows]}


@router.post("/cms/ads", status_code=201, summary="Create a campaign")
def create_ad(
    payload: AdIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ads.manage")),
) -> dict:
    category = (
        article_repo.get_category_by_slug(db, payload.category_slug)
        if payload.category_slug
        else None
    )
    if payload.category_slug and category is None:
        raise ValidationError(details={"category_slug": "unknown category"})
    district = (
        article_repo.get_district_by_slug(db, payload.district_slug)
        if payload.district_slug
        else None
    )
    if payload.district_slug and district is None:
        raise ValidationError(details={"district_slug": "unknown district"})

    now = utcnow()
    campaign = AdCampaign(
        name=payload.name,
        image_url=str(payload.image_url),
        target_url=str(payload.target_url),
        placement=payload.placement,
        category_id=category.id if category else None,
        district_id=district.id if district else None,
        starts_at=now,
        ends_at=now + timedelta(days=payload.duration_days),
        weight=payload.weight,
        created_by=p.id,
    )
    db.add(campaign)
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="ad_campaign",
        entity_id=campaign.id,
        actor=p.user,
        after={"name": campaign.name, "placement": campaign.placement},
        request=request,
    )
    return _ad_row(campaign)


@router.patch("/cms/ads/{ad_id}", summary="Edit / pause a campaign")
def update_ad(
    ad_id: int,
    payload: AdPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ads.manage")),
) -> dict:
    campaign = db.get(AdCampaign, ad_id)
    if campaign is None:
        raise NotFoundError()
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        if value is not None:
            setattr(campaign, key, value)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="ad_campaign",
        entity_id=campaign.id,
        actor=p.user,
        after={k: str(v) for k, v in changes.items()},
        request=request,
    )
    return _ad_row(campaign)


@router.delete("/cms/ads/{ad_id}", summary="End a campaign now")
def delete_ad(
    ad_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("ads.manage")),
) -> dict:
    campaign = db.get(AdCampaign, ad_id)
    if campaign is None:
        raise NotFoundError()
    campaign.is_active = False
    campaign.ends_at = utcnow()
    audit_service.record(
        db,
        action=AuditAction.DELETE,
        entity_type="ad_campaign",
        entity_id=campaign.id,
        actor=p.user,
        request=request,
    )
    return {"id": campaign.id, "ended": True}
