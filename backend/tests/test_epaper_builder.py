"""The e-paper builder: slot layouts, the fitting recommender, editing, PDF.

Service-level, on an in-memory SQLite. The HTTP surface is in
`test_epaper_api.py`. Nothing here draws Telugu for real — the dev host has no
Raqm — so the PDF tests stub the renderer and assert the asset bookkeeping.
"""

from __future__ import annotations

import itertools
from datetime import datetime
from types import SimpleNamespace
from typing import get_args

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.errors import ConflictError, ValidationError
from app.db.base import Base, utcnow
from app.db.seed_content import CATEGORIES, seed_categories
from app.models.content import Article, Category
from app.models.enums import ArticleStatus, WorkflowState
from app.models.epaper import (
    EpaperAsset,
    EpaperEdition,
    EpaperPageArticle,
    EpaperUserEdition,
    EpaperUserEditionPreference,
)
from app.models.media import Media
from app.schemas.epaper import LayoutType, SlotOut
from app.services import epaper_pdf, epaper_service, settings_service
from app.services.epaper_layouts import (
    GRID_COLS,
    GRID_ROWS,
    LAYOUTS,
    SIZE_RANK,
    size_class,
    slot_count,
    slots_for,
)

_seq = itertools.count(1)


@pytest.fixture()
def db() -> Session:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    seed_categories(session)
    session.commit()
    settings_service.invalidate()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        settings_service.invalidate()


def today():  # type: ignore[no-untyped-def]
    return datetime.now(epaper_service.IST).date()


def category_id(db: Session, slug: str) -> int:
    return db.scalar(select(Category.id).where(Category.slug == slug))


def media(db: Session) -> Media:
    row = Media(
        filename="hero.jpg",
        mime="image/jpeg",
        storage_key=f"hero-{next(_seq)}.jpg",
        cdn_url="https://cdn.example/hero.jpg",
    )
    db.add(row)
    db.flush()
    return row


def story(
    db: Session,
    *,
    words: int = 100,
    hero: bool = False,
    category: str | None = None,
    breaking: bool = False,
    featured: bool = False,
    views: int = 0,
    status: ArticleStatus = ArticleStatus.PUBLISHED,
    title: str | None = None,
) -> Article:
    n = next(_seq)
    row = Article(
        short_id=f"s{n:05d}",
        slug=f"story-{n}",
        title_te=title or f"వార్త {n}",
        summary_te="ఇది కథనం సారాంశం. " * 3,
        word_count=words,
        hero_media_id=media(db).id if hero else None,
        category_id=category_id(db, category) if category else None,
        is_breaking=breaking,
        is_featured=featured,
        view_count=views,
        status=status,
        workflow_state=(
            WorkflowState.PUBLISHED
            if status == ArticleStatus.PUBLISHED
            else WorkflowState.DRAFT
        ),
        published_at=utcnow() if status == ArticleStatus.PUBLISHED else None,
    )
    db.add(row)
    db.flush()
    return row


def stories(db: Session, n: int, **kw) -> list[Article]:  # type: ignore[no-untyped-def]
    return [story(db, **kw) for _ in range(n)]


def show_only(db: Session, *slugs: str) -> None:
    for template in epaper_service.ensure_templates(db):
        template.is_visible = template.slug in slugs
    db.flush()


def links(edition: EpaperEdition) -> list[EpaperPageArticle]:
    return [link for page in edition.pages for link in page.articles]


# ------------------------------------------------------------------ layouts --
def test_layouts_within_grid_no_overlap_full_area() -> None:
    assert set(LAYOUTS) == set(get_args(LayoutType))
    for name, slots in LAYOUTS.items():
        cells: set[tuple[int, int]] = set()
        for slot in slots:
            assert slot.size in SIZE_RANK
            assert 0 <= slot.x and slot.x + slot.w <= GRID_COLS
            assert 0 <= slot.y and slot.y + slot.h <= GRID_ROWS
            own = {(x, y) for x in range(slot.x, slot.x + slot.w) for y in range(slot.y, slot.y + slot.h)}
            assert not (own & cells), f"{name}: overlapping slot {slot}"
            cells |= own
        assert len(cells) == (30 if name == "breaking" else 36), name


def test_size_class_thresholds() -> None:
    def article(**kw):  # type: ignore[no-untyped-def]
        base = dict(word_count=0, body_plain="", hero_media_id=None, is_breaking=False)
        return SimpleNamespace(**{**base, **kw})

    assert size_class(article(word_count=59)) == "brief"
    assert size_class(article(word_count=60)) == "standard"
    assert size_class(article(word_count=149, hero_media_id=1)) == "standard"
    assert size_class(article(word_count=150, hero_media_id=1)) == "lead"
    assert size_class(article(word_count=10, hero_media_id=1, is_breaking=True)) == "lead"
    assert size_class(article(word_count=0, body_plain="పదం " * 70)) == "standard"


