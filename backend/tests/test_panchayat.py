"""The one exception to per-article review, and every wall around it.

`README.md` says nothing reaches a reader without a human editor pressing
Approve, and an admin-approved gram-panchayat secretary is the single exception.
So the tests worth writing here are not "it publishes" — they are the six ways
it must **refuse** to, because each one is a class of story that would otherwise
reach readers unread:

  * no grant, somebody else's copy, somebody else's panchayat;
  * a KYC that has lapsed;
  * the account's first three stories, which still go to the desk;
  * a body the sensitive-topics screen trips on.

Plus the two properties an investigation depends on: `approved_by` stays NULL so
the audit log never claims an editor approved, and revoking the grant is instant
*and* pulls their live copy down.
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from collections.abc import Iterator
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.deps import Principal, build_principal  # noqa: E402
from app.core.errors import (  # noqa: E402
    ConflictError,
    RateLimitedError,
    ScopeDeniedError,
    ValidationError,
)
from app.core.permissions import ROLE_DEFINITIONS, ROLE_PERMISSIONS  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.db.seed import (  # noqa: E402
    seed_districts,
    seed_panchayat_category,
    seed_permissions,
    seed_roles,
    seed_states,
)
from app.db.seed_content import seed_categories  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.integrations.kyc.base import KycDecision  # noqa: E402
from app.main import app  # noqa: E402
from app.models.content import (  # noqa: E402
    Article,
    ArticleVersion,
    Category,
    WorkflowTransition,
)
from app.models.enums import (  # noqa: E402
    ArticleStatus,
    ArticleType,
    ContributorType,
    KycStatus,
    ReportStatus,
    ReportTargetType,
    RoleKey,
    ScopeType,
    UserStatus,
    Vertical,
    WorkflowState,
)
from app.models.engagement import Report  # noqa: E402
from app.models.geo import District, Locality, Mandal  # noqa: E402
from app.models.kyc import ContributorProfile  # noqa: E402
from app.models.user import Role, User, UserRole  # noqa: E402
from app.services import auth_service, kyc_service, panchayat_service  # noqa: E402
from app.services import workflow_service  # noqa: E402

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
    categories = seed_categories(session)
    seed_panchayat_category(session, categories)

    district = session.scalars(select(District)).first()
    mandal = Mandal(
        district_id=district.id, slug="peda-mandal", name_te="పెద మండలం",
        name_en="Peda Mandal",
    )
    session.add(mandal)
    session.flush()
    session.add_all(
        [
            Locality(
                mandal_id=mandal.id, slug=slug, name_te=name_te, name_en=name_en,
                kind="panchayat",
            )
            for slug, name_te, name_en in (
                ("gollapalem", "గొల్లపాలెం", "Gollapalem"),
                ("rayapuram", "రాయపురం", "Rayapuram"),
            )
        ]
    )
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
    db.query(Report).delete()
    db.query(WorkflowTransition).delete()
    db.query(ArticleVersion).delete()
    db.query(Article).delete()
    db.query(ContributorProfile).delete()
    db.commit()


# --------------------------------------------------------------------------- #
# Fixtures for one secretary in one panchayat
# --------------------------------------------------------------------------- #
def _locality(db: Session, slug: str) -> Locality:
    return db.scalars(select(Locality).where(Locality.slug == slug)).one()


def _user(
    db: Session, email: str, role: RoleKey, *, scope_id: int | None = None
) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        return user
    role_row = db.scalars(select(Role).where(Role.key == role.value)).one()
    user = User(
        email=email, name_te="కార్యదర్శి", name_en="Secretary",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    db.flush()
    db.add(
        UserRole(
            user_id=user.id,
            role_id=role_row.id,
            # A real secretary account is scoped to one mandal, and
            # `build_principal` reads `scope_id` to know which. Leaving it NULL
            # gives an empty scope set and every transition is refused before
            # the exception is ever consulted.
            scope_type=ScopeType.MANDAL
            if role is RoleKey.PANCHAYAT_SECRETARY
            else ScopeType.GLOBAL,
            scope_id=scope_id if role is RoleKey.PANCHAYAT_SECRETARY else None,
        )
    )
    db.flush()
    db.commit()
    return user


def secretary(
    db: Session, *, email: str = "sec@test.local", locality_slug: str = "gollapalem",
    granted: bool = True, approved: bool = True,
) -> tuple[User, ContributorProfile]:
    """A verified PANCHAYAT contributor who is also a CMS secretary account."""
    locality = _locality(db, locality_slug)
    user = _user(
        db, email, RoleKey.PANCHAYAT_SECRETARY, scope_id=locality.mandal_id
    )
    profile = ContributorProfile(
        user_id=user.id,
        contributor_type=ContributorType.CITIZEN,
        vertical=Vertical.PANCHAYAT,
        display_name_te="రమేష్ కుమార్",
        locality_id=locality.id,
    )
    db.add(profile)
    db.flush()
    if approved:
        kyc_service.apply_decision(
            db, profile, KycDecision(status=KycStatus.APPROVED, provider="manual"),
            actor_id=None,
        )
    if granted:
        panchayat_service.set_publish_grant(db, profile, granted=True, actor_id=1)
    db.commit()
    return user, profile


def principal_for(db: Session, user: User) -> Principal:
    """The real thing, built from the user's actual role assignments.

    It used to hand-assemble a Principal with the secretary's permissions baked
    in, which meant a test could hand it a desk editor and still get a
    secretary's authority — the exact confusion the exception has to be immune
    to. `build_principal` is what the API uses, so use it.
    """
    db.refresh(user)
    return build_principal(user, "test")


def make_article(
    db: Session,
    *,
    author_id: int | None,
    locality_slug: str | None = "gollapalem",
    body: str = "గ్రామ పంచాయతీ సర్వసభ్య సమావేశం సోమవారం జరిగింది.",
    status: ArticleStatus = ArticleStatus.DRAFT,
    state: WorkflowState = WorkflowState.DRAFT,
    title: str = "పంచాయతీ సమావేశం",
    summary: str | None = None,
    source_type: str = "own",
    article_type: ArticleType = ArticleType.NORMAL,
    approved_by: int | None = None,
) -> Article:
    locality = _locality(db, locality_slug) if locality_slug else None
    article = Article(
        short_id=f"a{db.query(Article).count():05d}",
        slug=f"kathanam-{db.query(Article).count()}",
        title_te=title,
        summary_te=summary,
        body_plain=body,
        source_type=source_type,
        article_type=article_type,
        approved_by=approved_by,
        author_id=author_id,
        locality_id=locality.id if locality else None,
        mandal_id=locality.mandal_id if locality else None,
        district_id=locality.mandal.district_id if locality else None,
        status=status,
        workflow_state=state,
    )
    db.add(article)
    db.flush()
    db.commit()
    return article


def serve_probation(db: Session, author_id: int) -> None:
    """The three reviewed stories that end probation."""
    for _ in range(panchayat_service.PROBATION):
        make_article(
            db, author_id=author_id, status=ArticleStatus.PUBLISHED,
            state=WorkflowState.PUBLISHED,
        )


def publish(db: Session, user: User, article: Article) -> Article:
    return workflow_service.transition(
        db, principal_for(db, user), article, "publish", None
    )


# --------------------------------------------------------------------------- #
# The six refusals
# --------------------------------------------------------------------------- #
class TestTheHolesTheReviewFound:
    """Six ways in that the first implementation left open.

    Every one of these was reachable with a real account and a real token, and
    each is the kind of hole that only shows up when somebody is actively
    looking for it rather than checking the happy path.
    """

    def test_a_sensitive_headline_is_screened_even_over_an_innocent_body(
        self, db: Session
    ) -> None:
        """The headline is what a card, a push and a WhatsApp preview show.

        Screening `body_plain` alone let an ordinary meeting notice carry any
        headline at all — and an empty body passed the check trivially.
        """
        user, _p = secretary(db)
        serve_probation(db, user.id)
        article = make_article(
            db,
            author_id=user.id,
            title="గ్రామంలో అత్యాచారం",
            body="గ్రామ పంచాయతీ సర్వసభ్య సమావేశం సోమవారం జరిగింది.",
        )
        assert not panchayat_service.may_self_publish(
            db, principal_for(db, user), article
        )

    def test_an_empty_body_does_not_pass_the_screen_by_default(
        self, db: Session
    ) -> None:
        user, _p = secretary(db)
        serve_probation(db, user.id)
        article = make_article(
            db, author_id=user.id, title="మతపరమైన ఘర్షణ", body=""
        )
        assert not panchayat_service.may_self_publish(
            db, principal_for(db, user), article
        )

    def test_a_desk_editor_holding_the_same_grant_still_needs_an_approver(
        self, db: Session
    ) -> None:
        """The exception is documented as one role. It was implemented as a
        column, so anyone carrying it skipped the two-person rule — including
        staff who are specifically not allowed to publish their own copy."""
        editor = _user(db, "desk@test.local", RoleKey.DESK_EDITOR)
        profile = ContributorProfile(
            user_id=editor.id,
            contributor_type=ContributorType.CITIZEN,
            vertical=Vertical.PANCHAYAT,
            display_name_te="డెస్క్",
            locality_id=_locality(db, "gollapalem").id,
        )
        db.add(profile)
        db.flush()
        kyc_service.apply_decision(
            db, profile,
            KycDecision(status=KycStatus.APPROVED, provider="manual"),
            actor_id=None,
        )
        panchayat_service.set_publish_grant(db, profile, granted=True, actor_id=1)
        db.commit()
        serve_probation(db, editor.id)

        article = make_article(db, author_id=editor.id)
        assert not panchayat_service.may_self_publish(
            db, principal_for(db, editor), article
        )
        # Untrusted, so the ordinary state machine answers first: a DRAFT does
        # not go straight to PUBLISHED for anybody. Either refusal is the right
        # one; what matters is that the story does not reach readers.
        with pytest.raises((ConflictError, ValidationError)):
            publish(db, editor, article)
        db.refresh(article)
        assert article.status == ArticleStatus.DRAFT

    def test_another_outlets_reporting_cannot_be_relocated_and_self_published(
        self, db: Session
    ) -> None:
        """A secretary holds `article.create`, which reaches the crawl import,
        and an imported item takes the importer as its author. Without a
        provenance check that made somebody else's journalism 'their own copy',
        and `stamp_ugc` would then overwrite the publisher's credit."""
        user, _p = secretary(db)
        serve_probation(db, user.id)
        imported = make_article(
            db,
            author_id=user.id,
            source_type="syndicated",
            article_type=ArticleType.SYNDICATED,
        )
        assert not panchayat_service.may_self_publish(
            db, principal_for(db, user), imported
        )

    def test_the_throttle_refuses_rather_than_vanishes_when_redis_is_down(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`incr_with_ttl` returns 0 on any Redis error, which normally means
        "no limiting". On the one path that puts copy in front of readers with
        nobody in between, that turns the only throttle into nothing — and a
        Redis outage is routine here, not exotic."""
        from app.core import ratelimit

        monkeypatch.setattr(ratelimit, "incr_with_ttl", lambda *_a, **_kw: 0)
        dependency = ratelimit.rate_limit("panchayat_publish", 5, fail_closed=True)
        with pytest.raises(RateLimitedError):
            dependency(SimpleNamespace(state=SimpleNamespace(user_id=1), client=None))

        # The engagement surface keeps the opposite default on purpose.
        ratelimit.rate_limit("comment", 5)(
            SimpleNamespace(state=SimpleNamespace(user_id=1), client=None)
        )

    def test_revoking_leaves_editor_approved_journalism_up(
        self, db: Session
    ) -> None:
        """Withdrawing a trust flag is not a reason to unpublish stories a real
        editor read and approved."""
        user, profile = secretary(db)
        reviewed = make_article(
            db,
            author_id=user.id,
            status=ArticleStatus.PUBLISHED,
            state=WorkflowState.PUBLISHED,
            approved_by=1,
        )
        unreviewed = make_article(
            db,
            author_id=user.id,
            status=ArticleStatus.PUBLISHED,
            state=WorkflowState.PUBLISHED,
        )
        taken = panchayat_service.set_publish_grant(
            db, profile, granted=False, actor_id=1
        )
        db.commit()
        ids = {a.id for a in taken}
        assert unreviewed.id in ids
        assert reviewed.id not in ids, "an editor's approved story was taken down"
        db.refresh(reviewed)
        assert reviewed.status == ArticleStatus.PUBLISHED


class TestTheExceptionRefuses:
    def test_without_a_grant_a_draft_cannot_be_published(self, db: Session) -> None:
        user, _p = secretary(db, granted=False)
        serve_probation(db, user.id)
        with pytest.raises(ConflictError):
            publish(db, user, make_article(db, author_id=user.id))

    def test_somebody_elses_article_cannot_be_published(self, db: Session) -> None:
        """The grant is to publish *their own* copy, not to publish."""
        user, _p = secretary(db)
        serve_probation(db, user.id)
        other = _user(db, "other-sec@test.local", RoleKey.PANCHAYAT_SECRETARY)
        with pytest.raises(ConflictError):
            publish(db, user, make_article(db, author_id=other.id))

    def test_another_panchayat_cannot_be_published_into(self, db: Session) -> None:
        user, _p = secretary(db, locality_slug="gollapalem")
        serve_probation(db, user.id)
        with pytest.raises(ConflictError):
            publish(
                db, user, make_article(db, author_id=user.id, locality_slug="rayapuram")
            )

    def test_an_article_with_no_locality_is_not_theirs_by_default(
        self, db: Session
    ) -> None:
        """NULL == NULL must not read as "their own panchayat".

        Asserted on the function rather than the transition, because a
        mandal-scoped account is refused ungeographic content by `_scope`
        first — a second wall, not the one under test.
        """
        user, _p = secretary(db)
        serve_probation(db, user.id)
        article = make_article(db, author_id=user.id, locality_slug=None)
        assert not panchayat_service.may_self_publish(
            db, principal_for(db, user), article
        )
        with pytest.raises((ConflictError, ScopeDeniedError)):
            publish(db, user, article)

    def test_an_expired_kyc_revokes_it_with_no_sweep_job(self, db: Session) -> None:
        user, profile = secretary(db)
        serve_probation(db, user.id)
        profile.expires_at = utcnow() - timedelta(days=1)
        db.commit()
        assert not kyc_service.is_approved(db, user.id)
        with pytest.raises(ConflictError):
            publish(db, user, make_article(db, author_id=user.id))

    def test_the_first_three_stories_still_go_to_the_desk(self, db: Session) -> None:
        user, _p = secretary(db)
        assert panchayat_service.PROBATION == 3
        with pytest.raises(ConflictError):
            publish(db, user, make_article(db, author_id=user.id))
        serve_probation(db, user.id)
        # The fourth is the first that may skip review.
        assert publish(db, user, make_article(db, author_id=user.id)).status == (
            ArticleStatus.PUBLISHED
        )

    def test_a_sensitive_body_lands_in_review_instead(self, db: Session) -> None:
        """A suicide report is not a panchayat notice, and it is exactly the
        story that must not reach readers unread."""
        user, _p = secretary(db)
        serve_probation(db, user.id)
        article = make_article(
            db,
            author_id=user.id,
            body="గ్రామంలో ఒక రైతు ఆత్మహత్య చేసుకున్నాడని పోలీసులు తెలిపారు.",
        )
        workflow_service.transition(
            db, principal_for(db, user), article, "submit", None
        )
        db.commit()
        assert article.workflow_state == WorkflowState.SUBMITTED
        with pytest.raises(ConflictError):
            publish(db, user, article)
        assert article.workflow_state == WorkflowState.SUBMITTED
        assert article.status != ArticleStatus.PUBLISHED


# --------------------------------------------------------------------------- #
# What a trusted publish leaves behind
# --------------------------------------------------------------------------- #
class TestATrustedPublish:
    def test_approved_by_stays_null_and_a_snapshot_is_taken(
        self, db: Session
    ) -> None:
        """`PUBLISHED AND approved_by IS NULL` is the forensic signature of
        this exception. Stamping the secretary in would make the audit log
        claim an editor approved when none did."""
        user, _p = secretary(db)
        serve_probation(db, user.id)
        article = publish(db, user, make_article(db, author_id=user.id))
        db.commit()
        assert article.status == ArticleStatus.PUBLISHED
        assert article.approved_by is None
        assert article.approved_at is None
        assert article.published_by == user.id
        assert db.scalars(
            select(ArticleVersion).where(ArticleVersion.article_id == article.id)
        ).all()

    def test_every_ugc_marker_is_stamped_and_the_category_is_forced(
        self, db: Session
    ) -> None:
        user, profile = secretary(db)
        serve_probation(db, user.id)
        article = make_article(db, author_id=user.id)
        # A secretary filing into Cinema is a mistake, not an intent.
        wrong = db.scalars(
            select(Category).where(
                Category.slug != panchayat_service.PANCHAYAT_CATEGORY_SLUG
            )
        ).first()
        article.category_id = wrong.id
        db.flush()
        publish(db, user, article)
        db.commit()

        panchayat = db.scalars(
            select(Category).where(
                Category.slug == panchayat_service.PANCHAYAT_CATEGORY_SLUG
            )
        ).one()
        assert article.category_id == panchayat.id
        assert article.article_source_type == "USER"
        assert article.article_type == ArticleType.USER_SUBMITTED
        assert article.source_type == "contributed"
        assert article.source_credit == "గొల్లపాలెం"
        assert article.byline_te == profile.display_name_te
        assert article.byline_badge == "panchayat"


# --------------------------------------------------------------------------- #
# Taking it away
# --------------------------------------------------------------------------- #
class TestRevocation:
    def test_revoking_stops_the_next_publish_and_takes_live_copy_down(
        self, db: Session
    ) -> None:
        user, profile = secretary(db)
        serve_probation(db, user.id)
        live = publish(db, user, make_article(db, author_id=user.id))
        db.commit()
        assert live.status == ArticleStatus.PUBLISHED

        taken_down = panchayat_service.set_publish_grant(
            db, profile, granted=False, actor_id=1
        )
        db.commit()
        assert live.id in {a.id for a in taken_down}
        assert live.status == ArticleStatus.UNPUBLISHED
        assert live.workflow_state == WorkflowState.UNPUBLISHED
        assert profile.panchayat_publish_granted_at is None
        # Instant, because the grant is read from the row on every request.
        with pytest.raises(ConflictError):
            publish(db, user, make_article(db, author_id=user.id))

    def test_the_grant_endpoint_needs_an_admin_not_a_kyc_approver(
        self, db: Session, client: TestClient
    ) -> None:
        """Level 60 approves a KYC. Deciding that somebody's copy reaches
        readers unread is a different decision."""
        _u, profile = secretary(db, granted=False)
        path = f"/api/v1/cms/kyc/{profile.id}/panchayat-publish"
        body = {"granted": True}

        desk = _user(db, "desk@test.local", RoleKey.DESK_EDITOR)
        _s, access, _r, _e = auth_service.create_session(db, desk)
        db.commit()
        refused = client.post(
            path, json=body, headers={"Authorization": f"Bearer {access}"}
        )
        assert refused.status_code == 403

        admin = _user(db, "admin@test.local", RoleKey.ADMIN)
        _s, access, _r, _e = auth_service.create_session(db, admin)
        db.commit()
        allowed = client.post(
            path, json=body, headers={"Authorization": f"Bearer {access}"}
        )
        assert allowed.status_code == 200
        assert allowed.json()["granted_at"] is not None


# --------------------------------------------------------------------------- #
# The queue that catches it when this goes wrong
# --------------------------------------------------------------------------- #
class TestReportQueue:
    def test_the_most_reported_target_surfaces_first_and_ugc_can_be_isolated(
        self, db: Session, client: TestClient
    ) -> None:
        """Three reports on one article is a different signal from three
        reports on three. Nothing here unpublishes at a threshold — a brigade
        would be the fastest way to take down real journalism — it only moves
        a story up a human's list."""
        user, _p = secretary(db)
        serve_probation(db, user.id)
        ugc = publish(db, user, make_article(db, author_id=user.id))
        desk_copy = make_article(db, author_id=None)
        desk_copy.article_source_type = "EDITOR"
        db.flush()

        db.add_all(
            [
                Report(
                    target_type=ReportTargetType.ARTICLE,
                    target_id=desk_copy.id,
                    reason="spam",
                    status=ReportStatus.OPEN,
                )
            ]
            + [
                Report(
                    target_type=ReportTargetType.ARTICLE,
                    target_id=ugc.id,
                    reason="abuse",
                    status=ReportStatus.OPEN,
                )
                for _ in range(3)
            ]
        )
        db.commit()

        admin = _user(db, "admin@test.local", RoleKey.ADMIN)
        _s, access, _r, _e = auth_service.create_session(db, admin)
        db.commit()
        headers = {"Authorization": f"Bearer {access}"}

        rows = client.get(
            "/api/v1/cms/moderation/reports", params={"status": "open"},
            headers=headers,
        ).json()["items"]
        assert rows[0]["target"]["id"] == ugc.id
        assert rows[0]["report_count"] == 3
        assert rows[-1]["report_count"] == 1

        only_ugc = client.get(
            "/api/v1/cms/moderation/reports",
            params={"status": "open", "ugc_only": True},
            headers=headers,
        ).json()
        assert only_ugc["total"] == 3
        assert {r["target"]["id"] for r in only_ugc["items"]} == {ugc.id}
