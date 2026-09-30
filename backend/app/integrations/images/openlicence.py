"""Photographs we may run with **no credit line at all**.

Sibling of `feeds/images.py`: same shape, same job — deciding which pictures
may be used — but a different question. `feeds.images` asks "is this the
publisher's own photo?". This asks "does this licence let a commercial news
site reuse the picture **without naming anybody**?".

**Why the distinction is the whole point.** The stories here are rewritten
under our own masthead. Running the source publisher's photograph puts their
name back on the page as a mandatory credit, which is exactly what the rewrite
was for. So is a CC-BY photo: it swaps "TV9" for "Bollywood Hungama". Only a
licence that waives attribution removes the other name entirely.

**The accepted values, and nothing else.**

    cc0        — Creative Commons Zero, rights actively waived
    pdm        — Public Domain Mark
    pdm-owner  — the same mark, applied by the rights holder

Bare `pd` is **not** accepted, and that is deliberate rather than an
oversight. CommonsMetadata flattens every `{{PD-*}}` template to
`License: "pd"` with `AttributionRequired: "false"`, including the US-only
ones — `PD-US-expired`, `PD-US-1996`, `PD-URAA`, `PD-USGov`. Those works are
public domain *in the United States*; India's term is life+60, so a 1960s
agency portrait of an Indian politician can be PD-US and still a live
copyright here. Nothing in the metadata distinguishes the rationale, and
"cannot prove it" is a reject. CC0 and PDM are worldwide dedications, which
is why they survive. The cost is real — it puts most historical photography
out of reach — so if that trade is ever re-decided, adding `"pd"` back to
`NO_CREDIT_LICENCES` is the whole change.

Everything else is refused, including things that look free:

  * `cc-by-*` and `cc-by-sa-*` — free to reuse, `AttributionRequired: "true"`.
  * **GODL-India** — the licence on most PIB/PMO handout photos of Indian
    politicians. It has no `License` key at all, so a check written as
    "reject a licence I recognise as bad" passes it. Attribution required.
  * **ODbL** — same shape, and it has been observed passing Commons'
    `haslicense:unrestricted` pre-filter. That is why the pre-filter is a
    speed-up and never the decision.

A candidate whose licence cannot be positively identified from the API's own
metadata is dropped. Absent metadata is a reject, not a maybe.

**Two rejections that are not about copyright.**

  * `Restrictions` non-empty — usually `personality`. The copyright licence
    may be CC0 while the depicted person still holds publicity rights.
    Commercial use of a recognisable living person is a separate question and
    we do not answer it with a dropdown value.
  * `Attribution` present — a custom credit string the uploader asked for.
    Someone wanted their name printed; that is an attribution requirement
    whatever the machine-readable flag says.

**No open-web image search happens here, ever.** One licence-indexed API,
queried by subject, returning structured licence metadata. No Google Images,
no Bing, no scraping a news site or a social account, and emphatically no
"this photo has no visible watermark so it must be free" — an unwatermarked
wire photo is still a wire agency's copyrighted work.

Openverse used to be a second rung and was removed. Its licence code is
self-declared by the uploader with nothing to cross-check it against — no
attribution flag, no restrictions field — so the only thing standing behind
it was a one-name denylist (`excluded_source=flickr`) that could not be kept
current. What it added on top of Commons was precisely that self-declared
kind; its institutional sources reach us through Commons anyway.

Network lives in `_commons`. Every decision above it is a pure function over
a dict, so the rules are testable without a socket.
"""

from __future__ import annotations

import re

import httpx

from app.core.logging import get_logger
from app.integrations.feeds import images as feed_images
from app.integrations.images.base import StockImage
from app.integrations.images.wikimedia import API as COMMONS_API
from app.integrations.images.wikimedia import USER_AGENT, _clean

logger = get_logger(__name__)

#: The only licences that permit commercial reuse with no credit line, in
#: every jurisdiction we publish in. `pdm-owner` is Commons' spelling when the
#: rights holder applied the mark. Bare `pd` is excluded on purpose — see the
#: module docstring; it is jurisdiction-blind.
NO_CREDIT_LICENCES = frozenset({"cc0", "pdm", "pdm-owner"})

#: A hero is cropped to 1600px by `media_service`. Below this it is a
#: thumbnail being stretched, whatever the licence says.
MIN_WIDTH, MIN_HEIGHT = 1000, 600