# --------------------------------------------------------------- generation --
def test_generate_daily_page_count_exact_and_full(db: Session) -> None:
    stories(db, 15, words=200, hero=True)
    stories(db, 25, words=100)
    stories(db, 20, words=30)
    edition = epaper_service.generate_daily(db, today(), page_count=3)
    assert [p.page_number for p in edition.pages] == [1, 2, 3]
    front = next(t for t in epaper_service.ensure_templates(db) if t.slug == "front-page")
    assert edition.pages[0].template_id == front.id
    ids = [link.article_id for link in links(edition)]
    assert len(ids) == len(set(ids))
    for page in edition.pages:
        slots = slots_for(page.layout_type)
        assert len(page.articles) == len(slots)
        for link in page.articles:
            assert link.display_type == slots[link.position - 1].size


def test_page_count_defaults_from_setting_and_clamps(db: Session) -> None:
    stories(db, 5)
    settings_service.set_many(db, {"epaper.page_count": 2}, actor_id=None)
    edition = epaper_service.generate_daily(db, today())
    assert len(edition.pages) == 2
    edition = epaper_service.generate_daily(db, today(), regenerate=True, page_count=99)
    assert len(edition.pages) == 24


def test_overflow_pages_after_sections(db: Session) -> None:
    stories(db, 30)
    show_only(db, "front-page")
    edition = epaper_service.generate_daily(db, today(), page_count=3)
    assert edition.pages[0].template_id is not None
    for page in edition.pages[1:]:
        assert page.template_id is None
        assert page.title == epaper_service.OVERFLOW_TITLE
        assert page.layout_type == epaper_service.OVERFLOW_LAYOUT
        assert page.articles


def test_section_first_then_filler_and_size_fit(db: Session) -> None:
    show_only(db, "front-page", "sports")
    story(db, words=300, hero=True, category="national", views=1000)
    nationals = stories(db, 30, words=100, category="national", views=100)
    sports_lead = story(db, words=200, hero=True, category="sports")
    sports_briefs = stories(db, 2, words=30, category="sports")
    edition = epaper_service.generate_daily(db, today(), page_count=2)
    sports_page = edition.pages[1]
    assert sports_page.layout_type == "image_lead"
    placed = {link.position: link.article_id for link in sports_page.articles}
    assert placed[1] == sports_lead.id
    assert {sports_lead.id, *(s.id for s in sports_briefs)} <= set(placed.values())
    assert len(placed) == slot_count("image_lead")
    filler = set(placed.values()) - {sports_lead.id, *(s.id for s in sports_briefs)}
    assert filler <= {n.id for n in nationals}


def test_short_day_leaves_slots_empty_without_duplicates(db: Session) -> None:
    stories(db, 5)
    edition = epaper_service.generate_daily(db, today(), page_count=2)
    ids = [link.article_id for link in links(edition)]
    assert len(ids) == 5 and len(set(ids)) == 5


def test_regenerate_keeps_page_count_and_refuses_personal(db: Session) -> None:
    stories(db, 12)
    edition = epaper_service.generate_daily(db, today(), page_count=3)
    edition = epaper_service.regenerate(db, edition, None)
    assert len(edition.pages) == 3 and edition.revision == 2
    personal = EpaperEdition(
        title="mine", edition_date=today(), edition_type="PERSONAL_1", owner_user_id=1
    )
    db.add(personal)
    db.flush()
    with pytest.raises(ConflictError):
        epaper_service.regenerate(db, personal, None)
    with pytest.raises(ConflictError):
        epaper_service.withdraw(db, personal, 1)


def test_plan_preview(db: Session) -> None:
    stories(db, 20, category="sports")
    plan = epaper_service.plan_preview(db, today())
    assert plan.candidates == 20
    assert plan.suggested_page_count == 3
    assert plan.default_page_count == 8
    by_slug = {t.slug: t for t in plan.per_template}
    assert by_slug["front-page"].available == 20
    assert by_slug["sports"].available == 20
    assert by_slug["national"].available == 0
    assert by_slug["sports"].slot_count == slot_count("image_lead")


def test_default_templates_reference_seeded_categories(db: Session) -> None:
    seeded = {slug for slug, *_ in CATEGORIES}
    for slug, _te, _en, category_slugs, layout in epaper_service.DEFAULT_TEMPLATES:
        assert set(category_slugs) <= seeded, slug
        assert layout in LAYOUTS
    for template in epaper_service.ensure_templates(db):
        if template.slug not in {"front-page", "big-question"}:
            assert template.category_ids, template.slug


