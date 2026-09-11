"""The three-hourly audio bulletin — public playback and the editor's desk.

    GET   /public/bulletins/latest
    GET   /public/bulletins?date=
    GET   /public/bulletins/{date}/{slot}

    GET   /cms/bulletins?date=          voice.manage
    GET   /cms/bulletins/{id}
    PATCH /cms/bulletins/{id}           edit the script
    POST  /cms/bulletins/run            produce a slot now
    POST  /cms/bulletins/{id}/regenerate
    POST  /cms/bulletins/{id}/publish   level 60+
    POST  /cms/bulletins/{id}/pull      level 60+

The public payload is a **superset of the article-audio payload**, so the web
and mobile players work against a bulletin unchanged. `voice_enabled` maps to
`bulletin.enabled`: flipping the kill switch makes both players render nothing
through the branch they already have, rather than needing new code.

Publish and pull require level 60 (desk editor and above), matching the house
rule that anything a reader sees is a desk editor's call.
"""

from __future__ import annotations

from datetime import date as date_type

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_permission
from app.core.errors import NotFoundError, ValidationError
from app.db.session import get_db
from app.models.bulletin import AudioBulletin
from app.models.enums import AuditAction, BulletinStatus
from app.services import audit_service, bulletin_service, settings_service

router = APIRouter(tags=["bulletins"])

#: Same shape as the article audio route: revalidate at the browser, cache at
#: the edge for two minutes. A bulletin changes at most six times a day, but
#: when it is pulled it must disappear quickly.
_CACHE = "public, max-age=0, must-revalidate"
_CDN_CACHE = "public, s-maxage=120, stale-while-revalidate=600"


def _cache(response: Response) -> None:
    response.headers["Cache-Control"] = _CACHE
    response.headers["CDN-Cache-Control"] = _CDN_CACHE


# --------------------------------------------------------------------------- #
# Public
# --------------------------------------------------------------------------- #
@router.get("/public/bulletins/latest")
def latest_bulletin(response: Response, db: Session = Depends(get_db)):
    _cache(response)
    return bulletin_service.serialize(db, bulletin_service.latest_published(db))


@router.get("/public/bulletins")
def bulletins_for_day(
    response: Response,
    date: date_type | None = None,
    db: Session = Depends(get_db),
):
    _cache(response)
    if not settings_service.bulletin_enabled(db):
        return {"enabled": False, "items": []}
    day = date or bulletin_service.today()
    rows = [
        row
        for row in bulletin_service.for_day(db, day)
        if row.status == BulletinStatus.PUBLISHED
    ]
    return {
        "enabled": True,
        "date": day.isoformat(),
        "items": [
            bulletin_service.serialize(db, row, include_script=False) for row in rows
        ],
    }


@router.get("/public/bulletins/{date}/{slot}")
def bulletin_detail(
    date: date_type, slot: int, response: Response, db: Session = Depends(get_db)
):
    _cache(response)
    bulletin = bulletin_service.get(db, date, slot)
    if bulletin.status != BulletinStatus.PUBLISHED or not settings_service.bulletin_enabled(db):
        raise NotFoundError()
    return bulletin_service.serialize(db, bulletin)


# --------------------------------------------------------------------------- #
# CMS
# --------------------------------------------------------------------------- #
def _cms_row(db: Session, bulletin: AudioBulletin) -> dict:
    """The editor's view: everything, including the bulletins that are not live."""
    return {
        "id": bulletin.id,
        "date": bulletin.bulletin_date.isoformat(),
        "slot": bulletin.slot,
        "slot_label_te": bulletin.slot_label_te,
        "status": bulletin.status,
        "revision": bulletin.revision,
        "attempts": bulletin.attempts,
        "script_te": bulletin.script_te,
        "char_count": bulletin.char_count,
        "target_chars": bulletin_service.target_chars(db),
        "duration_sec": bulletin.duration_sec,
        "segment_count": bulletin.segment_count,
        "provider": bulletin.provider,
        "voice": bulletin.voice,
        "url": bulletin.url,
        "error": bulletin.error,
        "generated_at": bulletin.generated_at,
        "published_at": bulletin.published_at,
        "items": [
            {
                "position": item.position,
                "article_id": item.article_id,
                "short_id": item.article.short_id if item.article else None,
                "url": item.article.url_path if item.article else None,
                "headline_te": item.headline_te,
            }
            for item in bulletin.items
        ],
    }


@router.get("/cms/bulletins")
def list_bulletins(
    date: date_type | None = None,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("voice.manage")),
):
    day = date or bulletin_service.today()
    rows = bulletin_service.for_day(db, day)
    have = {row.slot for row in rows}
    return {
        "date": day.isoformat(),
        "enabled": settings_service.bulletin_enabled(db),
        "requires_approval": bulletin_service.requires_approval(db),
        "items": [_cms_row(db, row) for row in rows],
        # Slots that have not been produced yet, so the screen can offer
        # "Run now" rather than simply showing nothing.
        "missing_slots": [s for s in bulletin_service.SLOTS if s not in have],
    }


