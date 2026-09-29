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
    "signature", "coat of arms", "flag of", "map of", "locator",
    "seal of", "emblem", "stamp of", "chart", "diagram", "poster",
    # Measured, not guessed: a live "Vijayawada city" search returned
    # "Floor plan of Trimurti rock-cut temple" as a top CC0 hit.
    "floor plan", "plan of",
)

#: The proper nouns in a search query. `depicts_subject` matches on these and
#: nothing else, so "Mithali Raj cricketer portrait" is tested on the name.
#: `{2,}` is a three-character floor, not four: Raj, Rao and Roy are surnames,
#: and a floor of four tested "Mithali" alone and called that a match.
_CAPITALISED = re.compile(r"\b[A-Z][a-zA-Z]{2,}\b")


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
    """Is this a picture **of the named subject**, or merely on the topic?

    The honesty rule, and the caller sets the caption from it. Every
    capitalised word in the search query — the proper nouns, which is all the
    query is meant to contain — must appear in the file's title or its Commons
    categories. That is a deliberately strict test:

      * "Mithali Raj cricketer" against a file categorised `Mithali Raj` —
        both words present, it is her.
      * the same query against a generic `India Women v Australia Women` shot
        with no name — topical, not her.
      * a query with no proper noun at all ("flood rescue") can never match,
        which is correct: there is no named subject to be a picture of.

    Matching is on **word boundaries**, not substrings. A plain `in` test read
    "Nara Brahmani" as depicted by "Brahmani River near Naraj Odisha", and the
    same collision fires on the commonest terms we search for: Modi ⊂
    Modinagar, Rama ⊂ Ramanathapuram, Guntur ⊂ Gunturu. Those land on the
    confident side of the caption, which is the one direction that is not
    allowed to be wrong.

    False does not reject the image. It decides whether the reader is told the
    picture is a stand-in.
    """
    names = _CAPITALISED.findall(query or "")
    if not names:
        return False
    text = f"{candidate.title} {candidate.subject_text or ''}".lower()
    return all(
        re.search(rf"\b{re.escape(name.lower())}\b", text) is not None for name in names
    )


def is_person_query(query: str) -> bool:
    """Whether this search was for a named human rather than a place or topic.

    `image_query` mandates a trailing noun, and "portrait" is the one it uses
    for people. It is the whole test on purpose: the caller needs to know
    "would a stand-in be a lie here", and for a person the answer is always yes.
    """
    words = (query or "").split()
    return bool(words) and words[-1].lower() == "portrait"


def may_attach(candidate: StockImage, query: str) -> bool:
    """Is this close enough to the story to publish **at all**?

    `depicts_subject` decides whether the reader is told the picture is a
    stand-in. This decides whether there is a picture. They are different
    questions and conflating them produced real nonsense on the first live run
    against fourteen crawled stories: a "WAPL" (women's cricket league) search
    attached *Foe Killer Creek, Roswell, Georgia*; "Jubilee Hills" attached a
    football club's rooms in Bassendean, Australia, matched on the word
    Jubilee; a bank-holiday story got a shopfront in Crawford, Nebraska. Each
    was correctly labelled ప్రాతినిధ్య చిత్రం — which made the label meaningless,
    because a representative image has to be representative *of something*.

    Two rules:

      * A **person** query attaches only on a full match. A story about
        somebody needs a picture of that person; a topical stand-in on a named
        individual is the case where a wrong face is worst. The live run found
        one: a Deepika Padukone story matched a working still of the film's
        director, categorised under her name.
      * A **place or topic** query attaches when at least one proper noun from
        the query really appears in the file's title or categories — Warangal
        Museum on a Warangal story — and is then labelled as a stand-in.

    Nothing matching means no picture. Hero-less is a correct outcome, and the
    AI rung and the editor's own MediaPicker both sit behind this one.
    """
    if is_person_query(query):
        # A story about somebody needs a picture of THEM, and Commons
        # categories cannot tell a photograph of a person from one merely
        # filed under their name: the live run matched a Deepika Padukone
        # story to a working still of her film's DIRECTOR, categorised under
        # her. The title is where Commons names who is actually in the
        # frame, so for a person that is the only field that counts.
        names = _CAPITALISED.findall(query or "")
        title = (candidate.title or "").lower()
        return bool(names) and all(
            re.search(rf"\b{re.escape(name.lower())}\b", title) is not None
            for name in names
        )
    if depicts_subject(candidate, query):
        return True
    names = _CAPITALISED.findall(query or "")
    if not names:
        return False
    text = f"{candidate.title} {candidate.subject_text or ''}".lower()
    return any(
        re.search(rf"\b{re.escape(name.lower())}\b", text) is not None
        for name in names
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
            # Categories are the only reliable proof of subject: Commons
            # `ImageDescription` is routinely "IMG_2652".
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
