"""The newsroom's house style, as data the writer is handed on every call.

`newsroom_style.json` is the "training". It was distilled from 12,033 Telugu
news articles by 28 outlets (plus 2,106 video and web-story titles): one
analyst per story type, cross-cutting specialists, a chief-editor synthesis and
an adversarial review. Nothing here is fine-tuning — the guide rides in the
prompt, so regenerating the JSON re-trains the writer with no code change.

Three jobs, all stdlib and all deterministic:

  * **briefs** (`writer_brief`, `headline_brief`, `card_brief`, `seo_brief`) —
    the guidance a prompt carries. The static part (voice, core rules,
    headline and language rules, attribution verbs, the avoid list by
    severity) comes
    FIRST and is byte-identical across calls, so a provider's prompt-prefix
    cache can reuse it; only the story type's part varies. Per the guide's
    PAYLOAD note it never carries `evidence`, `lint`, `detect_hints`,
    `words_min` or the 70 canonical spellings — those are fixed in code by
    `canonicalize`, which is cheaper and certain where a prompt is neither.
    Type keys are written bare, never inside double quotes: the rewrite
    prompt's tests assert that a prompt with no taxonomy carries no quoted
    "category" or "breaking" key, and `breaking` is also a story type.
  * **canonicalize** — the majority spellings (సీఎం not సిఎం, నుంచి not నుండి),
    applied to whole Telugu tokens only.
  * **lint_copy** — the checks a machine can make without a model: headline
    length and punctuation, banned phrases, lede and paragraph length, Latin
    density, placeholder leaks, the refusal screen. Pure; free to run on every
    rewrite and every editor's draft.

Matching is never substring and never `\\b`: Python treats Telugu vowel signs
as non-word characters, so `\\bఐటి\\b` fires inside longer words. A token
boundary here is "no Telugu letter, sign, ZWNJ or ZWJ, and no Latin word
character, on either side", and a token may carry one trailing case suffix.
"""

from __future__ import annotations

import functools
import json
import re
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_PATH = Path(__file__).with_name("newsroom_style.json")

_TE = "ఀ-౿‌‍"
_LEFT = rf"(?<![{_TE}\w])"
_RIGHT = rf"(?![{_TE}\w])"
#: One case suffix a token may carry (lint.notes MATCHING), with or without
#: the ZWNJ that follows a halant stem.
_SUFFIXES = ("లో", "కు", "కి", "ను", "పై", "తో", "ది", "గా", "ల")
_SUFFIX = "(?:‌?(?:" + "|".join(_SUFFIXES) + "))?"
_VIRAMA = "్"
_ZWNJ = "‌"

#: Said in the headline section of every brief. A device that withholds is
#: only honest when the body pays it off; when none fits, the plain fact wins.
HONESTY_LINE = (
    "Honesty: a headline may withhold one detail but never promise what the "
    "body does not deliver; if no device fits honestly, write the plain fact "
    "headline."
)

_IST = timezone(timedelta(hours=5, minutes=30))


# --------------------------------------------------------------------------- #
# The data
# --------------------------------------------------------------------------- #
@functools.cache
def guide() -> dict:
    return json.loads(_PATH.read_text(encoding="utf-8"))


@functools.cache
def _types() -> dict[str, dict]:
    return {t["key"]: t for t in guide()["story_types"]}


@functools.cache
def _devices() -> dict[str, dict]:
    return {d["key"]: d for d in guide()["curiosity_devices"]}


def type_keys() -> tuple[str, ...]:
    return tuple(_types())


def story_type(key: str | None) -> dict | None:
    return _types().get(key or "")


def headline_cap(key: str | None) -> int:
    """The type's headline ceiling in code points, else the global one."""
    found = story_type(key)
    return int(found["headline_max_chars"]) if found else int(guide()["lint"]["headline_max_chars"])


def device_label(key: str) -> str:
    """The Telugu name of a curiosity device; `straight` is the plain fact
    headline every set of options starts with. Empty for an unknown key."""
    if key == "straight":
        return "సూటి వార్త"
    return (_devices().get(key) or {}).get("label_te", "")


# --------------------------------------------------------------------------- #
# Matching
# --------------------------------------------------------------------------- #
def _flex(phrase: str) -> str:
    """A phrase as a regex body: any run of spaces, the ZWNJ optional."""
    return re.escape(phrase).replace("\\ ", r"\s+").replace(_ZWNJ, _ZWNJ + "?")


@functools.cache
def _term(phrase: str) -> re.Pattern[str]:
    """A whole token with one optional case suffix; a trailing '-' makes it a
    stem matched at the start of a token (lint.notes MATCHING)."""
    if phrase.endswith("-"):
        return re.compile(_LEFT + _flex(phrase[:-1]), re.IGNORECASE)
    return re.compile(_LEFT + _flex(phrase) + _SUFFIX + _RIGHT, re.IGNORECASE)


@functools.cache
def _stem(word: str) -> re.Pattern[str]:
    """Word-start match, any ending: for detection hints and screens."""
    return re.compile(_LEFT + _flex(word), re.IGNORECASE)


