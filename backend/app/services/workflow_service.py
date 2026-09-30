from __future__ import annotations

from datetime import datetime, timedelta
from enum import Enum
from typing import Any

from nanoid import generate
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.core.errors import ConflictError, ValidationError
from app.core.permissions import LEVEL_PIN_PLACEMENT
from app.db.base import utcnow
from app.models.content import (
    Article,
    ArticleTag,
    ArticleVersion,
    Category,
    Tag,
    WorkflowTransition,
)
from app.models.enums import ArticleStatus, ArticleType, TagType, WorkflowState
from app.models.geo import Locality, Mandal
from app.models.media import ArticleMedia, Media
from app.services import tiptap
from app.telugu.normalize import normalize_headline, normalize_text
from app.telugu.transliterate import slugify


def _scope(principal: Principal, article: Article) -> None:
    principal.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)


#: Straight copies — no normalisation, no derived work.
_SCALARS = (
    "category_id",
    "subcategory_id",
    "district_id",
    "mandal_id",
    "locality_id",
    "source_type",
    "is_breaking",
    "is_exclusive",
    "is_featured",
    "is_short",
    "voice_enabled",
    "article_type",
    "hero_media_id",
    "video_id",
    "author_id",
)
#: Placement intent. Nullable ints where an explicit null means "do not pin",
#: so they are handled with the clearable fields rather than _SCALARS.
_PIN_INTENT = ("pin_home_minutes", "pin_trending_minutes")
#: Nullable timestamps: an explicit `null` clears them, so presence matters
#: rather than truthiness.
_TIMESTAMPS = ("scheduled_at", "expires_at", "breaking_until")
#: Free text that goes through Telugu normalisation.
_TEXT = (
    "title_en",
    "sub_title_te",
    "summary_te",
    "byline_te",
    "source_credit",
    "seo_title",
    "seo_description",
)


def _resolve_placement(db: Session, article: Article, values: dict[str, Any]) -> None:
    """§2: the location chain has to be internally consistent, and a
    subcategory has to actually belong to its parent. The form guides the
    editor, but the server is what guarantees it."""
    if article.subcategory_id is not None:
        sub = db.get(Category, article.subcategory_id)
        if sub is None:
            raise ValidationError(details={"subcategory_id": "unknown category"})
        if sub.parent_id != article.category_id:
            raise ValidationError(
                details={"subcategory_id": "must be a child of the selected category"}
            )
    if article.mandal_id is not None:
        mandal = db.get(Mandal, article.mandal_id)
        if mandal is None:
            raise ValidationError(details={"mandal_id": "unknown mandal"})
        if article.district_id is None:
            article.district_id = mandal.district_id
        elif mandal.district_id != article.district_id:
            raise ValidationError(
                details={"mandal_id": "does not belong to the selected district"}
            )
    if article.locality_id is not None:
        locality = db.get(Locality, article.locality_id)
        if locality is None:
            raise ValidationError(details={"locality_id": "unknown locality"})
        if article.mandal_id is None:
            article.mandal_id = locality.mandal_id
        elif locality.mandal_id != article.mandal_id:
            raise ValidationError(
                details={"locality_id": "does not belong to the selected mandal"}
            )


def _apply_tags(
    db: Session,
    article: Article,
    names: list[str],
    *,
    types: dict[str, TagType] | None = None,
    create_inactive: bool = False,
) -> None:
    """Replace the tag set. Unknown names become topic tags — an editor typing
    a new name should not have to leave the form to create it first.

    `types` (name -> type) and `create_inactive` are for the crawl's AI tags
    and apply only to a tag created here: an existing tag keeps its type and
    its state. An inactive tag goes live when its story is published."""
    wanted: list[Tag] = []
    seen: set[str] = set()
    for raw in names:
        name = normalize_text(raw).strip()
        if not name:
            continue
        slug = (
            slugify(name)[:100]
            or slugify(name.encode("ascii", "ignore").decode())[:100]
        )
        if not slug or slug in seen:
            continue
        seen.add(slug)
        tag = db.scalar(select(Tag).where(Tag.slug == slug))
        if tag is None:
            tag = Tag(
                slug=slug,
                name_te=name[:140],
                name_en=name[:140],
                type=(types or {}).get(raw, TagType.TOPIC),
                is_active=not create_inactive,
            )
            db.add(tag)
            db.flush()
        wanted.append(tag)

    existing = {link.tag_id: link for link in article.tags}
    keep = {t.id for t in wanted}
    for tag_id, link in existing.items():
        if tag_id not in keep:
            article.tags.remove(link)
    for position, tag in enumerate(wanted):
        link = existing.get(tag.id)
        if link is None:
            article.tags.append(ArticleTag(tag_id=tag.id, sort=position))
        else:
            link.sort = position