#: Checked against the file's *title*, which the URL rules cannot see. These
#: are what a licence-filtered Commons search actually returns for a person
#: who has no free photograph: their autograph, a party symbol, a map.
_NOT_A_PHOTOGRAPH = (
    # "flag", not "flag of": "Hyderabad City Flag" was attached to a Hyderabad
    # story on 2026-09-30.
    "signature", "coat of arms", "flag", "map of", "locator",
    "seal of", "emblem", "stamp of", "chart", "diagram", "poster",
    # Measured, not guessed: a live "Vijayawada city" search returned
    # "Floor plan of Trimurti rock-cut temple" as a top CC0 hit.
    "floor plan", "plan of",
    # "Guntur city", live: a Wikidata/OSM map screenshot and "Flora of
    # Viswanagar in Guntur district" — named for the place, pictures of neither.
    "wikidata", "screenshot", "flora of", "fauna of",
)

#: The proper nouns in a search query, so "Mithali Raj cricketer portrait" is
#: tested on the name. `{2,}` is a three-character floor, not four: Raj, Rao
#: and Roy are surnames, and a floor of four tested "Mithali" alone and called
#: that a match.
_CAPITALISED = re.compile(r"\b[A-Z][a-zA-Z]{2,}\b")

#: Adjacent proper nouns are one name: "Mithali Raj", not "Mithali" and "Raj".
#: `depicts_subject` looks for each name whole.
_NAME = re.compile(rf"{_CAPITALISED.pattern}(?:\s+{_CAPITALISED.pattern})*")

#: Names no single photograph can show. A state or a country is where a
#: picture was taken, not what is in it: the model answered "Andhra city" for
#: a Tirupati accident, and Commons returned a temple in Vontimitta filed
#: under "Andhra Pradesh". The query prompt forbids these too; this is the
#: part that does not depend on the model listening.
# ponytail: our two states and the country only; add a name when a live run
# shows another region slipping through.
_TOO_BROAD = frozenset({"andhra", "pradesh", "telangana", "india", "indian", "telugu"})

#: The trailing noun `story_image_service._QUERY_RULES` mandates. It says what
#: kind of picture, not whose, so it is never part of a name however the model
#: capitalised it ("Charminar Building", "Rajamouli Portrait").
_QUERY_NOUNS = frozenset({"portrait", "city", "town", "temple", "stadium", "building"})

#: A person's name on one of these is a thing named after them — Rajiv Gandhi
#: International Airport, NTR Gardens, Indira Gandhi Municipal Stadium — not a
#: photograph of the person.
_NAMED_AFTER = re.compile(
    r"\b(?:airport|stadium|gardens?|park|road|marg|nagar|station|bridge|hospital"
    r"|college|university|memorial|colony|statue|bhavan|samadhi|ghat)\b",
    re.IGNORECASE,
)

#: A homonym abroad, in the title or the categories. Measured 2026-09-30: the
#: top CC0 hit for "Guntur city" was a Dutch print of Mount Guntur in Java,
#: then a Javanese gamelan named Guntur; Hyderabad is also a city in Sindh. An
#: "India/Andhra/Telangana" anchor was tried and refused — the correct hits
#: ("Guntur rail station platform", "Charminar 11") carry none.
# ponytail: the homonyms seen so far; add a region when a live run shows another.
_ABROAD = re.compile(
    r"\b(?:java|indonesia|yogyakarta|sindh|pakistan|bangladesh)\b", re.IGNORECASE
)

#: A title that is a picture of the place itself: the name first (or after
#: "view of the"), then nothing but a comma, a bracket, a number or a word
#: like skyline. Measured 2026-09-30: "Hyderabad city" took "Inorbit Mall,
#: Hyderabad", "Dubai city"/"Dubai building" a building's shadow — photos
#: taken in the place, not of it.
_VIEW_PREFIX = r"\W*(?i:[\d\s]*view of (?:the )?)?"
_VIEW_SUFFIX = (
    r"(?:\s*(?:$|[,(\d])|\s+(?i:skyline|panorama|cityscape|aerial|view|at|campus)\b)"
)


def licence_of_commons(extmetadata: dict | None) -> str | None:
    """The no-credit licence code for a Commons file, or None to refuse it.

    All five conditions must hold. They are checked together because no single
    one of them is sufficient:

      * `AttributionRequired` is the decisive field, and it is a *string*
        ("true"/"false"), not a JSON boolean — `bool("false")` is True.
      * `License` must be one we recognise. It can be absent, which is how
        GODL-India and ODbL arrive, so "not in the reject list" is not a test.
      * `Restrictions` must be empty (see module docstring).
      * `Attribution` must not be present at all.

    `Copyrighted` is deliberately **not** consulted: a CC0 file reports
    `"True"` — the work is copyrighted, the rights are waived — so gating on
    it would refuse exactly the licence we most want.
    """
    meta = extmetadata or {}

    def value(key: str) -> str:
        return str((meta.get(key) or {}).get("value") or "").strip()

    if "Attribution" in meta:
        return None
    if value("AttributionRequired").lower() != "false":
        return None
    if value("Restrictions"):
        return None
    code = value("License").lower()
    return code if code in NO_CREDIT_LICENCES else None


