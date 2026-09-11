"""Idempotent seeder.

Two clearly separated tiers (brief §40, §41):

* **Reference data** — permissions, roles, role_permissions, districts, mandals.
  Ships to every environment including production. Safe to re-run: it upserts.
* **Demo data** — staff accounts for local development. Written **only** when
  `--demo` is passed *and* APP_ENV is not production. Every demo account is
  marked with the `seed.` email prefix and a random password printed once, so a
  demo credential can never be mistaken for a real one.

Usage:
    python -m app.db.seed              # reference data only
    python -m app.db.seed --demo       # + development accounts
"""

from __future__ import annotations

import argparse
import secrets
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.permissions import (
    FORBIDDEN_PERMISSION_SUBSTRINGS,
    PERMISSIONS,
    ROLE_DEFINITIONS,
    ROLE_PERMISSIONS,
)
from app.core.security import hash_password
from app.db.seed_content import (
    CATEGORIES,
    DEMO_ARTICLES,
    seed_categories,
    seed_demo_articles,
    seed_tags,
)
from app.db.seed_data import AP_DISTRICTS, MANDALS, TS_DISTRICTS
from app.db.seed_media import seed_article_images
from app.db.base import utcnow
from app.db.session import session_scope
from app.models.content import Category
from app.models.enums import HomeSectionKind, RoleKey, ScopeType, UserStatus
from app.models.geo import District, Mandal, State
from app.models.site import HomepageSection
from app.models.user import Permission, Role, RolePermission, User, UserRole

logger = get_logger("seed")

DEMO_EMAIL_DOMAIN = "seed.example.com"


# --------------------------------------------------------------------------- #
# reference data
# --------------------------------------------------------------------------- #
def seed_permissions(db: Session) -> dict[str, Permission]:
    # §6.1: assert the forbidden keys really are absent before writing anything.
    for definition in PERMISSIONS:
        for banned in FORBIDDEN_PERMISSION_SUBSTRINGS:
            if banned in definition.key:
                raise RuntimeError(
                    f"Refusing to seed forbidden permission '{definition.key}'. "
                    "Nothing may publish without human approval (§0, §6.1)."
                )

    existing = {p.key: p for p in db.execute(select(Permission)).scalars()}
    for d in PERMISSIONS:
        perm = existing.get(d.key)
        if perm is None:
            perm = Permission(key=d.key)
            db.add(perm)
            existing[d.key] = perm
        perm.group = d.group
        perm.label_en = d.label_en
        perm.label_te = d.label_te
        perm.description = d.description or None
        perm.is_scoped = d.scoped
    db.flush()
    logger.info("seeded_permissions", count=len(existing))
    return existing


def seed_roles(db: Session, permissions: dict[str, Permission]) -> dict[str, Role]:
    existing = {r.key: r for r in db.execute(select(Role)).scalars()}

    for role_key, meta in ROLE_DEFINITIONS.items():
        role = existing.get(role_key.value)
        if role is None:
            role = Role(key=role_key.value)
            db.add(role)
            existing[role_key.value] = role
        role.label_te = str(meta["te"])
        role.label_en = str(meta["en"])
        role.level = int(meta["level"])  # type: ignore[arg-type]
        role.default_scope_type = meta["scope"]  # type: ignore[assignment]
        role.is_staff = bool(meta["staff"])
        role.is_system = True
    db.flush()

    # Rebuild the matrix so a permission removed from the catalogue is also
    # revoked from every role — otherwise a stale grant survives forever.
    for role_key, keys in ROLE_PERMISSIONS.items():
        role = existing[role_key.value]
        current = {rp.permission.key: rp for rp in role.permissions if rp.permission}
        for key in keys:
            if key not in permissions:
                raise RuntimeError(
                    f"Role {role_key} references unknown permission '{key}'"
                )
            if key not in current:
                db.add(
                    RolePermission(role_id=role.id, permission_id=permissions[key].id)
                )
        for key, rp in current.items():
            if key not in keys:
                db.delete(rp)
    db.flush()
    logger.info("seeded_roles", count=len(existing))
    return existing


