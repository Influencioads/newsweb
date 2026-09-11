from __future__ import annotations

import hashlib

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.base import utcnow
from app.models.poll import Poll, PollVote


def active_polls(
    db: Session, article_id: int | None = None, big_question: bool | None = None
) -> list[Poll]:
    now = utcnow()
    stmt = (
        select(Poll)
        .options(selectinload(Poll.options))
        .where(Poll.status == "ACTIVE", Poll.start_time <= now, Poll.end_time > now)
    )
    if article_id is not None:
        stmt = stmt.where(Poll.article_id == article_id)
    if big_question is not None:
        stmt = stmt.where(Poll.is_big_question == big_question)
    return list(
        db.scalars(stmt.order_by(Poll.is_big_question.desc(), Poll.created_at.desc()))
    )


def get_poll(db: Session, poll_id: int) -> Poll:
    row = db.scalar(
        select(Poll).options(selectinload(Poll.options)).where(Poll.id == poll_id)
    )
    if row is None:
        raise NotFoundError(message_en="Poll not found.", message_te="పోల్ కనబడలేదు.")
    return row


def voter_key(user_id: int | None, anonymous_id: str | None, fingerprint: str) -> str:
    if user_id is not None:
        return f"user:{user_id}"
    if not anonymous_id:
        raise ValidationError(details={"anonymous_id": "Required for anonymous voting"})
    raw = f"{settings.JWT_SECRET}:{anonymous_id}:{fingerprint}".encode()
    return "anon:" + hashlib.sha256(raw).hexdigest()[:64]


def vote(
    db: Session, poll: Poll, option_id: int, key: str, user_id: int | None
) -> PollVote:
    now = utcnow()
    if poll.status != "ACTIVE" or poll.start_time > now or poll.end_time <= now:
        raise ConflictError(
            message_en="This poll is not accepting votes.",
            message_te="ఈ పోల్ ప్రస్తుతం ఓట్లను స్వీకరించడం లేదు.",
        )
    option = next((o for o in poll.options if o.id == option_id), None)
    if option is None:
        raise ValidationError(
            details={"option_id": "Option does not belong to this poll"}
        )
    if db.scalar(
        select(PollVote).where(PollVote.poll_id == poll.id, PollVote.voter_key == key)
    ):
        raise ConflictError(
            message_en="You have already voted in this poll.",
            message_te="మీరు ఇప్పటికే ఈ పోల్‌లో ఓటు వేశారు.",
        )
    row = PollVote(poll_id=poll.id, option_id=option.id, user_id=user_id, voter_key=key)
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError as exc:
        raise ConflictError(
            message_en="You have already voted in this poll.",
            message_te="మీరు ఇప్పటికే ఈ పోల్‌లో ఓటు వేశారు.",
        ) from exc
    option.vote_count += 1
    db.flush()
    return row


def serialize(poll: Poll, selected_option_id: int | None = None) -> dict:
    selected = selected_option_id
    total = sum(o.vote_count for o in poll.options)
    return {
        "id": poll.id,
        "question_te": poll.question_te,
        "question_en": poll.question_en,
        "status": poll.status,
        "is_big_question": poll.is_big_question,
        "start_time": poll.start_time,
        "end_time": poll.end_time,
        "category_id": poll.category_id,
        "district_id": poll.district_id,
        "article_id": poll.article_id,
        "total_votes": total,
        "has_voted": selected is not None,
        "selected_option_id": selected,
        "options": [
            {
                "id": o.id,
                "option_text_te": o.option_text_te,
                "option_text_en": o.option_text_en,
                "votes": o.vote_count,
                "percentage": round(o.vote_count * 100 / total, 1) if total else 0.0,
            }
            for o in poll.options
        ],
    }
