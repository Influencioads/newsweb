from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from nanoid import generate
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal
from app.core.errors import ConflictError, ValidationError
from app.db.base import utcnow
from app.models.content import Article, ArticleVersion, WorkflowTransition
from app.models.enums import ArticleStatus, WorkflowState
from app.services import tiptap
from app.telugu.normalize import normalize_headline, normalize_text
from app.telugu.transliterate import slugify


def _scope(principal: Principal, article: Article) -> None:
    principal.assert_scope(district_id=article.district_id, mandal_id=article.mandal_id)


def apply_copy(article: Article, values: dict[str, Any]) -> None:
    if "title_te" in values and values["title_te"] is not None:
        article.title_te = normalize_headline(values["title_te"])
        article.slug = slugify(article.title_te)[:180]
    for key in ("title_en", "sub_title_te", "summary_te", "byline_te", "source_credit"):
        if key in values:
            setattr(article, key, normalize_text(values[key]) if values[key] else None)
    for key in ("category_id", "district_id", "mandal_id", "source_type", "is_breaking", "is_exclusive"):
        if key in values and values[key] is not None:
            setattr(article, key, values[key])
    if "body" in values:
        body, plain, html, words, seconds = tiptap.derive(values["body"])
        article.body, article.body_plain, article.body_html = body, plain, html
        article.word_count, article.reading_time_sec = words, seconds


def create(db: Session, principal: Principal, values: dict[str, Any]) -> Article:
    article = Article(short_id=generate(size=6), slug="draft", author_id=principal.id,
                      created_by=principal.id, updated_by=principal.id)
    apply_copy(article, values)
    if values.get("is_breaking"):
        principal.require("article.breaking")
    _scope(principal, article)
    db.add(article)
    db.flush()
    db.add(WorkflowTransition(article_id=article.id, from_state=None,
                              to_state=WorkflowState.DRAFT, actor_id=principal.id, created_at=utcnow()))
    return article


def update(db: Session, principal: Principal, article: Article, values: dict[str, Any]) -> Article:
    _scope(principal, article)
    if article.workflow_state not in {WorkflowState.DRAFT, WorkflowState.CHANGES_REQUESTED}:
        raise ConflictError(message_en="Only drafts or returned articles can be edited.")
    if values.get("is_breaking"):
        principal.require("article.breaking")
    apply_copy(article, values)
    article.updated_by = principal.id
    article.version += 1
    return article


def transition(db: Session, principal: Principal, article: Article, action: str, note: str | None) -> Article:
    _scope(principal, article)
    old = article.workflow_state
    mapping = {
        "submit": ({WorkflowState.DRAFT, WorkflowState.CHANGES_REQUESTED}, WorkflowState.SUBMITTED),
        "review": ({WorkflowState.SUBMITTED}, WorkflowState.IN_REVIEW),
        "approve": ({WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW}, WorkflowState.APPROVED),
        "request-changes": ({WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW}, WorkflowState.CHANGES_REQUESTED),
        "reject": ({WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW}, WorkflowState.REJECTED),
        "publish": ({WorkflowState.APPROVED}, WorkflowState.PUBLISHED),
        "unpublish": ({WorkflowState.PUBLISHED}, WorkflowState.UNPUBLISHED),
    }
    allowed, target = mapping[action]
    if old not in allowed:
        raise ConflictError(details={"state": old, "action": action})
    if action == "approve":
        if article.author_id == principal.id:
            raise ValidationError(message_en="Authors cannot approve their own article.")
        article.approved_by, article.approved_at = principal.id, utcnow()
        def json_value(value: Any) -> Any:
            if isinstance(value, datetime):
                return value.isoformat()
            if isinstance(value, Enum):
                return value.value
            return value
        snapshot = {c.name: json_value(getattr(article, c.name)) for c in Article.__table__.columns
                    if c.name not in {"body"}}
        snapshot["body"] = article.body
        db.add(ArticleVersion(article_id=article.id, version=article.version,
                              snapshot=snapshot, changed_by=principal.id, created_at=utcnow()))
    if action == "publish":
        if not article.approved_by or article.approved_by == article.author_id:
            raise ValidationError(message_en="A different senior editor must approve before publishing.")
        if article.source_type != "own" and not article.source_credit:
            raise ValidationError(message_en="Agency and syndicated stories require source credit.")
        article.status = ArticleStatus.PUBLISHED
        article.published_by = principal.id
        article.published_at = utcnow()
        article.first_published_at = article.first_published_at or article.published_at
    elif action == "unpublish":
        article.status = ArticleStatus.UNPUBLISHED
    elif target in {WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW}:
        article.status = ArticleStatus.PENDING
    elif target == WorkflowState.REJECTED:
        article.status = ArticleStatus.REJECTED
    article.workflow_state = target
    db.add(WorkflowTransition(article_id=article.id, from_state=old, to_state=target,
                              actor_id=principal.id, note=note, created_at=utcnow()))
    return article