def is_photograph(title: str, url: str) -> bool:
    """Cheap rejects that have nothing to do with licensing.

    Reuses `feeds.images.survives_redirect` for the URL — scheme, the shared
    deny-token list (logo, watermark, placeholder, icon...) and any size
    declared in the filename — so "what is not a news photograph" is answered
    in one place for both image paths.
    """
    if not feed_images.survives_redirect(url):
        return False
    lowered = (title or "").lower()
    return not any(token in lowered for token in _NOT_A_PHOTOGRAPH)


def depicts_subject(candidate: StockImage, query: str) -> bool:
    """Is this a picture **of the named person, place or event**? The only
    question, because nothing else is attached.

    Every name in the query must appear, whole, in the file's **title**:

      * "Rajamouli portrait" against "SS Rajamouli" — it is him.
      * "Charminar building" against "Charminar at night" — it is the place.
      * a query with no proper noun at all ("flood rescue") never matches:
        there is no named subject to be a picture of.

    **Title only.** Commons categories cannot tell a photograph of a subject
    from one merely filed under it: a Deepika Padukone story matched a working
    still of her film's director, categorised under her name. They can only
    refuse — `_ABROAD`, a homonym in another country.

    **A name is matched whole, on word boundaries, in its own case.**
    Substrings read "Nara Brahmani" into "Brahmani River near Naraj Odisha"
    (Modi ⊂ Modinagar, Rama ⊂ Ramanathapuram). Words matched separately read
    "Green Card" into "Charles Green - The Visiting Card". Case, because a
    capitalised common noun ("Bus Accident") is not a name, and "Bus accident
    in Kerala" must not answer it. The query's trailing noun and a trailing
    state ("Amaravati Andhra Pradesh") are not part of the name.

    **A person is not a landmark.** For a portrait, a title naming an airport,
    a stadium, gardens (`_NAMED_AFTER`) is somewhere named after them.

    **A place is only its own picture.** For a city, town or building query
    the title must be about the place (`_VIEW_PREFIX`/`_VIEW_SUFFIX`):
    "Inorbit Mall, Hyderabad", "Guntur rail station platform" and "Dubai
    building shadow" were taken there; they are not the place. A temple or
    stadium query keeps the looser rule — its name is already the landmark.

    **"from <name>" is something else.** "Buddha from Guntur district,
    Warangal Museum" is a statue, "View from Charminar" is the city below it.

    There used to be a second, looser rule — any one proper noun in the title
    or categories, captioned ప్రాతినిధ్య చిత్రం (representative image). It was
    removed after 2026-09-30, when it put a Yale painting on an EB-5 green-card
    story, a Zelenskyy meeting on a Telangana voter-registration story, a
    Kodandarama temple on a Tirupati accident and a WW2 Yugoslav crash on a
    Tu-95 crash. A label does not make a picture of somewhere else honest.
    Nothing matching means no picture; the AI rung and the editor's
    MediaPicker sit behind this one.
    """
    words = (query or "").split()
    # The model stacks them ("Hyderabad city portrait", "Dubai city building").
    nouns = set()
    while words and words[-1].lower() in _QUERY_NOUNS:
        nouns.add(words.pop().lower())
    # Only a temple or a stadium names its landmark; anything else, including
    # a query off the mandated form ("Dubai airplane"), must be the place itself.
    person = nouns == {"portrait"}
    place = not person and not nouns & {"temple", "stadium"}
    names = []
    for name in _NAME.findall(" ".join(words)):
        parts = name.split()
        while parts and parts[-1].lower() in _TOO_BROAD:
            parts.pop()
        if parts:
            names.append(parts)
    title = candidate.title or ""
    if not names or _ABROAD.search(f"{title} {candidate.subject_text or ''}"):
        return False
    if person and _NAMED_AFTER.search(title):
        return False
    if place:  # "Tirupati, Andhra Pradesh", "Charminar at night", "Amaravati"
        name = r"\W+".join(map(re.escape, names[0]))
        return re.match(_VIEW_PREFIX + name + _VIEW_SUFFIX, title) is not None
    return all(
        re.search(
            r"(?<![Ff]rom )\b" + r"\W+".join(map(re.escape, parts)) + r"\b", title
        )
        is not None
        for parts in names
    )