# --------------------------------------------------------------- candidates --
def test_candidates_exclude_placed_filter_q_and_section(db: Session) -> None:
    show_only(db, "front-page", "sports")
    stories(db, 10, category="national", views=10)
    stories(db, 9, category="sports", views=5)
    special = story(db, category="sports", title="క్రికెట్ ఫైనల్ విజయం")
    edition = epaper_service.generate_daily(db, today(), page_count=1)
    placed = {link.article_id for link in links(edition)}
    assert len(placed) == 9
    rows = epaper_service.candidates(db, edition)
    assert len(rows) == 11 and not ({r.id for r in rows} & placed)
    assert [r.id for r in epaper_service.candidates(db, edition, q="క్రికెట్")] == [special.id]
    sports = next(t for t in epaper_service.ensure_templates(db) if t.slug == "sports")
    page = epaper_service.add_page(
        db, edition, epaper_service.PageCreateIn(template_id=sports.id)
    )
    rows = epaper_service.candidates(db, edition, page=page)
    flags = [r.in_section for r in rows]
    assert flags == sorted(flags, reverse=True) and True in flags and False in flags


def test_fill_page_only_empties_vs_reset(db: Session) -> None:
    stories(db, 20)
    edition = epaper_service.generate_daily(db, today(), page_count=1)
    page = edition.pages[0]
    before = {link.position: link.article_id for link in page.articles}
    ids: list[int | None] = [before[i + 1] for i in range(9)]
    ids[1] = None
    ids[4] = None
    epaper_service.update_page(db, page, {"article_ids": ids})
    assert len(page.articles) == 7
    epaper_service.fill_page(db, page)
    after = {link.position: link.article_id for link in page.articles}
    assert len(after) == 9
    for position in (1, 3, 4, 6, 7, 8, 9):
        assert after[position] == before[position]
    assert len(set(after.values())) == 9  # the two freed slots got the best unused stories back
    epaper_service.fill_page(db, page, reset=True)
    assert len(page.articles) == 9


# ------------------------------------------------------------------ editing --
def test_update_page_aligned_slots_and_validation(db: Session) -> None:
    a, b, c = stories(db, 3)
    draft = story(db, status=ArticleStatus.DRAFT)
    edition = epaper_service.generate_daily(db, today(), page_count=2)
    page, other = edition.pages[0], edition.pages[1]
    epaper_service.update_page(db, other, {"article_ids": []})
    epaper_service.update_page(db, page, {"article_ids": [a.id, None, b.id]})
    assert {link.position: link.article_id for link in page.articles} == {1: a.id, 3: b.id}
    assert page.articles[0].display_type == "lead"
    with pytest.raises(ValidationError):
        epaper_service.update_page(db, page, {"article_ids": [a.id, a.id]})
    with pytest.raises(ValidationError):
        epaper_service.update_page(db, page, {"article_ids": [draft.id]})
    with pytest.raises(ValidationError):
        epaper_service.update_page(db, page, {"article_ids": [None] * 10})
    epaper_service.update_page(db, other, {"article_ids": [c.id]})
    with pytest.raises(ValidationError):
        epaper_service.update_page(db, page, {"article_ids": [c.id]})


def test_update_page_preserves_poll_when_omitted(db: Session) -> None:
    stories(db, 3)
    edition = epaper_service.generate_daily(db, today(), page_count=1)
    page = edition.pages[0]
    epaper_service.update_page(db, page, {"poll_id": 5})
    epaper_service.update_page(db, page, {"title": "కొత్త పేరు"})
    assert page.poll_id == 5 and page.title == "కొత్త పేరు"
    epaper_service.update_page(db, page, {"poll_id": None})
    assert page.poll_id is None


def test_layout_change_truncates_and_resizes(db: Session) -> None:
    stories(db, 12)
    edition = epaper_service.generate_daily(db, today(), page_count=1)
    page = edition.pages[0]
    assert len(page.articles) == 9
    epaper_service.update_page(db, page, {"layout_type": "breaking"})
    assert [link.display_type for link in page.articles] == ["lead", "standard", "standard", "standard"]


def test_every_mutation_bumps_revision(db: Session) -> None:
    stories(db, 12)
    edition = epaper_service.generate_daily(db, today(), page_count=2)
    page = edition.pages[0]
    revision = edition.revision
    for changes in ({"title": "మొదటి"}, {"layout_type": "two_column"}, {"poll_id": 3}, {"article_ids": []}):
        epaper_service.update_page(db, page, changes)
        revision += 1
        assert edition.revision == revision
    epaper_service.fill_page(db, page)
    assert edition.revision == revision + 1
    added = epaper_service.add_page(db, edition, epaper_service.PageCreateIn(title="అదనం"))
    assert edition.revision == revision + 2 and added.page_number == 3
    epaper_service.order_pages(db, edition, [added.id, page.id, edition.pages[1].id])
    assert edition.revision == revision + 3
    epaper_service.delete_page(db, edition, added.id)
    assert edition.revision == revision + 4
    assert sorted(p.page_number for p in edition.pages) == [1, 2]


