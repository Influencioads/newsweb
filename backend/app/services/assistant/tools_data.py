"""Read-only tools: analytics, queues, lookups. See registry.py for the contract.

Every tool answers a question the staff member could already answer by hand in
the CMS, behind the same permission and the same district scope as that
screen, so asking Sanjaya never shows anyone more than their own dashboard
would. Nothing here writes, except `trending_now`, which may recompute the
trending table exactly as `GET /cms/trending` does.

Rules every query follows (see CONTRACT.md): bounded by a window and a LIMIT,
portable to SQLite and MySQL (days are bucketed in Python, IST where we say
"day" about publishing, UTC where the data itself is UTC), seeded engagement
excluded, deleted stories excluded, and no reader identifier or free text a
reader typed ever leaves this module. Each result says which window and which
clock it used, so the model can say it too.

`resolve_category` / `resolve_district` are the one place a name the model
typed ("Guntur", "గుంటూరు", "politics", 7) becomes a row; the action tools use
them as well.
"""

from __future__ import annotations

import json
import re
import statistics
from collections import Counter
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.orm import Session

from app.api.v1.cms_dashboard import dashboard_stats
from app.core.deps import Principal
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from app.db.base import utcnow
from app.models.ai import AiUsage
from app.models.audio import AudioAsset
from app.models.bulletin import AudioBulletin
from app.models.content import Article, Category, WorkflowTransition
from app.models.creator import AdCampaign
from app.models.engagement import (
    ArticleEvent,
    Bookmark,
    Comment,
    Follow,
    Like,
    Reaction,
    ReadingSession,
    Report,
)
from app.models.enums import (
    ArticleStatus,
    ArticleType,
    AudioStatus,
    CommentStatus,
    EventType,
    WorkflowState,
)
from app.models.epaper import EpaperEdition, EpaperPageShare
from app.models.geo import District, Mandal
from app.models.ingestion import ContentSource
from app.models.kyc import ContributorProfile
from app.models.notify import NotificationCampaign
from app.models.poll import Poll, PollOption, PollVote
from app.models.user import Role, User, UserRole
from app.models.video import Video
from app.repositories import discovery_repo
from app.services import (
    ai_usage_service,
    analytics_service,
    bulletin_service,
    crawl_service,
    notification_service,
    trending_service,
    tts_service,
    workflow_service,
)
from app.services.assistant.registry import ToolContext, tool
from app.services.epaper_service import IST

#: Hard ceiling on rows pulled into Python for day bucketing.
# ponytail: a busy month of ai_usage fits; move bucketing into SQL per dialect
# if a window ever holds more than this.
_BUCKET_ROWS = 50_000


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def _plain(o: Any) -> Any:
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    return str(o)