def _apply_gallery(db: Session, article: Article, media_ids: list[int]) -> None:
    """Replace the gallery. The hero image is a separate column and is not
    touched here, so an editor can reorder the gallery without losing it."""
    known = (
        {
            m.id
            for m in db.scalars(
                select(Media).where(Media.id.in_(media_ids), Media.deleted_at.is_(None))
            ).all()
        }
        if media_ids
        else set()
    )
    missing = [i for i in media_ids if i not in known]
    if missing:
        raise ValidationError(
            details={"gallery_media_ids": f"unknown media: {missing}"}
        )

    db.execute(
        delete(ArticleMedia).where(
            ArticleMedia.article_id == article.id, ArticleMedia.role == "gallery"
        )
    )
    for position, media_id in enumerate(dict.fromkeys(media_ids)):
        db.add(
            ArticleMedia(
                article_id=article.id, media_id=media_id, role="gallery", sort=position
            )
        )
    # The session runs with autoflush off, so without this the response
    # serialiser's SELECT would not see the rows just added and the editor
    # would be shown an empty gallery immediately after saving one.
    db.flush()


def apply_copy(
    article: Article, values: dict[str, Any], db: Session | None = None
) -> None:
    """Copy a validated payload onto the article.

    `db` is optional so the existing callers that only set copy keep working;
    the relational fields (tags, gallery, video URL, placement checks) need a
    session and are skipped without one.
    """
    if "title_te" in values and values["title_te"] is not None:
        article.title_te = normalize_headline(values["title_te"])
        # An explicit slug wins; otherwise it is derived, and a published
        # article keeps the slug readers already have.
        if not values.get("slug") and (
            article.slug in (None, "", "draft") or article.published_at is None
        ):
            article.slug = slugify(article.title_te)[:180] or article.slug or "draft"
    if values.get("slug"):
        article.slug = values["slug"][:180]
    for key in _TEXT:
        if key in values:
            setattr(article, key, normalize_text(values[key]) if values[key] else None)
    if "canonical_url" in values:
        article.canonical_url = values["canonical_url"] or None
    for key in _SCALARS:
        if key in values and values[key] is not None:
            setattr(article, key, values[key])
    # Clearing a placement has to be possible: an explicit null means "unset".
    for key in (
        "subcategory_id",
        "district_id",
        "mandal_id",
        "locality_id",
        "hero_media_id",
        "video_id",
    ):
        if key in values and values[key] is None:
            setattr(article, key, None)
    for key in _PIN_INTENT:
        if key in values:
            setattr(article, key, values[key])
    for key in _TIMESTAMPS:
        if key in values:
            setattr(article, key, values[key])
    if "body" in values:
        body, plain, html, words, seconds = tiptap.derive(values["body"])
        article.body, article.body_plain, article.body_html = body, plain, html
        article.word_count, article.reading_time_sec = words, seconds

    if db is None:
        return

    if values.get("video_youtube_url"):
        from app.services import video_service

        article.video_id = video_service.link_for_article(
            db, values["video_youtube_url"], article=article
        ).id
    _resolve_placement(db, article, values)
    if values.get("tags") is not None:
        _apply_tags(db, article, values["tags"])


#: §23 types that describe a machine-produced origin. An editor cannot claim
#: one by hand — the AI pipeline sets them, so desk copy can never be mislabelled
#: as AI output and, more importantly, AI output can never be relabelled as desk
#: copy to slip past the review the type is there to signal.
_MACHINE_TYPES = {ArticleType.AI_SUGGESTED, ArticleType.AI_DRAFT}


def _guard_flags(
    db: Session, principal: Principal, article: Article, values: dict[str, Any]
) -> None:
    if values.get("is_breaking"):
        principal.require("article.breaking")
    # Choosing what leads the home page or Top trending is the same authority
    # as pinning from the pin screen — the form is a shortcut to that action,
    # not a way around its permission.
    if any(values.get(key) for key in _PIN_INTENT):
        principal.require("article.publish")
        # `article.publish` used to imply desk seniority. A panchayat
        # secretary now holds it at level 15, and deciding what leads the
        # home page for every reader in two states is not theirs to make.
        principal.require_level(LEVEL_PIN_PLACEMENT, reason="pin")
    if values.get("article_type") in _MACHINE_TYPES:
        raise ValidationError(
            message_en="AI article types are set by the AI pipeline, not by hand.",
            details={"article_type": "reserved"},
        )
    if values.get("author_id") is not None and values["author_id"] != article.author_id:
        # Re-assigning a byline moves ownership of the article, so it needs the
        # same authority as approving one.
        principal.require("article.approve")