def _stock(
    *,
    source: str,
    external_id: str,
    title: str,
    url: str,
    licence: str,
    page_url: str | None,
    width: int | None,
    height: int | None,
    creator: str | None = None,
    licence_url: str | None = None,
    subject_text: str | None = None,
) -> StockImage | None:
    """Build a candidate, or None if it fails the non-licence checks."""
    if not url or not is_photograph(title, url):
        return None
    if not width or not height or width < MIN_WIDTH or height < MIN_HEIGHT:
        return None
    return StockImage(
        source=source,
        external_id=external_id,
        title=title,
        image_url=url,
        creator=creator,
        license_code=licence,
        license_version=None,
        license_url=licence_url,
        landing_url=page_url,
        provider=source,
        width=width,
        height=height,
        subject_text=subject_text,
    )


def _commons(query: str, limit: int, timeout: float) -> list[StockImage]:
    """Search Commons. `haslicense:unrestricted` narrows, it does not decide.

    A malformed `haslicense:` value returns zero hits plus a soft `warnings`
    key rather than an error — a silent-empty-result trap — so a warned
    response that is *also* empty is discarded rather than read as "no photo
    exists". A warning next to real results is logged and the results kept:
    MediaWiki warns about deprecated parameters and continuations too, and
    one of those would otherwise switch this rung off site-wide.
    """
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        "gsrsearch": f"{query} haslicense:unrestricted filetype:bitmap fileres:>1200",
        "gsrnamespace": "6",
        "gsrlimit": str(min(max(limit * 4, 10), 50)),
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": "1600",
        "iiextmetadatafilter": (
            "License|LicenseShortName|UsageTerms|LicenseUrl|AttributionRequired"
            "|Attribution|Artist|Restrictions|Categories"
        ),
    }
    try:
        response = httpx.get(
            COMMONS_API,
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
            follow_redirects=True,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("openlicence_commons_failed", query=query, error=str(exc)[:200])
        return []

    pages = (payload.get("query") or {}).get("pages") or []
    if payload.get("warnings"):
        logger.warning(
            "openlicence_commons_warned", query=query, warnings=str(payload["warnings"])[:200]
        )
        if not pages:
            return []

    out: list[StockImage] = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        if not str(info.get("mime") or "").startswith("image/"):
            continue
        licence = licence_of_commons(info.get("extmetadata"))
        if licence is None:
            continue
        meta = info.get("extmetadata") or {}
        title = re.sub(
            r"\.(jpe?g|png|webp|tiff?)$", "", str(page.get("title", "")).replace("File:", ""),
            flags=re.IGNORECASE,
        ).replace("_", " ")
        # `thumburl` is a pregenerated bucket at or above the width we asked
        # for; `media_service` derives our own widths from whatever arrives.
        # The query string is stripped for the reason `wikimedia.py` measured
        # and documents: the API appends utm_* params and upload.wikimedia.org
        # answers 403 to a request carrying them. Passing them through here
        # would 403 every download and fail this rung silently.
        candidate = _stock(
            source="wikimedia",
            external_id=str(page.get("pageid", "")),
            title=title,
            url=(info.get("thumburl") or info.get("url") or "").split("?", 1)[0],
            licence=licence,
            page_url=info.get("descriptionurl"),
            width=info.get("thumbwidth") or info.get("width"),
            height=info.get("thumbheight") or info.get("height"),
            creator=_clean((meta.get("Artist") or {}).get("value")),
            licence_url=_clean((meta.get("LicenseUrl") or {}).get("value")),
            # Read only to refuse a homonym abroad (`_ABROAD`), never as proof.
            subject_text=_clean((meta.get("Categories") or {}).get("value")),
        )
        if candidate is None:
            continue
        out.append(candidate)
        if len(out) >= limit:
            break
    return out


def search(query: str, *, limit: int = 3, timeout: float = 6.0) -> list[StockImage]:
    """No-credit candidates for `query`. Commons, and nothing else.

    Commons is the only source because its licence metadata is structured and
    auditable — the five `extmetadata` fields above. At most two calls per
    story, both short: this runs inside the import request, and a photo
    library having a slow day must not turn into a 504 for the editor.
    """
    query = (query or "").strip()
    if len(query) < 3:
        return []

    found = _commons(query, limit, timeout)
    if not found:
        # Measured against the live API: the trailing noun the query prompt
        # asks for costs real recall on Commons, because CirrusSearch wants
        # every term to hit. "Mangalagiri town" returns nothing; "Mangalagiri"
        # returns nine usable files. So the proper nouns are retried alone
        # before giving up — same subject, one fewer term.
        names = " ".join(_CAPITALISED.findall(query))
        if names and names != query:
            found = _commons(names, limit, timeout)
    logger.info("openlicence_search", query=query[:120], found=len(found))
    return found