def _get(db: Session, bulletin_id: int) -> AudioBulletin:
    bulletin = db.get(AudioBulletin, bulletin_id)
    if bulletin is None:
        raise NotFoundError()
    return bulletin


@router.get("/cms/bulletins/{bulletin_id}")
def get_bulletin(
    bulletin_id: int,
    db: Session = Depends(get_db),
    _p: Principal = Depends(require_permission("voice.manage")),
):
    return _cms_row(db, _get(db, bulletin_id))


class BulletinPatch(BaseModel):
    script_te: str = Field(min_length=20, max_length=bulletin_service.MAX_SCRIPT_CHARS)


@router.patch("/cms/bulletins/{bulletin_id}")
def edit_script(
    bulletin_id: int,
    payload: BulletinPatch,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage")),
):
    """Replace the script by hand.

    Drops the bulletin back to SCRIPTED, so Regenerate then speaks the editor's
    words rather than rebuilding them. This is the path that lets somebody fix
    a mispronunciation or drop a story without abandoning the automation.
    """
    import hashlib

    bulletin = _get(db, bulletin_id)
    before = {"status": bulletin.status, "chars": bulletin.char_count}
    bulletin.script_te = payload.script_te.strip()
    bulletin.script_hash = hashlib.sha256(
        bulletin.script_te.encode("utf-8")
    ).hexdigest()
    bulletin.char_count = len(bulletin.script_te)
    bulletin.status = BulletinStatus.SCRIPTED
    db.flush()
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="audio_bulletin",
        entity_id=bulletin.id,
        actor=p.user,
        before=before,
        after={"status": bulletin.status, "chars": bulletin.char_count},
        request=request,
    )
    return _cms_row(db, bulletin)


class BulletinRunIn(BaseModel):
    date: date_type | None = None
    slot: int | None = None


@router.post("/cms/bulletins/run")
def run_now(
    payload: BulletinRunIn,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage")),
):
    if not settings_service.bulletin_enabled(db):
        raise ValidationError(
            message_en="Turn the audio bulletin on in Settings first.",
            message_te="ముందుగా సెట్టింగ్స్‌లో ఆడియో బులెటిన్‌ను ఆన్ చేయండి.",
            details={"bulletin.enabled": "is off"},
        )
    if payload.slot is not None and payload.slot not in bulletin_service.SLOTS:
        raise ValidationError(details={"slot": f"must be one of {list(bulletin_service.SLOTS)}"})

    bulletin = bulletin_service.run_slot(
        db, day=payload.date, slot=payload.slot, requested_by=p.id
    )
    if bulletin is None:
        raise ValidationError(
            message_en="No slot is due right now. Pick one explicitly to backfill it.",
            message_te="ఇప్పుడు ఏ స్లాట్ లేదు. కావాలంటే ఒకదాన్ని ఎంచుకోండి.",
        )
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="audio_bulletin",
        entity_id=bulletin.id,
        actor=p.user,
        after={"status": bulletin.status, "slot": bulletin.slot},
        request=request,
    )
    return _cms_row(db, bulletin)


@router.post("/cms/bulletins/{bulletin_id}/regenerate")
def regenerate(
    bulletin_id: int,
    request: Request,
    rescript: bool = Query(True),
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage")),
):
    bulletin = _get(db, bulletin_id)
    bulletin_service.regenerate(db, bulletin, actor_id=p.id, rescript=rescript)
    audit_service.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="audio_bulletin",
        entity_id=bulletin.id,
        actor=p.user,
        after={"status": bulletin.status, "revision": bulletin.revision},
        request=request,
    )
    return _cms_row(db, bulletin)


@router.post("/cms/bulletins/{bulletin_id}/publish")
def publish_bulletin(
    bulletin_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage", min_level=60)),
):
    bulletin = bulletin_service.publish(db, _get(db, bulletin_id), actor_id=p.id)
    audit_service.record(
        db,
        action=AuditAction.PUBLISH,
        entity_type="audio_bulletin",
        entity_id=bulletin.id,
        actor=p.user,
        after={"slot": bulletin.slot, "date": bulletin.bulletin_date.isoformat()},
        request=request,
    )
    return _cms_row(db, bulletin)


@router.post("/cms/bulletins/{bulletin_id}/pull")
def pull_bulletin(
    bulletin_id: int,
    request: Request,
    db: Session = Depends(get_db),
    p: Principal = Depends(require_permission("voice.manage", min_level=60)),
):
    """Take a live bulletin off the air. The audio is kept, so it can go back."""
    bulletin = bulletin_service.pull(db, _get(db, bulletin_id), actor_id=p.id)
    audit_service.record(
        db,
        action=AuditAction.UNPUBLISH,
        entity_type="audio_bulletin",
        entity_id=bulletin.id,
        actor=p.user,
        after={"slot": bulletin.slot},
        request=request,
    )
    return _cms_row(db, bulletin)