def apply_placement_pins(
    db: Session, article: Article, actor_id: int | None
) -> list[str]:
    """Turn the form's pin intent into real pins (§8, §9).

    Called on save for an already-live article and again at publication, so the
    editor's decision lands whichever order the two happen in. Re-running it is
    safe: an existing live pin in the same slot is replaced rather than
    duplicated, so saving twice does not stack two overlapping windows.
    """
    from app.models.discovery import Pin
    from app.models.enums import PinPlacement

    if article.status != ArticleStatus.PUBLISHED:
        return []

    now = utcnow()
    applied: list[str] = []
    wanted = {
        PinPlacement.HOME: article.pin_home_minutes,
        PinPlacement.TRENDING: article.pin_trending_minutes,
    }
    for placement, minutes in wanted.items():
        if not minutes or minutes <= 0:
            continue
        existing = db.scalar(
            select(Pin).where(
                Pin.article_id == article.id,
                Pin.placement == placement,
                Pin.ends_at > now,
            )
        )
        if existing is not None:
            existing.starts_at = now
            existing.ends_at = now + timedelta(minutes=minutes)
            existing.created_by = actor_id
        else:
            db.add(
                Pin(
                    article_id=article.id,
                    placement=placement,
                    starts_at=now,
                    ends_at=now + timedelta(minutes=minutes),
                    note="Set on the article form",
                    created_by=actor_id,
                )
            )
        applied.append(placement.value)
    if applied:
        db.flush()
    return applied


def create(db: Session, principal: Principal, values: dict[str, Any]) -> Article:
    article = Article(
        short_id=generate(size=6),
        slug="draft",
        author_id=principal.id,
        created_by=principal.id,
        updated_by=principal.id,
    )
    _guard_flags(db, principal, article, values)
    # Placement has to land before the scope check, and the gallery needs an id,
    # so the write is split around the flush.
    gallery = values.pop("gallery_media_ids", None)
    apply_copy(article, values, db)
    if values.get("article_type") is None:
        article.article_type = _default_type(principal, article)
    article.article_source_type = "EDITOR" if principal.is_global else "REPORTER"
    _scope(principal, article)
    db.add(article)
    db.flush()
    if gallery is not None:
        _apply_gallery(db, article, gallery)
    db.add(
        WorkflowTransition(
            article_id=article.id,
            from_state=None,
            to_state=WorkflowState.DRAFT,
            actor_id=principal.id,
            created_at=utcnow(),
        )
    )
    return article


def _default_type(principal: Principal, article: Article) -> ArticleType:
    """§23 default. Breaking wins, then a field reporter's own copy, then the
    ordinary desk case."""
    if article.is_breaking:
        return ArticleType.BREAKING_NEWS
    if principal.has("article.create") and not principal.is_global:
        return ArticleType.REPORTER
    return ArticleType.NORMAL


def update(
    db: Session, principal: Principal, article: Article, values: dict[str, Any]
) -> Article:
    _scope(principal, article)
    if article.workflow_state not in {
        WorkflowState.DRAFT,
        WorkflowState.CHANGES_REQUESTED,
    }:
        raise ConflictError(
            message_en="Only drafts or returned articles can be edited."
        )
    _guard_flags(db, principal, article, values)
    gallery = values.pop("gallery_media_ids", None)
    apply_copy(article, values, db)
    if gallery is not None:
        _apply_gallery(db, article, gallery)
    article.updated_by = principal.id
    article.version += 1
    return article


def _snapshot(db: Session, article: Article, actor_id: int | None) -> None:
    """Freeze the article as it stands right now.

    Written at approval, and again on the one publish path that has no
    approval — a story that reached readers unreviewed is precisely the one you
    want a `before` for when a takedown edit follows.
    """

    def json_value(value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, Enum):
            return value.value
        return value

    snapshot = {
        c.name: json_value(getattr(article, c.name))
        for c in Article.__table__.columns
        if c.name not in {"body"}
    }
    snapshot["body"] = article.body
    db.add(
        ArticleVersion(
            article_id=article.id,
            version=article.version,
            snapshot=snapshot,
            changed_by=actor_id,
            created_at=utcnow(),
        )
    )


