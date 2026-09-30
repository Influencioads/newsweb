"""Background job runners for the assistant. See registry.py.

Each runner re-checks the permissions its tool demanded (the principal is
rebuilt from the live user row, so a role revoked since the request stops the
job), reports every phase through `job.step()` — which also commits, so a
provider bill or an article already made survives a later failure — and
returns `{"summary", "cards", ...}`.

`research_articles` is the owner's "crawl the Big Billion Days deals and write
five articles, five products each": search, read the pages ourselves, write
from those pages only, check every price against them, and file the result in
the review queue with a note saying which prices nobody could find.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select

from app.core.errors import (
    AiBudgetExceededError,
    AiQuotaExceededError,
    AppError,
    ConflictError,
    ValidationError,
)
from app.core.logging import get_logger
from app.db.base import utcnow
from app.models.ai import AiArticleDraft
from app.models.bulletin import AudioBulletin
from app.models.content import Article, WorkflowTransition
from app.models.enums import (
    ArticleStatus,
    AuditAction,
    BulletinStatus,
    IngestStatus,
    RewriteStatus,
    SourceBeat,
)
from app.models.ingestion import ContentSource, IngestedItem
from app.services import (
    ai_service,
    ai_usage_service,
    audit_service,
    bulletin_service,
    crawl_service,
    ingestion_service,
    settings_service,
    tiptap,
)
from app.services.assistant import tools_actions
from app.services.assistant.registry import JobContext, job_runner
from app.services.social_card_service import _foreign_glyph

logger = get_logger(__name__)

_STOP = (AiBudgetExceededError, AiQuotaExceededError)


def _require(job: JobContext, *permissions: str) -> None:
    for permission in permissions:
        job.principal.require(permission)


def _t(te: str, en: str) -> dict[str, str]:
    return {"te": te, "en": en}


def _why(exc: AppError, provider_key: str) -> str:
    """The error for a job card. Direct Gemini puts its key in the URL, and an
    httpx error string quotes the URL, so its details never go on a card."""
    detail = None if provider_key == "gemini" else (exc.details or {}).get("error")
    return (f"{exc.message_en} ({detail})" if detail else exc.message_en)[:300]


# --------------------------------------------------------------------------- #
# research_articles
# --------------------------------------------------------------------------- #
_JSON_ONLY = "Return JSON only - no prose, no code fences."

_WRITE_RULES = """You are a senior writer at a Telugu news website, writing for our own masthead.
Return JSON only - no prose, no code fences.
1. Use ONLY facts stated in the SOURCE MATERIAL. Never add a fact, figure, date, product or claim from memory.
2. Write in your own words, in natural modern Telugu. Never copy a sentence from the sources.
3. Never name any newspaper, TV channel, website, blog or publication - in Telugu or English script. No URLs in the copy.
4. Prices exactly as the sources state them. Leave out any item whose price the sources do not state. Never estimate, round or convert a price.
5. Sale dates and offer terms only as the sources give them.
6. Product and brand names may stay in English letters; everything else in Telugu script only."""

_TE_DIGITS = str.maketrans("౦౧౨౩౪౫౬౭౮౯", "0123456789")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_CURRENCY = re.compile(r"^\s*(₹|rs\.?|inr)\s*", re.IGNORECASE)
#: Host labels that name no outlet: a subdomain, a word every site uses, or a
#: shop — the retailer running a sale is what a deals story is about ("Big
#: Billion Days" is Flipkart's even when the brief does not say so).
_GENERIC_LABELS = frozenset(
    "www m amp en news live home blog shop store sale sales deals offers tech india "
    "telugu english hindi mobile web online com co org net gov edu "
    "amazon flipkart myntra meesho ajio croma reliancedigital vijaysales tatacliq "
    "jiomart nykaa snapdeal bigbasket blinkit zepto swiggy zomato".split()
)
#: How near a price must be written to its product's name on a page.
_REACH = 300


def _fold(text: str) -> str:
    """Telugu digits to ASCII, Indian digit grouping dropped."""
    return re.sub(r"(?<=\d),(?=\d)", "", (text or "").translate(_TE_DIGITS))


def _figure(n: str) -> str:
    return n.rstrip("0").rstrip(".") if "." in n else n


def _numbers(text: str) -> set[str]:
    """Every figure in `text`: '₹1,29,999' and '౧,౨౯,౯౯౯' are both '129999'."""
    return {_figure(n) for n in _NUMBER.findall(_fold(text))}


def _beside(name: str, figures: set[str], texts: list[str]) -> bool:
    """Is every figure written within `_REACH` characters of the product's
    most specific word (a model code like 's24', else its longest word) in
    one of `texts`? A deals page lists dozens of products; a price read off
    the wrong row is on the page all the same.

    ponytail: one anchor word and a character window — a brand-wide word
    ("iphone") on a page of iPhones still passes. Parse the page's product
    rows if that mistake shows up in review."""
    words = re.findall(r"\w+", name.casefold())
    coded = [w for w in words if not w.isalpha() and not w.isdigit()]
    anchor = max(coded or words, key=len, default="")
    if not anchor:
        return False
    for text in texts:
        folded = _fold(text).casefold()
        spots = [m.start() for m in re.finditer(re.escape(anchor), folded)]
        near = {
            _figure(m.group())
            for m in _NUMBER.finditer(folded)
            if any(abs(m.start() - s) <= _REACH for s in spots)
        }
        if figures <= near:
            return True
    return False


def _squash(text: str) -> str:
    return (text or "").casefold().replace(" ", "")


def _outlets(urls: list[str], allowed: str, names: list[str]) -> set[str]:
    """Names the copy must not carry: each source host's distinctive labels
    (gadgets360, economictimes) and our configured feeds' names in both
    scripts (ఈనాడు, సాక్షి — a Telugu outlet is named in Telugu). A name the
    brief, the angle or a product uses is the subject, not an outlet.

    ponytail: a plain substring, so a feed called సాక్షి also trips on
    సాక్షిగా ("as a witness"); the rewrite-once loop absorbs the rare false
    alarm. Match on word boundaries if it starts skipping good copy."""
    banned = set()
    for url in urls:
        for label in (urlsplit(url).hostname or "").lower().split(".")[:-1]:
            if len(label) >= 4 and label not in _GENERIC_LABELS:
                banned.add(label)
    banned |= {n for n in map(_squash, names) if len(n) >= 3}
    squashed = _squash(allowed)
    return {n for n in banned if n not in squashed}


def _strs(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    return [str(v).strip() for v in value or [] if str(v).strip()]


def _money(value: Any) -> str:
    return _CURRENCY.sub("", str(value or "")).strip()


def _source_material(pages: list[dict], found: dict, notes: str) -> str:
    parts = [f"[Page {i}] {p['url']}\n{p['text']}" for i, p in enumerate(pages, start=1)]
    if found.get("answer"):
        parts.append(f"[Search summary]\n{found['answer'][:3000]}")
    snippets = [
        f"- {s.get('title') or ''}: {s.get('snippet') or ''} ({s['url']})"
        for s in found.get("sources") or []
        if s.get("snippet")
    ]
    if snippets:
        parts.append("[Search snippets]\n" + "\n".join(snippets[:10]))
    if notes:
        parts.append(f"[Editor's notes]\n{notes}")
    return "\n\n".join(parts)


def _write_prompt(brief: str, angle: str, items: int, material: str, retry: str | None) -> str:
    if items:
        shape = (
            f"Write ONE Telugu article on this angle featuring up to {items} items. JSON:\n"
            '{"title_te": str, "summary_te": str (max 40 words), "intro_te": [2-3 paragraphs], '
            '"items": [{"name": str, "price": str, "mrp": str, "discount": str, '
            '"offer_te": str, "highlight_te": str, "source_url": str}], '
            '"closing_te": [1-2 paragraphs]}\n'
            "price/mrp: exactly as the source writes them. discount: only the cut from "
            "MRP as the source states it (e.g. 20% off), else empty - a bank or card "
            "discount is an offer, not this. source_url: the [Page]/snippet URL the price "
            "was read from. offer_te: bank/card offers and sale dates the source states. "
            "highlight_te: one line on why it stands out."
        )
    else:
        shape = (
            "Write ONE Telugu news article on this angle. JSON:\n"
            '{"title_te": str, "summary_te": str (max 40 words), "body_te": [6-10 paragraphs]}'
        )
    fix = f"\nYour previous answer was rejected: {retry}. Fix that.\n" if retry else ""
    return (
        f"Editor's brief: {brief}\nThis article's angle: {angle}\n{shape}\n{fix}\n"
        f"SOURCE MATERIAL:\n{material}"
    )


def _ground(items: list[dict], pages: list[str], search_text: str) -> tuple[list[dict], list[dict]]:
    """`(kept, dropped)`. An item needs a price. Every figure it carries —
    price, MRP, discount, offer, highlight — must be in the material, or it
    is dropped: rule 4 of the brief, enforced rather than asked for. A kept
    item is `verified_in_page` when its price is written beside its name on
    a page we fetched (or in the editor's notes, which are `pages` too), and
    `search_only` when the figures are only somewhere in the material."""
    on_page = _numbers("\n".join(pages))
    anywhere = on_page | _numbers(search_text)
    kept, dropped = [], []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        item = {
            "name": str(raw.get("name") or "").strip()[:200],
            "price": _money(raw.get("price")),
            "mrp": _money(raw.get("mrp")),
            "discount": str(raw.get("discount") or "").strip(),
            "offer_te": str(raw.get("offer_te") or "").strip(),
            "highlight_te": str(raw.get("highlight_te") or "").strip(),
            "source_url": str(raw.get("source_url") or "").strip(),
        }
        price = _numbers(item["price"])
        if not price or not item["name"]:
            continue
        figures = price | _numbers(
            " ".join(item[k] for k in ("mrp", "discount", "offer_te", "highlight_te"))
        )
        if not figures <= anywhere:
            dropped.append({**item, "grounding": "unverified"})
            continue
        beside = figures <= on_page and _beside(item["name"], price, pages)
        kept.append({**item, "grounding": "verified_in_page" if beside else "search_only"})
    return kept, dropped


def _screen(
    copy: dict, items: list[dict], wanted: int, outlets: set[str], known: set[str]
) -> str | None:
    """Why this copy must not be filed, or None. `known`: every figure in the
    material and the brief — a price or a year in the prose must be one."""
    prose = " ".join([copy["title"], copy["summary"], *copy["paragraphs"]])
    text = " ".join(
        [prose]
        + [
            f"{i['name']} {i['price']} {i['mrp']} {i['discount']} {i['offer_te']} {i['highlight_te']}"
            for i in items
        ]
    )
    lowered = text.casefold()
    if not copy["title"]:
        return "there was no headline"
    if wanted and not copy["intro"]:
        return "there was no introduction"
    if _foreign_glyph(text):
        return "it contains letters from a script that is neither Telugu nor English"
    if "http" in lowered or "www." in lowered:
        return "it contains a web address"
    squashed = _squash(text)
    named = sorted(n for n in outlets if n in squashed)
    if named:
        return f"it names a publication ({named[0]})"
    # Three digits and up: prices, years, counts in the thousands. A "5" in
    # "five offers" is the model counting, not a fact it could have invented.
    stray = sorted(n for n in _numbers(prose) if len(n) >= 3 and n not in known)
    if stray:
        return f"it states a figure the sources do not ({stray[0]})"
    if wanted and len(items) < wanted / 2:
        return f"only {len(items)} of {wanted} items had a price stated by the sources"
    if not wanted and len(copy["paragraphs"]) < 3:
        return "the article was too short"
    return None


def _too_close(copy: dict, pages: list[dict], threshold: int) -> str | None:
    """The crawl rewrite's copying check, against each page we read. Token
    overlap with an English page is near zero whatever the copy does, so this
    only ever bites on a Telugu source — the one that can be copied."""
    if not threshold:
        return None
    ours = " ".join(copy["paragraphs"])
    similar = max(
        (crawl_service.similarity_percent(ours, pg["text"]) for pg in pages), default=0
    )
    return f"it is too close to a source ({similar}%)" if similar >= threshold else None


def _body(copy: dict, items: list[dict]) -> dict:
    """The tiptap document, built by our code: the model supplies words, never
    structure, and the price line is ours so its shape cannot drift."""
    content = [tiptap.paragraph(p) for p in copy["intro"]]
    for item in items:
        content.append(tiptap.heading(item["name"], 3))
        extras = ", ".join(x for x in (f"MRP ₹{item['mrp']}" if item["mrp"] else "", item["discount"]) if x)
        content.append(tiptap.paragraph(f"ధర: ₹{item['price']}" + (f" ({extras})" if extras else "")))
        content += [tiptap.paragraph(x) for x in (item["offer_te"], item["highlight_te"]) if x]
    content += [tiptap.paragraph(p) for p in copy["closing"]]
    if items:
        stamp = utcnow().astimezone(tools_actions.IST).strftime("%d-%m-%Y")
        content.append(tiptap.paragraph(f"గమనిక: ఈ ధరలు {stamp} నాటివి; సేల్ సమయంలో మారవచ్చు."))
    return {"type": "doc", "content": content}


def _copy(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    intro, closing, body = _strs(raw.get("intro_te")), _strs(raw.get("closing_te")), _strs(raw.get("body_te"))
    return {
        "title": str(raw.get("title_te") or "").strip()[:400],
        "summary": str(raw.get("summary_te") or "").strip()[:1000],
        "intro": intro or body,
        "closing": closing if intro else [],
        "paragraphs": (intro + closing) if intro else body,
        "items": raw.get("items") if isinstance(raw.get("items"), list) else [],
    }


def _angles(job: JobContext, brief: str, given: list[str], count: int) -> list[str]:
    """The given angles, plus ONE bulk-model call for the missing ones."""
    if len(given) >= count:
        return given[:count]
    if count == 1:
        return [brief]
    bulk = tools_actions.llm(job.db, bulk=True)
    missing = count - len(given)
    prompt = (
        f'A Telugu news site will publish {count} separate articles on: "{brief}".\n'
        f"Angles already chosen: {given or 'none'}.\n"
        f"Propose {missing} more angles, each clearly different from every other (for a "
        "deals brief: a product category or a price band, e.g. 'laptops under ₹50,000'). "
        'Short English phrases, at most 8 words each. JSON: {"angles": [str]}'
    )
    out = tools_actions.paid(
        job.db, bulk, job.user_id, "draft",
        lambda: bulk._parse_json(bulk._complete(prompt, rules=_JSON_ONLY, timeout=60)),
    )
    proposed = out.get("angles") if isinstance(out, dict) else out
    seen = {a.casefold() for a in given}
    for angle in _strs(proposed):
        if angle.casefold() not in seen and len(given) < count:
            given.append(angle[:200])
            seen.add(angle.casefold())
    return given


def _read_sources(found: dict, *, want: int = 3, attempts: int = 5) -> list[dict]:
    """Fetch up to `want` of the search results ourselves — the only text a
    price counts as verified against."""
    pages = []
    for source in (found.get("sources") or [])[:attempts]:
        page = tools_actions.safe_extract(source["url"])
        if page["status"] == "ok" and page.get("text"):
            pages.append(page)
            if len(pages) >= want:
                break
    return pages


def _one_article(
    job: JobContext, p: dict, writer: Any, angle: str, index: int, total: int
) -> dict:
    db, uid = job.db, job.user_id
    brief, items_wanted = p["brief"], p["items_per_article"]
    head = f"Article {index + 1}/{total}"
    tick = lambda phase, text: job.step(100 * (index + phase / 5) / total, f"{head}: {text}")  # noqa: E731

    # The tool screened what the user typed; an angle the model proposed is
    # screened here, before anything is spent on it.
    tools_actions._screen_topic(db, angle)
    found: dict = {"answer": "", "sources": []}
    if p["research"]:
        tick(0, f"researching {angle[:60]}")
        ask = (
            f"list up to {items_wanted * 2} of the most notable deals on well-known brands, each "
            "with the exact product name, sale price, MRP or original price, discount, bank/card "
            "offers and sale dates, and the page where each is reported"
            if items_wanted
            else "the key facts, figures, dates and names reported, and where each is reported"
        )
        found = tools_actions.research(
            db, writer, uid,
            f"{brief} — {angle}: {ask}. Only what the sources state; say so when a figure is not stated.",
            recency=p["recency"], timeout=90,
        )
    tick(1, "reading the sources")
    pages = _read_sources(found)
    if not pages and not found.get("answer") and not p["notes"]:
        return {"angle": angle, "skipped": "no source material was found"}

    material = _source_material(pages, found, p["notes"])
    # The editor's notes are source material the editor vouches for: a price
    # copied from them is as good as one read off a page.
    grounds = [pg["text"] for pg in pages] + ([p["notes"]] if p["notes"] else [])
    search_text = " ".join(
        [found.get("answer") or ""] + [s.get("snippet") or "" for s in found.get("sources") or []]
    )
    known = _numbers(f"{material} {brief} {angle}")
    urls = [pg["url"] for pg in pages] + [s["url"] for s in found.get("sources") or []]
    subject = f"{brief} {angle} {p['notes']}"
    threshold = settings_service.get_int(db, "crawl.similarity_block_percent")

    reason = None
    for attempt in range(2):
        tick(2 + attempt, "writing" if not attempt else f"rewriting ({reason})")
        prompt = _write_prompt(brief, angle, items_wanted, material, reason)
        copy = _copy(
            tools_actions.paid(
                db, writer, uid, "draft",
                lambda prompt=prompt: writer._parse_json(
                    writer._complete(prompt, rules=_WRITE_RULES, timeout=120)
                ),
            )
        )
        items, dropped = _ground(copy["items"], grounds, search_text) if items_wanted else ([], [])
        items = items[:items_wanted]
        outlets = _outlets(urls, " ".join([subject, *(i["name"] for i in items)]), p["outlet_names"])
        reason = _screen(copy, items, items_wanted, outlets, known) or _too_close(copy, pages, threshold)
        if reason is None:
            break
    if reason is not None:
        return {"angle": angle, "skipped": reason}
    # What came back may be about something no model should write, whatever
    # the angle said.
    tools_actions._screen_topic(db, " ".join([copy["title"], copy["summary"], *copy["paragraphs"]]))

    tick(4, "filing it for review")
    body = _body(copy, items)
    _, plain, _, words, _ = tiptap.derive(body)
    unverified = dropped
    search_only = [i for i in items if i["grounding"] == "search_only"]
    verified = len(items) - len(search_only)
    draft = AiArticleDraft(
        suggestion_id=None,
        title_te=copy["title"],
        summary_te=copy["summary"] or (copy["paragraphs"][0][:300] if copy["paragraphs"] else None),
        body=body,
        body_plain=plain,
        category_id=p["category_id"],
        district_id=p["district_id"],
        engine=writer.key,
        model=getattr(writer, "model_name", None),
        confidence=round(verified / len(items), 2) if items else (0.6 if pages else 0.4),
        word_count=words,
        created_by=uid,
    )
    db.add(draft)
    db.flush()
    article = ai_service.convert_draft(db, draft.id, job.principal)

    sources = list(dict.fromkeys(urls))[:8]  # the pages read first, then the search's
    lines = [f"Sanjaya (assistant) job #{job.job.id}: written from web sources - check every fact before approving."]
    if items:
        lines.append(
            f"{len(items)} products: {verified} prices found beside the product on a fetched "
            f"page or in the editor's notes, {len(search_only)} only elsewhere in the material."
        )
    if unverified:
        lines.append(
            "Left out, a figure not in the sources: "
            + "; ".join(f"{i['name']} (₹{i['price']})" for i in unverified)
        )
    if search_only:
        lines.append(
            "Check these prices, not found beside the product on a fetched page: "
            + "; ".join(f"{i['name']} (₹{i['price']})" for i in search_only)
        )
    lines.append("Needs a hero photo before publishing.")
    lines.append("Sources: " + " ; ".join(sources))
    note = "\n".join(lines)[:4000]
    # No review screen renders a per-article note yet, so it goes where the
    # history does — the SUBMITTED transition convert_draft just wrote — and
    # on the job card, which the requester sees.
    db.flush()
    transition = db.scalar(
        select(WorkflowTransition)
        .where(WorkflowTransition.article_id == article.id)
        .order_by(WorkflowTransition.id.desc())
        .limit(1)
    )
    if transition is not None:
        transition.note = f"{transition.note}\n{note}" if transition.note else note
    audit_service.record(
        db,
        action=AuditAction.CREATE,
        entity_type="article",
        entity_id=article.id,
        actor=job.principal.user,
        after={"workflow_state": article.workflow_state, "ai_generated": True, "items": len(items)},
        note=f"assistant: research_articles job {job.job.id}",
    )
    return {
        "id": article.id,
        "short_id": article.short_id,
        "title": article.title_te,
        "workflow_state": article.workflow_state,
        "angle": angle,
        "items": len(items),
        "unverified": [i["name"] for i in unverified],
        "search_only": [i["name"] for i in search_only],
        "sources": sources,
        "review_note": note,
    }


@job_runner("research_articles")
def research_articles(job: JobContext) -> dict[str, Any]:
    _require(job, "ai.use", "article.create")
    p = job.params
    count = int(p["count"])
    writer = (
        tools_actions.research_provider(job.db) if p["research"] else tools_actions.llm(job.db)
    )
    if writer.key == "heuristic":
        raise ValidationError(
            "No AI provider key is configured (Settings → AI).",
            "AI ప్రొవైడర్ కీ లేదు (సెట్టింగ్స్ → AI).",
        )
    job.step(1, "Choosing the angles")
    angles = _angles(job, p["brief"], list(p.get("angles") or []), count)
    # Our own feeds are the outlets most likely to turn up in Telugu copy.
    p["outlet_names"] = [
        name
        for row in job.db.execute(select(ContentSource.name, ContentSource.name_te).limit(500))
        for name in row
        if name
    ]

    created: list[dict] = []
    skipped: list[dict] = []
    stopped = None
    for index, angle in enumerate(angles):
        if not settings_service.ai_enabled(job.db):
            stopped = "AI was switched off."
            break
        try:
            row = _one_article(job, p, writer, angle, index, len(angles))
        except _STOP as exc:
            job.db.rollback()
            stopped = exc.message_en
            break
        except AppError as exc:
            job.db.rollback()
            row = {"angle": angle, "skipped": _why(exc, writer.key)}
        except Exception:  # noqa: BLE001 — one bad article must not lose the others
            job.db.rollback()
            logger.exception("assistant_article_failed", job_id=job.job.id, angle=angle[:80])
            row = {"angle": angle, "skipped": "failed unexpectedly"}
        (skipped if "skipped" in row else created).append(row)
        job.step(100 * (index + 1) / len(angles), f"Article {index + 1}/{len(angles)} done")

    unverified = sum(len(a["unverified"]) for a in created)
    summary = (
        f"Created {len(created)} of {count} articles in the review queue (SUBMITTED, filed "
        "under the user's name, so a different editor must approve them); "
        f"{unverified} items left out because their prices were not in the sources; "
        "every article needs a hero photo before publishing."
    )
    if skipped:
        summary += " Skipped: " + "; ".join(f"{s['angle']} ({s['skipped']})" for s in skipped) + "."
    if stopped:
        summary += f" Stopped early: {stopped}"
    items_note = lambda a: (  # noqa: E731
        _t(
            f"{a['items']} ఉత్పత్తులు · ధర దొరకని {len(a['unverified'])} తొలగించాం · ప్రధాన ఫోటో కావాలి",
            f"{a['items']} products · {len(a['unverified'])} unverified left out · needs hero",
        )
        if a["items"]
        else _t("వార్తా కథనం · ప్రధాన ఫోటో కావాలి", "news article · needs hero")
    )
    all_sources = list(dict.fromkeys(u for a in created for u in a["sources"]))
    cards: list[dict] = [
        {
            "type": "articles",
            "title": _t("సమీక్ష క్యూలో కొత్త కథనాలు", "New articles in the review queue"),
            "items": [
                {
                    "id": a["id"],
                    "short_id": a["short_id"],
                    "title": a["title"],
                    "workflow_state": a["workflow_state"],
                    "note": items_note(a),
                }
                for a in created
            ],
        }
    ]
    if all_sources:
        cards.append(
            {
                "type": "sources",
                "title": _t("వాడిన మూలాలు", "Sources used"),
                "items": [{"title": u, "url": u} for u in all_sources[:30]],
            }
        )
    return {"summary": summary, "cards": cards, "articles": created, "skipped": skipped}


# --------------------------------------------------------------------------- #
# crawl_fetch
# --------------------------------------------------------------------------- #
@job_runner("crawl_fetch")
def crawl_fetch(job: JobContext) -> dict[str, Any]:
    """Poll each matching source now (due or not). Fetch only: no auto-import,
    no rewrite — `ingestion_service.run_all` would also auto-publish."""
    _require(job, "taxonomy.manage")
    p = job.params
    stmt = select(ContentSource).where(ContentSource.is_active.is_(True))
    if p.get("beat"):
        stmt = stmt.where(ContentSource.beat == SourceBeat(p["beat"]))
    if p.get("source_id"):
        stmt = stmt.where(ContentSource.id == p["source_id"])
    sources = list(job.db.scalars(stmt.order_by(ContentSource.id).limit(200)).all())
    rows = []
    for index, source in enumerate(sources):
        job.step(100 * index / max(1, len(sources)), f"Fetching {source.name} ({index + 1}/{len(sources)})")
        out = ingestion_service.fetch_source(job.db, source)
        rows.append(
            {"source": source.name, "status": out.get("status"), "new": int(out.get("new") or 0)}
        )
    job.db.commit()
    new = sum(r["new"] for r in rows)
    failed = [r["source"] for r in rows if r["status"] not in ("ok", "not_modified")]
    summary = f"Fetched {len(rows)} sources: {new} new items in the ingestion queue."
    if failed:
        summary += f" Failed: {', '.join(failed)}."
    return {
        "summary": summary,
        "sources": len(rows),
        "new_items": new,
        "failed": failed,
        "cards": [
            {
                "type": "table",
                "title": _t("ఫీడ్ క్రాల్", "Feed crawl"),
                "columns": [
                    {"key": "source", "label": _t("మూలం", "Source")},
                    {"key": "status", "label": _t("స్థితి", "Status")},
                    {"key": "new", "label": _t("కొత్తవి", "New"), "align": "right"},
                ],
                "rows": rows,
            }
        ],
    }


# --------------------------------------------------------------------------- #
# rewrite_items
# --------------------------------------------------------------------------- #
@job_runner("rewrite_items")
def rewrite_items(job: JobContext) -> dict[str, Any]:
    """The single-item rewrite + import routes, in a loop, as this person.

    `rewrite_one` checks only the newsroom budget (the crawl beat bills no one);
    a person asking also spends their own allowance, so `guard` comes first.
    """
    _require(job, "ai.use", "article.create")
    db, uid, p = job.db, job.user_id, job.params
    ids = list(p["item_ids"])
    imported: list[dict] = []
    outcomes: dict[str, int] = {}
    passed: list[dict] = []
    stopped = None
    for index, item_id in enumerate(ids):
        if not crawl_service.rewrite_enabled(db):  # switched off mid-run: stop spending
            stopped = "AI rewriting was switched off."
            break
        item = db.get(IngestedItem, item_id)
        if item is None or item.status != IngestStatus.NEW or item.article_id:
            continue
        job.step(100 * index / len(ids), f"Item {index + 1}/{len(ids)}: {item.title[:60]}")
        try:
            if item.rewrite_status == RewriteStatus.NONE:
                ai_usage_service.guard(db, uid)
                rewrite = crawl_service.rewrite_one(db, item, actor_id=uid)
                db.commit()  # the rewrite and its bill stand whatever the import does
                if rewrite.status != RewriteStatus.READY:
                    key = str(rewrite.status)
                    outcomes[key] = outcomes.get(key, 0) + 1
                    passed.append({"title": item.title[:120], "outcome": key, "reason": rewrite.refusal_reason or ""})
                    continue
            article = ingestion_service.import_item(
                db, item, actor_id=uid, district_id=p.get("district_id")
            )
            audit_service.record(
                db,
                action=AuditAction.CREATE,
                entity_type="article",
                entity_id=article.id,
                actor=job.principal.user,
                after={"from_ingested_item": item.id, "workflow_state": article.workflow_state},
                note=f"assistant: rewrite_items job {job.job.id}",
            )
            imported.append(
                {
                    "id": article.id,
                    "short_id": article.short_id,
                    "title": article.title_te,
                    "workflow_state": article.workflow_state,
                    "note": _t("ప్రధాన ఫోటో కావాలి", "needs hero") if not article.hero_media_id else None,
                }
            )
        except _STOP as exc:
            db.rollback()
            stopped = exc.message_en
            break
        except Exception as exc:  # noqa: BLE001 — one bad item must not end the pass
            db.rollback()
            if not isinstance(exc, AppError):
                logger.exception("assistant_rewrite_item_failed", job_id=job.job.id, item_id=item_id)
            outcomes["failed"] = outcomes.get("failed", 0) + 1
            passed.append(
                {
                    "title": item.title[:120],
                    "outcome": "failed",
                    "reason": exc.message_en if isinstance(exc, AppError) else "failed unexpectedly",
                }
            )
    job.db.commit()
    summary = f"Imported {len(imported)} of {len(ids)} items into the review queue (SUBMITTED, under the user's name)."
    if outcomes:
        summary += " Not imported: " + ", ".join(f"{n} {k}" for k, n in outcomes.items()) + "."
    if stopped:
        summary += f" Stopped early: {stopped}"
    cards: list[dict] = [
        {
            "type": "articles",
            "title": _t("సమీక్ష క్యూలోకి వచ్చినవి", "Imported for review"),
            "items": [{k: v for k, v in a.items() if v is not None} for a in imported],
        }
    ]
    if passed:
        cards.append(
            {
                "type": "table",
                "title": _t("దిగుమతి కానివి", "Not imported"),
                "columns": [
                    {"key": "title", "label": _t("శీర్షిక", "Headline")},
                    {"key": "outcome", "label": _t("ఫలితం", "Outcome")},
                    {"key": "reason", "label": _t("కారణం", "Reason")},
                ],
                "rows": passed,
            }
        )
    return {"summary": summary, "imported": imported, "outcomes": outcomes, "cards": cards}


# --------------------------------------------------------------------------- #
# bulletin
# --------------------------------------------------------------------------- #
@job_runner("bulletin")
def bulletin(job: JobContext) -> dict[str, Any]:
    """Script and record one slot, and hold it at READY — never publish.

    Nothing touches the slot's row until there are stories to read, so a
    filter that matches nothing leaves a bulletin the desk is holding as it
    was. From the claim to the end of the render it is one transaction, as for
    the Regenerate button: the beat and the retry task never see a half-made
    row (a committed SCRIPTED row is one the retry would record a second time,
    in parallel). Once committed, `requested_by` with `published_at` cleared
    is what keeps both from putting it on air — even if this render fails and
    the retry is the one that finishes it.
    """
    _require(job, "voice.manage")
    db, p = job.db, job.params
    if not bulletin_service.enabled(db):
        raise ValidationError(
            message_en="Turn the audio bulletin on in Settings first.",
            message_te="ముందుగా సెట్టింగ్స్‌లో ఆడియో బులెటిన్‌ను ఆన్ చేయండి.",
        )
    day, slot, minutes = date.fromisoformat(p["date"]), int(p["slot"]), int(p["minutes"])
    ai_usage_service.guard(db, job.user_id)  # the recording is a paid call in this person's name
    job.step(5, f"Choosing the stories and recording about {minutes} min")
    row: AudioBulletin = bulletin_service.get_or_create(db, day, slot)
    if row.status == BulletinStatus.PUBLISHED:
        raise ConflictError(
            "That bulletin went live meanwhile. Pick another slot.",
            "ఈలోగా ఆ బులెటిన్ ప్రసారమైంది. మరో స్లాట్ ఎంచుకోండి.",
        )
    if p.get("article_ids"):
        ids = list(dict.fromkeys(p["article_ids"]))
        rows = db.scalars(
            select(Article).where(
                Article.id.in_(ids),
                Article.status == ArticleStatus.PUBLISHED,
                Article.deleted_at.is_(None),
            )
        ).all()
        by_id = {a.id: a for a in rows}
        articles = [by_id[i] for i in ids if i in by_id]
    else:
        articles = bulletin_service.select_stories(
            db,
            day,
            slot,
            limit=max(3, round(minutes * 2.4)),
            category_ids=[p["category_id"]] if p.get("category_id") else None,
            district_id=p.get("district_id"),
            since=utcnow() - timedelta(hours=int(p.get("hours_back") or 12)),
        )
    if not articles:  # raised before any write: run_job's rollback leaves the row as it was
        raise ValidationError(
            "No published stories matched, so there is nothing to read. Widen hours_back or drop the filters.",
            "సరిపోయే ప్రచురిత కథనాలు లేవు. hours_back పెంచండి లేదా ఫిల్టర్లు తీసేయండి.",
        )
    if row.url:
        # New audio over old, as Regenerate does: a new revision is a new
        # storage key, never the CDN's immutable copy of the last one.
        row.revision += 1
        row.attempts = 0
    row.requested_by, row.published_at = job.user_id, None
    bulletin_service.script_bulletin(db, row, articles=articles, seconds=minutes * 60)
    bulletin_service.render(db, row, requested_by=job.user_id)
    db.commit()
    if row.status != BulletinStatus.READY:
        raise ConflictError(
            f"The bulletin could not be recorded: {row.error}",
            f"బులెటిన్ రికార్డ్ కాలేదు: {row.error}",
            {"bulletin_id": row.id},
        )
    seconds = row.duration_sec or round(row.char_count / bulletin_service.CHARS_PER_SECOND)
    cards: list[dict] = [
        {
            "type": "bulletin",
            "id": row.id,
            "date": day.isoformat(),
            "slot": slot,
            "slot_label_te": row.slot_label_te,
            "status": str(row.status),
            "url": row.url,
            "duration_sec": row.duration_sec,
        }
    ]
    if job.principal.has("voice.manage") and job.principal.level >= 60:
        cards.append(
            {
                "type": "action",
                "action": "publish_bulletin",
                "label": _t("బులెటిన్ ప్రసారం", "Publish bulletin"),
                "summary": _t(
                    f"{row.slot_label_te} ({day.isoformat()} {slot}:00)",
                    f"Put the {day.isoformat()} {slot}:00 bulletin on air",
                ),
                "params": {"bulletin_id": row.id},
            }
        )
    return {
        "summary": (
            f"Bulletin #{row.id} for {day.isoformat()} {slot}:00 IST is recorded and held at "
            f"READY (not published): {len(row.items)} stories, about {seconds} s. A desk editor "
            "publishes it from the bulletin card or the Bulletins screen."
        ),
        "bulletin_id": row.id,
        "stories": len(row.items),
        "duration_sec": seconds,
        "cards": cards,
    }