# --------------------------------------------------------------------------- #
# Detection
# --------------------------------------------------------------------------- #
#: Source beat / category slug / section → story type. Beats are
#: `SourceBeat` values; slugs are the seeded nav sections.
_HINT_TYPES = {
    "film": "film_news",
    "cinema": "film_news",
    "entertainment": "film_news",
    "movies": "film_news",
    "sports": "sports",
    "govt_jobs": "jobs_education",
    "jobs": "jobs_education",
    "education": "jobs_education",
    "business": "business_markets",
    "tech": "tech_gadgets",
    "technology": "tech_gadgets",
    "national": "national",
    "international": "international",
    "world": "international",
    "district_local": "local_district",
    "districts": "local_district",
    "devotional": "devotional_festival",
    "health": "health_lifestyle",
    "lifestyle": "health_lifestyle",
    "food": "health_lifestyle",
    "crime": "crime",
    "breaking": "breaking",
    "politics": "politics",
    "opinion": "editorial_opinion",
    "best-deals": "deals_offers",
    "deals": "deals_offers",
    "inspiring": "human_interest_viral",
    "zero-to-hero": "human_interest_viral",
}
#: lint.notes DETECTION tie-break: a death is the news first, then hard news.
_PRIORITY = (
    "obituary", "accident_disaster", "breaking", "crime", "court_legal", "weather",
    "politics", "governance", "national", "international",
)
#: Padding for `candidates` when nothing scores: the commonest AP/TS desks.
_FALLBACK = ("local_district", "governance", "politics")
_HEADLINE_WEIGHT, _LEDE_WEIGHT, _HINT_WEIGHT = 3, 1, 2
#: A hint alone, or one headline hit, is enough; lede hits alone are not —
#: `detect_type` measures the threshold on the headline-and-hint part only.
_THRESHOLD = 2
_LEDE_CHARS = 400


def _hinted(hint: str | Iterable[str] | None) -> set[str]:
    hints = [hint] if isinstance(hint, str) else list(hint or ())
    return {_HINT_TYPES[h.strip().lower()] for h in hints if h and h.strip().lower() in _HINT_TYPES}


@functools.cache
def _hint_pattern(word: str) -> re.Pattern[str]:
    """A detect_hint's matcher. Telugu hints are stems (any ending). A Latin
    hint must end where its letters do — `mAh` is not Maharashtra, `EV` not
    Every, `LIVE` not Liver — though a Telugu suffix may follow (EVలు). The
    two-letter `స్టే` (a court's stay) is a whole token, or it fires inside
    స్టేషన్, స్టేడియం and స్టేట్ (28 corpus headlines)."""
    if re.search("[A-Za-z]", word):
        return re.compile(_LEFT + _flex(word) + r"(?![A-Za-z])", re.IGNORECASE)
    return _term(word) if word == "స్టే" else _stem(word)


def _scores(
    headline: str, text: str, hint: str | Iterable[str] | None
) -> list[tuple[int, str, int]]:
    """(score, key, the headline-and-hint part of the score) for every type
    that scored, best first, ties by priority."""
    lede = (text or "")[:_LEDE_CHARS]
    hinted = _hinted(hint)
    order = {key: i for i, key in enumerate(dict.fromkeys(_PRIORITY + type_keys()))}
    scored = []
    for key, entry in _types().items():
        head = _HINT_WEIGHT if key in hinted else 0
        lede_score = 0
        for word in entry["detect_hints"]:
            pattern = _hint_pattern(word)
            if pattern.search(headline or ""):
                head += _HEADLINE_WEIGHT
            if pattern.search(lede):
                lede_score += _LEDE_WEIGHT
        if head + lede_score:
            scored.append((head + lede_score, key, head))
    scored.sort(key=lambda row: (-row[0], order[row[1]]))
    return scored


#: Formats whose guide changes what the writer does (a review needs a
#: reviewer, an editorial a brief, a deal a product and a price): a wrong
#: one turns an ordinary story into a refusal, so a keyword pick needs two
#: headline hits or a hint. The cotton-price protest that tripped
#: "తగ్గింపు" into deals_offers and was refused as thin_source is the case.
_SPECIAL = frozenset(
    {"deals_offers", "film_review", "editorial_opinion", "explainer", "interview", "obituary", "breaking"}
)
#: Desks where the learned model is right ≥ 0.83 of the time it is
#: confident (held-out, 2026-10-03); on the small formats it is not.
_RELIABLE = frozenset(
    {"film_news", "politics", "business_markets", "sports", "health_lifestyle", "crime",
     "tech_gadgets", "governance", "astrology"}
)
_MODEL_MARGIN = 6.0
_MODEL_PATH = Path(__file__).with_name("story_type_model.json")
_MODEL_TOKEN = re.compile(r"[ఀ-౿‌‍]+|[A-Za-z]{2,}")


@functools.cache
def _model() -> dict:
    return json.loads(_MODEL_PATH.read_text(encoding="utf-8"))


def _model_rank(headline: str, text: str) -> list[tuple[float, str]]:
    """The learned story-type model (`story_type_model.json`, naive Bayes over
    the labelled corpus): every type's score, best first. Its `meta` says how
    the features are built; this must build them the same way."""
    feats: dict[str, int] = {}
    for weight, part in ((3, headline or ""), (1, " ".join((text or "").split()[:60]))):
        for token in _MODEL_TOKEN.findall(part):
            token = token.replace(_ZWNJ, "").replace("‍", "").lower()
            if not token:  # a lone joiner: training counted it, and it meant nothing
                continue
            keys = [token] + ([token[:4] + "~"] if len(token) > 4 and not token.isascii() else [])
            for key in keys:
                feats[key] = feats.get(key, 0) + weight
    model = _model()
    ranked = [
        (0.5 * prior + sum(model["weights"][key].get(f, 0) * min(n, 3) for f, n in feats.items()), key)
        for key, prior in model["prior"].items()
    ]
    return sorted(ranked, reverse=True)