#: (code, slug, name_te, name_en) — top of the §4 location hierarchy.
STATES: tuple[tuple[str, str, str, str], ...] = (
    ("AP", "andhra-pradesh", "ఆంధ్రప్రదేశ్", "Andhra Pradesh"),
    ("TS", "telangana", "తెలంగాణ", "Telangana"),
)


def seed_states(db: Session) -> dict[str, State]:
    existing = {s.code: s for s in db.execute(select(State)).scalars()}
    for sort, (code, slug, name_te, name_en) in enumerate(STATES):
        state = existing.get(code)
        if state is None:
            state = State(code=code)
            db.add(state)
            existing[code] = state
        state.slug = slug
        state.name_te = name_te
        state.name_en = name_en
        state.sort = sort
        state.is_active = True
    db.flush()
    logger.info("seeded_states", count=len(existing))
    return existing


def seed_homepage_sections(db: Session, categories: dict[str, "Category"]) -> int:
    """Create a default section row per nav category (updated doc §24).

    Insert-only: an admin's reordering/toggles survive every re-seed — the seed
    only backfills sections for categories that have none yet.
    """
    existing_keys = {s.key for s in db.execute(select(HomepageSection)).scalars()}
    next_sort = (
        max((s.sort for s in db.execute(select(HomepageSection)).scalars()), default=-1)
        + 1
    )
    created = 0
    # The §8 trending block leads the section list; the engine behind it fills
    # it once reader behaviour exists, and the block hides itself until then.
    if "trending" not in existing_keys:
        db.add(
            HomepageSection(
                key="trending",
                kind=HomeSectionKind.TRENDING,
                title_te="ట్రెండింగ్",
                title_en="Trending",
                sort=next_sort,
                is_enabled=True,
                item_count=6,
                min_items=3,
            )
        )
        next_sort += 1
        created += 1
    for cat in sorted(categories.values(), key=lambda c: c.sort):
        if not cat.show_in_nav or cat.slug in existing_keys:
            continue
        db.add(
            HomepageSection(
                key=cat.slug,
                kind=HomeSectionKind.CATEGORY,
                category_id=cat.id,
                sort=next_sort,
                is_enabled=True,
                item_count=7,
                min_items=3,
            )
        )
        next_sort += 1
        created += 1
    db.flush()
    logger.info("seeded_homepage_sections", created=created)
    return created


def seed_demo_events(db: Session) -> int:
    """Synthetic reader behaviour so trending and analytics have something to
    show in a fresh dev environment. Deterministic-ish, demo tier only.

    Re-seeds when the newest event has aged past the trending window: §8 decays
    engagement over 48 hours, so a dev database left alone for two days would
    otherwise show an empty Trending block — the engine working correctly, but
    looking broken. Real deployments get this from actual reader traffic.
    """
    import random

    from datetime import timedelta

    from app.models.content import Article
    from app.models.engagement import ArticleEvent
    from app.models.enums import ArticleStatus, EventType

    newest = db.execute(select(func.max(ArticleEvent.created_at))).scalar()
    if newest is not None and (utcnow() - newest) < timedelta(hours=12):
        return 0

    rng = random.Random(42)
    now = utcnow()
    articles = list(
        db.execute(
            select(Article).where(Article.status == ArticleStatus.PUBLISHED)
        ).scalars()
    )
    created = 0
    for index, article in enumerate(articles):
        # Newer demo stories draw more synthetic readers; a few go "viral".
        readers = rng.randint(3, 10) + (12 if index % 7 == 0 else 0)
        for reader in range(readers):
            anon = f"demo-{index}-{reader}"
            age = rng.uniform(0.5, 30.0)
            db.add(
                ArticleEvent(
                    article_id=article.id,
                    anon_id=anon,
                    event_type=EventType.VIEW,
                    created_at=now - timedelta(hours=age),
                )
            )
            created += 1
            if rng.random() < 0.5:
                db.add(
                    ArticleEvent(
                        article_id=article.id,
                        anon_id=anon,
                        event_type=EventType.READ,
                        value=rng.randint(20, 110),
                        created_at=now - timedelta(hours=age),
                    )
                )
                created += 1
            if rng.random() < 0.25:
                db.add(
                    ArticleEvent(
                        article_id=article.id,
                        anon_id=anon,
                        event_type=EventType.SHARE,
                        created_at=now - timedelta(hours=age),
                    )
                )
                article.share_count = (article.share_count or 0) + 1
                created += 1
        article.view_count = (article.view_count or 0) + readers
    db.flush()
    logger.info("seeded_demo_events", events=created)
    return created


