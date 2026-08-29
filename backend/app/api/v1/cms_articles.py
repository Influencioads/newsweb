from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, require_any_permission, require_permission
from app.core.errors import NotFoundError
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import AuditAction
from app.schemas.cms import ArticlePatch, ArticleWrite, CmsArticleList, CmsArticleOut, TransitionIn
from app.services import audit_service, workflow_service

router = APIRouter(prefix="/cms/articles", tags=["articles"])


def _get(db: Session, article_id: int) -> Article:
    article = db.get(Article, article_id)
    if not article or article.deleted_at:
        raise NotFoundError()
    return article


@router.get("", response_model=CmsArticleList)
def list_articles(state: str | None = None, search: str | None = Query(None, max_length=200),
                  offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                  db: Session = Depends(get_db),
                  principal: Principal = Depends(require_any_permission("article.view", "article.view_own"))):
    stmt = select(Article).where(Article.deleted_at.is_(None))
    if not principal.is_global:
        stmt = stmt.where(Article.district_id.in_(principal.district_ids))
    if state:
        stmt = stmt.where(Article.workflow_state == state)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(Article.title_te.ilike(term), Article.title_en.ilike(term),
                              Article.short_id.ilike(term)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.execute(stmt.order_by(Article.updated_at.desc()).offset(offset).limit(limit)).scalars())
    return CmsArticleList(articles=rows, total=total)


@router.post("", response_model=CmsArticleOut, status_code=201)
def create_article(payload: ArticleWrite, request: Request, db: Session = Depends(get_db),
                   principal: Principal = Depends(require_permission("article.create", scoped=True))):
    article = workflow_service.create(db, principal, payload.model_dump())
    audit_service.record(db, action=AuditAction.CREATE, entity_type="article", entity_id=article.id,
                         actor=principal.user, after={"title_te": article.title_te}, request=request)
    return article


@router.get("/{article_id}", response_model=CmsArticleOut)
def get_article(article_id: int, db: Session = Depends(get_db),
                principal: Principal = Depends(require_any_permission("article.view", "article.view_own"))):
    article = _get(db, article_id); workflow_service._scope(principal, article); return article


@router.patch("/{article_id}", response_model=CmsArticleOut)
def update_article(article_id: int, payload: ArticlePatch, request: Request,
                   db: Session = Depends(get_db),
                   principal: Principal = Depends(require_any_permission("article.edit", "article.edit_own"))):
    article = workflow_service.update(db, principal, _get(db, article_id), payload.model_dump(exclude_unset=True))
    audit_service.record(db, action=AuditAction.UPDATE, entity_type="article", entity_id=article.id,
                         actor=principal.user, request=request)
    return article


_PERMISSION = {"submit":"article.submit", "review":"article.review", "approve":"article.approve",
               "request-changes":"article.reject", "reject":"article.reject",
               "publish":"article.publish", "unpublish":"article.unpublish"}
_AUDIT = {"submit":AuditAction.SUBMIT, "review":AuditAction.REVIEW_START, "approve":AuditAction.APPROVE,
          "request-changes":AuditAction.REQUEST_CHANGES, "reject":AuditAction.REJECT,
          "publish":AuditAction.PUBLISH, "unpublish":AuditAction.UNPUBLISH}


@router.post("/{article_id}/{action}", response_model=CmsArticleOut)
def change_state(article_id: int, action: str, payload: TransitionIn, request: Request,
                 db: Session = Depends(get_db), principal: Principal = Depends(require_any_permission(
                     "article.submit", "article.review", "article.approve", "article.reject", "article.publish", "article.unpublish"))):
    if action not in _PERMISSION:
        raise NotFoundError()
    principal.require(_PERMISSION[action])
    article = workflow_service.transition(db, principal, _get(db, article_id), action, payload.note)
    audit_service.record(db, action=_AUDIT[action], entity_type="article", entity_id=article.id,
                         actor=principal.user, note=payload.note, request=request)
    return article
