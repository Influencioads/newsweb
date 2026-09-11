from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_any_permission
from app.db.session import get_db
from app.models.ai import AiArticleDraft, AiSuggestion
from app.models.content import Article, Category, Tag
from app.models.creator import CreatorSubmission
from app.models.engagement import ArticleEvent
from app.models.enums import (
    AiDraftStatus,
    AiSuggestionStatus,
    ArticleStatus,
    EventType,
    SubmissionStatus,
    WorkflowState,
)
from app.models.geo import District, Locality, Mandal, State
from app.models.user import User
from app.schemas.cms import (
    CmsCategoryOption,
    CmsDistrictOption,
    CmsEditorOptions,
    CmsOption,
    CmsTagRef,
    DashboardStats,
)

router = APIRouter(prefix="/cms/dashboard", tags=["dashboard"])

_EDITOR = require_any_permission("article.create", "article.edit", "article.edit_own")


@router.get("", response_model=DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    principal: Principal = Depends(
        require_any_permission("dashboard.view", "article.review")
    ),
) -> DashboardStats:
    """§24 — the fourteen cards. Everything is scoped: a district editor's
    dashboard counts their district, not the whole masthead."""
    base = [Article.deleted_at.is_(None)]
    if not principal.is_global:
        base.append(Article.district_id.in_(principal.district_ids))

    def count(*conditions: object) -> int:
        return int(
            db.scalar(select(func.count(Article.id)).where(*base, *conditions)) or 0
        )

    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = now - timedelta(days=7)

    published_today = [
        Article.status == ArticleStatus.PUBLISHED,
        Article.published_at >= today,
    ]

    def top(column, limit: int = 5) -> list[dict]:
        """Most-published buckets over the last 7 days — what the desk is
        actually producing, not an all-time total nobody acts on."""
        rows = db.execute(
            select(column, func.count(Article.id).label("n"))
            .where(
                *base,
                Article.status == ArticleStatus.PUBLISHED,
                Article.published_at >= week,
                column.is_not(None),
            )
            .group_by(column)
            .order_by(func.count(Article.id).desc())
            .limit(limit)
        ).all()
        return [{"id": value, "count": int(n)} for value, n in rows]

    def label(model, rows: list[dict]) -> list[dict]:
        if not rows:
            return []
        names = {
            r.id: r
            for r in db.scalars(
                select(model).where(model.id.in_([r["id"] for r in rows]))
            ).all()
        }
        return [
            {**r, "name_te": names[r["id"]].name_te, "name_en": names[r["id"]].name_en}
            for r in rows
            if r["id"] in names
        ]

    views_today = int(
        db.scalar(
            select(func.count(ArticleEvent.id)).where(
                ArticleEvent.event_type == EventType.VIEW,
                ArticleEvent.created_at >= today,
            )
        )
        or 0
    )
    active_users = int(
        db.scalar(
            select(func.count(func.distinct(ArticleEvent.user_id))).where(
                ArticleEvent.created_at >= week, ArticleEvent.user_id.is_not(None)
            )
        )
        or 0
    )

    return DashboardStats(
        total_articles=count(),
        drafts=count(Article.workflow_state == WorkflowState.DRAFT),
        pending_review=count(
            Article.workflow_state.in_(
                [WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW]
            )
        ),
        approved=count(Article.workflow_state == WorkflowState.APPROVED),
        published_today=count(*published_today),
        breaking_live=count(
            Article.status == ArticleStatus.PUBLISHED, Article.is_breaking.is_(True)
        ),
        returned_for_changes=count(
            Article.workflow_state == WorkflowState.CHANGES_REQUESTED
        ),
        scheduled=count(Article.workflow_state == WorkflowState.SCHEDULED),
        total_users=int(
            db.scalar(select(func.count(User.id)).where(User.deleted_at.is_(None))) or 0
        ),
        active_users_7d=active_users,
        views_today=views_today,
        submissions_pending=int(
            db.scalar(
                select(func.count(CreatorSubmission.id)).where(
                    CreatorSubmission.status == SubmissionStatus.PENDING
                )
            )
            or 0
        ),
        ai_suggestions_new=int(
            db.scalar(
                select(func.count(AiSuggestion.id)).where(
                    AiSuggestion.status == AiSuggestionStatus.NEW
                )
            )
            or 0
        ),
        ai_drafts_pending=int(
            db.scalar(
                select(func.count(AiArticleDraft.id)).where(
                    AiArticleDraft.status == AiDraftStatus.DRAFT
                )
            )
            or 0
        ),
        top_categories=label(Category, top(Article.category_id)),
        top_districts=label(District, top(Article.district_id)),
        top_mandals=label(Mandal, top(Article.mandal_id)),
    )