#: (youtube_id, title_te, title_en, category_slug) — placeholder ids for the
#: demo library; production editors paste real newsroom links.
DEMO_VIDEOS: tuple[tuple[str, str, str, str], ...] = (
    (
        "dQw4w9WgXcQ",
        "అమరావతి పనుల డ్రోన్ దృశ్యాలు",
        "Amaravati works drone view",
        "andhra-pradesh",
    ),
    (
        "jNQXAC9IVRw",
        "హైదరాబాద్ మెట్రో రెండో దశ వివరణ",
        "Hyderabad Metro phase 2 explainer",
        "telangana",
    ),
    ("M7lc1UVf-VE", "ఈవారం సినీ విశేషాలు", "This week in cinema", "cinema"),
    ("ysz5S6PUM-U", "పోలవరం ప్రాజెక్టు క్షేత్రస్థాయి నివేదిక", "Polavaram ground report", "politics"),
)


def seed_demo_videos(db: Session) -> int:
    from app.models.content import Category
    from app.models.video import Video

    categories = {c.slug: c for c in db.execute(select(Category)).scalars()}
    existing = {v.youtube_id for v in db.execute(select(Video)).scalars()}
    created = 0
    for youtube_id, title_te, title_en, category_slug in DEMO_VIDEOS:
        if youtube_id in existing:
            continue
        category = categories.get(category_slug)
        db.add(
            Video(
                youtube_id=youtube_id,
                title_te=title_te,
                title_en=title_en,
                category_id=category.id if category else None,
                is_published=True,
                published_at=utcnow(),
            )
        )
        created += 1
    db.flush()
    logger.info("seeded_demo_videos", created=created)
    return created


def seed_districts(db: Session) -> dict[str, District]:
    existing = {d.slug: d for d in db.execute(select(District)).scalars()}
    for state, rows in (("AP", AP_DISTRICTS), ("TS", TS_DISTRICTS)):
        for sort, (slug, name_en, name_te) in enumerate(rows):
            district = existing.get(slug)
            if district is None:
                district = District(slug=slug)
                db.add(district)
                existing[slug] = district
            district.state = state
            district.name_en = name_en
            district.name_te = name_te
            district.sort = sort
            district.is_active = True
    db.flush()
    logger.info(
        "seeded_districts",
        ap=len(AP_DISTRICTS),
        ts=len(TS_DISTRICTS),
        total=len(existing),
    )
    return existing


def seed_mandals(
    db: Session, districts: dict[str, District]
) -> dict[tuple[str, str], Mandal]:
    existing = {
        (m.district.slug, m.slug): m
        for m in db.execute(select(Mandal)).scalars()
        if m.district is not None
    }
    for district_slug, rows in MANDALS.items():
        district = districts.get(district_slug)
        if district is None:
            continue
        for slug, name_en, name_te in rows:
            mandal = existing.get((district_slug, slug))
            if mandal is None:
                mandal = Mandal(district_id=district.id, slug=slug)
                db.add(mandal)
                existing[(district_slug, slug)] = mandal
            mandal.name_en = name_en
            mandal.name_te = name_te
            mandal.is_active = True
    db.flush()
    logger.info("seeded_mandals", count=len(existing))
    return existing


