"""Phase K — citizen journalism and contributor verification.

The tests that earn their place are about what must *not* happen:

  * an identity document must have no URL and must not be reachable from the
    public media mount;
  * opening one must be a separate, audited permission from triaging the queue;
  * approval must grant standing and quota, and never the ability to publish;
  * a full Aadhaar number must not be storable.
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings as env_settings  # noqa: E402
from app.core.errors import ConflictError, ValidationError  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories, seed_tags  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.kyc import get_kyc  # noqa: E402
from app.integrations.kyc.base import KycDecision  # noqa: E402
from app.integrations.storage import get_private_storage, get_storage  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.creator import CreatorSubmission  # noqa: E402
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ContributorType,
    KycDocumentKind,
    KycStatus,
    RoleKey,
    ScopeType,
    UserStatus,
    WorkflowState,
)
from app.models.kyc import ContributorProfile, KycDocument  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import (  # noqa: E402
    auth_service,
    kyc_service,
    secure_upload_service,
    settings_service,
    submission_service,
)

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    permissions = seed_permissions(session)
    seed_roles(session, permissions)
    seed_states(session)
    seed_districts(session)
    seed_categories(session)
    seed_tags(session)
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="module")
def client(db: Session) -> Iterator[TestClient]:
    def _get_db() -> Iterator[Session]:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _isolate(db: Session) -> Iterator[None]:
    _purge(db)
    yield
    _purge(db)


def _purge(db: Session) -> None:
    db.query(KycDocument).delete()
    db.query(ContributorProfile).delete()
    db.query(CreatorSubmission).delete()
    db.query(Article).delete()
    db.query(AppSetting).delete()
    db.commit()
    settings_service.invalidate()


def make_reader(
    db: Session, *, email: str, phone_verified: bool = True
) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            name_te="పాఠకుడు",
            name_en="Reader",
            phone=f"9{abs(hash(email)) % 1000000000:09d}",
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()
    user.phone_verified_at = utcnow() if phone_verified else None
    db.flush()
    db.commit()
    return user


def staff(db: Session, *, role: RoleKey, email: str) -> tuple[User, dict[str, str]]:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        role_row = db.execute(select(Role).where(Role.key == role.value)).scalar_one()
        user = User(
            email=email, name_te="సిబ్బంది", name_en="Staff", status=UserStatus.ACTIVE
        )
        db.add(user)
        db.flush()
        db.add(
            UserRole(user_id=user.id, role_id=role_row.id, scope_type=ScopeType.GLOBAL)
        )
        db.flush()
    db.refresh(user)
    _s, access, _r, _e = auth_service.create_session(db, user)
    db.commit()
    return user, {"Authorization": f"Bearer {access}"}


def png_bytes() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (600, 380), (200, 200, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def apply_and_submit(
    db: Session, user: User, *, contributor_type=ContributorType.CITIZEN
) -> ContributorProfile:
    profile = kyc_service.start_or_update(
        db,
        user=user,
        contributor_type=contributor_type,
        display_name_te="రమేష్ కుమార్",
        organisation="ఒక కళాశాల" if contributor_type == ContributorType.STUDENT else None,
        portfolio_url="https://example.com/work"
        if contributor_type == ContributorType.FREELANCE
        else None,
    )
    kyc_service.add_document(
        db, profile=profile, kind=KycDocumentKind.PAN, raw=png_bytes(),
        declared_mime="image/png", number="ABCDE1234F",
    )
    kyc_service.add_document(
        db, profile=profile, kind=KycDocumentKind.SELFIE, raw=png_bytes(),
        declared_mime="image/png",
    )
    if contributor_type == ContributorType.STUDENT:
        kyc_service.add_document(
            db, profile=profile, kind=KycDocumentKind.STUDENT_ID, raw=png_bytes(),
            declared_mime="image/png",
        )
    if contributor_type == ContributorType.FREELANCE:
        kyc_service.add_document(
            db, profile=profile, kind=KycDocumentKind.PRESS_ACCREDITATION,
            raw=png_bytes(), declared_mime="image/png",
        )
    db.commit()
    kyc_service.submit(db, profile=profile, user=user)
    db.commit()
    return profile


# --------------------------------------------------------------------------- #
# Where documents live
# --------------------------------------------------------------------------- #
class TestDocumentPrivacy:
    def test_the_model_has_no_url_column(self) -> None:
        """The absence is the design. A public address for somebody's passport
        scan is how these leak, and 'just for convenience' is how it gets added."""
        assert not hasattr(KycDocument, "url")
        assert "url" not in {c.name for c in KycDocument.__table__.columns}

    def test_private_storage_is_not_under_the_public_media_mount(self) -> None:
        """`app/main.py` mounts STORAGE_LOCAL_PATH at /media with StaticFiles,
        so a 'private' folder inside it would be served to the whole internet."""
        private = Path(getattr(get_private_storage(), "root", "/private")).resolve()
        public = Path(env_settings.STORAGE_LOCAL_PATH).resolve()
        assert not private.is_relative_to(public)

    def test_the_two_providers_are_different_roots(self) -> None:
        assert getattr(get_private_storage(), "root", None) != getattr(
            get_storage(), "root", None
        )

    def test_an_uploaded_document_records_no_public_url(self, db: Session) -> None:
        user = make_reader(db, email="kyc-priv@test.local")
        profile = kyc_service.start_or_update(
            db, user=user, contributor_type=ContributorType.CITIZEN,
            display_name_te="ఒక పేరు",
        )
        document = kyc_service.add_document(
            db, profile=profile, kind=KycDocumentKind.PAN, raw=png_bytes(),
            declared_mime="image/png", number="ABCDE1234F",
        )
        db.commit()
        assert document.storage_key.startswith("kyc/")
        assert document.sha256
        assert document.number_masked == "XXXXXX234F"
        # The full value is encrypted, not stored in the clear.
        assert document.number_encrypted != "ABCDE1234F"

    def test_gps_metadata_is_stripped_from_a_photo_of_an_id(self) -> None:
        """A phone photo of an ID carries the coordinates of wherever it was
        taken — usually the applicant's home."""
        from PIL import Image

        buffer = io.BytesIO()
        image = Image.new("RGB", (400, 300), (128, 128, 128))
        exif = image.getexif()
        exif[0x8825] = {1: "N"}  # GPSInfo
        image.save(buffer, format="JPEG", exif=exif)
        raw = buffer.getvalue()
        assert b"Exif" in raw

        key, _size, _digest, mime = secure_upload_service.store_private(
            raw, key_prefix="kyc/test/pan", declared_mime="image/jpeg"
        )
        cleaned = secure_upload_service.read_private(key)
        assert mime == "image/jpeg"
        with Image.open(io.BytesIO(cleaned)) as out:
            assert not dict(out.getexif())


