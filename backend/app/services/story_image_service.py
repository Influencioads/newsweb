"""Finding a hero photograph for an imported story, in a fixed order.

The story is ours: rewritten in Telugu, published under our own masthead. The
picture kept undoing that. The source publisher's photograph is their work, so
§12.5 makes `Media.credit` mandatory, so their name went back on the page under
our headline. This service is the way out — and the way out is a **licence**
question, never a watermark question.

    a. the publisher's own photo, if one survived `feeds.images` and, with
       `crawl.image_scan` on, the vision check (branded ones are rejected,
       never cleaned)                                  (`ingestion_service`)
    b. an open-licence photo of the story's named person, place or event —
       CC0 / PDM only, no credit line                            (this file)
    c. an AI image, photographic, on the crawl's automatic import only
                                         (`ingestion_service._illustrate`)
    d. nothing. Hero-less is a good outcome; the desk adds a photo.

(b) runs only when (a) produced nothing, and sits behind
`crawl.open_licence_images`, which defaults off — so this file changes nothing
until an admin says otherwise.

**The AI rung is deliberately not here**, and is fenced hard where it is. A
picture costs money per item at up to sixty items an hour, and the rungs are
anti-correlated — Commons being thin, slow or rate-limited is exactly the
condition that would route *every* article to the paid one. So (c) has its
own switch (`crawl.ai_illustrations`, default off), a daily cap, stops at the
budget-alert line and never runs inside a web request. What it draws is a
generic representative scene — never the event, a victim or a recognisable
real person — labelled AI-made and ప్రతీకాత్మక చిత్రం, and a sensitive story
gets none. The editor's MediaPicker button still generates one on demand, for
a human who chose it.

WHAT THE READER IS TOLD, which is the part that is not negotiable
----------------------------------------------------------------
Only an exact match is attached: the name the story is about — a person, a
place, an event — is in the Commons file's *title* (`openlicence.
depicts_subject`). That photograph *is* its subject, but it is a library
photograph, not a picture of the event in the story, so it is captioned
**ఫైల్ చిత్రం** (file photo), the same word a print desk has used for a
century.

There is no stand-in any more. A second, looser rule used to attach anything
sharing one proper noun with the query, captioned ప్రాతినిధ్య చిత్రం
(representative image). On 2026-09-30 it attached a Yale painting to an EB-5
green-card story, a Zelenskyy meeting to a Telangana voter-registration
story, a Kodandarama temple to a Tirupati accident and a WW2 crash in
Yugoslavia to a Tu-95 crash. A label does not make a picture of something
else honest, so a story with no exact match gets no Commons photo.

No credit line is printed for (b) because CC0 and PDM require none. The
provenance does not vanish: `Media.copyright`, `Media.meta['open_licence']` and
the source page URL are all written, so an auditor can retrace any picture.
"""

from __future__ import annotations

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
    # Measured 2026-09-30: without this line "Andhra:" in a headline became
    # "Andhra city", and a Vontimitta temple went on a Tirupati accident.
    "A place is a city, town, village or landmark, never a state or a country.\n"
    "Capitalise proper nouns and nothing else.\n"
    "Name only people or places that appear in the headline. If the headline "
    "names neither a person nor a place, reply with the word NONE."
)

#: A model that ignores the word limit is a model whose answer is a sentence.
_MAX_QUERY_WORDS = 6


def image_query(db: Session, item: IngestedItem) -> str | None:
    """A short English image-search query for a Telugu story, or None.

    Commons indexes in English; the story is in Telugu. The bulk
    model does the translation because it is the only thing here that can read
    a Telugu headline, and `_QUERY_RULES` forbids it naming anybody the
    headline does not — a hallucinated celebrity would be searched for, found,
    and published beside an unrelated story.

    **NONE is the answer, not a cue to guess.** There used to be a fallback
    that built a query from Latin text in the item — the English title, the
    URL slug — and it ran whenever the model said NONE. It cannot tell a name
    from a topic, and on 2026-09-30 it turned four NONEs into "Green Card",
    "Rights Register Review Meeting", "Bomber Crashes" and "Gold Medals", each
    of which Commons answered with something unrelated. It is gone: no model,
    no key, a refusal, a timeout or NONE all mean no Commons photo.

    `_complete` is reached through `getattr` rather than by widening
    `AiProvider`: the keyless heuristic provider has no completion to offer and
    no business growing a fourth abstract method for one caller.

    It is a billed call like any other, so it is bracketed by
    `ai_usage_service` the way every sibling call site is: the budget is
    checked first (inside the try, so an exhausted month means no photo rather
    than a failed import) and the spend is recorded after. Without
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
    return None


def _attach(
    db: Session,
    article: Article,
    item: IngestedItem,
    candidate,
    *,
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

    # Alt text describes the *picture*, not the article: a Charminar photo on
    # a story about a bandobast there shows Charminar, not the bandobast. The
    # file's own title is the text that says what is in the frame.
    alt = f"{FILE_PHOTO_TE}: {candidate.title}"
    media = media_service.create_image_media(
        db,
        raw=raw,
        filename=f"{(article.slug[:40] or 'photo')}.jpg",
        mime=mime,
        max_bytes=ingestion_service.MAX_IMAGE_BYTES,
        uploaded_by=actor_id,
        alt_te=alt[:500],
        caption_te=FILE_PHOTO_TE,
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
    # An incident gets no file photo of the place: a temple on a Tirupati
    # accident (2026-09-30) reads as the scene. The owner wants it drawn as a
    # representative scene instead, which is the next rung's job.
    from app.services import ai_image_service

    if ai_image_service.is_incident(db, article, item.source.default_category_id if item.source else None):
        return None

    query = image_query(db, item)
    if query:
        try:
            for candidate in openlicence.search(query):
                # The story's named subject in the file's title, or nothing —
                # see `openlicence.depicts_subject`.
                if not openlicence.depicts_subject(candidate, query):
                    logger.info(
                        "story_image_off_subject",
                        item_id=item.id,
                        query=query,
                        title=candidate.title[:80],
                    )
                    continue
                media = _attach(db, article, item, candidate, actor_id=actor_id)
                if media is not None:
                    logger.info(
                        "story_image_open_licence",
                        article_id=article.id,
                        licence=candidate.license_code,
                        source=candidate.source,
                    )
                    return media
        except Exception:  # noqa: BLE001
            logger.warning("story_image_search_failed", item_id=item.id, exc_info=True)

    return None


__all__ = ["FILE_PHOTO_TE", "image_query", "resolve_hero"]