# --------------------------------------------------------------------------- #
# demo data — development only
# --------------------------------------------------------------------------- #
#: (local_part, name_te, name_en, role, scope_type, scope_slug, phone)
DEMO_STAFF: tuple[
    tuple[str, str, str, RoleKey, ScopeType, str | None, str | None], ...
] = (
    (
        "superadmin",
        "సూపర్ అడ్మిన్",
        "Super Admin",
        RoleKey.SUPER_ADMIN,
        ScopeType.GLOBAL,
        None,
        None,
    ),
    (
        "srinivas",
        "శ్రీనివాస్",
        "Srinivas",
        RoleKey.EDITOR_IN_CHIEF,
        ScopeType.GLOBAL,
        None,
        None,
    ),
    (
        "lakshmi",
        "లక్ష్మి దేవి",
        "Lakshmi Devi",
        RoleKey.DESK_EDITOR,
        ScopeType.DISTRICT,
        "visakhapatnam",
        None,
    ),
    ("kiran", "కిరణ్", "Kiran", RoleKey.SUB_EDITOR, ScopeType.GLOBAL, None, None),
    (
        "ravi",
        "రవి కుమార్",
        "Ravi Kumar",
        RoleKey.REPORTER,
        ScopeType.DISTRICT,
        "guntur",
        "919848000001",
    ),
    (
        "suresh",
        "సురేష్",
        "Suresh",
        RoleKey.REPORTER,
        ScopeType.DISTRICT,
        "srikakulam",
        "919848000002",
    ),
    (
        "anusha",
        "అనూష",
        "Anusha",
        RoleKey.STRINGER,
        ScopeType.MANDAL,
        "parvathipuram",
        "919848000003",
    ),
    (
        "durga",
        "దుర్గ",
        "Durga",
        RoleKey.STRINGER,
        ScopeType.MANDAL,
        "anakapalli-rural",
        "919848000004",
    ),
    (
        "dtp",
        "DTP ఆపరేటర్",
        "DTP Operator",
        RoleKey.DTP_OPERATOR,
        ScopeType.DISTRICT,
        "visakhapatnam",
        None,
    ),
    (
        "photo",
        "ఫోటో డెస్క్",
        "Photo Desk",
        RoleKey.PHOTO_VIDEO,
        ScopeType.GLOBAL,
        None,
        None,
    ),
)


def seed_demo_users(
    db: Session,
    roles: dict[str, Role],
    districts: dict[str, District],
    mandals: dict[tuple[str, str], Mandal],
    reset_passwords: bool = False,
) -> list[tuple[str, str]]:
    if settings.is_production:
        raise RuntimeError("Refusing to write demo accounts in production (brief §40)")

    mandal_by_slug = {slug: m for (_d, slug), m in mandals.items()}
    credentials: list[tuple[str, str]] = []

    for local, name_te, name_en, role_key, scope_type, scope_slug, phone in DEMO_STAFF:
        email = f"{local}@{DEMO_EMAIL_DOMAIN}"
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

        # Re-running the seed must not silently invalidate credentials a developer
        # already saved. A password is only minted for a new account, or when
        # --reset-passwords is passed explicitly.
        is_new = user is None
        rotate = is_new or reset_passwords or not (user and user.password_hash)
        password = secrets.token_urlsafe(12) if rotate else None

        if user is None:
            user = User(email=email, name_te=name_te, name_en=name_en)
            db.add(user)
        user.name_te = name_te
        user.name_en = name_en
        user.phone = phone
        if password is not None:
            user.password_hash = hash_password(password)
        user.status = UserStatus.ACTIVE
        # Demo accounts never get 2FA — it would make local development
        # unusable. That is exactly why they must not exist in production.
        user.two_factor_enabled = False
        user.is_author = role_key in {
            RoleKey.REPORTER,
            RoleKey.STRINGER,
            RoleKey.DESK_EDITOR,
        }
        user.author_slug = local if user.is_author else None
        user.designation_te = roles[role_key.value].label_te
        db.flush()

        scope_id: int | None = None
        if scope_type == ScopeType.DISTRICT and scope_slug:
            scope_id = districts[scope_slug].id
        elif scope_type == ScopeType.MANDAL and scope_slug:
            scope_id = mandal_by_slug[scope_slug].id

        role = roles[role_key.value]
        exists = db.execute(
            select(UserRole).where(
                UserRole.user_id == user.id,
                UserRole.role_id == role.id,
                UserRole.scope_type == scope_type,
                UserRole.scope_id.is_(scope_id)
                if scope_id is None
                else UserRole.scope_id == scope_id,
            )
        ).scalar_one_or_none()
        if exists is None:
            db.add(
                UserRole(
                    user_id=user.id,
                    role_id=role.id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                )
            )
        credentials.append((email, password or "(unchanged)"))

    db.flush()
    logger.info("seeded_demo_users", count=len(credentials))
    return credentials