class TestUploadSafety:
    def test_magic_bytes_decide_the_type_not_the_declared_one(self) -> None:
        with pytest.raises(ValidationError):
            secure_upload_service.store_private(
                b"#!/bin/sh\nrm -rf /", key_prefix="kyc/x/pan",
                declared_mime="image/png",
            )

    def test_a_pdf_with_javascript_is_refused(self) -> None:
        payload = b"%PDF-1.4\n/OpenAction << /S /JavaScript >>\n%%EOF"
        with pytest.raises(ValidationError):
            secure_upload_service.store_private(
                payload, key_prefix="kyc/x/bonafide", declared_mime="application/pdf"
            )

    def test_a_plain_pdf_is_accepted(self) -> None:
        payload = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
        key, size, _digest, mime = secure_upload_service.store_private(
            payload, key_prefix="kyc/x/bonafide", declared_mime="application/pdf"
        )
        assert mime == "application/pdf"
        assert size == len(payload)
        assert key.endswith(".pdf")

    def test_an_oversize_file_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            secure_upload_service.store_private(
                b"\x89PNG\r\n\x1a\n" + b"0" * secure_upload_service.MAX_DOC_BYTES,
                key_prefix="kyc/x/pan",
                declared_mime="image/png",
            )


# --------------------------------------------------------------------------- #
# Applying
# --------------------------------------------------------------------------- #
class TestApplying:
    def test_an_unverified_phone_cannot_submit(self, db: Session) -> None:
        """Phone is the identity anchor in India and the OTP flow already
        exists; an application from an unreachable number wastes a reviewer."""
        user = make_reader(db, email="kyc-nophone@test.local", phone_verified=False)
        profile = kyc_service.start_or_update(
            db, user=user, contributor_type=ContributorType.CITIZEN,
            display_name_te="ఒక పేరు",
        )
        for kind in (KycDocumentKind.PAN, KycDocumentKind.SELFIE):
            kyc_service.add_document(
                db, profile=profile, kind=kind, raw=png_bytes(),
                declared_mime="image/png",
            )
        db.commit()
        with pytest.raises(ValidationError):
            kyc_service.submit(db, profile=profile, user=user)

    def test_missing_documents_block_submission_and_say_which(
        self, db: Session
    ) -> None:
        user = make_reader(db, email="kyc-partial@test.local")
        profile = kyc_service.start_or_update(
            db, user=user, contributor_type=ContributorType.STUDENT,
            display_name_te="ఒక పేరు", organisation="కళాశాల",
        )
        kyc_service.add_document(
            db, profile=profile, kind=KycDocumentKind.PAN, raw=png_bytes(),
            declared_mime="image/png",
        )
        db.commit()
        missing = kyc_service.missing_documents(db, profile)
        assert any("selfie" in group for group in missing)
        with pytest.raises(ValidationError):
            kyc_service.submit(db, profile=profile, user=user)

    def test_a_full_aadhaar_number_is_refused(self, db: Session) -> None:
        """Storing one without being UIDAI-registered is a compliance problem,
        not a schema decision — the enum has no AADHAAR member and this catches
        somebody typing one into another field."""
        user = make_reader(db, email="kyc-aadhaar@test.local")
        profile = kyc_service.start_or_update(
            db, user=user, contributor_type=ContributorType.CITIZEN,
            display_name_te="ఒక పేరు",
        )
        with pytest.raises(ValidationError):
            kyc_service.add_document(
                db, profile=profile, kind=KycDocumentKind.PAN, raw=png_bytes(),
                declared_mime="image/png", number="123456789012",
            )

    def test_the_document_set_offers_no_aadhaar_option(self) -> None:
        assert "aadhaar" not in {k.value for k in KycDocumentKind}

    def test_a_submitted_application_cannot_be_edited(self, db: Session) -> None:
        user = make_reader(db, email="kyc-locked@test.local")
        profile = apply_and_submit(db, user)
        assert profile.kyc_status == KycStatus.SUBMITTED
        with pytest.raises(ConflictError):
            kyc_service.start_or_update(
                db, user=user, contributor_type=ContributorType.CITIZEN,
                display_name_te="వేరే పేరు",
            )