def detect_type(
    headline: str, text: str = "", *, hint: str | Iterable[str] | None = None
) -> str | None:
    """The story type, or None when the evidence is not strong. No model call.

    `hint` is what we already know about where the story came from — the
    source's beat, its category slug, the section — one string or several.
    Headline hits weigh 3, the first ~400 characters of text 1, a hint 2.

    Three ways to commit, in order: a hint or a clear keyword lead (two
    headline hits for a `_SPECIAL` format); else the learned model, when it
    names a `_RELIABLE` desk by a wide margin. Measured on a held-out fifth
    of the corpus: 64% of stories committed at 84% precision, against 42% at
    68% for keywords alone. The rest get `candidates`, whose three contain
    the right type 83% of the time — one wrong guide is worse than three.
    """
    scored = _scores(headline, text, hint)
    ranked = _model_rank(headline, text)
    if scored:
        score, key, head = scored[0]
        lead = score - scored[1][0] if len(scored) > 1 else score
        # One headline hit is enough for a _SPECIAL format when the learned
        # model agrees: 'కన్నుమూత' alone is an obituary, 'తగ్గింపు' alone is
        # not a deal (the model says agriculture for the cotton protest).
        if key in _hinted(hint) or (
            head >= 3 and lead >= 3 and (key not in _SPECIAL or head >= 6 or ranked[0][1] == key)
        ):
            return key
    if ranked[0][1] in _RELIABLE and ranked[0][0] - ranked[1][0] >= _MODEL_MARGIN:
        return ranked[0][1]
    return None


def candidates(
    headline: str, text: str = "", *, hint: str | Iterable[str] | None = None, k: int = 3
) -> list[str]:
    """The `k` likeliest types: the keyword leader (when there is one) and the
    learned model's picks that rose above their prior, padded with the
    commonest desks. A weak keyword hit on a `_SPECIAL` format goes after the
    model's first pick, not before it."""
    scored = _scores(headline, text, hint)
    prior = _model()["prior"]
    ranked = [key for score, key in _model_rank(headline, text)[: k + 1] if score > 0.5 * prior[key]]
    lead = [scored[0][1]] if scored else []
    if lead and lead[0] in _SPECIAL and scored[0][2] < 6:
        keys = ranked[:1] + lead + ranked[1:]
    else:
        keys = lead + ranked
    return list(dict.fromkeys(keys + list(_FALLBACK)))[:k]


# --------------------------------------------------------------------------- #
# Briefs
# --------------------------------------------------------------------------- #
def _numbered(rows: list[str]) -> str:
    return "\n".join(f"{i}. {row}" for i, row in enumerate(rows, start=1))


def _shade(text: str) -> str:
    """An attribution verb's shade, cut to its first clause."""
    first = re.split(r"(?<=[.;])\s", text, maxsplit=1)[0].rstrip(".;")
    words = first.split()
    return " ".join(words[:10]) + ("…" if len(words) > 10 else "")


#: Rules the code enforces after the model has written, so the prompt need
#: not pay for them on every call (measured 2026-10-03: the full brief took a
#: rewrite from 1,351 to 8,460 prompt tokens and doubled its price).
#: Only two of the language rules can go: 1 (ZWNJ placement — `canonicalize`
#: strips the stray ones, `lint_copy` warns on the rest) and 16 (keep the
#: source's spelling of a name — core rule 19 says it again). The others
#: looked "enforced" but are not: the table fixes 70 tokens, not ళ్ళ in
#: general, not every aspirate, not punctuation (post-build review,
#: 2026-10-03). Core 24 is about correcting a published story, which no
#: writing call does.
_LANGUAGE_IN_CODE = frozenset({0, 15})
_CORE_NOT_WRITING = frozenset({23})


@functools.cache
def _static_brief() -> str:
    """Everything that does not depend on the story: identical on every call,
    so it is the cacheable prefix of the prompt."""
    g = guide()
    verbs = "; ".join(f"{v['verb']} ({_shade(v['shade'])})" for v in g["attribution_verbs"])
    banned = ", ".join(a["phrase"] for a in g["avoid_phrases"] if a["severity"] == "block")
    # The warn entries too (PAYLOAD: "avoid_phrases as phrase plus
    # severity"): a warn earns no retry, so the brief is the only place the
    # writer hears of the disability slurs, కసాయి, ఖాయం or the hype slang.
    warned = ", ".join(a["phrase"] for a in g["avoid_phrases"] if a["severity"] == "warn")
    language = [r for i, r in enumerate(g["language_rules"]) if i not in _LANGUAGE_IN_CODE]
    core = [r for i, r in enumerate(g["core_rules"]) if i not in _CORE_NOT_WRITING]
    return (
        "HOUSE STYLE (learned from 12,033 Telugu news articles). Follow it after "
        "the absolute rules above, never instead of them.\n"
        f"VOICE: {g['house_voice']}\n\n"
        f"CORE RULES:\n{_numbered(core)}\n\n"
        f"HEADLINE RULES:\n{_numbered(g['headline_rules'])}\n{HONESTY_LINE}\n\n"
        f"LANGUAGE RULES:\n{_numbered(language)}\n\n"
        f"ATTRIBUTION VERBS: {verbs}\n\n"
        "NEVER WRITE these words or phrases (a trailing - means any word "
        f"starting so): {banned}\n"
        "AVOID these unless inside a verbatim quote or used literally: "
        f"{warned}"
    )


def _device_lines(keys: Iterable[str]) -> str:
    lines = []
    for key in keys:
        d = _devices().get(key)
        if d:
            lines.append(f"- {d['label_te']} ({key}): {d['how']} Shape: {d['example_te']}")
    return "\n".join(lines)


