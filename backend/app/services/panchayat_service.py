"""The one exception to "nothing reaches a reader without a human editor".

An admin-approved gram-panchayat secretary publishes to their own panchayat
without per-article review. The product owner asked for this explicitly, and
the shape below is what keeps it from becoming a bypass:

* **It is not a permission.** `FORBIDDEN_PERMISSION_SUBSTRINGS` still bans any
  key containing `auto_publish`, the three tests that assert it are untouched,
  and no role grants anything of the sort. The exception is a dated grant on
  one contributor profile — `panchayat_publish_granted_at` — and it is read
  from the database on every single request.
* **It is one function.** `may_self_publish` is the whole of it, and four of
  its six clauses are restrictions: their own copy, their own panchayat, a
  live (unexpired) KYC, and nothing the sensitive-topics screen trips on. A
  fifth, `PROBATION`, keeps a freshly granted account in review for its first
  three stories.
* **Revocation is instant, and there is nothing to bust.** Because the grant is
  read from the database on every publish, an admin revoking it at 14:03 means
  the 14:03 publish is refused. Do not "optimise" this into the JWT or a cache:
  that would put a window between taking the trust away and it stopping, which
  is the one property this design is buying.

`transition()` in `workflow_service` is the only caller of `may_self_publish`,
and a publish it allows deliberately leaves `approved_by` NULL. Faking a
self-approval would make the audit log claim an editor approved when none did;
`status = PUBLISHED AND approved_by IS NULL` is instead the queryable forensic
signature of exactly this exception.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.core.errors import ConflictError
from app.db.base import utcnow
from app.integrations.ai.sensitive import is_sensitive
from app.models.content import Article, Category, WorkflowTransition
from app.models.enums import (
    ArticleStatus,
    ArticleType,
    RoleKey,
    Vertical,
    WorkflowState,
)
from app.models.geo import Locality
from app.models.kyc import ContributorProfile
from app.services import kyc_service

#: Published stories a secretary needs behind them before the exception starts
#: applying. Their first three go through the desk like anybody else's, which
#: is where a reviewer finds out whether this person files news or notices.
PROBATION = 3

#: Every self-published story lands here, whatever the author picked. The seed
#: creates the row; `stamp_ugc` refuses to publish without it rather than
#: quietly filing panchayat copy into Cinema.
PANCHAYAT_CATEGORY_SLUG = "panchayat"

#: What a reader sees on the byline of this copy. `Article.byline_badge` is
#: String(30).
PANCHAYAT_BADGE = "panchayat"


def _published_count(db: Session, author_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Article.id)).where(
                Article.author_id == author_id,
                Article.status == ArticleStatus.PUBLISHED,
            )
        )
        or 0
    )


def _is_sensitive_anywhere(article: Article) -> bool:
    """Screen the headline, standfirst, summary and body — in that order.

    `body_plain` alone was not enough. A reader meets the headline first, and a
    push notification or a WhatsApp preview may show nothing else; an empty
    body passed the old check trivially, and nothing requires a body.
    """
    return any(
        is_sensitive(field or "")
        for field in (
            article.title_te,
            article.sub_title_te,
            article.summary_te,
            article.body_plain,
        )
    )


def may_self_publish(db: Session, principal: Principal, article: Article) -> bool:
    """May this person publish this article with no editor in front of them?

    Read this as six conditions of which four are restrictions. Widening it is
    not a refactor — every clause removed here is a class of story that reaches
    readers unreviewed.
    """
    # Staff are out, whatever their profile says. A desk editor with a
    # panchayat profile would otherwise use this to publish their own copy and
    # walk straight past the two-person rule — and their story would be
    # rewritten into the panchayat category on the way out. The exception is
    # documented as one role; enforce that it *is* one role.
    if not principal.has_role(RoleKey.PANCHAYAT_SECRETARY):
        return False
    profile = kyc_service.profile_for(db, principal.id)
    return bool(
        profile
        and profile.vertical == Vertical.PANCHAYAT
        and profile.panchayat_publish_granted_at is not None
        # Honours expires_at, so a lapsed KYC revokes this for free — no sweep
        # job, no second expiry to keep in step.
        and kyc_service.is_approved(db, principal.id)
        # Their own copy only.
        and article.author_id == principal.id
        # Their own panchayat only. `is not None` matters: without it, a grant
        # with no locality set would match every article that has no locality.
        and profile.locality_id is not None
        and article.locality_id == profile.locality_id
        # A communal clash or a rape case is not panchayat-notice copy, and it
        # is precisely the story that must not go out unread. Screen every
        # field a reader meets first: the headline is what a card, a push and a
        # link preview show, and screening only the body let an innocuous
        # notice carry any headline at all.
        and not _is_sensitive_anywhere(article)
        # Their own words. A secretary also holds `article.create`, which
        # reaches the crawl-import route, and an imported item takes the
        # importer as its author — so without this, another outlet's reporting
        # could be relocated into their panchayat and published unreviewed,
        # with `stamp_ugc` overwriting the publisher's credit on the way out.
        # `source_type` and `article_type` are what the import stamps; a story
        # somebody actually wrote here carries neither.
        and article.source_type == "own"
        and article.article_type
        not in (ArticleType.SYNDICATED, ArticleType.AI_REWRITE, ArticleType.AI_DRAFT)
        and not article.ai_generated
        and _published_count(db, principal.id) >= PROBATION
    )


def stamp_ugc(db: Session, article: Article, principal: Principal) -> None:
    """Set every reader-facing marker that says where this copy came from.

    One place, so a marker cannot be set on one path and forgotten on another.
    Forcing the category is part of it: it makes the public section correct by
    construction, and a secretary filing into "Cinema" a mistake rather than an
    intent.
    """
    profile = kyc_service.profile_for(db, principal.id)
    category = db.scalar(
        select(Category).where(Category.slug == PANCHAYAT_CATEGORY_SLUG)
    )
    if category is None:
        raise ConflictError(
            message_en="The panchayat category is missing; run the seed.",
            message_te="పంచాయతీ విభాగం లేదు.",
        )
    locality = (
        db.get(Locality, profile.locality_id)
        if profile and profile.locality_id
        else None
    )

    article.category_id = category.id
    article.article_source_type = "USER"
    article.article_type = ArticleType.USER_SUBMITTED
    article.source_type = "contributed"
    article.source_credit = locality.name_te if locality else None
    article.byline_te = profile.display_name_te if profile else None
    article.byline_badge = PANCHAYAT_BADGE


def set_publish_grant(
    db: Session,
    profile: ContributorProfile,
    *,
    granted: bool,
    actor_id: int,
    unpublish_live: bool = True,
) -> list[Article]:
    """Give or take away the exception. Returns the articles taken down.

    Revoking is the takedown path, so by default it pulls this author's live
    copy back out of the site in the same transaction. Waiting for a separate
    sweep would leave the stories an admin just stopped trusting on the home
    page.
    """
    if granted:
        profile.panchayat_publish_granted_at = utcnow()
        profile.panchayat_publish_granted_by = actor_id
        db.flush()
        return []

    profile.panchayat_publish_granted_at = None
    profile.panchayat_publish_granted_by = None
    if not unpublish_live:
        db.flush()
        return []

    # Only the copy that reached readers *through this exception*. An editor
    # read, approved and published the rest; withdrawing a trust flag is not a
    # reason to pull their journalism off the site. `approved_by IS NULL` on a
    # PUBLISHED row is exactly the signature the trusted path leaves.
    live = list(
        db.scalars(
            select(Article).where(
                Article.author_id == profile.user_id,
                Article.status == ArticleStatus.PUBLISHED,
                Article.approved_by.is_(None),
            )
        ).all()
    )
    for article in live:
        old = article.workflow_state
        article.status = ArticleStatus.UNPUBLISHED
        article.workflow_state = WorkflowState.UNPUBLISHED
        db.add(
            WorkflowTransition(
                article_id=article.id,
                from_state=old,
                to_state=WorkflowState.UNPUBLISHED,
                actor_id=actor_id,
                note="panchayat publish grant revoked",
                created_at=utcnow(),
            )
        )
    db.flush()
    return live