# --------------------------------------------------------------------------- #
# The provider seam
# --------------------------------------------------------------------------- #
class TestProviderSeam:
    def test_manual_review_leaves_the_case_in_the_queue(self, db: Session) -> None:
        user = make_reader(db, email="kyc-manual@test.local")
        profile = apply_and_submit(db, user)
        assert profile.kyc_status == KycStatus.SUBMITTED
        assert profile.provider == "manual"
        assert get_kyc("manual").can_decide is False

    def test_an_unknown_provider_degrades_to_manual(self) -> None:
        """A typo in a settings row must mean 'a person reads it', never
        'nobody can apply'."""
        assert get_kyc("digoi-typo").key == "manual"

    def test_a_provider_outage_does_not_lose_the_application(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class Exploding:
            key = "boom"

            def submit(self, _submission):
                raise RuntimeError("vendor down")

        monkeypatch.setattr(
            "app.services.kyc_service.get_kyc", lambda *_a, **_k: Exploding()
        )
        user = make_reader(db, email="kyc-outage@test.local")
        profile = apply_and_submit(db, user)
        assert profile.kyc_status == KycStatus.SUBMITTED


# --------------------------------------------------------------------------- #
# What approval unlocks — and what it never does
# --------------------------------------------------------------------------- #
class TestApproval:
    def _approve(self, db: Session, user: User) -> ContributorProfile:
        profile = apply_and_submit(db, user)
        kyc_service.apply_decision(
            db,
            profile,
            KycDecision(status=KycStatus.APPROVED, provider="manual"),
            actor_id=None,
        )
        db.commit()
        return profile

    def test_approval_grants_the_contributor_role_and_nothing_else(
        self, db: Session
    ) -> None:
        user = make_reader(db, email="kyc-role@test.local")
        self._approve(db, user)
        roles = db.scalars(
            select(Role)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user.id)
        ).all()
        keys = {r.key for r in roles}
        assert RoleKey.CONTRIBUTOR.value in keys
        assert keys & {"reporter", "sub_editor", "desk_editor", "admin"} == set()

    def test_a_contributor_cannot_publish(self) -> None:
        from app.core.permissions import ROLE_PERMISSIONS

        granted = ROLE_PERMISSIONS[RoleKey.CONTRIBUTOR]
        assert "article.publish" not in granted
        assert "article.create" not in granted
        assert "article.approve" not in granted

    def test_the_pending_quota_rises_after_approval(self, db: Session) -> None:
        user = make_reader(db, email="kyc-quota@test.local")
        assert kyc_service.pending_limit(db, user.id) == 5
        self._approve(db, user)
        assert kyc_service.pending_limit(db, user.id) == 15

    def test_an_expired_approval_stops_counting(self, db: Session) -> None:
        from datetime import timedelta

        user = make_reader(db, email="kyc-expired@test.local")
        profile = self._approve(db, user)
        profile.expires_at = utcnow() - timedelta(days=1)
        db.flush()
        assert kyc_service.is_approved(db, user.id) is False
        assert kyc_service.pending_limit(db, user.id) == 5

    def test_an_approved_submission_still_needs_an_editor(self, db: Session) -> None:
        """The whole point: verification buys standing, never publication."""
        user = make_reader(db, email="kyc-flow@test.local")
        self._approve(db, user)
        submission = submission_service.create_submission(
            db,
            user_id=user.id,
            title_te="ఒక పౌర విలేకరి కథనం",
            body_te="ఇది ఒక పరీక్ష కథనం. " * 12,
            category_id=None,
            district_id=None,
            accept_guidelines=True,
        )
        db.commit()
        _sub, article = submission_service.approve_submission(
            db, submission_id=submission.id, moderator_id=None
        )
        db.commit()
        assert article.status == ArticleStatus.PENDING
        assert article.workflow_state == WorkflowState.SUBMITTED
        assert article.published_at is None
        assert article.byline_badge == ContributorType.CITIZEN.value
        assert article.byline_te == "రమేష్ కుమార్", "the chosen display name, not the account name"

    def test_a_rejection_carries_a_reason_back_to_the_applicant(
        self, db: Session
    ) -> None:
        user = make_reader(db, email="kyc-reject@test.local")
        profile = apply_and_submit(db, user)
        kyc_service.apply_decision(
            db,
            profile,
            KycDecision(
                status=KycStatus.REJECTED,
                provider="manual",
                reason_te="పత్రం స్పష్టంగా లేదు",
            ),
            actor_id=None,
        )
        db.commit()
        assert profile.kyc_status == KycStatus.REJECTED
        assert profile.review_note
        assert profile.verified_badge is False