def transition(
    db: Session,
    principal: Principal,
    article: Article,
    action: str,
    note: str | None,
    scheduled_at: datetime | None = None,
) -> Article:
    _scope(principal, article)
    old = article.workflow_state
    mapping = {
        "submit": (
            {WorkflowState.DRAFT, WorkflowState.CHANGES_REQUESTED},
            WorkflowState.SUBMITTED,
        ),
        "review": ({WorkflowState.SUBMITTED}, WorkflowState.IN_REVIEW),
        "approve": (
            {WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW},
            WorkflowState.APPROVED,
        ),
        "request-changes": (
            {WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW},
            WorkflowState.CHANGES_REQUESTED,
        ),
        "reject": (
            {WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW},
            WorkflowState.REJECTED,
        ),
        # SCHEDULED is publishable too: that is both the scheduler firing and an
        # editor deciding to go early.
        "publish": (
            {WorkflowState.APPROVED, WorkflowState.SCHEDULED},
            WorkflowState.PUBLISHED,
        ),
        "unpublish": ({WorkflowState.PUBLISHED}, WorkflowState.UNPUBLISHED),
    }
    allowed, target = mapping[action]
    # The ONE exception to "nothing reaches a reader without a human editor
    # pressing Approve", and this is the only place it is asked. Everything
    # that makes it safe lives in `may_self_publish`; if it says no, the rest
    # of this function is exactly what it has always been.
    from app.services import panchayat_service

    trusted = action == "publish" and panchayat_service.may_self_publish(
        db, principal, article
    )
    if trusted:
        # Their copy never passes through APPROVED, because nobody approves it.
        allowed = allowed | {WorkflowState.DRAFT, WorkflowState.SUBMITTED}
    if old not in allowed:
        raise ConflictError(details={"state": old, "action": action})
    if action == "approve":
        if article.author_id == principal.id:
            raise ValidationError(
                message_en="Authors cannot approve their own article."
            )
        article.approved_by, article.approved_at = principal.id, utcnow()
        _snapshot(db, article, principal.id)
    if action == "review":
        article.reviewed_by = principal.id
    if action == "publish":
        # A short-news card is its photo and its few lines of text; the swipe
        # feed has nothing else to show, and the body is optional.
        if article.is_short and not (article.hero_media_id and (article.summary_te or "").strip()):
            raise ValidationError(
                message_en="Short news needs a hero photo and short text before publishing.",
                message_te="షార్ట్ న్యూస్ ప్రచురించే ముందు ఫోటో మరియు చిన్న వార్త తప్పనిసరి.",
                details={"is_short": "hero_media_id and summary required"},
            )
        # The owner's rule (2026-09-29): no story reaches a reader without its
        # photo. Asked before the trusted branch below writes anything, and of
        # the picture itself — a hero deleted from the library is no photo.
        hero = db.get(Media, article.hero_media_id) if article.hero_media_id else None
        if hero is None or hero.deleted_at is not None or not hero.mime.startswith("image/"):
            raise ValidationError(
                message_en="Add a hero photo before publishing: a story without a photo is never published.",
                message_te="ప్రచురించే ముందు ప్రధాన ఫోటో జత చేయండి — ఫోటో లేని వార్త ప్రచురించబడదు.",
                details={"hero_media_id": "a usable photo is required"},
            )
        if trusted:
            # `approved_by` stays NULL on purpose. Stamping the secretary into
            # it would make the audit log claim an editor approved this when
            # none did; PUBLISHED with `approved_by IS NULL` is instead the
            # signature you query for to find every story that took this path.
            panchayat_service.stamp_ugc(db, article, principal)
            _snapshot(db, article, principal.id)
        else:
            if not article.approved_by or article.approved_by == article.author_id:
                raise ValidationError(
                    message_en="A different senior editor must approve before publishing."
                )
            # The check above compares the approver against the *author*, which is
            # the right test for copy a person wrote. Machine-created copy has no
            # author — a feed import and an AI rewrite both leave `author_id` NULL
            # — and `approved_by == None` is false, so without this clause one
            # editor could approve and publish a machine article entirely alone.
            # Two people are required precisely *because* nobody wrote it.
            if article.author_id is None and article.approved_by == principal.id:
                raise ValidationError(
                    message_en=(
                        "A machine-created article must be approved and published "
                        "by two different people."
                    ),
                    message_te=(
                        "యంత్రం రూపొందించిన కథనాన్ని ఇద్దరు వేర్వేరు వ్యక్తులు "
                        "ఆమోదించి ప్రచురించాలి."
                    ),
                )
            if article.source_type != "own" and not article.source_credit:
                raise ValidationError(
                    message_en="Agency and syndicated stories require source credit."
                )

        # §1 "publish date and time": a future time schedules instead of going
        # live now. The state machine gains SCHEDULED rather than PUBLISHED, so
        # every public query — all of which filter on status — keeps it hidden
        # without needing to know about scheduling at all.
        #
        # Once an article is already SCHEDULED its stored time is deliberately
        # ignored: a bare publish from that state is either the scheduler firing
        # or an editor deciding to go early, and both mean "now". Only an
        # explicit time in the request re-schedules it.
        when = (
            scheduled_at
            if old == WorkflowState.SCHEDULED
            else (scheduled_at or article.scheduled_at)
        )
        if when is not None and when > utcnow():
            article.scheduled_at = when
            article.status = ArticleStatus.SCHEDULED
            article.workflow_state = WorkflowState.SCHEDULED
            db.add(
                WorkflowTransition(
                    article_id=article.id,
                    from_state=old,
                    to_state=WorkflowState.SCHEDULED,
                    actor_id=principal.id,
                    note=note,
                    created_at=utcnow(),
                )
            )
            return article

        article.scheduled_at = None
        article.status = ArticleStatus.PUBLISHED
        article.published_by = principal.id
        article.published_at = utcnow()
        article.first_published_at = article.first_published_at or article.published_at
        # Tags the crawl created for this story waited inactive for a person
        # to let the story out; one just has.
        for link in article.tags:
            if not link.tag.is_active:
                link.tag.is_active = True
        # §9 duration control: an explicit end time wins, otherwise the
        # configured default (24h out of the box) applies from now.
        if article.is_breaking and article.breaking_until is None:
            from app.services import settings_service

            minutes = settings_service.get_int(db, "breaking.default_duration_minutes")
            article.breaking_until = article.published_at + timedelta(minutes=minutes)
        # §8 / §9 — the placement chosen on the article form becomes real now
        # that there is something to place.
        apply_placement_pins(db, article, principal.id)
        # §13 publish triggers (breaking / local / topic). A notification bug
        # must never keep a story off the site, hence the broad guard.
        try:
            from app.services.notification_service import fan_out_for_article

            fan_out_for_article(db, article)
        except Exception:  # noqa: BLE001
            from app.core.logging import get_logger

            get_logger(__name__).exception(
                "notification_fanout_failed", article_id=article.id
            )
        # §20 optional pre-generation. Same reasoning as the fan-out: a TTS
        # provider outage must never block publication.
        try:
            from app.services import settings_service, tts_service

            if settings_service.get_bool(db, "voice.auto_generate_on_publish"):
                tts_service.ensure_audio(db, article, requested_by=principal.id)
        except Exception:  # noqa: BLE001
            from app.core.logging import get_logger

            get_logger(__name__).exception(
                "tts_pregenerate_failed", article_id=article.id
            )
    elif action == "unpublish":
        article.status = ArticleStatus.UNPUBLISHED
    elif target in {WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW}:
        article.status = ArticleStatus.PENDING
    elif target == WorkflowState.REJECTED:
        article.status = ArticleStatus.REJECTED
    article.workflow_state = target
    if target in {WorkflowState.PUBLISHED, WorkflowState.REJECTED}:
        _release_source_text(db, article)
    db.add(
        WorkflowTransition(
            article_id=article.id,
            from_state=old,
            to_state=target,
            actor_id=principal.id,
            note=note,
            created_at=utcnow(),
        )
    )
    return article


def _release_source_text(db: Session, article: Article) -> None:
    """Forget the publisher's text now this article's review has resolved.

    `IngestedRewrite.source_text` is the copy the reviewer reads beside our
    rewrite. It used to be dropped at import, which meant the comparison was
    gone before the person who has to approve the article ever saw it — the
    review it exists for happens *here*, not in the ingest queue. Published or
    rejected, the decision has landed and the reason to hold it is over.

    Never fatal: a story must not fail to publish because a cleanup failed.
    """
    from app.models.ingestion import IngestedItem
    from app.services.ingestion_service import drop_source_text

    try:
        item = db.scalar(
            select(IngestedItem).where(IngestedItem.article_id == article.id)
        )
        if item is not None:
            drop_source_text(item)
    except Exception:  # noqa: BLE001 — same reasoning as the fan-out above
        from app.core.logging import get_logger

        get_logger(__name__).exception(
            "source_text_release_failed", article_id=article.id
        )
