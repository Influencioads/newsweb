"""Creator submissions (updated doc §17).

Flow: reader submits plain text → moderation queue → approve converts it into
a real Article in SUBMITTED state (source_type=contributed, byline = creator)
so it enters the normal editor review queue — approval here is *moderation*,
never publication. Reject returns a note to the creator. Every decision is
audited by the caller.
"""

from __future__ import annotations

from typing import Any

from nanoid import generate
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.db.base import utcnow
from app.models.content import Article, WorkflowTransition
from app.models.creator import CreatorSubmission
from app.models.enums import ArticleStatus, SubmissionStatus, WorkflowState
from app.models.user import User
from app.services import tiptap
from app.telugu.normalize import normalize_headline, normalize_text
from app.telugu.transliterate import slugify

#: A creator may hold at most this many submissions awaiting review — a spam
#: guard that never blocks a genuine contributor (§17 moderation history).
MAX_PENDING_PER_USER = 5

TITLE_MIN = 10
BODY_MIN = 100
BODY_MAX = 20_000


def plain_text_to_tiptap(text: str) -> dict[str, Any]:
    """Paragraphs split on blank lines; single newlines become hard breaks.
    Creators write plain text — the doc structure is built for them."""
    paragraphs = [
        p.strip() for p in text.replace("\r\n", "\n").split("\n\n") if p.strip()
    ]
    content: list[dict[str, Any]] = []
    for paragraph in paragraphs:
        nodes: list[dict[str, Any]] = []
        for i, line in enumerate(
            line for line in paragraph.split("\n") if line.strip()
        ):
            if i > 0:
                nodes.append({"type": "hardBreak"})
            nodes.append({"type": "text", "text": line.strip()})
        if nodes:
            content.append({"type": "paragraph", "content": nodes})
    return {"type": "doc", "content": content or [{"type": "paragraph"}]}


def create_submission(
    db: Session,
    *,
    user_id: int,
    title_te: str,
    body_te: str,
    category_id: int | None,
    district_id: int | None,
    accept_guidelines: bool,
) -> CreatorSubmission:
    if not accept_guidelines:
        raise ValidationError(
            message_en="Please accept the content guidelines first.",
            message_te="ముందుగా కంటెంట్ మార్గదర్శకాలను అంగీకరించండి.",
        )
    title = normalize_headline(title_te or "").strip()
    body = normalize_text(body_te or "").strip()
    if len(title) < TITLE_MIN:
        raise ValidationError(details={"title_te": f"at least {TITLE_MIN} characters"})
    if not (BODY_MIN <= len(body) <= BODY_MAX):
        raise ValidationError(details={"body_te": f"{BODY_MIN}–{BODY_MAX} characters"})

    pending = db.execute(
        select(func.count(CreatorSubmission.id)).where(
            CreatorSubmission.user_id == user_id,
            CreatorSubmission.status == SubmissionStatus.PENDING,
        )
    ).scalar()
    if int(pending or 0) >= MAX_PENDING_PER_USER:
        raise ConflictError(
            message_en="You already have submissions awaiting review. Please wait for those first.",
            message_te="మీ గత సమర్పణలు సమీక్షలో ఉన్నాయి. అవి పూర్తయ్యే వరకు వేచి ఉండండి.",
        )

    submission = CreatorSubmission(
        user_id=user_id,
        title_te=title,
        body_te=body,
        category_id=category_id,
        district_id=district_id,
    )
    db.add(submission)
    db.flush()
    return submission


def _get_pending(db: Session, submission_id: int) -> CreatorSubmission:
    submission = db.get(CreatorSubmission, submission_id)
    if submission is None:
        raise NotFoundError()
    if submission.status != SubmissionStatus.PENDING:
        raise ConflictError(
            message_en="This submission was already reviewed.",
            message_te="ఈ సమర్పణ ఇప్పటికే సమీక్షించబడింది.",
        )
    return submission


def approve_submission(
    db: Session, *, submission_id: int, moderator_id: int
) -> tuple[CreatorSubmission, Article]:
    submission = _get_pending(db, submission_id)
    creator = db.get(User, submission.user_id)

    body_doc = plain_text_to_tiptap(submission.body_te)
    body, plain, html, words, seconds = tiptap.derive(body_doc)

    article = Article(
        short_id=generate(size=6),
        slug=slugify(submission.title_te)[:180] or "contributed",
        title_te=submission.title_te,
        body=body,
        body_plain=plain,
        body_html=html,
        word_count=words,
        reading_time_sec=seconds,
        category_id=submission.category_id,
        district_id=submission.district_id,
        # §17 "published with creator attribution" — the byline is the creator;
        # author_id stays NULL so no staff author page claims the piece.
        byline_te=creator.name_te if creator else "పాఠక రచయిత",
        source_type="contributed",
        source_credit=creator.name_te if creator else None,
        status=ArticleStatus.PENDING,
        workflow_state=WorkflowState.SUBMITTED,
        created_by=moderator_id,
        article_source_type="USER",
        updated_by=moderator_id,
    )
    db.add(article)
    db.flush()
    db.add(
        WorkflowTransition(
            article_id=article.id,
            from_state=None,
            to_state=WorkflowState.SUBMITTED,
            actor_id=moderator_id,
            note=f"creator submission #{submission.id} approved into review",
            created_at=utcnow(),
        )
    )

    submission.status = SubmissionStatus.APPROVED
    submission.reviewed_by = moderator_id
    submission.reviewed_at = utcnow()
    submission.article_id = article.id
    return submission, article


def reject_submission(
    db: Session, *, submission_id: int, moderator_id: int, note: str | None
) -> CreatorSubmission:
    submission = _get_pending(db, submission_id)
    submission.status = SubmissionStatus.REJECTED
    submission.reviewed_by = moderator_id
    submission.reviewed_at = utcnow()
    submission.review_note = (note or "").strip()[:500] or None
    return submission