@router.get("/editor-options", response_model=CmsEditorOptions)
def editor_options(
    db: Session = Depends(get_db), _principal: Principal = Depends(_EDITOR)
) -> CmsEditorOptions:
    """Everything the §1 form needs in one call. Subcategories come through in
    the same list carrying `parent_id`, so the picker can filter client-side
    instead of round-tripping when a category is chosen."""
    categories = db.scalars(
        select(Category)
        .where(Category.is_active.is_(True))
        .order_by(Category.sort, Category.name_en)
    ).all()
    districts = db.scalars(
        select(District)
        .where(District.is_active.is_(True))
        .order_by(District.state, District.sort, District.name_en)
    ).all()
    states = db.scalars(
        select(State).where(State.is_active.is_(True)).order_by(State.sort)
    ).all()
    authors = db.scalars(
        select(User)
        .where(User.deleted_at.is_(None), User.is_author.is_(True))
        .order_by(User.name_en)
        .limit(200)
    ).all()
    tags = db.scalars(
        select(Tag)
        .where(Tag.is_active.is_(True))
        .order_by(Tag.usage_count.desc(), Tag.name_en)
        .limit(200)
    ).all()
    return CmsEditorOptions(
        categories=[
            CmsCategoryOption(
                id=x.id,
                slug=x.slug,
                name_te=x.name_te,
                name_en=x.name_en,
                parent_id=x.parent_id,
            )
            for x in categories
        ],
        districts=[
            CmsDistrictOption(
                id=x.id,
                slug=x.slug,
                name_te=x.name_te,
                name_en=x.name_en,
                state=x.state,
            )
            for x in districts
        ],
        states=[
            CmsOption(id=x.id, slug=x.slug, name_te=x.name_te, name_en=x.name_en)
            for x in states
        ],
        authors=[
            {"id": x.id, "name_te": x.name_te, "name_en": x.name_en} for x in authors
        ],
        tags=[
            CmsTagRef(id=x.id, slug=x.slug, name_te=x.name_te, name_en=x.name_en)
            for x in tags
        ],
    )


@router.get("/mandals")
def editor_mandals(
    district_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    _principal: Principal = Depends(_EDITOR),
):
    """§2 cascade, step 3. Separate from the taxonomy-admin endpoint because a
    reporter filing a story holds `article.create`, not `taxonomy.view`."""
    rows = db.scalars(
        select(Mandal)
        .where(Mandal.district_id == district_id, Mandal.is_active.is_(True))
        .order_by(Mandal.name_en)
    ).all()
    return {
        "items": [
            {"id": m.id, "slug": m.slug, "name_te": m.name_te, "name_en": m.name_en}
            for m in rows
        ]
    }


@router.get("/localities")
def editor_localities(
    mandal_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    _principal: Principal = Depends(_EDITOR),
):
    """§2 cascade, step 4 — city / town / village."""
    rows = db.scalars(
        select(Locality)
        .where(Locality.mandal_id == mandal_id, Locality.is_active.is_(True))
        .order_by(Locality.name_en)
    ).all()
    return {
        "items": [
            {
                "id": x.id,
                "slug": x.slug,
                "name_te": x.name_te,
                "name_en": x.name_en,
                "kind": x.kind,
            }
            for x in rows
        ]
    }