# --------------------------------------------------------------------------- #
# The submission gates that were documented and never enforced
# --------------------------------------------------------------------------- #
class TestSubmissionGates:
    def _submit(self, db: Session, user: User):
        return submission_service.create_submission(
            db,
            user_id=user.id,
            title_te="ఒక పరీక్ష కథనం ఇక్కడ",
            body_te="ఇది ఒక పరీక్ష కథనం. " * 12,
            category_id=None,
            district_id=None,
            accept_guidelines=True,
        )

    def test_submissions_disabled_actually_blocks(self, db: Session) -> None:
        """`submissions.enabled` has been in SPECS since the settings screen
        shipped, and nothing read it."""
        settings_service.set_many(db, {"submissions.enabled": False}, actor_id=None)
        db.commit()
        user = make_reader(db, email="sub-off@test.local")
        with pytest.raises(ConflictError):
            self._submit(db, user)

    def test_phone_verification_is_now_required(self, db: Session) -> None:
        """`verification_service`'s docstring already claimed this was the
        rule; nothing checked it."""
        user = make_reader(db, email="sub-nophone@test.local", phone_verified=False)
        with pytest.raises(ValidationError):
            self._submit(db, user)

    def test_a_verified_reader_can_still_submit_without_kyc(
        self, db: Session
    ) -> None:
        """Requiring KYC to submit at all is a policy choice, not the default."""
        user = make_reader(db, email="sub-ok@test.local")
        submission = self._submit(db, user)
        db.commit()
        assert submission.id

    def test_require_kyc_closes_it_to_unverified_readers(self, db: Session) -> None:
        settings_service.set_many(db, {"submissions.require_kyc": True}, actor_id=None)
        db.commit()
        user = make_reader(db, email="sub-kyc@test.local")
        with pytest.raises(ConflictError):
            self._submit(db, user)