def _type_brief(entry: dict, *, devices: bool = True, disclaimer: bool = True) -> str:
    examples = " | ".join(entry["headline_examples_te"])
    parts = [
        f"STORY TYPE: {entry['key']} ({entry['label_te']} / {entry['label_en']})",
        f"GUIDE: {entry['guide']}",
        f"HEADLINE SHAPES (shapes only; never carry a noun from them): {examples}",
        f"LENGTH: at most {entry['words_max']} words and a headline of at most "
        f"{entry['headline_max_chars']} characters. A ceiling, not a target: a "
        "short source makes a short story.",
    ]
    if devices and entry["devices"]:
        parts.append(
            "HEADLINE DEVICES for this type (optional, unordered; plain fact "
            "headline first):\n" + _device_lines(entry["devices"])
        )
    # film_review's line says "our reviewer's opinion", true only of a review
    # written from REVIEWER_NOTES — and no caller supplies them yet. Offered
    # conditionally, the writer printed it on a rewritten review anyway
    # (blind eval 2026-10-03), claiming another outlet's verdict as ours; so
    # it is not offered at all. A caller whose code prints its own dated
    # notice (the assistant's deals job) turns the line off.
    if disclaimer and entry["disclaimer_te"] and entry["key"] != "film_review":
        # The prices are the source's, so its date: TODAY told readers a
        # summer sale was checked this morning.
        parts.append(
            "DISCLAIMER (end the story with this line), filling every bracket "
            "from the source or SOURCE_DATE, never TODAY; drop any slot you "
            f"cannot fill: {entry['disclaimer_te']}"
        )
    return "\n".join(parts)


def _writable(story_type: str | None) -> str | None:
    return "film_news" if story_type == "film_review" else story_type


def writer_brief(
    story_type: str | None,
    *,
    headline: str = "",
    text: str = "",
    hint: str | Iterable[str] | None = None,
    disclaimer: bool = True,
) -> str:
    """The house style for one writing call: the static rules, then the story
    type's guide — or, when the type is unknown, the three likeliest types'
    guides and an instruction to pick one and report it as story_type.
    `disclaimer=False` is for a caller whose code writes the notice itself.

    A film review is written only from REVIEWER_NOTES, and no caller has
    any yet: its guide's review half (verdict shapes, 'చివరగా' close) made
    the writer print another outlet's verdict as ours. Until a reviewer
    exists it is written as film news — what was released and what was said."""
    entry = _types().get(_writable(story_type) or "")
    if entry is not None:
        tail = _type_brief(entry, disclaimer=disclaimer)
    else:
        keys = dict.fromkeys(_writable(k) for k in candidates(headline, text, hint=hint, k=4))
        picks = [_types()[k] for k in list(keys)[:3]]
        tail = (
            "STORY TYPE: not detected. Pick the one of these that fits, follow "
            "its guide, and return its key as story_type.\n\n"
            + "\n\n".join(_type_brief(e, devices=False, disclaimer=disclaimer) for e in picks)
        )
    return f"{_static_brief()}\n\n{tail}"


def headline_brief(story_type: str | None) -> str:
    g = guide()
    entry = _types().get(story_type or "")
    keys = entry["devices"] if entry else list(_devices())
    head = (
        f"HEADLINE RULES:\n{_numbered(g['headline_rules'])}\n{HONESTY_LINE}\n"
        f"Headline ceiling: {headline_cap(story_type)} characters.\n"
    )
    if entry:
        head += (
            f"STORY TYPE: {entry['key']} ({entry['label_en']}). "
            f"{entry['guide']}\nHEADLINE SHAPES (shapes only): "
            + " | ".join(entry["headline_examples_te"]) + "\n"
        )
    return head + "DEVICES you may use:\n" + _device_lines(keys)


def card_brief() -> str:
    return "SOCIAL CARD RULES (house style):\n" + _numbered(guide()["social_card_rules"])


def seo_brief() -> str:
    return "SEO RULES (house style):\n" + _numbered(guide()["seo_rules"])


def today_lines(source_date: date | datetime | None = None, *, now: datetime | None = None) -> str:
    """The TODAY and SOURCE_DATE inputs the core rules count dates from, in IST.
    TODAY carries the clock time too, for the deals disclaimer's [సమయం]."""

    def ist(value: datetime) -> datetime:
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(_IST)

    moment = ist(now or datetime.now(timezone.utc))
    today = moment.date()
    lines = [f"TODAY: {today.isoformat()} ({today.strftime('%A')}, IST), time {moment:%H:%M}"]
    if source_date is not None:
        when = ist(source_date).date() if isinstance(source_date, datetime) else source_date
        lines.append(f"SOURCE_DATE: {when.isoformat()} ({when.strftime('%A')})")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Canonical spellings
# --------------------------------------------------------------------------- #
@functools.cache
def _canon() -> tuple[dict[str, str], re.Pattern[str]]:
    table = {row["variant"]: row["canonical"] for row in guide()["canonical_spellings"]}
    alternatives = "|".join(_flex(v) for v in sorted(table, key=len, reverse=True))
    pattern = re.compile(
        _LEFT + f"(?P<word>{alternatives})(?P<suffix>{_SUFFIX})" + _RIGHT
    )
    return table, pattern


def _swap(match: re.Match[str]) -> str:
    table, _ = _canon()
    canonical = table[" ".join(match["word"].replace(_ZWNJ, "").split())]
    suffix = match["suffix"].lstrip(_ZWNJ)
    # A ZWNJ belongs between a halant stem and its suffix and nowhere else:
    # కోర్ట్‌లో → కోర్టులో, అక్టోబరులో → అక్టోబర్‌లో.
    if suffix and canonical.endswith(_VIRAMA):
        suffix = _ZWNJ + suffix
    return canonical + suffix


