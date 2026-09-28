"""Finding a hero photograph for an imported story, in a fixed order.

The story is ours: rewritten in Telugu, published under our own masthead. The
picture kept undoing that. The source publisher's photograph is their work, so
§12.5 makes `Media.credit` mandatory, so their name went back on the page under
our headline. This service is the way out — and the way out is a **licence**
question, never a watermark question.

    a. the publisher's own photo, if one survived `feeds.images`   (unchanged)
    b. an open-licence photo — CC0 / PDM only, no credit line
    c. nothing. Hero-less is a perfectly good outcome.

(b) runs only when (a) produced nothing, and sits behind
`crawl.open_licence_images`, which defaults off — so this file changes nothing
until an admin says otherwise.

**There is deliberately no AI-illustration rung here.** `_attach_media`'s
reasoning has not changed: a drawing costs money per item at up to sixty items
an hour, and the two rungs are anti-correlated — Commons being thin, slow or
rate-limited is exactly the condition that would route *every* article to the
paid one. An admin who turns on a switch labelled "find a no-credit photo" is
not asking to buy a picture for every import. The editor's
MediaPicker button still generates one on demand, for a human who chose it.

WHAT THE READER IS TOLD, which is the part that is not negotiable
----------------------------------------------------------------
A photograph of a named person *is* that person, and needs no qualifier — but
it is a library photograph, not a picture of the event in the story, so it is
captioned **ఫైల్ చిత్రం** (file photo), the same word a print desk has used for
a century. Anything else — a city view on a story datelined that city, a
cricket-ground shot on a cricket story — is captioned **ప్రాతినిధ్య చిత్రం**
(representative image), the label `seed_media` already uses.

Two things must both hold before the confident label is used.
`openlicence.depicts_subject` — every proper noun in the search query present
in the file's title or Commons categories — and the query must be about a
*person*, which `_QUERY_RULES` marks with the trailing noun "portrait". A
place fails the second test on purpose: "Mangalagiri" matches any Commons
photo categorised Mangalagiri, so a temple or a street view would be captioned
"file photo" on a story about a bus fire there, and in Indian news convention
that says the picture is an older shot *of the thing in the story*. Everything
that is not a named person falls to the stand-in label. A generic photo
presented as the event is a lie to the reader, and the only safe direction to
be wrong in is towards the label.

No credit line is printed for (b) because CC0 and PDM require none. The
provenance does not vanish: `Media.copyright`, `Media.meta['open_licence']` and
the source page URL are all written, so an auditor can retrace any picture.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.integrations.ai import get_ai
from app.integrations.images import openlicence
from app.models.content import Article
from app.models.ingestion import IngestedItem
from app.models.media import ArticleMedia, Media
from app.services import ai_usage_service, media_service, settings_service

logger = get_logger(__name__)

#: A library photograph of the named subject. True, and honest about its age.
FILE_PHOTO_TE = "ఫైల్ చిత్రం"

#: A stand-in. Matches `seed_media.DEMO_CREDIT`'s wording on purpose.
REPRESENTATIVE_TE = "ప్రాతినిధ్య చిత్రం"

#: Asked of the cheap bulk model, the same one the crawl rewrite uses. An image
#: lookup runs on every import; the editorial model's price does not survive
#: that, and this is a four-word answer.
_QUERY_RULES = (
    "You convert a Telugu news headline into a short English image-search "
    "query for a public-domain photo library.\n"
    "Reply with the query alone: at most six words, no punctuation, no "
    "explanation, no quotes.\n"
    "Name the single main person, or the single main place, that the headline "
    "is about, then one plain noun for what the photo should show.\n"
    "The noun must be exactly 'portrait' for a person, and one of city, town, "
    "temple, stadium or building for a place. Nothing else.\n"
    "Capitalise proper nouns and nothing else.\n"
    "Name only people or places that appear in the headline. If the headline "
    "names neither a person nor a place, reply with the word NONE."
)

#: A model that ignores the word limit is a model whose answer is a sentence.
_MAX_QUERY_WORDS = 6

_SLUG_NOISE = re.compile(r"\d|^(news|video|photos|live|latest|update|story)$")


def _from_latin_text(item: IngestedItem) -> str | None:
    """The fallback when AI is off or failed: proper nouns already in the item.

    A Telugu headline rarely carries Latin script, but the source URL almost
    always does — `/cricket-news/wapl-t20-launch-nara-brahmani-mithali-raj-…`
    is a list of exactly the names we want, written by the publisher's own CMS.
    Nothing is invented: every word returned came out of the item.

    It also cannot tell a name from a section word, so the query it builds
    carries "Launch" beside "Mithali Raj" — and `depicts_subject`, which
    demands *every* capitalised word be present, will then refuse to call any
    result a picture of the subject. That is the correct outcome rather than a
    shortcoming: a query nothing verified should not produce a photo captioned
    as if it were verified. Fallback results get the stand-in label.

    Three characters is the floor, not four: Raj, Rao and Roy are surnames.
    """
    from_title = openlicence._CAPITALISED.findall(item.title or "")
    if from_title:
        return " ".join(from_title[:4])

    slug = (item.url or "").rstrip("/").rsplit("/", 1)[-1].split(".")[0]
    words = [w for w in slug.split("-") if len(w) >= 3 and not _SLUG_NOISE.search(w)]
    # Trailing numeric ids and section words are gone; what is left is names —
    # and the **tail** is taken, not the head. A news CMS writes the campaign
    # and section words first and the names last: the real slug above survives
    # as [wapl, launch, nara, brahmani, mithali, raj], where the first four are
    # "Wapl Launch Nara Brahmani" — the names cut off, and two section words
    # searched for as proper nouns.
    return " ".join(w.capitalize() for w in words[-4:]) or None


def image_query(db: Session, item: IngestedItem) -> str | None:
    """A short English image-search query for a Telugu story, or None.

    Commons indexes in English; the story is in Telugu. The bulk
    model does the translation because it is the only thing here that can read
    a Telugu headline, and `_QUERY_RULES` forbids it naming anybody the
    headline does not — a hallucinated celebrity would be searched for, found,
    and published beside an unrelated story.

    `_complete` is reached through `getattr` rather than by widening
    `AiProvider`: the keyless heuristic provider has no completion to offer and
    no business growing a fourth abstract method for one caller. No provider,
    no key, a refusal or a timeout all land in the same place — the Latin
    fallback, which needs nothing.

    It is a billed call like any other, so it is bracketed by
    `ai_usage_service` the way every sibling call site is: the budget is
    checked first (inside the try, so an exhausted month falls to the fallback
    rather than failing the import) and the spend is recorded after. Without
    the record the ₹15,000 ceiling under-counts by one call per import; without
    the check this is the one AI feature that keeps firing after every other
    one has stopped.
    """
    if settings_service.ai_enabled(db):
        provider = get_ai(**settings_service.ai_credentials(db, bulk=True))
        complete = getattr(provider, "_complete", None)
        if complete is not None:
            try:
                ai_usage_service.check_budget(db)
                answer = complete(f"Headline: {item.title}", _QUERY_RULES)
                ai_usage_service.record(
                    db,
                    operation="image_query",
                    provider=provider.key,
                    model=getattr(provider, "model_name", None),
                    usage=getattr(provider, "last_usage", None),
                )
                words = (answer or "").strip().strip('"').split()
                if words and words[0].upper() != "NONE":
                    return " ".join(words[:_MAX_QUERY_WORDS])
            except Exception:  # noqa: BLE001 — a picture must never fail an import
                logger.warning("image_query_failed", item_id=item.id, exc_info=True)
    return _from_latin_text(item)


def _attach(
    db: Session,
    article: Article,
    item: IngestedItem,
    candidate,
    *,
    depicts: bool,
    actor_id: int | None,
) -> Media | None:
    """Download one candidate and hang it off the article as the hero.

    Reuses `ingestion_service._download_image`, which is where the SSRF guard,
    the streaming size cap and the dimension check already live. A second
    downloader would be a second place for those to be got wrong.
    """
    from app.services import ingestion_service

    downloaded = ingestion_service._download_image(candidate.image_url)
    if downloaded is None:
        return None
    raw, mime, final_url = downloaded

    caption = FILE_PHOTO_TE if depicts else REPRESENTATIVE_TE
    # Alt text describes the *picture*, not the article. A screen-reader user
    # on a stand-in used to hear "Bus burned in Mangalagiri — representative
    # image": the claim first, the qualifier after it. For a stand-in the only
    # text that says what is actually in the frame is the file's own title, so
    # that leads. When it really is the named subject the headline is accurate
    # and stays in front.
    alt = (
        f"{article.title_te} — {caption}"
        if depicts
        else f"{caption}: {candidate.title}"
    )
    media = media_service.create_image_media(
        db,
        raw=raw,
        filename=f"{(article.slug[:40] or 'photo')}.jpg",
        mime=mime,
        max_bytes=ingestion_service.MAX_IMAGE_BYTES,
        uploaded_by=actor_id,
        alt_te=alt[:500],
        caption_te=caption,
        # No credit, and that is the whole feature. CC0 and PDM require none,
        # and `source_type="public_domain"` is what tells `media_service` this
        # is a licensed absence rather than a forgotten field.
        credit=None,
        source_type="public_domain",
    )
    # The licence code alone. `Media.copyright` is not the internal field it
    # looks like: `public.py:_media_out` serialises it to every reader and API
    # consumer as `license_label`, so "CC0 · wikimedia" would put a third
    # party's name back in the public payload — the one thing this whole
    # feature exists to prevent. The provider is two lines down in `meta`,
    # which is admin-only, so the audit trail loses nothing.
    media.copyright = candidate.license_code.upper()
    media.meta = {
        "ingested_item_id": item.id,
        # The audit trail. No credit is printed, so this is the only record of
        # why we were allowed to print the picture at all.
        "open_licence": {
            "source": candidate.source,
            "licence": candidate.license_code,
            "page_url": candidate.landing_url,
            "external_id": candidate.external_id,
            "title": candidate.title,
        },
        "origin_url": candidate.image_url,
        # The machine-readable half of the caption, for any client that wants
        # to badge a stand-in rather than print the Telugu line.
        "representative": not depicts,
    }
    if final_url != candidate.image_url:
        media.meta["fetched_from"] = final_url

    article.hero_media_id = media.id
    db.add(ArticleMedia(article_id=article.id, media_id=media.id, role="hero", sort=0))
    db.flush()
    return media


def resolve_hero(
    db: Session,
    article: Article,
    item: IngestedItem,
    *,
    actor_id: int | None = None,
) -> Media | None:
    """Rung (b): an open-licence photo, or None.

    Called only when (a) left `article.hero_media_id` empty, and returns None
    for (c). Every failure path here is a warning and a None — an import that
    fell over because a photo library was slow would be a worse bug than a
    story with no picture.
    """
    if article.hero_media_id is not None:
        return None
    if not settings_service.get_bool(db, "crawl.open_licence_images"):
        return None

    query = image_query(db, item)
    if query:
        try:
            for candidate in openlicence.search(query):
                # Close enough to the story to publish at all? A label saying
                # "representative image" does not rescue a photograph of
                # somewhere else entirely — see `openlicence.may_attach`.
                if not openlicence.may_attach(candidate, query):
                    logger.info(
                        "story_image_off_subject",
                        item_id=item.id,
                        query=query,
                        title=candidate.title[:80],
                    )
                    continue
                media = _attach(
                    db,
                    article,
                    item,
                    candidate,
                    # Both halves of the confident label: it matches every
                    # proper noun, *and* the query is about a person. A place
                    # query matches any photo categorised under that place —
                    # a temple, a street — and "file photo" would then claim
                    # the picture shows what the story is about.
                    depicts=(
                        openlicence.depicts_subject(candidate, query)
                        and query.split()[-1].lower() == "portrait"
                    ),
                    actor_id=actor_id,
                )
                if media is not None:
                    logger.info(
                        "story_image_open_licence",
                        article_id=article.id,
                        licence=candidate.license_code,
                        source=candidate.source,
                        representative=media.meta.get("representative"),
                    )
                    return media
        except Exception:  # noqa: BLE001
            logger.warning("story_image_search_failed", item_id=item.id, exc_info=True)

    return None


__all__ = ["FILE_PHOTO_TE", "REPRESENTATIVE_TE", "image_query", "resolve_hero"]
