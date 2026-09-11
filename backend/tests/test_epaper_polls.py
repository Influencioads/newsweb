"""Core invariants for generated editions and interactive polls."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base, utcnow
from app.db.seed_content import seed_categories
from app.models.content import Article
from app.models.enums import ArticleStatus, WorkflowState
from app.models.poll import Poll, PollOption
from app.services import epaper_service, poll_service


@pytest.fixture()
def db() -> Session:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    seed_categories(session)
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def article(db: Session, *, status: ArticleStatus, suffix: str) -> Article:
    row = Article(
        short_id=f"ep{suffix:0>4}"[-6:],
        slug=f"epaper-{suffix}",
        title_te=f"వార్త {suffix}",
        status=status,
        workflow_state=WorkflowState.PUBLISHED
        if status == ArticleStatus.PUBLISHED
        else WorkflowState.DRAFT,
        published_at=utcnow() if status == ArticleStatus.PUBLISHED else None,
    )
    db.add(row)
    db.flush()
    return row


def test_generation_uses_only_published_articles_and_requires_approval(
    db: Session,
) -> None:
    published = article(db, status=ArticleStatus.PUBLISHED, suffix="1")
    draft = article(db, status=ArticleStatus.DRAFT, suffix="2")
    edition = epaper_service.generate_daily(db, datetime.now(epaper_service.IST).date())
    selected = {link.article_id for page in edition.pages for link in page.articles}
    assert published.id in selected
    assert draft.id not in selected
    with pytest.raises(Exception):
        epaper_service.publish(db, edition, 1)
    epaper_service.approve(db, edition, 1)
    epaper_service.publish(db, edition, 1)
    assert edition.status == "PUBLISHED"
    with pytest.raises(Exception):
        epaper_service.generate_daily(db, edition.edition_date, regenerate=True)


def test_poll_allows_one_vote_per_voter(db: Session) -> None:
    poll = Poll(
        question_te="మీ ఎంపిక?",
        status="ACTIVE",
        start_time=utcnow() - timedelta(minutes=1),
        end_time=utcnow() + timedelta(days=1),
    )
    poll.options = [
        PollOption(option_text_te="అవును", display_order=1),
        PollOption(option_text_te="కాదు", display_order=2),
    ]
    db.add(poll)
    db.flush()
    key = poll_service.voter_key(None, "stable-device", "fingerprint")
    poll_service.vote(db, poll, poll.options[0].id, key, None)
    assert poll_service.serialize(poll, poll.options[0].id)["total_votes"] == 1
    with pytest.raises(Exception):
        poll_service.vote(db, poll, poll.options[1].id, key, None)