def canonicalize(text: str) -> str:
    """Majority spellings on whole tokens, invisible residue stripped.

    Never changes meaning: a variant is replaced only as a whole token (with
    at most one case suffix, which is kept), runs of ZWNJ/ZWJ collapse to
    one, U+200B and literal nbsp go, and a word-final ZWNJ after a halant —
    harmless, per lint.notes — is stripped silently.
    """
    if not text:
        return text or ""
    text = re.sub("[​⁬⁭﻿]", "", text)
    if re.search("nbsp", text, re.IGNORECASE):
        text = re.sub(r"&?nbsp;?", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub("[‌‍]{2,}", lambda m: m.group()[0], text)
    # Language rule 4: ళ్ల, not ళ్ళ — the same sound, and the majority spelling
    # in the corpus (మళ్లీ, ఏళ్లు, ఇళ్లు); the table only knew two words of it.
    text = text.replace("ళ్ళ", "ళ్ల")
    text = re.sub(f"{_VIRAMA}{_ZWNJ}(?![ఀ-౿])", _VIRAMA, text)
    _, pattern = _canon()
    # Twice: సుప్రీం కోర్ట్ → సుప్రీం కోర్టు → సుప్రీంకోర్టు.
    for _ in range(2):
        text = pattern.sub(_swap, text)
    return text


def canonicalize_copy(
    title: str, summary: str, paragraphs: list[str]
) -> tuple[str, str, list[str]]:
    # Headline rules 1 and 3: no full stop, never end on '..'. The writer
    # still does it now and then (1 in 24 on the 2026-10-03 eval); dropping
    # the dots is certain and free where a retry is neither.
    title = canonicalize(title)
    stripped = re.sub(r"\s*[.…]+$", "", title)
    # A title that was nothing but dots stays as it was, for lint_copy's
    # headline_missing to catch; an empty one would slip past every caller's
    # "no title" check, which runs before this.
    return stripped if stripped.strip() else title, canonicalize(summary), [canonicalize(p) for p in paragraphs]


# --------------------------------------------------------------------------- #
# Lint
# --------------------------------------------------------------------------- #
_DEATH_WORDS = ("మృతి", "హత్య", "మరణం", "గల్లంతు", "దుర్మరణం", "కన్నుమూ", "ఇక లేరు")
_ONE_GAP = frozenset(
    {"politics", "governance", "court_legal", "crime", "accident_disaster",
     "national", "international", "breaking"}
)
_BANG_OK = frozenset({"human_interest_viral", "film_news", "sports"})
_NO_MARKS = frozenset({"accident_disaster", "obituary", "breaking"})
_STACKED = ("!!", "??", "?!", "..!", "..?", "?:", "!:", "?..")
_UNITS = frozenset({"gb", "tb", "mp", "mah", "hz", "w", "kwh", "ram", "5g", "4k"})
_LATIN_CAP = {
    **dict.fromkeys(
        ("politics", "governance", "crime", "accident_disaster", "court_legal", "local_district"), 1.5
    ),
    "tech_gadgets": 8.0,
    "auto": 8.0,
    "deals_offers": 10.0,
}
_LEDE_CAP = {"court_legal": 55, "explainer": 55, "interview": 60}
_PARAGRAPH_CAP = {"editorial_opinion": 110, "interview": 110}
#: Subjects that block auto-publish and route the story to an editor
#: (lint.notes REFUSE_SCREEN), matched at the start of a word.
REFUSE_SCREEN = (
    "ఆత్మహత్య", "బలవన్మరణం", "ఉరేసుకుని", "పురుగుల మందు తాగి", "అత్యాచారం",
    "లైంగిక దాడి", "లైంగిక వేధింపు", "పోక్సో", "బాలికపై", "బాలుడిపై", "మైనర్",
    "పరువు హత్య", "కుల దూషణ", "మత ఘర్షణ", "మతమార్పిడి", "అట్రాసిటీ",
)
_QUOTED = re.compile(r"‘[^’]*’|“[^”]*”")
_SENTENCE = re.compile(r"(?<=[.?!])\s+")
_DOUBLE_DOT = re.compile(r"(?<!\.)\.\.(?!\.)")
_LATIN_KEYWORD = re.compile(r"[A-Za-z][\w&'.-]*\s*:")
_STRAY_ZWNJ = re.compile(f"(?<!{_VIRAMA}){_ZWNJ}|[‌‍]{{2,}}")
_RUPEE = re.compile(r"రూ\.(?!\d|లక్ష|కోటి|వెయ్యి)")
_PAKKA = re.compile(_LEFT + r"పక్కా\s*(?:!|\.|$)")
_FIRE_ENDING = re.compile(r"ఫైర్\s*(?:!|\.\.)?\s*$")
_TOKEN = re.compile(rf"[\w{_TE}]+")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_TE_DIGITS = str.maketrans("౦౧౨౩౪౫౬౭౮౯", "0123456789")


def _issue(code: str, severity: str, message: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "message": message}


def _words(text: str) -> int:
    return len((text or "").split())


def _avoid_hits(text: str, source: str, *, quoted_ok: bool) -> list[dict[str, str]]:
    """Banned phrases in `text`. Block entries always count; a warn entry the
    source itself uses is the source's fact and is allowed."""
    if quoted_ok:
        text = _QUOTED.sub(" ", text)
    out = []
    for row in guide()["avoid_phrases"]:
        phrase, severity = row["phrase"], row["severity"]
        if phrase == "పక్కా":
            hit = _PAKKA.search(text)
        else:
            hit = _term(phrase).search(text)
        if not hit:
            continue
        if severity == "warn" and _term(phrase).search(source or ""):
            continue
        out.append(
            _issue(
                "avoid_phrase",
                severity,
                f"Do not write '{hit.group().strip()}': {row['why']}.",
            )
        )
    return out


#: A child word and a crime word in one sentence: a minor as the victim of a
#: crime, which the house refuses. Neither alone — శిశువు is in every
#: newborn-care scheme and అరెస్ట్ in every crime story. The 2026-10-03 eval
#: had a sold infant (పసికందు ... విక్రయం) written once and refused once.
#: Plurals are their own stems (చిన్నారులు is ర+ు, not చిన్నారి); not 'పిల్ల',
#: which is also పిల్లి, a cat.
_CHILD = (
    "పసికందు", "పసిబిడ్డ", "శిశువు", "శిశు", "చిన్నారి", "చిన్నారు", "బాలిక", "బాలుడు", "బాలుడి",
    "బాలుర", "బాలల", "పిల్లల", "పిల్లాడ", "పిల్లవాడ",
)
_CHILD_CRIME = (
    "విక్రయ", "అమ్మేశ", "అమ్మేసి", "అమ్మకం", "అమ్మకాని", "అమ్మిన", "కిడ్నాప్", "అపహరణ",
    "అపహరించ", "ఎత్తుకెళ్ల", "హత్య", "చంపే", "చంపి", "దాడి", "వేధింపు", "అసభ్య", "చిత్రహింస",
    "అక్రమ రవాణా",
)
#: A dog or other animal attacking a child is news, not a crime against a minor.
_ANIMAL_ATTACK = re.compile(
    _LEFT + r"(?:వీధి\s+)?(?:కుక్క|శునక|కోతు|కోతి|ఎలుగు|చిరుత|ఏనుగు)\S*\s+దాడి"
)
#: Sentences end at . ? ! — but not after రూ. or డా., and not before a figure:
#: 'పసికందును రూ. 2 లక్షలకు విక్రయించారు' is one sentence.
_SCREEN_SENTENCE = re.compile(r"(?<=[.?!])(?<!రూ\.)(?<!డా\.)\s+(?![\d౦-౯])|\n+")


def refuse_screen_hits(text: str) -> list[str]:
    hits = []
    for term in REFUSE_SCREEN:
        for match in _stem(term).finditer(text or ""):
            if term == "మైనర్" and re.match(r"[\s‌‍]*ఇరిగేషన్", text[match.end():]):
                continue
            hits.append(term)
            break
    for sentence in _SCREEN_SENTENCE.split(text or ""):
        sentence = _ANIMAL_ATTACK.sub(" ", sentence)
        child = next((w for w in _CHILD if _stem(w).search(sentence)), None)
        if child and any(_stem(w).search(sentence) for w in _CHILD_CRIME):
            hits.append(child)
            break
    return hits


def _latin_per_100(body: str, source: str) -> float:
    words = body.split()
    if not words:
        return 0.0
    folded_source = (source or "").casefold()
    latin = 0
    for word in words:
        token = word.strip(".,;:!?()‘’“”'\"-")
        if not re.search("[A-Za-z]", token) or re.search(r"\d", token):
            continue
        if token.casefold() in _UNITS or token.casefold() in folded_source:
            continue
        latin += 1
    return latin * 100 / len(words)


def _jaccard(a: str, b: str) -> float:
    left, right = set(_TOKEN.findall(a)), set(_TOKEN.findall(b))
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


#: Share of a rewrite made of 5-word runs lifted from its source that is
#: "copying". Measured 2026-10-03 on 27 held-out rewrites: the old prompt
#: 2% median (max 13%); the first house-style prompt 28% (max 96%), which the
#: blind fact-checker called near-verbatim in 25 of 27.
COPY_RUN = 5
COPY_BLOCK_PERCENT = 20
#: Below this many copied words nothing is "copying", whatever the share: a
#: short item that keeps one exact designation and name is following rule 19.
COPY_MIN_WORDS = 2 * COPY_RUN
#: A figure is one clean token: `_TOKEN` splits 1,200 in two, and a trailing
#: full stop made '2024.' a different word from '2024'.
_COPY_TOKEN = re.compile(rf"\d+(?:[.,]\d+)*|[A-Za-z{_TE}]+")


def _copied_words(text: str, source: str, n: int = COPY_RUN) -> tuple[int, int]:
    """(copied, total) tokens of `text`, outside quotes. A run counts when
    all n tokens occur in that order in `source` and none is a figure: a
    gold-rate or vote-tally line shares its numbers with any honest rewrite,
    while a lifted sentence is still caught by its figure-free windows."""
    text = _QUOTED.sub(" ", text or "")
    ours = [t.replace(_ZWNJ, "") for t in _COPY_TOKEN.findall(text)]
    theirs = [t.replace(_ZWNJ, "") for t in _COPY_TOKEN.findall(source or "")]
    runs = {tuple(theirs[i:i + n]) for i in range(len(theirs) - n + 1)}
    if not ours or not runs:
        return 0, len(ours)
    covered = [False] * len(ours)
    for i in range(len(ours) - n + 1):
        window = tuple(ours[i:i + n])
        if window in runs and not any(t[0].isdigit() for t in window):
            covered[i:i + n] = [True] * n
    return sum(covered), len(ours)


def copied_share(text: str, source: str, *, n: int = COPY_RUN) -> int:
    """Percent of `text`'s tokens inside an n-token run lifted from `source`
    (see `_copied_words`). 0 for an English source, as it should be. Words
    inside quote marks are skipped: a quote is verbatim by rule, and on the
    2026-10-03 eval quoted speech was most of what still "matched"."""
    copied, total = _copied_words(text, source, n)
    return round(100 * copied / total) if total else 0


def lint_copy(
    title: str,
    summary: str,
    paragraphs: list[str],
    *,
    story_type: str | None = None,
    source: str = "",
    outlets: Iterable[str] = (),
) -> list[dict[str, str]]:
    """Deterministic style checks: `[{code, severity, message}]`.

    `severity` is "block" (worth one paid retry, or an editor's attention) or
    "warn". Messages are short English sentences a model can act on — the
    crawl sends the block ones back as feedback. `source` is the text we
    rewrote from: a warn phrase it uses, or a brand it names in Latin
    letters, is the source's and not ours. `outlets` are publication names the
    copy must not carry. Never warns below a type's minimum length: a thin
    source makes a short story.
    """
    lint = guide()["lint"]
    entry = story_type and _types().get(story_type)
    title = (title or "").strip()
    summary = (summary or "").strip()
    paragraphs = [p.strip() for p in paragraphs or [] if p and p.strip()]
    body = "\n\n".join(paragraphs)
    every = "\n".join([title, summary, body])
    issues: list[dict[str, str]] = []

    # --- wording: ours, not the source's ----------------------------------
    copied_words, total_words = _copied_words(body, source)
    copied = round(100 * copied_words / total_words) if total_words else 0
    if copied >= COPY_BLOCK_PERCENT and copied_words >= COPY_MIN_WORDS:
        issues.append(_issue(
            "copied", "block",
            f"{copied}% of the body repeats the source word for word. Rebuild every "
            "sentence in your own words and order; keep only names, titles, "
            "figures and verbatim quotes.",
        ))

    # --- headline ---------------------------------------------------------
    length = len(title)
    if not title.strip(" .…"):
        issues.append(_issue("headline_missing", "block", "Write a headline."))
    elif length > lint["headline_max_chars"]:
        issues.append(_issue("headline_too_long", "block",
                             f"The headline is {length} characters; keep it under {lint['headline_max_chars']}."))
    elif length < lint["headline_min_chars"]:
        # lint.notes calls this an error; it is a warning here on purpose. A
        # three-word headline is print-desk style (eenadu's median is 34
        # code points), an editor fixes it in seconds, and as a block it would
        # buy a whole second rewrite.
        issues.append(_issue("headline_too_short", "warn",
                             f"The headline is {length} characters; it must be at least {lint['headline_min_chars']} and make sense alone."))
    elif entry and length > entry["headline_max_chars"]:
        issues.append(_issue("headline_over_type_cap", "warn",
                             f"The headline is {length} characters; this story type allows {entry['headline_max_chars']}."))
    gaps = len(_DOUBLE_DOT.findall(title))
    allowed = 1 if story_type in _ONE_GAP else 2
    if gaps > allowed:
        issues.append(_issue("headline_gaps", "warn",
                             f"The headline has {gaps} '..' breaks; use at most {allowed}."))
    if title.endswith("."):
        issues.append(_issue("headline_trailing_stop", "warn",
                             "The headline must not end with '..' or a full stop."))
    if "..." in title or "…" in title:
        issues.append(_issue("headline_ellipsis", "warn", "Never use '...' or '…' in a headline."))
    if title.count("?") > 1:
        issues.append(_issue("headline_questions", "warn", "Use at most one '?' in a headline."))
    marks = "?" in title or "!" in title
    if marks and (story_type in _NO_MARKS or any(_stem(w).search(title) for w in _DEATH_WORDS)):
        issues.append(_issue("death_headline_mark", "block",
                             "A headline about a death, a killing, a missing person or a disaster takes no '?' or '!'."))
    elif "!" in title and story_type not in _BANG_OK:
        issues.append(_issue("headline_exclamation", "warn",
                             "Use '!' only in human-interest, film or sports headlines."))
    if _LATIN_KEYWORD.search(title):
        issues.append(_issue("headline_keyword_prefix", "warn",
                             "No English 'Keyword:' label in the headline; write it in Telugu inside the clause."))
    if _FIRE_ENDING.search(title):
        issues.append(_issue("headline_fire", "warn",
                             "Do not end a headline on 'ఫైర్'; say what was said, with a neutral verb."))

    # --- everywhere -------------------------------------------------------
    stacked = next((s for s in _STACKED if s in every), None)
    if stacked:
        issues.append(_issue("stacked_marks", "warn", f"Never stack punctuation marks ('{stacked}')."))
    if "[" in every or "]" in every:
        issues.append(_issue("placeholder", "block",
                             "Square brackets are left in the copy; fill the slot from the source or drop it."))
    if _STRAY_ZWNJ.search(every):
        issues.append(_issue("stray_zwnj", "warn",
                             "A ZWNJ follows a letter without a halant, or repeats; remove it."))
    if "​" in every or re.search("nbsp", every, re.IGNORECASE):
        issues.append(_issue("invisible_residue", "warn", "Remove zero-width spaces and 'nbsp' residue."))
    if re.search(r"\s[?!:,]", every):
        issues.append(_issue("space_before_mark", "warn", "No space before ? ! : or ,."))
    if _RUPEE.search(every):
        issues.append(_issue("rupee_format", "warn",
                             "Write 'రూ.' directly before the digits, or before లక్ష, కోటి or వెయ్యి."))
    for name in outlets:
        if name and len(name.strip()) >= 3 and _outlet_pattern(name.strip()).search(every):
            issues.append(_issue("outlet_named", "block",
                                 f"Name no newspaper, channel or website ('{name.strip()}'); state the facts as our own."))
            break
    screened = refuse_screen_hits(every)
    if screened:
        issues.append(_issue("refuse_screen", "block",
                             f"The copy mentions '{screened[0]}'; an editor must handle this story."))

    # --- banned phrases: headline always, body outside quotes ---------------
    seen: set[str] = set()
    for hit in _avoid_hits(title, source, quoted_ok=False) + _avoid_hits(
        f"{summary}\n{body}", source, quoted_ok=True
    ):
        if hit["message"] not in seen:
            seen.add(hit["message"])
            issues.append(hit)

    # --- body ---------------------------------------------------------------
    if "!" in _QUOTED.sub(" ", body):
        issues.append(_issue("body_exclamation", "warn", "No '!' in the body outside a quote."))
    if paragraphs:
        lede_cap = (
            lint["lede_max_words"] if story_type == "editorial_opinion" else _LEDE_CAP.get(story_type or "", 50)
        )
        lede_words = _words(paragraphs[0])
        if lede_words > lede_cap:
            issues.append(_issue("lede_too_long", "warn",
                                 f"The first paragraph is {lede_words} words; keep the lede under {lede_cap}."))
        cap = _PARAGRAPH_CAP.get(story_type or "", 90)
        long_paras = sum(1 for p in paragraphs if _words(p) > cap)
        if long_paras:
            issues.append(_issue("paragraph_too_long", "warn",
                                 f"{long_paras} paragraph(s) run over {cap} words; split them."))
        sentences = [s for p in paragraphs for s in _SENTENCE.split(p)]
        long_sentences = sum(1 for s in sentences if _words(s) > lint["sentence_max_words"])
        if long_sentences:
            issues.append(_issue("sentence_too_long", "warn",
                                 f"{long_sentences} sentence(s) run over {lint['sentence_max_words']} words; split them."))
        if len(set(paragraphs)) < len(paragraphs):
            issues.append(_issue("paragraph_repeated", "warn", "A paragraph is repeated; keep one."))
        first_sentence = _SENTENCE.split(paragraphs[0])[0]
        if summary and _jaccard(summary, first_sentence) >= 0.7:
            issues.append(_issue("summary_repeats_lede", "warn",
                                 "The summary repeats the first sentence; word it differently."))
    if _words(summary) > lint["summary_max_words"]:
        issues.append(_issue("summary_too_long", "warn",
                             f"The summary is {_words(summary)} words; keep it under {lint['summary_max_words']}."))
    latin_cap = _LATIN_CAP.get(story_type or "", 3.0)
    density = _latin_per_100(body, source)
    if density > latin_cap:
        issues.append(_issue("latin_heavy", "warn",
                             f"{density:.1f} English words per 100; write Telugu (limit {latin_cap:g} for this type)."))
    total = _words(body)
    if entry and total > entry["words_max"]:
        issues.append(_issue("too_long", "warn",
                             f"The story is {total} words; this type's ceiling is {entry['words_max']}."))
    return issues


@functools.cache
def _outlet_pattern(name: str) -> re.Pattern[str]:
    """A publication's name as copy would cite it. A one-word name in Telugu
    letters must stand beside a media noun: సాక్షి is also "witness" and a
    first name (కీలక సాక్షిగా, సాక్షి మాలిక్), and a block on those spends a
    paid retry that garbles the person out of the story. Multi-word names
    (నమస్తే తెలంగాణ, వీ6 వెలుగు) and ones with Latin letters or digits (TV9,
    టీవీ9) are no ordinary word and match alone."""
    if " " in name or not re.fullmatch(f"[{_TE}]+", name):
        return _term(name)
    return re.compile(
        _LEFT + _flex(name) + _SUFFIX
        + r"\s*(?:పత్రిక|దినపత్రిక|ఛానల్|టీవీ|మీడియా|కథనం|వెబ్‌?సైట్|నివేదిం)",
        re.IGNORECASE,
    )


def blocking(issues: list[dict[str, str]]) -> list[dict[str, str]]:
    """Block issues a retry can fix — everything but the refusal screen."""
    return [i for i in issues if i["severity"] == "block" and i["code"] != "refuse_screen"]


# --------------------------------------------------------------------------- #
# Headline options
# --------------------------------------------------------------------------- #
def _numbers(text: str) -> set[str]:
    # Grouping commas dropped: "1,20,000" and "120000" are the same figure.
    return {n.replace(",", "") for n in _NUMBER.findall((text or "").translate(_TE_DIGITS))}


def invented_numbers(text: str, source: str) -> set[str]:
    """Figures in `text` the story never states (social_card_service's rule)."""
    return _numbers(text) - _numbers(source)


def foreign_glyph(text: str) -> bool:
    """A letter from neither Telugu nor Latin (`ఎစ်భై` for `ఎనభై`) — the same
    predicate as social_card_service's, kept here so this module stays free
    of the service layer."""
    return any(
        not (ord(ch) < 0x0300 or 0x0C00 <= ord(ch) <= 0x0C7F or 0x2000 <= ord(ch) <= 0x206F or ch in "₹।॥")
        for ch in text
    )


def headline_problem(text: str, *, story_type: str | None, source: str) -> str | None:
    """Why a suggested headline must be dropped, or None. `source` is our own
    story: headline, summary and body."""
    if not text:
        return "empty"
    if not re.search("[ఀ-౿]", text):
        return "not Telugu"
    if len(text) > headline_cap(story_type) * 1.1:
        return "too long"
    if foreign_glyph(text):
        return "foreign glyph"
    if invented_numbers(text, source):
        return "invented number"
    if any(hit["severity"] == "block" for hit in _avoid_hits(text, source, quoted_ok=False)):
        return "banned phrase"
    if "[" in text or "]" in text:
        return "placeholder"
    if any(i["code"] == "death_headline_mark" for i in lint_copy(text, "", [], story_type=story_type)):
        return "mark on a death headline"
    return None
