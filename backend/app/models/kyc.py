"""Contributor identity checks — citizens, freelance and student journalists.

The product goal is people who are not on staff filing real stories. The risk
is that a platform which accepts stories from anybody, under a byline, is a
platform that can be used to launder a claim. So a contributor proves who they
are once, and their byline then carries that.

**Where the documents live, precisely.** Not in the public media bucket, not as
a `Media` row, and never at a URL. `KycDocument` has **no `url` column** — that
absence is the design, and a test asserts it. Files go to a separate private
bucket under a high-entropy key and are readable through exactly one
authenticated, audited, streaming route.

**What approval buys.** A higher submission quota, the ability to attach
photographs, and a verified badge on the byline. Not publication: an approved
contributor's story still lands in the moderation queue, still becomes an
article in SUBMITTED, and still needs an editor. The `contributor` role holds
no `article.create` and no `article.publish`.

**Retention.** A rejected application's files are purged after 90 days and an
approved one's after two years, at which point the contributor re-verifies.
Keeping somebody's passport scan indefinitely because nobody wrote the deletion
job is the failure this avoids.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
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
from app.db.types import UTCDateTime
from app.models.enums import ContributorType, KycDocumentKind, KycStatus


class ContributorProfile(PKMixin, TimestampMixin, Base):
    __tablename__ = "contributor_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_contributor_profiles_user_id"),
        Index("ix_contributor_profiles_status_created", "kyc_status", "created_at"),
        MYSQL_TABLE_ARGS,
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    contributor_type: Mapped[ContributorType] = mapped_column(
        Enum(ContributorType, native_enum=False, length=12, validate_strings=True),
        nullable=False,
        default=ContributorType.CITIZEN,
        server_default=ContributorType.CITIZEN.name,
    )
    kyc_status: Mapped[KycStatus] = mapped_column(
        Enum(KycStatus, native_enum=False, length=12, validate_strings=True),
        nullable=False,
        default=KycStatus.NOT_STARTED,
        server_default=KycStatus.NOT_STARTED.name,
    )

    #: Which adapter decided. "manual" is a person in the admin queue; a vendor
    #: name means an eKYC provider answered. The service never branches on this
    #: — it exists so an audit can say who checked.
    provider: Mapped[str] = mapped_column(
        String(30), nullable=False, default="manual", server_default="manual"
    )
    provider_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)

    #: The byline they want. Separate from `User.name_te`, because a pen name
    #: and a legal name are not the same thing and only one of them is public.
    display_name_te: Mapped[str] = mapped_column(String(120), nullable=False)
    bio_te: Mapped[str | None] = mapped_column(Text, nullable=True)

    district_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("districts.id", ondelete="SET NULL"), nullable=True
    )
    mandal_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("mandals.id", ondelete="SET NULL"), nullable=True
    )

    #: Outlet for a freelance applicant, college for a student one.
    organisation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    portfolio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    course_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Shown to the applicant. "Your college ID was unreadable" is a useful
    #: answer; silence is not.
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    #: Never shown to the applicant.
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: When this verification lapses and the contributor must check in again.
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    verified_badge: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    documents: Mapped[list["KycDocument"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )
    user = relationship("User", foreign_keys=[user_id], lazy="joined")

    @property
    def is_approved(self) -> bool:
        return self.kyc_status == KycStatus.APPROVED

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ContributorProfile user={self.user_id} {self.kyc_status}>"


class KycDocument(PKMixin, TimestampMixin, Base):
    """One uploaded identity document.

    Note what is not here: a `url`. There is no public address for somebody's
    passport scan, and adding one "for convenience" is how these leak. Reading
    a document goes through `GET /cms/kyc/{id}/documents/{doc}/raw`, which
    requires `kyc.view_document` and writes an audit row every time.
    """

    __tablename__ = "kyc_documents"
    __table_args__ = (
        Index("ix_kyc_documents_profile_kind", "profile_id", "kind"),
        MYSQL_TABLE_ARGS,
    )

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("contributor_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[KycDocumentKind] = mapped_column(
        Enum(KycDocumentKind, native_enum=False, length=24, validate_strings=True),
        nullable=False,
    )

    #: Key in the **private** bucket. High-entropy by construction, because a
    #: guessable key is the other way these leak.
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    mime: Mapped[str] = mapped_column(String(60), nullable=False)
    bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    #: Tamper evidence, and the source of the storage key.
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    #: What a reviewer sees without opening anything: "XXXXXX1234".
    number_masked: Mapped[str | None] = mapped_column(String(40), nullable=True)
    #: Fernet, via core.security. Only ever decrypted for a vendor submission.
    number_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    profile: Mapped["ContributorProfile"] = relationship(back_populates="documents")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<KycDocument {self.kind} profile={self.profile_id}>"
