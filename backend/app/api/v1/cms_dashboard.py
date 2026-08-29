from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_any_permission
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import ArticleStatus, WorkflowState
from app.models.content import Category
from app.models.geo import District
from app.schemas.cms import CmsEditorOptions, CmsOption, DashboardStats

router = APIRouter(prefix="/cms/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_any_permission("dashboard.view", "article.review")),
) -> DashboardStats:
    base = [Article.deleted_at.is_(None)]
    if not principal.is_global:
        base.append(Article.district_id.in_(principal.district_ids))

    def count(*conditions: object) -> int:
        return int(db.scalar(select(func.count(Article.id)).where(*base, *conditions)) or 0)

    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return DashboardStats(
        total_articles=count(),
        drafts=count(Article.workflow_state == WorkflowState.DRAFT),
        pending_review=count(Article.workflow_state.in_([WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW])),
        approved=count(Article.workflow_state == WorkflowState.APPROVED),
        published_today=count(Article.status == ArticleStatus.PUBLISHED, Article.published_at >= today),
        breaking_live=count(Article.status == ArticleStatus.PUBLISHED, Article.is_breaking.is_(True)),
        returned_for_changes=count(Article.workflow_state == WorkflowState.CHANGES_REQUESTED),
    )


@router.get("/editor-options", response_model=CmsEditorOptions)
def editor_options(
    db: Session = Depends(get_db),
    _principal: Principal = Depends(require_any_permission("article.create", "article.edit", "article.edit_own")),
) -> CmsEditorOptions:
    categories = db.scalars(select(Category).where(Category.is_active.is_(True)).order_by(Category.sort, Category.name_en)).all()
    districts = db.scalars(select(District).where(District.is_active.is_(True)).order_by(District.state, District.sort, District.name_en)).all()
    return CmsEditorOptions(
        categories=[CmsOption(id=x.id, slug=x.slug, name_te=x.name_te, name_en=x.name_en) for x in categories],
        districts=[CmsOption(id=x.id, slug=x.slug, name_te=x.name_te, name_en=x.name_en) for x in districts],
    )