# ----------------------------------------------------------------- workflow --
def test_submit_and_withdraw_transitions(db: Session) -> None:
    stories(db, 3)
    edition = epaper_service.generate_daily(db, today(), page_count=1)
    with pytest.raises(ConflictError):
        epaper_service.withdraw(db, edition, 1)
    epaper_service.submit(db, edition, 1)
    assert edition.status == "UNDER_REVIEW"
    with pytest.raises(ConflictError):
        epaper_service.submit(db, edition, 1)
    epaper_service.approve(db, edition, 1)
    epaper_service.publish(db, edition, 1)
    revision = edition.revision
    epaper_service.withdraw(db, edition, 1)
    assert edition.status == "GENERATED"
    assert edition.approved_by is None and edition.approved_at is None
    assert edition.published_at is None and edition.revision == revision + 1
    assert all(page.status == "GENERATED" for page in edition.pages)


def test_personal_edition_respects_slots(db: Session) -> None:
    stories(db, 12, category="sports")
    saved = EpaperUserEdition(user_id=1, name="నా పేపర్")
    saved.preferences = [
        EpaperUserEditionPreference(
            preference_type="category", target_id=category_id(db, "sports"), priority=0
        )
    ]
    db.add(saved)
    db.flush()
    edition = epaper_service.generate_personal(db, saved, today())
    first = edition.pages[0]
    assert 0 < len(first.articles) <= slot_count("lead_grid")
    slots = slots_for("lead_grid")
    for link in first.articles:
        assert link.display_type == slots[link.position - 1].size


# ---------------------------------------------------------------------- PDF --
class _Stored:
    def __init__(self, url: str) -> None:
        self.url = url


class _Storage:
    def __init__(self) -> None:
        self.keys: list[str] = []

    def put(self, key: str, raw: bytes, **_kw):  # type: ignore[no-untyped-def]
        self.keys.append(key)
        return _Stored(f"https://cdn.example/{key}")


def test_generate_pdf_failed_without_shaping_then_retry_reuses_row(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    stories(db, 3)
    edition = epaper_service.generate_daily(db, today(), page_count=1)
    with pytest.raises(ConflictError):
        epaper_service.generate_pdf(db, edition)
    epaper_service.approve(db, edition, 1)
    monkeypatch.setattr(epaper_service, "telugu_shaping_available", lambda: False)
    failed = epaper_service.generate_pdf(db, edition)
    assert failed.status == "FAILED" and "libfribidi0" in (failed.error or "")
    assert db.scalar(select(EpaperAsset.id).where(EpaperAsset.edition_id == edition.id)) == failed.id
    assert epaper_service.serialize(db, edition).pdf_status == "FAILED"

    storage = _Storage()
    monkeypatch.setattr(epaper_service, "telugu_shaping_available", lambda: True)
    monkeypatch.setattr(epaper_pdf, "render_edition", lambda _e, images=True: b"%PDF-1.4 x")
    monkeypatch.setattr(epaper_service, "get_storage", lambda: storage)
    ready = epaper_service.generate_pdf(db, edition)
    assert ready.id == failed.id and ready.status == "READY" and ready.error is None
    assert len(db.scalars(select(EpaperAsset).where(EpaperAsset.edition_id == edition.id)).all()) == 1
    out = epaper_service.serialize(db, edition)
    assert out.pdf_url == ready.public_url and out.pdf_status == "READY"
    assert storage.keys == [f"epaper/{edition.edition_date.isoformat()}/edition-r{edition.revision}.pdf"]
    assert epaper_service.generate_pdf(db, edition) is ready


def test_render_edition_assembles_pdf(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    from PIL import Image

    stories(db, 6)
    edition = epaper_service.serialize(db, epaper_service.generate_daily(db, today(), page_count=2))
    monkeypatch.setattr(epaper_pdf, "render_page", lambda _e, _p, images=True: Image.new("RGB", (60, 80)))
    raw = epaper_pdf.render_edition(edition)
    assert raw.startswith(b"%PDF") and b"/Count 2" in raw
    x0, y0, x1, y1 = epaper_pdf.content_box()
    for page in edition.pages:
        boxes = [epaper_pdf.slot_box(slot) for slot in page.slots]
        for a in boxes:
            assert x0 <= a[0] < a[2] <= x1 and y0 <= a[1] < a[3] <= y1
        for i, a in enumerate(boxes):
            for b in boxes[i + 1 :]:
                assert a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]
    strip = SlotOut(index=-1, x=0, y=GRID_ROWS - 1, w=GRID_COLS, h=1, size="brief")
    assert epaper_pdf.slot_box(strip)[3] <= y1