# --------------------------------------------------------------------------- #
# The admin surface
# --------------------------------------------------------------------------- #
class TestAdminSurface:
    def test_a_desk_editor_can_triage_but_not_open_a_document(
        self, db: Session, client: TestClient
    ) -> None:
        """The split is the privacy design: triage on masked metadata, and
        opening a government ID is a deliberate escalation."""
        user = make_reader(db, email="kyc-desk-applicant@test.local")
        profile = apply_and_submit(db, user)
        document = profile.documents[0]

        _desk, headers = staff(db, role=RoleKey.DESK_EDITOR, email="kyc-desk@test.local")
        assert client.get("/api/v1/cms/kyc", headers=headers).status_code == 200
        assert (
            client.get(f"/api/v1/cms/kyc/{profile.id}", headers=headers).status_code
            == 200
        )
        blocked = client.get(
            f"/api/v1/cms/kyc/{profile.id}/documents/{document.id}/raw",
            headers=headers,
        )
        assert blocked.status_code == 403

    def test_an_editor_in_chief_can_open_it_and_the_open_is_audited(
        self, db: Session, client: TestClient
    ) -> None:
        from app.models.audit import AuditLog

        user = make_reader(db, email="kyc-eic-applicant@test.local")
        profile = apply_and_submit(db, user)
        document = profile.documents[0]

        _eic, headers = staff(
            db, role=RoleKey.EDITOR_IN_CHIEF, email="kyc-eic@test.local"
        )
        before = int(
            db.scalar(
                select(__import__("sqlalchemy").func.count(AuditLog.id)).where(
                    AuditLog.entity_type == "kyc_document"
                )
            )
            or 0
        )
        response = client.get(
            f"/api/v1/cms/kyc/{profile.id}/documents/{document.id}/raw",
            headers=headers,
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, no-store"
        assert "noindex" in response.headers.get("x-robots-tag", "")

        after = int(
            db.scalar(
                select(__import__("sqlalchemy").func.count(AuditLog.id)).where(
                    AuditLog.entity_type == "kyc_document"
                )
            )
            or 0
        )
        assert after > before, "every open must be recorded"

    def test_the_queue_row_carries_masked_numbers_only(
        self, db: Session, client: TestClient
    ) -> None:
        user = make_reader(db, email="kyc-mask@test.local")
        profile = apply_and_submit(db, user)
        _eic, headers = staff(
            db, role=RoleKey.EDITOR_IN_CHIEF, email="kyc-eic@test.local"
        )
        body = client.get(f"/api/v1/cms/kyc/{profile.id}", headers=headers).json()
        serialised = str(body)
        assert "ABCDE1234F" not in serialised, "the full number must never be returned"
        assert "XXXXXX234F" in serialised
        assert "storage_key" not in serialised

    def test_the_applicant_never_gets_a_document_url(
        self, db: Session, client: TestClient
    ) -> None:
        user = make_reader(db, email="kyc-self@test.local")
        apply_and_submit(db, user)
        _s, access, _r, _e = auth_service.create_session(db, user)
        db.commit()
        body = client.get(
            "/api/v1/users/me/contributor",
            headers={"Authorization": f"Bearer {access}"},
        ).json()
        for document in body["documents"]:
            assert "url" not in document
            assert "storage_key" not in document


def test_retention_purges_a_rejected_application(db: Session) -> None:
    """Keeping somebody's passport scan forever because nobody wrote the
    deletion job is the failure this prevents."""
    from datetime import timedelta

    user = make_reader(db, email="kyc-purge@test.local")
    profile = apply_and_submit(db, user)
    kyc_service.apply_decision(
        db, profile, KycDecision(status=KycStatus.REJECTED, provider="manual"),
        actor_id=None,
    )
    profile.reviewed_at = utcnow() - timedelta(days=120)
    db.flush()
    db.commit()
    assert profile.documents

    purged = kyc_service.purge_expired(db)
    db.commit()
    assert purged >= 1
    remaining = db.scalars(
        select(KycDocument).where(KycDocument.profile_id == profile.id)
    ).all()
    assert remaining == []