# --------------------------------------------------------------------------- #
def run(include_demo: bool = False, reset_passwords: bool = False) -> None:
    configure_logging(settings.LOG_LEVEL, settings.LOG_JSON)
    with session_scope() as db:
        permissions = seed_permissions(db)
        roles = seed_roles(db, permissions)
        seed_states(db)
        districts = seed_districts(db)
        mandals = seed_mandals(db, districts)
        categories = seed_categories(db)
        seed_homepage_sections(db, categories)
        tags = seed_tags(db)

        credentials: list[tuple[str, str]] = []
        demo_articles = 0
        demo_images = 0
        if include_demo:
            credentials = seed_demo_users(
                db, roles, districts, mandals, reset_passwords
            )
            demo_articles = seed_demo_articles(db, categories, tags)
            demo_images = seed_article_images(db)
            seed_demo_events(db)
            # English headlines so the reader's English mode is testable end to
            # end (§16 item 3 decided Telugu + English).
            from app.models.content import Article as _Article
            from scripts.set_english_titles import ENGLISH_TITLES

            for short_id, title_en in ENGLISH_TITLES.items():
                article = db.execute(
                    select(_Article).where(_Article.short_id == short_id)
                ).scalar_one_or_none()
                if article is not None and not article.title_en:
                    article.title_en = title_en
            seed_demo_videos(db)

    print("\nReference data seeded:")
    print(f"  permissions {len(PERMISSIONS)}   roles {len(ROLE_DEFINITIONS)}")
    print(f"  districts   {len(AP_DISTRICTS)} AP + {len(TS_DISTRICTS)} TS")
    print(f"  categories  {len(CATEGORIES)}")
    if include_demo:
        print(
            f"  demo articles written this run: {demo_articles} (of {len(DEMO_ARTICLES)})"
        )
        print(f"  demo hero images generated:     {demo_images}")

    if credentials:
        print("\n" + "=" * 66)
        print("DEVELOPMENT ACCOUNTS — shown once, not stored anywhere in plaintext.")
        print("These are seed accounts. They must never exist in production.")
        print("=" * 66)
        for email, password in credentials:
            print(f"  {email:34s}  {password}")
        print("=" * 66 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed reference and development data")
    parser.add_argument(
        "--demo", action="store_true", help="also create development staff accounts"
    )
    parser.add_argument(
        "--reset-passwords",
        action="store_true",
        help="mint new passwords for existing demo accounts (implies --demo)",
    )
    args = parser.parse_args()
    if args.reset_passwords:
        args.demo = True
    if args.demo and settings.is_production:
        print(
            "Refusing: --demo cannot be used with APP_ENV=production", file=sys.stderr
        )
        raise SystemExit(2)
    run(include_demo=args.demo, reset_passwords=args.reset_passwords)
