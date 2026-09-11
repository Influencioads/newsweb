"""Government job notifications as structured data, not just prose.

A job notification is read for six facts — who is recruiting, how many posts,
what qualification, what the fee is, when applications close, and where to
apply — and a reader who has to find the closing date inside four paragraphs of
Telugu is being failed by the format. So the story stays a normal `Article`,
travelling the normal editorial workflow, and these fields hang off it.

Two deliberate constraints:

  * **Everything here is editable and nothing is trusted.** The crawl extracts
    a first pass, but a wrong `last_date` on a government job costs a reader a
    career opportunity, so `is_verified` stays false until a person confirms
    it, and the reader UI says which state the row is in.
  * **`state` restricts to the two Telugu states plus central.** The brief asks
    for jobs "only in Telugu states"; a central-government notification is
    included because APPSC candidates apply for those too, but it is labelled.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import MYSQL_TABLE_ARGS, Base, PKMixin, TimestampMixin
from app.models.enums import JobState


class JobPosting(PKMixin, TimestampMixin, Base):
    __tablename__ = "job_postings"
    __table_args__ = (
        UniqueConstraint("article_id", name="uq_job_postings_article_id"),
        Index("ix_job_postings_state_last_date", "state", "last_date"),
        Index("ix_job_postings_last_date", "last_date"),
        MYSQL_TABLE_ARGS,
    )

    article_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("articles.id", ondelete="CASCADE"), nullable=False
    )

    department: Mapped[str | None] = mapped_column(String(250), nullable=True)
    department_te: Mapped[str | None] = mapped_column(String(250), nullable=True)
    posts_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qualification_te: Mapped[str | None] = mapped_column(Text, nullable=True)
    pay_scale: Mapped[str | None] = mapped_column(String(200), nullable=True)
    age_limit: Mapped[str | None] = mapped_column(String(200), nullable=True)
    fee: Mapped[str | None] = mapped_column(String(200), nullable=True)

    apply_url: Mapped[str | None] = mapped_column(String(900), nullable=True)
    notification_url: Mapped[str | None] = mapped_column(String(900), nullable=True)

    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    exam_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    state: Mapped[JobState] = mapped_column(
        Enum(JobState, native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=JobState.BOTH,
        server_default=JobState.BOTH.name,
    )

    #: False until a person has checked the dates against the notification PDF.
    #: An extracted date is a suggestion; a reader treats it as a deadline.
    is_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    verified_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    article = relationship("Article", lazy="joined")

    @property
    def is_open(self) -> bool:
        """Whether applications are still being accepted, as far as we know.

        A missing `last_date` counts as open: hiding a notification because we
        failed to extract its deadline is the worse error.
        """
        from app.db.base import utcnow

        if self.last_date is None:
            return True
        return self.last_date >= utcnow().date()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<JobPosting {self.id} article={self.article_id} {self.state}>"