def _tool(name: str, description: str, parameters: dict | None = None, **kw: Any):
    """`registry.tool`, plus a JSON round-trip of the result.

    Cards are stored in a JSON column and results go to the model as JSON, so a
    stray datetime, Decimal (MySQL SUM) or enum must become plain data here
    rather than fail the turn's commit later.
    """

    def deco(fn):
        def run(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
            return json.loads(
                json.dumps(fn(ctx, args), ensure_ascii=False, default=_plain)
            )

        tool(name, description, parameters, **kw)(run)
        return fn

    return deco


_URL_SECRET = re.compile(
    r"([?&](?:key|api_key|apikey|token|access_token|sig|signature)=)[^&'\"\s]+", re.I
)


def _clip(text: str | None, n: int) -> str | None:
    """A stored provider error, masked then clipped. httpx error strings carry
    the full request URL, and Google TTS sends its key as `?key=` — the raw
    text would hand the key to the model vendor and the transcript."""
    return _URL_SECRET.sub(r"\1***", text or "")[:n] or None


def _t(te: str, en: str) -> dict[str, str]:
    return {"te": te, "en": en}


def _v(x: Any) -> Any:
    """Enum → its value (grouped enum columns come back as members)."""
    return getattr(x, "value", x)


def _int(args: dict[str, Any], key: str, default: int, lo: int, hi: int) -> int:
    """A bounded integer argument. Out of range is clamped, not refused: the
    model asking for 365 days of something capped at 90 should get 90."""
    raw = args.get(key)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError(
            f"{key} must be a whole number.", f"{key} పూర్ణ సంఖ్య కావాలి."
        ) from None
    return max(lo, min(hi, value))


def _choice(
    args: dict[str, Any], key: str, options: tuple[str, ...], default: str | None
) -> str | None:
    raw = args.get(key)
    if raw is None or raw == "":
        return default
    value = str(raw).strip()
    if value not in options:
        raise ValidationError(
            f"{key} must be one of: {', '.join(options)}.",
            f"{key} వీటిలో ఒకటి కావాలి: {', '.join(options)}.",
        )
    return value


def _days_param(default: int, lo: int = 1, hi: int = 90) -> dict[str, Any]:
    return {
        "type": "integer",
        "minimum": lo,
        "maximum": hi,
        "default": default,
        "description": f"Window length in days, counted back from now ({lo}-{hi}).",
    }


def _rolling(days: int) -> str:
    return f"last {days} days, rolling from now (UTC)"


def _ist_day(dt: datetime) -> date:
    return dt.astimezone(IST).date()


def _ist_today() -> date:
    return _ist_day(utcnow())


def _stats(title: dict | str, items: list[tuple[Any, Any]]) -> dict[str, Any]:
    return {
        "type": "stats",
        "title": title,
        "items": [{"label": label, "value": value} for label, value in items],
    }


def _table(
    title: dict | str, columns: list[tuple[str, Any, str]], rows: list[dict]
) -> dict:
    return {
        "type": "table",
        "title": title,
        "columns": [
            {"key": k, "label": label, "align": align} for k, label, align in columns
        ],
        "rows": [{k: r.get(k) for k, _l, _a in columns} for r in rows],
    }


def _articles_card(title: dict | str, rows: list[dict]) -> dict[str, Any]:
    return {
        "type": "articles",
        "title": title,
        "items": [
            {
                "id": r["id"],
                "short_id": r["short_id"],
                "title": r["title"],
                "workflow_state": r.get("state") or "PUBLISHED",
                **({"note": r["note"]} if r.get("note") else {}),
            }
            for r in rows
        ],
    }


def _names(db: Session, ids) -> dict[int, str]:
    """Staff display names. Never email or phone."""
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {
        i: en or te
        for i, en, te in db.execute(
            select(User.id, User.name_en, User.name_te).where(User.id.in_(ids))
        )
    }


def _district_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(
        db.execute(
            select(District.id, District.name_en).where(District.id.in_(ids))
        ).all()
    )


def _scope(p: Principal) -> list[Any]:
    """The clause every CMS article list applies: live rows, and a user who is
    not global sees their own districts only (cms_articles.list_articles)."""
    out: list[Any] = [Article.deleted_at.is_(None)]
    if not p.is_global:
        out.append(Article.district_id.in_(p.district_ids))
    return out


def _scope_note(p: Principal) -> str:
    return "all districts" if p.is_global else "only the districts you are assigned to"


def _row(a: Article, districts: dict[int, str]) -> dict[str, Any]:
    return {
        "id": a.id,
        "short_id": a.short_id,
        "title": a.title_te,
        "state": _v(a.workflow_state),
        "category": a.category.name_en if a.category else None,
        "district": districts.get(a.district_id),
        "published_at": a.published_at,
        "view_count": int(a.view_count or 0),
        "url_path": a.url_path,
    }


def _resolve(db: Session, model, value: str | int | None):
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return db.get(model, int(text))
    low = text.lower()
    return db.scalars(
        select(model)
        .where(
            or_(
                func.lower(model.slug) == low,
                func.lower(model.name_en) == low,
                model.name_te == text,
            )
        )
        .order_by(model.id)
        .limit(1)
    ).first()


def resolve_category(db: Session, value: str | int | None) -> Category | None:
    """A category by id, slug, English or Telugu name (case-insensitive)."""
    return _resolve(db, Category, value)


def resolve_district(db: Session, value: str | int | None) -> District | None:
    """A district by id, slug, English or Telugu name (case-insensitive)."""
    return _resolve(db, District, value)


def _need(row, value: Any, what: str):
    """A filter the model asked for that matches nothing is an error, not a
    silently unfiltered answer."""
    if value not in (None, "") and row is None:
        raise ValidationError(
            f"No {what} matches {value!r}. Use taxonomy_lookup to find it.",
            f"{value!r} అనే {what} కనిపించలేదు. taxonomy_lookup తో వెతకండి.",
        )
    return row


def _category_filter(db: Session, args: dict[str, Any]) -> list[Any]:
    out: list[Any] = []
    cat = _need(
        resolve_category(db, args.get("category")), args.get("category"), "category"
    )
    if cat is not None:
        out.append(or_(Article.category_id == cat.id, Article.subcategory_id == cat.id))
    dist = _need(
        resolve_district(db, args.get("district")), args.get("district"), "district"
    )
    if dist is not None:
        out.append(Article.district_id == dist.id)
    return out


_CATEGORY_ARG = {
    "type": "string",
    "description": "Category id, slug, or English/Telugu name.",
}
_DISTRICT_ARG = {
    "type": "string",
    "description": "District id, slug, or English/Telugu name.",
}


# --------------------------------------------------------------------------- #
# Newsroom state
# --------------------------------------------------------------------------- #
_OVERVIEW = (
    ("pending_review", "సమీక్షకు వేచి ఉన్నవి", "Awaiting review"),
    ("published_today", "ఈరోజు ప్రచురితం", "Published today"),
    ("drafts", "డ్రాఫ్ట్‌లు", "Drafts"),
    ("approved", "ఆమోదించినవి", "Approved"),
    ("scheduled", "షెడ్యూల్", "Scheduled"),
    ("returned_for_changes", "మార్పులకు తిరిగి", "Returned for changes"),
    ("breaking_live", "బ్రేకింగ్ లైవ్", "Breaking live"),
    ("views_today", "ఈరోజు వీక్షణలు", "Views today"),
    ("active_users_7d", "7 రోజుల యాక్టివ్ యూజర్లు", "Active users (7d)"),
    ("submissions_pending", "పాఠకుల సమర్పణలు", "Reader submissions"),
    ("ai_drafts_pending", "AI డ్రాఫ్ట్‌లు", "AI drafts pending"),
)


@_tool(
    "newsroom_overview",
    "The newsroom dashboard right now: stories awaiting review, drafts, approved, scheduled, "
    "published today, breaking live, returned for changes, views today, active signed-in users "
    "(7d), pending reader submissions and AI drafts, and the categories/districts/mandals that "
    "published most in the last 7 days. Use it for 'how are we doing today' or 'what is in the "
    "queue'. Article counts are limited to the user's districts unless they are global.",
    any_of=("dashboard.view", "article.review"),
    label=("న్యూస్‌రూమ్ స్థితి", "Newsroom overview"),
)
def newsroom_overview(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    s = dashboard_stats(db=ctx.db, principal=ctx.principal).model_dump()
    return {
        **s,
        "window": "published_today and views_today since 00:00 UTC today; top_* = published "
        "in the last 7 days rolling; views_today counts raw view events (not unique readers)",
        "scope": _scope_note(ctx.principal)
        + " for article counts; users, views, submissions and AI counts are newsroom-wide",
        "cards": [
            _stats(
                _t("న్యూస్‌రూమ్ ఇప్పుడు", "Newsroom now"),
                [(_t(te, en), s[k]) for k, te, en in _OVERVIEW],
            ),
            {
                "type": "bars",
                "title": _t(
                    "7 రోజుల్లో ఎక్కువ ప్రచురించిన విభాగాలు", "Most published categories (7d)"
                ),
                "items": [
                    {"label": _t(r["name_te"], r["name_en"]), "value": r["count"]}
                    for r in s["top_categories"]
                ],
            },
        ],
    }


@_tool(
    "content_inventory",
    "What content the site holds: articles by workflow state, articles created in the last 30 "
    "days by type (NORMAL/REPORTER/AI_DRAFT/...), published articles by category (top 10), "
    "published videos, active polls, e-paper editions of the last 7 days by status, and article "
    "audio (ready/failed) — each of those only if the user may open that platform_stats "
    "section. Article counts are limited to the user's districts unless global.",
    permissions=("dashboard.view",),
    label=("కంటెంట్ నిల్వ", "Content inventory"),
)
def content_inventory(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db, scope, now = ctx.db, _scope(ctx.principal), utcnow()
    by_state = {
        _v(s): int(n)
        for s, n in db.execute(
            select(Article.workflow_state, func.count(Article.id))
            .where(*scope)
            .group_by(Article.workflow_state)
        )
    }
    by_type = {
        _v(t): int(n)
        for t, n in db.execute(
            select(Article.article_type, func.count(Article.id))
            .where(*scope, Article.created_at >= now - timedelta(days=30))
            .group_by(Article.article_type)
        )
    }
    by_category = [
        {"category": en, "category_te": te, "published": int(n)}
        for te, en, n in db.execute(
            select(Category.name_te, Category.name_en, func.count(Article.id))
            .join(Article, Article.category_id == Category.id)
            .where(*scope, Article.status == ArticleStatus.PUBLISHED)
            .group_by(Category.id, Category.name_te, Category.name_en)
            .order_by(func.count(Article.id).desc())
            .limit(10)
        )
    ]
    # Beyond articles, each block only for a user who could open that
    # platform_stats section: dashboard.view alone must not widen into
    # e-paper, audio or video numbers the same user is refused there.
    p, more, other = ctx.principal, {}, []
    if _may(p, "videos"):
        videos = int(
            db.scalar(
                select(func.count(Video.id)).where(
                    Video.deleted_at.is_(None), Video.is_published.is_(True)
                )
            )
            or 0
        )
        more["videos_published"] = videos
        other.append((_t("వీడియోలు", "Videos published"), videos))
    if _may(p, "polls"):
        polls = int(
            db.scalar(
                select(func.count(Poll.id)).where(
                    Poll.status == "ACTIVE", Poll.start_time <= now, Poll.end_time > now
                )
            )
            or 0
        )
        more["active_polls"] = polls
        other.append((_t("యాక్టివ్ పోల్స్", "Active polls"), polls))
    if _may(p, "epaper"):
        editions = _count_by(
            db,
            EpaperEdition.status,
            EpaperEdition.edition_date >= _ist_today() - timedelta(days=6),
        )
        more["epaper_editions_7d_by_status"] = editions
        other.append(
            (_t("ఈ-పేపర్ (7 రోజులు)", "E-paper editions (7d)"), sum(editions.values()))
        )
    if _may(p, "audio"):
        audio = _count_by(
            db,
            AudioAsset.status,
            AudioAsset.status.in_([AudioStatus.READY, AudioStatus.FAILED]),
        )
        more["article_audio"] = {
            "ready": audio.get("ready", 0),
            "failed": audio.get("failed", 0),
        }
        other += [
            (_t("ఆడియో సిద్ధం", "Audio ready"), audio.get("ready", 0)),
            (_t("ఆడియో విఫలం", "Audio failed"), audio.get("failed", 0)),
        ]
    return {
        "articles_by_state": by_state,
        "articles_by_type_30d": by_type,
        "published_by_category_top10": by_category,
        **more,
        "window": "states and categories: all time; types: created in the last 30 days (UTC); "
        "e-paper: the last 7 edition dates (IST)",
        "scope": _scope_note(p) + " for article counts; other content only where you "
        "hold that section's permission",
        "cards": [
            {
                "type": "bars",
                "title": _t("స్థితి వారీగా కథనాలు", "Articles by state"),
                "items": [
                    {"label": k, "value": v}
                    for k, v in sorted(by_state.items(), key=lambda kv: -kv[1])
                ],
            },
            *([_stats(_t("ఇతర కంటెంట్", "Other content"), other)] if other else []),
            _table(
                _t("విభాగాల వారీగా ప్రచురితం", "Published by category"),
                [
                    ("category", _t("విభాగం", "Category"), "left"),
                    ("published", _t("కథనాలు", "Articles"), "right"),
                ],
                by_category,
            ),
        ],
    }


@_tool(
    "editorial_throughput",
    "How fast the desk is working over a window: stories published per day (IST), approvals, "
    "rejections and returns-for-changes, the median hours from submission to publication, and "
    "published counts by article type and by author (top 10). Use for productivity or "
    "turnaround questions. Limited to the user's districts unless global.",
    {"type": "object", "properties": {"days": _days_param(7)}},
    any_of=("dashboard.view", "analytics.view"),
    label=("ఎడిటోరియల్ వేగం", "Editorial throughput"),
)
def editorial_throughput(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db, scope = ctx.db, _scope(ctx.principal)
    days = _int(args, "days", 7, 1, 90)
    since = utcnow() - timedelta(days=days)
    published = db.execute(
        select(
            Article.id,
            Article.published_at,
            Article.created_at,
            Article.article_type,
            Article.author_id,
        )
        .where(
            *scope,
            Article.status == ArticleStatus.PUBLISHED,
            Article.published_at >= since,
        )
        .limit(_BUCKET_ROWS)
    ).all()

    per_day = Counter(_ist_day(r.published_at) for r in published)
    by_type = Counter(_v(r.article_type) for r in published)
    by_author = Counter(r.author_id for r in published if r.author_id)
    names = _names(db, [a for a, _n in by_author.most_common(10)])

    # Submission time = the first move to SUBMITTED; stories that never went
    # through the queue (published straight by an editor) count from creation.
    submitted: dict[int, datetime] = {}
    ids = [r.id for r in published]
    for chunk in range(0, len(ids), 1000):
        submitted.update(
            db.execute(
                select(
                    WorkflowTransition.article_id,
                    func.min(WorkflowTransition.created_at),
                )
                .where(
                    WorkflowTransition.article_id.in_(ids[chunk : chunk + 1000]),
                    WorkflowTransition.to_state == WorkflowState.SUBMITTED,
                )
                .group_by(WorkflowTransition.article_id)
            ).all()
        )
    hours = [
        (r.published_at - (submitted.get(r.id) or r.created_at)).total_seconds() / 3600
        for r in published
        if r.published_at and (submitted.get(r.id) or r.created_at)
    ]
    hours = [h for h in hours if h >= 0]

    decisions = {
        _v(s): int(n)
        for s, n in db.execute(
            select(WorkflowTransition.to_state, func.count(WorkflowTransition.id))
            .join(Article, Article.id == WorkflowTransition.article_id)
            .where(
                *scope,
                WorkflowTransition.created_at >= since,
                WorkflowTransition.to_state.in_(
                    [
                        WorkflowState.APPROVED,
                        WorkflowState.REJECTED,
                        WorkflowState.CHANGES_REQUESTED,
                    ]
                ),
            )
            .group_by(WorkflowTransition.to_state)
        )
    }
    start = _ist_day(since)
    series = [
        {
            "date": (start + timedelta(days=i)).isoformat(),
            "published": per_day.get(start + timedelta(days=i), 0),
        }
        for i in range((_ist_today() - start).days + 1)
    ]
    authors = [
        {"author": names.get(a, f"#{a}"), "published": n}
        for a, n in by_author.most_common(10)
    ]
    median = round(statistics.median(hours), 1) if hours else None
    out = {
        "published": len(published),
        "published_per_day": series,
        "approvals": decisions.get("APPROVED", 0),
        "rejections": decisions.get("REJECTED", 0),
        "returned_for_changes": decisions.get("CHANGES_REQUESTED", 0),
        "median_hours_submit_to_publish": median,
        "by_article_type": dict(by_type),
        "top_authors": authors,
        "window": _rolling(days) + "; published_per_day bucketed by IST date",
        "scope": _scope_note(ctx.principal),
    }
    out["cards"] = [
        _stats(
            _t(f"గత {days} రోజులు", f"Last {days} days"),
            [
                (_t("ప్రచురితం", "Published"), len(published)),
                (_t("ఆమోదాలు", "Approvals"), out["approvals"]),
                (_t("తిరస్కరణలు", "Rejections"), out["rejections"]),
                (_t("మార్పులకు తిరిగి", "Returned"), out["returned_for_changes"]),
                (
                    _t("సమర్పణ→ప్రచురణ (మధ్యస్థ గంటలు)", "Submit→publish (median h)"),
                    median if median is not None else "—",
                ),
            ],
        ),
        {
            "type": "bars",
            "title": _t("రోజువారీ ప్రచురణలు (IST)", "Published per day (IST)"),
            "items": [
                {"label": d["date"][5:], "value": d["published"]} for d in series
            ],
        },
        _table(
            _t("ఎక్కువ ప్రచురించిన రచయితలు", "Top authors"),
            [
                ("author", _t("రచయిత", "Author"), "left"),
                ("published", _t("కథనాలు", "Stories"), "right"),
            ],
            authors,
        ),
    ]
    return out


# --------------------------------------------------------------------------- #
# Audience
# --------------------------------------------------------------------------- #
@_tool(
    "audience_analytics",
    "Reader numbers: daily/weekly/monthly active readers (distinct devices + signed-in users, "
    "not people), reads, average read seconds and scroll depth, registered readers, all-time "
    "likes/bookmarks/real comments/follows, and the most-read articles, categories and districts "
    "plus the top 10 search terms over the window. Use for audience or readership questions.",
    {"type": "object", "properties": {"days": _days_param(7)}},
    permissions=("analytics.view",),
    label=("పాఠకుల విశ్లేషణ", "Audience analytics"),
)
def audience_analytics(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    days = _int(args, "days", 7, 1, 90)
    s = analytics_service.audience(ctx.db, days=days)
    s["window"] = (
        f"reads, averages and top lists: {_rolling(days)}; dau/wau/mau: last 1/7/30 days "
        "rolling (UTC); *_total: all time"
    )
    s["cards"] = [
        _stats(
            _t("పాఠకులు", "Readers"),
            [
                (_t("DAU", "DAU"), s["dau"]),
                (_t("WAU", "WAU"), s["wau"]),
                (_t("MAU", "MAU"), s["mau"]),
                (_t(f"చదువులు ({days} రోజులు)", f"Reads ({days}d)"), s["reads"]),
                (_t("సగటు చదివిన సెకన్లు", "Avg read seconds"), s["avg_read_seconds"]),
                (_t("సగటు స్క్రోల్ %", "Avg scroll %"), s["avg_scroll_pct"]),
                (_t("నమోదైన పాఠకులు", "Registered readers"), s["registered_readers"]),
            ],
        ),
        _articles_card(
            _t("ఎక్కువగా చదివినవి", "Most read"),
            [
                {
                    **r,
                    "title": r["title_te"],
                    "note": _t(f"{r['reads']} చదువులు", f"{r['reads']} reads"),
                }
                for r in s["top_articles"]
            ],
        ),
        {
            "type": "bars",
            "title": _t("విభాగాల వారీగా చదువులు", "Reads by category"),
            "items": [
                {"label": _t(r["name_te"], r["name_en"]), "value": r["reads"]}
                for r in s["top_categories"]
            ],
        },
        _table(
            _t("ఎక్కువగా వెతికినవి", "Top searches"),
            [
                ("query", _t("పదం", "Term"), "left"),
                ("count", _t("సార్లు", "Times"), "right"),
            ],
            s["top_searches"],
        ),
    ]
    return s


@_tool(
    "traffic_trend",
    "Day-by-day traffic: reads and unique viewers per day (UTC days, from reading sessions) and "
    "articles published per day (IST days). Use for 'is traffic going up', week-over-week or "
    "spike questions.",
    {"type": "object", "properties": {"days": _days_param(14, lo=2)}},
    permissions=("analytics.view",),
    label=("ట్రాఫిక్ ధోరణి", "Traffic trend"),
)
def traffic_trend(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    days = _int(args, "days", 14, 2, 90)
    utc_today = utcnow().date()
    start = utc_today - timedelta(days=days - 1)
    reads = {
        d: (int(n), int(v))
        for d, n, v in db.execute(
            select(
                ReadingSession.day,
                func.count(ReadingSession.id),
                func.count(distinct(ReadingSession.viewer_key)),
            )
            .where(ReadingSession.day >= start)
            .group_by(ReadingSession.day)
        )
    }
    published = Counter(
        min(_ist_day(at), utc_today)
        for at in db.scalars(
            select(Article.published_at)
            .where(
                Article.deleted_at.is_(None),
                Article.status == ArticleStatus.PUBLISHED,
                Article.published_at >= datetime.combine(start, time(), IST),
            )
            .limit(_BUCKET_ROWS)
        )
        if at
    )
    # Ends on the UTC date, the clock of the reads column: between 00:00 and
    # 05:30 IST the IST date is already tomorrow, and a row for it would show
    # reads=0 — traffic "falling to zero" that is only a clock seam. Stories
    # already on that IST date count in the last row instead (the min above).
    series = []
    for i in range(days):
        d = start + timedelta(days=i)
        n, v = reads.get(d, (0, 0))
        series.append(
            {
                "date": d.isoformat(),
                "reads": n,
                "viewers": v,
                "published": published.get(d, 0),
            }
        )
    return {
        "series": series,
        "totals": {k: sum(r[k] for r in series) for k in ("reads", "published")},
        "window": f"last {days} days ending today's UTC date: reads/viewers grouped by UTC date, "
        "published by IST date (stories already on tomorrow's IST date count in the last row); "
        "viewers are distinct devices + signed-in users per day",
        "cards": [
            {
                "type": "bars",
                "title": _t("రోజువారీ చదువులు", "Reads per day"),
                "items": [
                    {"label": r["date"][5:], "value": r["reads"]} for r in series
                ],
            },
            _table(
                _t("రోజువారీ ట్రాఫిక్", "Daily traffic"),
                [
                    ("date", _t("తేదీ", "Date"), "left"),
                    ("reads", _t("చదువులు", "Reads"), "right"),
                    ("viewers", _t("వీక్షకులు", "Viewers"), "right"),
                    ("published", _t("ప్రచురితం", "Published"), "right"),
                ],
                series,
            ),
        ],
    }


_METRICS = {
    "reads": (ReadingSession.article_id, ReadingSession.updated_at, ()),
    "views": (
        ArticleEvent.article_id,
        ArticleEvent.created_at,
        (ArticleEvent.event_type == EventType.VIEW,),
    ),
    "shares": (
        ArticleEvent.article_id,
        ArticleEvent.created_at,
        (ArticleEvent.event_type == EventType.SHARE,),
    ),
    "likes": (Like.article_id, Like.created_at, ()),
    "comments": (
        Comment.article_id,
        Comment.created_at,
        (Comment.is_seeded.is_(False), Comment.status == CommentStatus.VISIBLE),
    ),
}
_METRIC_TE = {
    "reads": "చదువులు",
    "views": "వీక్షణలు",
    "shares": "షేర్లు",
    "likes": "లైక్‌లు",
    "comments": "వ్యాఖ్యలు",
}


@_tool(
    "top_articles",
    "The best-performing published articles over a window by one metric: reads (reading "
    "sessions), views (raw view events), shares, likes, or comments (real, visible ones only). "
    "Optionally filter by category or district. Use for 'top stories this week', 'most shared "
    "politics stories', etc. Limited to the user's districts unless global.",
    {
        "type": "object",
        "properties": {
            "days": _days_param(7),
            "metric": {"type": "string", "enum": list(_METRICS), "default": "reads"},
            "category": _CATEGORY_ARG,
            "district": _DISTRICT_ARG,
            "limit": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10},
        },
    },
    any_of=("analytics.view", "dashboard.view"),
    label=("టాప్ కథనాలు", "Top articles"),
)
def top_articles(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    days = _int(args, "days", 7, 1, 90)
    limit = _int(args, "limit", 10, 1, 25)
    metric = _choice(args, "metric", tuple(_METRICS), "reads")
    aid, at, extra = _METRICS[metric]
    sub = (
        select(aid.label("aid"), func.count().label("n"))
        .where(at >= utcnow() - timedelta(days=days), *extra)
        .group_by(aid)
        .subquery()
    )
    rows = db.execute(
        select(Article, sub.c.n)
        .join(sub, sub.c.aid == Article.id)
        .where(
            *_scope(ctx.principal),
            Article.status == ArticleStatus.PUBLISHED,
            *_category_filter(db, args),
        )
        .order_by(sub.c.n.desc(), Article.id.desc())
        .limit(limit)
    ).all()
    districts = _district_names(db, [a.district_id for a, _n in rows])
    items = [{**_row(a, districts), metric: int(n)} for a, n in rows]
    return {
        "metric": metric,
        "window": _rolling(days)
        + ("; views are raw events, not unique readers" if metric == "views" else ""),
        "scope": _scope_note(ctx.principal),
        "articles": items,
        "cards": [
            _articles_card(
                _t(f"టాప్ కథనాలు — {_METRIC_TE[metric]}", f"Top articles by {metric}"),
                [
                    {
                        **r,
                        "note": _t(
                            f"{r[metric]} {_METRIC_TE[metric]}", f"{r[metric]} {metric}"
                        ),
                    }
                    for r in items
                ],
            )
        ],
    }


@_tool(
    "engagement_summary",
    "Reader engagement in a window: likes, bookmarks, real comments (not seeded, visible), "
    "shares, new follows, reactions by kind (happy/sad/angry), poll votes, and reports filed. "
    "Use for 'how engaged are readers' questions.",
    {"type": "object", "properties": {"days": _days_param(7)}},
    permissions=("analytics.view",),
    label=("పాఠకుల స్పందన", "Engagement summary"),
)
def engagement_summary(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    days = _int(args, "days", 7, 1, 90)
    since = utcnow() - timedelta(days=days)

    def count(model, *where) -> int:
        return int(
            db.scalar(select(func.count()).select_from(model).where(*where)) or 0
        )

    out = {
        "likes": count(Like, Like.created_at >= since),
        "bookmarks": count(Bookmark, Bookmark.created_at >= since),
        "comments": count(
            Comment,
            Comment.created_at >= since,
            Comment.is_seeded.is_(False),
            Comment.status == CommentStatus.VISIBLE,
        ),
        "shares": count(
            ArticleEvent,
            ArticleEvent.created_at >= since,
            ArticleEvent.event_type == EventType.SHARE,
        ),
        "follows": count(Follow, Follow.created_at >= since),
        "poll_votes": count(PollVote, PollVote.created_at >= since),
        "reports_filed": count(Report, Report.created_at >= since),
    }
    out["reactions"] = {
        _v(k): int(n)
        for k, n in db.execute(
            select(Reaction.kind, func.count(Reaction.id))
            .where(Reaction.updated_at >= since)
            .group_by(Reaction.kind)
        )
    }
    labels = {
        "likes": ("లైక్‌లు", "Likes"),
        "bookmarks": ("బుక్‌మార్క్‌లు", "Bookmarks"),
        "comments": ("వ్యాఖ్యలు", "Comments"),
        "shares": ("షేర్లు", "Shares"),
        "follows": ("ఫాలోలు", "Follows"),
        "poll_votes": ("పోల్ ఓట్లు", "Poll votes"),
        "reports_filed": ("ఫిర్యాదులు", "Reports filed"),
    }
    out["window"] = _rolling(days) + "; reactions by last change"
    out["cards"] = [
        _stats(
            _t(f"గత {days} రోజుల స్పందన", f"Engagement, last {days} days"),
            [(_t(*labels[k]), out[k]) for k in labels]
            + [(_t(k, k), v) for k, v in out["reactions"].items()],
        )
    ]
    return out


@_tool(
    "trending_now",
    "What is trending on the site right now (48-hour time-decayed score from views, reads, "
    "shares, likes, bookmarks and real comments), with each story's counters. Use for 'what is "
    "hot right now'.",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10}
        },
    },
    permissions=("dashboard.view",),
    label=("ట్రెండింగ్", "Trending now"),
)
def trending_now(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    limit = _int(args, "limit", 10, 1, 25)
    # Same as GET /cms/trending: recomputes the table when it is >5 min old.
    trending_service.ensure_fresh(ctx.db)
    items = [
        {
            "rank": ts.rank,
            "score": round(float(ts.score), 2),
            "id": a.id,
            "short_id": a.short_id,
            "title": a.title_te,
            "views": int(a.view_count or 0),
            "likes": int(a.like_count or 0),
            "shares": int(a.share_count or 0),
            "computed_at": ts.computed_at,
        }
        for ts, a in discovery_repo.scored_rows(ctx.db, limit=limit)
    ]
    return {
        "items": items,
        "window": "trending score over the last 48 hours, 12-hour decay; counters are all time",
        "cards": [
            _articles_card(
                _t("ఇప్పుడు ట్రెండింగ్", "Trending now"),
                [
                    {
                        **r,
                        "note": _t(
                            f"#{r['rank']} · {r['views']} వీక్షణలు",
                            f"#{r['rank']} · {r['views']} views",
                        ),
                    }
                    for r in items
                ],
            )
        ],
    }


# --------------------------------------------------------------------------- #
# Money, push, crawl, audio
# --------------------------------------------------------------------------- #
def _inr(paise: Any) -> float:
    return round(int(paise or 0) / 100, 2)


@_tool(
    "ai_spend",
    "AI spend: the month-to-date total against the monthly budget, plus spend and calls in the "
    "window by operation, by model, by day and the top 10 staff by spend; also voice (TTS) "
    "characters this month. Amounts are rupees. Rows with 0 paise (TTS, Sarvam, ElevenLabs, "
    "direct vendors) mean the cost is unknown, not free.",
    {"type": "object", "properties": {"days": _days_param(30)}},
    permissions=("ai.view_usage",),
    label=("AI ఖర్చు", "AI spend"),
)
def ai_spend(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    days = _int(args, "days", 30, 1, 90)
    since = utcnow() - timedelta(days=days)
    paise = func.coalesce(func.sum(AiUsage.cost_paise), 0)

    def grouped(col, limit: int) -> list[tuple]:
        return db.execute(
            select(
                col,
                func.count(AiUsage.id),
                paise,
                func.coalesce(func.sum(case((AiUsage.ok.is_(False), 1), else_=0)), 0),
                func.coalesce(func.sum(case((AiUsage.cost_paise == 0, 1), else_=0)), 0),
            )
            .where(AiUsage.created_at >= since)
            .group_by(col)
            .order_by(paise.desc(), func.count(AiUsage.id).desc())
            .limit(limit)
        ).all()

    def rows(col, key: str, limit: int = 20) -> list[dict]:
        return [
            {
                key: k,
                "calls": int(c),
                "spent_inr": _inr(p),
                "failed": int(f),
                "unpriced_calls": int(u),
            }
            for k, c, p, f, u in grouped(col, limit)
        ]

    by_operation = rows(AiUsage.operation, "operation")
    by_model = rows(AiUsage.model, "model")
    users = rows(AiUsage.actor_id, "actor_id", 10)
    names = _names(db, [u["actor_id"] for u in users])
    top_users = [
        {
            "user": names.get(u["actor_id"]) or "scheduled / system",
            **{k: v for k, v in u.items() if k != "actor_id"},
        }
        for u in users
    ]

    day_calls: Counter = Counter()
    day_paise: Counter = Counter()
    for at, p in db.execute(
        select(AiUsage.created_at, AiUsage.cost_paise)
        .where(AiUsage.created_at >= since)
        .limit(_BUCKET_ROWS)
    ):
        d = _ist_day(at)
        day_calls[d] += 1
        day_paise[d] += int(p or 0)
    start = _ist_day(since)
    by_day = [
        {"date": d.isoformat(), "calls": day_calls[d], "spent_inr": _inr(day_paise[d])}
        for d in (
            start + timedelta(days=i) for i in range((_ist_today() - start).days + 1)
        )
    ]
    month = ai_usage_service.usage_summary(db)
    voice = tts_service.usage_summary(db)
    window_inr = round(sum(r["spent_inr"] for r in by_operation), 2)
    window_calls = sum(r["calls"] for r in by_operation)
    return {
        "month_to_date": month,
        "window_spent_inr": window_inr,
        "window_calls": window_calls,
        "by_operation": by_operation,
        "by_model": by_model,
        "by_day": by_day,
        "top_users": top_users,
        "voice_usage": voice,
        "window": f"month_to_date: since the 1st, 00:00 UTC; everything else: {_rolling(days)}, "
        "by_day bucketed by IST date",
        "note": "unpriced_calls cost 0 paise because the provider does not report a price "
        "(TTS/Sarvam/ElevenLabs/direct vendors): unknown, not free. Voice is metered in characters.",
        "cards": [
            _stats(
                _t("AI ఖర్చు", "AI spend"),
                [
                    (_t("ఈ నెల (₹)", "This month (₹)"), month["spent_inr"]),
                    (_t("బడ్జెట్ (₹)", "Budget (₹)"), month["budget_inr"]),
                    (_t("వినియోగం %", "Used %"), month["percent_used"]),
                    (_t("ఈ నెల కాల్స్", "Calls this month"), month["calls_this_month"]),
                    (_t(f"{days} రోజుల ఖర్చు (₹)", f"Last {days}d (₹)"), window_inr),
                    (
                        _t("వాయిస్ అక్షరాలు (నెల)", "Voice chars (month)"),
                        voice["chars_this_month"],
                    ),
                ],
            ),
            {
                "type": "bars",
                "title": _t("రోజువారీ ఖర్చు (IST)", "Spend per day (IST)"),
                "unit": "₹",
                "items": [
                    {"label": d["date"][5:], "value": d["spent_inr"]} for d in by_day
                ],
            },
            _table(
                _t("పని వారీగా", "By operation"),
                [
                    ("operation", _t("పని", "Operation"), "left"),
                    ("calls", _t("కాల్స్", "Calls"), "right"),
                    ("spent_inr", _t("₹", "₹"), "right"),
                    ("unpriced_calls", _t("ధర తెలియనివి", "Unpriced"), "right"),
                ],
                by_operation,
            ),
            _table(
                _t("ఎక్కువ ఖర్చు చేసిన సిబ్బంది", "Top staff by spend"),
                [
                    ("user", _t("సిబ్బంది", "Staff"), "left"),
                    ("calls", _t("కాల్స్", "Calls"), "right"),
                    ("spent_inr", _t("₹", "₹"), "right"),
                ],
                top_users,
            ),
        ],
    }


@_tool(
    "push_stats",
    "Push notification performance in a window: campaigns by status, devices targeted, "
    "delivered/failed, opens and open rate, registered devices, and the last 10 campaigns. "
    "'opened' is reported by the app without authentication and can be inflated.",
    {"type": "object", "properties": {"days": _days_param(30)}},
    permissions=("push.create",),
    label=("పుష్ గణాంకాలు", "Push stats"),
)
def push_stats(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    days = _int(args, "days", 30, 1, 90)
    since = utcnow() - timedelta(days=days)
    C = NotificationCampaign
    in_window = C.created_at >= since
    by_status = {}
    totals = Counter()
    for status, n, dev, ok, failed, opened in db.execute(
        select(
            C.status,
            func.count(C.id),
            func.coalesce(func.sum(C.devices), 0),
            func.coalesce(func.sum(C.push_ok), 0),
            func.coalesce(func.sum(C.push_failed), 0),
            func.coalesce(func.sum(C.opened), 0),
        )
        .where(in_window)
        .group_by(C.status)
    ):
        by_status[status] = int(n)
        totals.update(
            devices=int(dev),
            push_ok=int(ok),
            push_failed=int(failed),
            opened=int(opened),
        )
    last = [
        {
            "title": c.title_te,
            "audience": c.audience,
            "status": c.status,
            "sent_at": c.sent_at,
            "devices": c.devices,
            "opened": c.opened,
        }
        for c in db.scalars(
            select(C)
            .where(in_window)
            .order_by(C.created_at.desc(), C.id.desc())
            .limit(10)
        )
    ]
    rate = (
        round(totals["opened"] * 100 / totals["push_ok"], 1)
        if totals["push_ok"]
        else None
    )
    devices = notification_service.device_counts(db)
    return {
        "campaigns": sum(by_status.values()),
        "by_status": by_status,
        **dict(totals),
        "open_rate_pct": rate,
        "registered_devices": devices,
        "last_campaigns": last,
        "window": _rolling(days) + " by campaign creation time",
        "note": "open_rate = opened / delivered; opens are unauthenticated and can be inflated",
        "cards": [
            _stats(
                _t("పుష్ నోటిఫికేషన్లు", "Push notifications"),
                [
                    (_t("క్యాంపెయిన్లు", "Campaigns"), sum(by_status.values())),
                    (_t("లక్ష్య పరికరాలు", "Devices targeted"), totals["devices"]),
                    (_t("చేరినవి", "Delivered"), totals["push_ok"]),
                    (_t("విఫలం", "Failed"), totals["push_failed"]),
                    (_t("తెరిచినవి", "Opened"), totals["opened"]),
                    (_t("ఓపెన్ రేటు %", "Open rate %"), rate if rate is not None else "—"),
                    (_t("నమోదైన పరికరాలు", "Registered devices"), devices["total"]),
                ],
            ),
            _table(
                _t("ఇటీవలి క్యాంపెయిన్లు", "Recent campaigns"),
                [
                    ("title", _t("శీర్షిక", "Title"), "left"),
                    ("audience", _t("ప్రేక్షకులు", "Audience"), "left"),
                    ("status", _t("స్థితి", "Status"), "left"),
                    ("devices", _t("పరికరాలు", "Devices"), "right"),
                    ("opened", _t("తెరిచినవి", "Opened"), "right"),
                ],
                last,
            ),
        ],
    }


@_tool(
    "crawl_health",
    "Health of the news crawl: whether crawling and rewriting are on, today's and this hour's "
    "usage against the caps, the ingest queue, and every source (worst first) with its last "
    "status, last fetch and consecutive failures. stale=true means the ingest worker is "
    "probably not running.",
    permissions=("taxonomy.view",),
    label=("క్రాల్ ఆరోగ్యం", "Crawl health"),
)
def crawl_health(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    snap = crawl_service.status_snapshot(db)
    S = ContentSource
    sources = [
        {
            "name": s.name,
            "beat": _v(s.beat),
            "active": s.is_active,
            "last_status": _clip(s.last_status, 120),
            "last_fetched_at": s.last_fetched_at,
            "consecutive_failures": int(s.consecutive_failures or 0),
            "items_ingested": int(s.items_ingested or 0),
        }
        for s in db.scalars(
            select(S)
            .order_by(
                S.is_active.desc(),
                S.consecutive_failures.desc(),
                S.last_fetched_at.is_(None).desc(),
                S.last_fetched_at,
                S.id,
            )
            .limit(50)
        )
    ]
    if snap.get("stale"):
        snap["stale_note"] = (
            "No source has been fetched for over 2 hours during crawl hours: the ingest worker is probably not running."
        )
    return {
        **snap,
        "sources": sources,
        "window": "live snapshot; used_today since 00:00 IST, used_this_hour is the current hour",
        "cards": [
            _stats(
                _t("క్రాల్ స్థితి", "Crawl status"),
                [
                    (_t("క్రాల్ ఆన్", "Crawl on"), "yes" if snap["enabled"] else "no"),
                    (
                        _t("ఇప్పుడు నడుస్తోంది", "Active now"),
                        "yes" if snap["active_now"] else "no",
                    ),
                    (
                        _t("ఈరోజు / పరిమితి", "Today / cap"),
                        f"{snap['used_today']} / {snap['daily_cap']}",
                    ),
                    (
                        _t("ఈ గంట / పరిమితి", "This hour / cap"),
                        f"{snap['used_this_hour']} / {snap['hourly_cap']}",
                    ),
                    (
                        _t("విఫలమవుతున్న సోర్సులు", "Failing sources"),
                        snap["failing_sources"],
                    ),
                    (_t("వర్కర్ ఆగిందా", "Worker stale"), "YES" if snap["stale"] else "no"),
                ],
            ),
            _table(
                _t("సోర్సులు", "Sources"),
                [
                    ("name", _t("సోర్సు", "Source"), "left"),
                    ("beat", _t("బీట్", "Beat"), "left"),
                    ("last_status", _t("చివరి స్థితి", "Last status"), "left"),
                    ("consecutive_failures", _t("వరుస వైఫల్యాలు", "Failures"), "right"),
                    ("items_ingested", _t("అంశాలు", "Items"), "right"),
                ],
                sources,
            ),
        ],
    }


@_tool(
    "bulletins_for_day",
    "The audio news bulletins for one day (IST date): each slot's status, duration, audio URL "
    "and any error, plus the slots not produced yet. Use to check whether today's bulletins "
    "are ready.",
    {
        "type": "object",
        "properties": {
            # No `format`: Gemini's function schema accepts only "date-time"/"enum".
            "date": {
                "type": "string",
                "description": "YYYY-MM-DD (IST). Default: today.",
            }
        },
    },
    permissions=("voice.manage",),
    label=("ఆడియో బులెటిన్లు", "Audio bulletins"),
)
def bulletins_for_day(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    raw = str(args.get("date") or "").strip()
    try:
        day = date.fromisoformat(raw) if raw else bulletin_service.today()
    except ValueError:
        raise ValidationError(
            "date must be YYYY-MM-DD.", "తేదీ YYYY-MM-DD రూపంలో ఉండాలి."
        ) from None
    rows = bulletin_service.for_day(ctx.db, day)
    items = [
        {
            "id": b.id,
            "slot": b.slot,
            "slot_label_te": b.slot_label_te,
            "status": _v(b.status),
            "duration_sec": b.duration_sec,
            "url": b.url,
            "stories": len(b.items),
            "error": _clip(b.error, 200),
        }
        for b in rows
    ]
    have = {b.slot for b in rows}
    return {
        "date": day.isoformat(),
        "items": items,
        "missing_slots": [s for s in bulletin_service.SLOTS if s not in have],
        "window": "one IST calendar day; slots are IST hours",
        "cards": [
            {
                "type": "bulletin",
                "id": b["id"],
                "date": day.isoformat(),
                "slot": b["slot"],
                "slot_label_te": b["slot_label_te"],
                "status": b["status"],
                "url": b["url"],
                "duration_sec": b["duration_sec"],
            }
            for b in items
        ],
    }


# --------------------------------------------------------------------------- #
# Articles and queues
# --------------------------------------------------------------------------- #
_STATES = tuple(s.value for s in WorkflowState)
_TYPES = tuple(t.value for t in ArticleType)


@_tool(
    "search_articles",
    "Find articles in the CMS by text (Telugu or English title, summary, or short id) and/or "
    "filters: workflow state, category, district, article type, and how recent. Returns id, "
    "short_id, title, state, category, district, published time, views and URL path. Use it "
    "to find an article id before get_article, or to list e.g. 'rejected AI drafts this week'.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "maxLength": 200},
            "state": {"type": "string", "enum": list(_STATES)},
            "category": _CATEGORY_ARG,
            "district": _DISTRICT_ARG,
            "days": {
                "type": "integer",
                "minimum": 1,
                "maximum": 365,
                "description": "Only articles updated in the last N days.",
            },
            "article_type": {"type": "string", "enum": list(_TYPES)},
            "limit": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10},
        },
    },
    any_of=("article.view", "article.view_own"),
    label=("కథనాల శోధన", "Search articles"),
)
def search_articles(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db, p = ctx.db, ctx.principal
    limit = _int(args, "limit", 10, 1, 25)
    where = [*_scope(p), *_category_filter(db, args)]
    if not p.has("article.view"):
        where.append(or_(Article.author_id == p.id, Article.created_by == p.id))
    state = _choice(args, "state", _STATES, None)
    if state:
        where.append(Article.workflow_state == WorkflowState(state))
    kind = _choice(args, "article_type", _TYPES, None)
    if kind:
        where.append(Article.article_type == ArticleType(kind))
    days = _int(args, "days", 0, 1, 365) if args.get("days") not in (None, "") else None
    if days:
        where.append(Article.updated_at >= utcnow() - timedelta(days=days))
    query = str(args.get("query") or "").strip()[:200]
    if query:
        term = f"%{query}%"
        where.append(
            or_(
                Article.title_te.ilike(term),
                Article.title_en.ilike(term),
                Article.summary_te.ilike(term),
                Article.short_id.ilike(term),
            )
        )
    found = list(
        db.scalars(
            select(Article)
            .where(*where)
            .order_by(Article.updated_at.desc(), Article.id.desc())
            .limit(limit)
        )
    )
    districts = _district_names(db, [a.district_id for a in found])
    items = [_row(a, districts) for a in found]
    return {
        "window": f"updated in the last {days} days (UTC)" if days else "any time",
        "scope": _scope_note(p)
        + ("" if p.has("article.view") else "; only your own articles"),
        "count": len(items),
        "articles": items,
        "cards": [_articles_card(_t("కథనాలు", "Articles"), items)] if items else [],
    }


@_tool(
    "get_article",
    "Details of one article by id or short_id: title, summary, state, type, source, author and "
    "approver, category, district, timestamps, counters (views, real likes, real comments, "
    "shares), whether it has a hero photo and audio, URL path, word count, the first 600 "
    "characters of the body, and its last 5 workflow steps.",
    {
        "type": "object",
        "properties": {
            "article_id": {"type": "integer", "minimum": 1},
            "short_id": {"type": "string", "maxLength": 20},
        },
    },
    any_of=("article.view", "article.view_own"),
    label=("కథనం వివరాలు", "Article details"),
)
def get_article(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db, p = ctx.db, ctx.principal
    article = None
    if args.get("article_id") not in (None, ""):
        article = db.get(Article, _int(args, "article_id", 0, 0, 2**62))
    elif args.get("short_id"):
        article = db.scalars(
            select(Article)
            .where(Article.short_id == str(args["short_id"]).strip())
            .limit(1)
        ).first()
    else:
        raise ValidationError(
            "Give article_id or short_id.", "article_id లేదా short_id ఇవ్వండి."
        )
    own = article is not None and p.id in (article.author_id, article.created_by)
    if article is None or article.deleted_at or not (p.has("article.view") or own):
        raise NotFoundError()
    workflow_service._scope(p, article)

    comments = int(
        db.scalar(
            select(func.count(Comment.id)).where(
                Comment.article_id == article.id,
                Comment.is_seeded.is_(False),
                Comment.status == CommentStatus.VISIBLE,
            )
        )
        or 0
    )
    audio = (
        db.get(AudioAsset, article.audio_asset_id) if article.audio_asset_id else None
    )
    steps = list(
        db.scalars(
            select(WorkflowTransition)
            .where(WorkflowTransition.article_id == article.id)
            .order_by(
                WorkflowTransition.created_at.desc(), WorkflowTransition.id.desc()
            )
            .limit(5)
        )
    )
    names = _names(
        db, [article.author_id, article.approved_by, *(s.actor_id for s in steps)]
    )
    district = db.get(District, article.district_id) if article.district_id else None
    out = {
        "id": article.id,
        "short_id": article.short_id,
        "title": article.title_te,
        "title_en": article.title_en,
        "summary": (article.summary_te or "")[:400] or None,
        "workflow_state": _v(article.workflow_state),
        "status": _v(article.status),
        "article_type": _v(article.article_type),
        "source_type": article.source_type,
        "ai_generated": article.ai_generated,
        "author": names.get(article.author_id) or article.byline_te,
        "approved_by": names.get(article.approved_by),
        "category": article.category.name_en if article.category else None,
        "district": district.name_en if district else None,
        "created_at": article.created_at,
        "published_at": article.published_at,
        "views": int(article.view_count or 0),
        "likes": int(article.like_count or 0),
        "seeded_likes": int(article.seed_like_count or 0),
        "comments": comments,
        "shares": int(article.share_count or 0),
        "has_hero": article.hero_media_id is not None,
        "has_audio": audio is not None and audio.status == AudioStatus.READY,
        "is_breaking": article.is_breaking,
        "url_path": article.url_path,
        "word_count": article.word_count,
        "body_excerpt": (article.body_plain or "")[:600] or None,
        "recent_steps": [
            {
                "state": _v(s.to_state),
                "by": names.get(s.actor_id),
                "at": s.created_at,
                "note": (s.note or "")[:200] or None,
            }
            for s in steps
        ],
        "window": "counters are all time; likes exclude seeded likes; comments are real, visible ones",
    }
    out["cards"] = [
        _articles_card(
            _t("కథనం", "Article"), [{**out, "state": out["workflow_state"]}]
        ),
        _stats(
            _t("గణాంకాలు", "Numbers"),
            [
                (_t("వీక్షణలు", "Views"), out["views"]),
                (_t("లైక్‌లు", "Likes"), out["likes"]),
                (_t("వ్యాఖ్యలు", "Comments"), comments),
                (_t("షేర్లు", "Shares"), out["shares"]),
            ],
        ),
    ]
    return out


def _queue_note(a: Article) -> dict[str, str] | None:
    te, en = [], []
    kinds = {
        ArticleType.AI_DRAFT: ("AI డ్రాఫ్ట్", "AI draft"),
        ArticleType.AI_SUGGESTED: ("AI సూచన", "AI suggested"),
        ArticleType.USER_SUBMITTED: ("పాఠకుల సమర్పణ", "Reader submission"),
        ArticleType.BREAKING_NEWS: ("బ్రేకింగ్", "Breaking"),
    }
    if a.article_type in kinds:
        te.append(kinds[a.article_type][0])
        en.append(kinds[a.article_type][1])
    if not a.hero_media_id:
        te.append("ఫోటో కావాలి")
        en.append("needs hero photo")
    return _t(" · ".join(te), " · ".join(en)) if en else None


@_tool(
    "review_queue",
    "The review queue: articles SUBMITTED or IN_REVIEW, oldest first (the same list as the "
    "CMS 'pending' screen), optionally filtered by article type, category or district. Notes "
    "flag AI drafts, reader submissions and stories missing a hero photo. Limited to the "
    "user's districts unless global.",
    {
        "type": "object",
        "properties": {
            "article_type": {"type": "string", "enum": list(_TYPES)},
            "category": _CATEGORY_ARG,
            "district": _DISTRICT_ARG,
            "limit": {"type": "integer", "minimum": 1, "maximum": 25, "default": 20},
        },
    },
    any_of=("article.review", "article.view"),
    label=("సమీక్ష క్యూ", "Review queue"),
)
def review_queue(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    limit = _int(args, "limit", 20, 1, 25)
    where = [
        *_scope(ctx.principal),
        Article.workflow_state.in_([WorkflowState.SUBMITTED, WorkflowState.IN_REVIEW]),
        *_category_filter(db, args),
    ]
    kind = _choice(args, "article_type", _TYPES, None)
    if kind:
        where.append(Article.article_type == ArticleType(kind))
    total = int(db.scalar(select(func.count(Article.id)).where(*where)) or 0)
    found = list(
        db.scalars(
            select(Article)
            .where(*where)
            .order_by(Article.updated_at.asc(), Article.id)
            .limit(limit)
        )
    )
    districts = _district_names(db, [a.district_id for a in found])
    names = _names(db, [a.author_id for a in found])
    # Lean rows, not `_row`: a queued story has no publish time, views or URL,
    # and the bilingual note is for the card (the model has article_type and
    # has_hero) — 25 full rows ran past MAX_RESULT_CHARS and got clipped.
    items = [
        {
            "id": a.id,
            "short_id": a.short_id,
            "title": a.title_te,
            "state": _v(a.workflow_state),
            "category": a.category.name_en if a.category else None,
            "district": districts.get(a.district_id),
            "article_type": _v(a.article_type),
            "author": names.get(a.author_id) or a.byline_te,
            "waiting_since": a.updated_at.isoformat(timespec="minutes"),
            "has_hero": a.hero_media_id is not None,
        }
        for a in found
    ]
    notes = {a.id: _queue_note(a) for a in found}
    # window/scope/total before the list: a clipped result loses its tail.
    return {
        "window": "current queue, oldest first by last update (UTC)",
        "scope": _scope_note(ctx.principal),
        "total_waiting": total,
        "articles": items,
        "cards": [
            _articles_card(
                _t(f"సమీక్షకు {total}", f"{total} awaiting review"),
                [{**r, "note": notes[r["id"]]} for r in items],
            )
        ]
        if items
        else [],
    }


# --------------------------------------------------------------------------- #
# Lookups
# --------------------------------------------------------------------------- #
@_tool(
    "taxonomy_lookup",
    "Look up categories, districts or mandals by name (English or Telugu) or slug, to get the "
    "exact id/slug to pass to other tools. For mandals, give the district to narrow the list.",
    {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["categories", "districts", "mandals"]},
            "query": {"type": "string", "maxLength": 100},
            "district": _DISTRICT_ARG,
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
        },
        "required": ["kind"],
    },
    any_of=("taxonomy.view", "article.create"),
    label=("వర్గాల శోధన", "Taxonomy lookup"),
)
def taxonomy_lookup(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    db = ctx.db
    kind = _choice(args, "kind", ("categories", "districts", "mandals"), None)
    if kind is None:
        raise ValidationError("kind is required.", "kind తప్పనిసరి.")
    limit = _int(args, "limit", 30, 1, 100)
    model = {"categories": Category, "districts": District, "mandals": Mandal}[kind]
    where: list[Any] = [model.is_active.is_(True)]
    q = str(args.get("query") or "").strip()[:100]
    if q:
        term = f"%{q}%"
        where.append(
            or_(
                model.slug.ilike(term),
                model.name_en.ilike(term),
                model.name_te.ilike(term),
            )
        )
    if kind == "mandals" and args.get("district"):
        dist = _need(
            resolve_district(db, args["district"]), args["district"], "district"
        )
        where.append(Mandal.district_id == dist.id)
    found = list(
        db.scalars(
            select(model).where(*where).order_by(model.name_en, model.id).limit(limit)
        )
    )
    items = [
        {"id": x.id, "slug": x.slug, "name_te": x.name_te, "name_en": x.name_en}
        for x in found
    ]
    if kind == "categories":
        parents = {
            c.id: c.slug
            for c in db.scalars(
                select(Category).where(
                    Category.id.in_({x.parent_id for x in found if x.parent_id})
                )
            )
        }
        for item, x in zip(items, found, strict=True):
            item["parent"] = parents.get(x.parent_id)
    elif kind == "mandals":
        dnames = _district_names(db, [x.district_id for x in found])
        for item, x in zip(items, found, strict=True):
            item["district"] = dnames.get(x.district_id)
    return {"kind": kind, "items": items, "window": "current active entries"}


# --------------------------------------------------------------------------- #
# Everything else, one section at a time
# --------------------------------------------------------------------------- #
_SECTION_PERMS = {
    "videos": ("video.view",),
    "epaper": ("epaper.view",),
    "ads": ("ads.manage",),
    "audio": ("voice.manage",),
    "polls": ("analytics.view", "article.view"),
    "users": ("user.view",),
    "contributors": ("kyc.review",),
}


def _may(p: Principal, section: str) -> bool:
    return any(p.has(x) for x in _SECTION_PERMS[section])


def _count_by(db: Session, col, *where) -> dict[str, int]:
    return {
        str(_v(k)): int(n)
        for k, n in db.execute(select(col, func.count()).where(*where).group_by(col))
    }


def _section(db: Session, section: str) -> tuple[dict[str, Any], list[dict], str]:
    now = utcnow()
    if section == "videos":
        live = (Video.deleted_at.is_(None), Video.is_published.is_(True))
        n, views = db.execute(
            select(
                func.count(Video.id), func.coalesce(func.sum(Video.view_count), 0)
            ).where(*live)
        ).one()
        top = [
            {"title": t, "views": int(v), "likes": int(lk)}
            for t, v, lk in db.execute(
                select(Video.title_te, Video.view_count, Video.like_count)
                .where(*live)
                .order_by(Video.view_count.desc(), Video.id)
                .limit(5)
            )
        ]
        data = {"published": int(n), "total_views": int(views), "top_by_views": top}
        card = _table(
            _t("టాప్ వీడియోలు", "Top videos"),
            [
                ("title", _t("శీర్షిక", "Title"), "left"),
                ("views", _t("వీక్షణలు", "Views"), "right"),
                ("likes", _t("లైక్‌లు", "Likes"), "right"),
            ],
            top,
        )
        return data, [card], "all time; video views are not de-duplicated"
    if section == "epaper":
        editions = _count_by(
            db,
            EpaperEdition.status,
            EpaperEdition.edition_date >= _ist_today() - timedelta(days=29),
        )
        shares = _count_by(
            db,
            EpaperPageShare.channel,
            EpaperPageShare.created_at >= now - timedelta(days=30),
        )
        data = {
            "editions_by_status": editions,
            "page_shares_by_channel": shares,
            "note": "e-paper page views are not recorded",
        }
        items = [(_t(k, k), v) for k, v in editions.items()] + [
            (_t("షేర్లు", "Page shares"), sum(shares.values()))
        ]
        return (
            data,
            [_stats(_t("ఈ-పేపర్ (30 రోజులు)", "E-paper (30 days)"), items)],
            "last 30 edition dates (IST); shares last 30 days (UTC)",
        )
    if section == "ads":
        rows = [
            {
                "name": name,
                "placement": _v(pl),
                "active": active,
                "impressions": int(i),
                "clicks": int(c),
                "ctr_pct": round(int(c) * 100 / int(i), 2) if i else 0,
            }
            for name, pl, active, i, c in db.execute(
                select(
                    AdCampaign.name,
                    AdCampaign.placement,
                    AdCampaign.is_active,
                    AdCampaign.impressions,
                    AdCampaign.clicks,
                )
                .order_by(AdCampaign.impressions.desc(), AdCampaign.id)
                .limit(20)
            )
        ]
        cols = [
            ("name", _t("క్యాంపెయిన్", "Campaign"), "left"),
            ("impressions", _t("ఇంప్రెషన్లు", "Impressions"), "right"),
            ("clicks", _t("క్లిక్‌లు", "Clicks"), "right"),
            ("ctr_pct", _t("CTR %", "CTR %"), "right"),
        ]
        return (
            {"campaigns": rows},
            [_table(_t("ప్రకటనలు", "Ads"), cols, rows)],
            "all-time counters (no per-day history is kept)",
        )
    if section == "audio":
        voice = tts_service.usage_summary(db)
        bulletins = _count_by(
            db,
            AudioBulletin.status,
            AudioBulletin.bulletin_date >= _ist_today() - timedelta(days=6),
        )
        data = {
            "voice_usage": voice,
            "article_audio_by_status": _count_by(db, AudioAsset.status),
            "bulletins_7d_by_status": bulletins,
            "note": "audio plays are not recorded",
        }
        items = [
            (_t("వాయిస్ అక్షరాలు (నెల)", "Voice chars (month)"), voice["chars_this_month"]),
            (_t("బడ్జెట్ %", "Budget used %"), voice["percent_used"]),
            (_t("ఆడియో సిద్ధం", "Audio ready"), voice["assets_ready"]),
            (_t("ఆడియో విఫలం", "Audio failed"), voice["assets_failed"]),
        ] + [(_t(f"బులెటిన్ {k}", f"Bulletins {k}"), v) for k, v in bulletins.items()]
        return (
            data,
            [_stats(_t("ఆడియో", "Audio"), items)],
            "voice: this month (UTC); bulletins: last 7 IST dates",
        )
    if section == "polls":
        active = int(
            db.scalar(
                select(func.count(Poll.id)).where(
                    Poll.status == "ACTIVE", Poll.start_time <= now, Poll.end_time > now
                )
            )
            or 0
        )
        votes = func.coalesce(func.sum(PollOption.vote_count), 0)
        top = [
            {"question": q, "status": s, "votes": int(v)}
            for q, s, v in db.execute(
                select(Poll.question_te, Poll.status, votes)
                .join(PollOption, PollOption.poll_id == Poll.id)
                .where(Poll.created_at >= now - timedelta(days=90))
                .group_by(Poll.id, Poll.question_te, Poll.status)
                .order_by(votes.desc(), Poll.id)
                .limit(5)
            )
        ]
        cols = [
            ("question", _t("ప్రశ్న", "Question"), "left"),
            ("votes", _t("ఓట్లు", "Votes"), "right"),
        ]
        return (
            {"active_polls": active, "top_by_votes": top},
            [_table(_t(f"పోల్స్ — {active} యాక్టివ్", f"Polls — {active} active"), cols, top)],
            "active now; top polls created in the last 90 days",
        )
    if section == "users":
        by_status = _count_by(db, User.status, User.deleted_at.is_(None))
        by_role = {
            k: int(n)
            for k, n in db.execute(
                select(Role.key, func.count(distinct(UserRole.user_id)))
                .join(UserRole, UserRole.role_id == Role.id)
                .group_by(Role.key)
            )
        }
        new = int(
            db.scalar(
                select(func.count(User.id)).where(
                    User.deleted_at.is_(None),
                    User.created_at >= now - timedelta(days=30),
                )
            )
            or 0
        )
        data = {"by_status": by_status, "by_role": by_role, "new_last_30d": new}
        rows = [
            {"role": k, "users": v}
            for k, v in sorted(by_role.items(), key=lambda kv: -kv[1])
        ]
        return (
            data,
            [
                _table(
                    _t("పాత్రల వారీగా యూజర్లు", "Users by role"),
                    [
                        ("role", _t("పాత్ర", "Role"), "left"),
                        ("users", _t("యూజర్లు", "Users"), "right"),
                    ],
                    rows,
                )
            ],
            "current; new_last_30d rolling (UTC)",
        )
    # contributors
    data = {
        "by_kyc_status": _count_by(db, ContributorProfile.kyc_status),
        "by_type": _count_by(db, ContributorProfile.contributor_type),
    }
    items = [(_t(k, k), v) for k, v in data["by_kyc_status"].items()]
    return (
        data,
        [_stats(_t("కంట్రిబ్యూటర్లు (KYC)", "Contributors (KYC)"), items)],
        "current",
    )


@_tool(
    "platform_stats",
    "Aggregate numbers for one area of the platform: videos (published, views, top 5), epaper "
    "(editions by status, page shares), ads (impressions/clicks/CTR per campaign), audio (voice "
    "characters, article audio, bulletins), polls (active, top 5 by votes), users (by status "
    "and role), contributors (by KYC status and type). Counts only, never personal details.",
    {
        "type": "object",
        "properties": {"section": {"type": "string", "enum": list(_SECTION_PERMS)}},
        "required": ["section"],
    },
    any_of=(
        "video.view",
        "epaper.view",
        "ads.manage",
        "voice.manage",
        "analytics.view",
        "user.view",
        "kyc.review",
    ),
    label=("ప్లాట్‌ఫామ్ గణాంకాలు", "Platform stats"),
)
def platform_stats(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    section = _choice(args, "section", tuple(_SECTION_PERMS), None)
    if section is None:
        raise ValidationError("section is required.", "section తప్పనిసరి.")
    if not _may(ctx.principal, section):
        raise PermissionDeniedError(
            details={"required_permission": " or ".join(_SECTION_PERMS[section])}
        )
    data, cards, window = _section(ctx.db, section)
    return {"section": section, **data, "window": window, "cards": cards}
