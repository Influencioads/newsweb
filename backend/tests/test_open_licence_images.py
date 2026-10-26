"""The no-credit licence rules, and the flag that keeps them switched off.

Same shape as `test_crawl_images.py`: the decision functions in
`integrations/images/openlicence.py` are pure and need no database, and the
service tests stub `httpx` at the same seam. Nothing here touches the network.

The four tests that matter most are the refusals. A CC-BY photo is free to
reuse and needs a credit — running it would put another company's name back on
our page, which is the exact bug this feature exists to fix — so "refused" is
the assertion, not "accepted with a credit".
"""

from __future__ import annotations

import io
import os
from collections.abc import Iterator

import pytest
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from app.api.v1.public import _media_out  # noqa: E402
from app.db.base import Base, utcnow  # noqa: E402
from app.integrations.images import openlicence  # noqa: E402
from app.integrations.images.base import StockImage  # noqa: E402
from app.integrations.storage import StoredObject  # noqa: E402
from app.models.content import Article  # noqa: E402
from app.models.enums import ContentPolicy, IngestStatus, SourceLicence  # noqa: E402
from app.models.ingestion import ContentSource, IngestedItem  # noqa: E402
from app.models.media import Media  # noqa: E402
from app.models.setting import AppSetting  # noqa: E402
from app.services import settings_service, story_image_service  # noqa: E402

PHOTO = "https://upload.wikimedia.org/wikipedia/commons/9/92/Mithali_Raj_batting.jpg"


def _extmeta(**pairs: str) -> dict:
    """Commons wraps every `extmetadata` value in `{"value": ...}`."""
    return {key: {"value": value} for key, value in pairs.items()}


#: A real CC0 file, abridged from the live response.
CC0 = _extmeta(
    License="cc0",
    LicenseShortName="CC0",
    UsageTerms="Creative Commons Zero, Public Domain Dedication",
    AttributionRequired="false",
    Copyrighted="True",  # CC0 files really do say True — see the docstring
    Restrictions="",
    Categories="Mithali Raj|CC-Zero|Women's Cricket World Cup 2017",
)


# --------------------------------------------------------------------------- #
# the licence rules
# --------------------------------------------------------------------------- #
class TestCommonsLicence:
    def test_cc0_and_pdm_are_accepted(self) -> None:
        assert openlicence.licence_of_commons(CC0) == "cc0"
        assert (
            openlicence.licence_of_commons(
                _extmeta(
                    License="pdm-owner",
                    LicenseShortName="Public Domain Mark",
                    AttributionRequired="false",
                    Restrictions="",
                )
            )
            == "pdm-owner"
        )

    def test_bare_public_domain_is_refused_because_it_hides_its_jurisdiction(
        self,
    ) -> None:
        """CommonsMetadata flattens every `{{PD-*}}` template to the same
        `License: "pd"`, US-only ones included. A `PD-US-expired` portrait of an
        Indian politician is still in copyright here — India's term is life+60
        — and nothing in the metadata says which rationale applies. Unprovable
        is a reject; CC0 and PDM are worldwide and survive."""
        assert (
            openlicence.licence_of_commons(
                _extmeta(
                    License="pd",
                    LicenseShortName="Public domain",
                    AttributionRequired="false",
                    Copyrighted="False",
                    Restrictions="",
                )
            )
            is None
        )

    def test_cc_by_is_refused(self) -> None:
        """Free to reuse, but it needs a credit — which is the thing we are
        trying to get off the page."""
        assert (
            openlicence.licence_of_commons(
                _extmeta(
                    License="cc-by-3.0",
                    LicenseShortName="CC BY 3.0",
                    AttributionRequired="true",
                    Restrictions="",
                )
            )
            is None
        )

    def test_cc_by_sa_is_refused(self) -> None:
        assert (
            openlicence.licence_of_commons(
                _extmeta(
                    License="cc-by-sa-4.0",
                    LicenseShortName="CC BY-SA 4.0",
                    AttributionRequired="true",
                    Restrictions="",
                )
            )
            is None
        )

    def test_godl_india_is_refused_despite_having_no_licence_key(self) -> None:
        """The trap. Most PIB/PMO photos of Indian politicians look like this:
        no `License` key at all, so a check that only rejects licences it
        recognises lets them straight through."""
        meta = _extmeta(
            LicenseShortName="GODL-India",
            UsageTerms="Government Open Data License – India",
            AttributionRequired="true",
            Restrictions="",
        )
        assert "License" not in meta
        assert openlicence.licence_of_commons(meta) is None

    def test_odbl_is_refused(self) -> None:
        assert (
            openlicence.licence_of_commons(
                _extmeta(
                    LicenseShortName="ODbL",
                    AttributionRequired="true",
                    Restrictions="",
                )
            )
            is None
        )

    def test_an_unidentifiable_licence_is_refused(self) -> None:
        """No metadata, no permission. Absent is a reject, never a maybe."""
        assert openlicence.licence_of_commons(None) is None
        assert openlicence.licence_of_commons({}) is None
        assert openlicence.licence_of_commons(_extmeta(License="cc0")) is None

    def test_attribution_required_is_a_string_not_a_boolean(self) -> None:
        """`bool("false")` is True. If this ever regresses, every CC-BY photo
        on Commons becomes publishable without a credit."""
        assert (
            openlicence.licence_of_commons(
                _extmeta(License="cc0", AttributionRequired="true", Restrictions="")
            )
            is None
        )

    def test_personality_rights_refuse_an_otherwise_free_photo(self) -> None:
        """A live Commons hit on a Nara Brahmani photo: CC licence, and
        `Restrictions=personality`. Copyright and publicity rights are two
        different questions and only one of them is in the licence."""
        meta = dict(CC0)
        meta["Restrictions"] = {"value": "personality"}
        assert openlicence.licence_of_commons(meta) is None

    def test_a_custom_attribution_string_refuses_it(self) -> None:
        meta = dict(CC0)
        meta["Attribution"] = {"value": "Photo by Somebody, please credit"}
        assert openlicence.licence_of_commons(meta) is None


class TestNonLicenceRules:
    def test_a_logo_or_signature_is_not_a_photograph(self) -> None:
        assert not openlicence.is_photograph("Some logo", "https://x.test/logo.png")
        assert not openlicence.is_photograph(
            "Virat Kohli signature", "https://x.test/sig.jpg"
        )
        assert not openlicence.is_photograph(
            "Map of Guntur district", "https://x.test/m.jpg"
        )
        # Attached to a Hyderabad story on 2026-09-30; "flag of" missed it.
        assert not openlicence.is_photograph(
            "Hyderabad City Flag", "https://x.test/f.jpg"
        )
        assert openlicence.is_photograph("Mithali Raj batting", PHOTO)

    def test_the_proper_noun_floor_is_three_characters(self) -> None:
        """Raj, Rao and Roy are surnames. A four-character floor tested
        "Mithali" alone and called that a match for "Mithali Raj"."""
        assert openlicence._CAPITALISED.findall("Mithali Raj") == ["Mithali", "Raj"]

    def test_depicts_subject_needs_the_name_in_the_title(self) -> None:
        her = StockImage(
            source="wikimedia",
            external_id="1",
            title="Mithali Raj at the 2017 Women's Cricket World Cup",
            image_url=PHOTO,
            creator=None,
            license_code="cc0",
            license_version=None,
            license_url=None,
            landing_url=None,
        )
        assert openlicence.depicts_subject(her, "Mithali Raj cricketer portrait")
        # Same photo, different story: not a picture of that person.
        assert not openlicence.depicts_subject(her, "Nara Brahmani portrait")
        # No proper noun at all — nothing to be a picture *of*.
        assert not openlicence.depicts_subject(her, "cricket stadium")

    def test_categories_are_not_proof(self) -> None:
        """Commons files a photo under everyone connected with it: a Deepika
        Padukone story matched a still of her film's director, categorised
        under her name. Only the title says who is in the frame."""
        still = StockImage(
            source="wikimedia",
            external_id="1",
            title="2017 Women's Cricket World Cup IMG 2652",
            image_url=PHOTO,
            creator=None,
            license_code="cc0",
            license_version=None,
            license_url=None,
            landing_url=None,
            subject_text="Mithali Raj|CC-Zero",
        )
        assert not openlicence.depicts_subject(still, "Mithali Raj portrait")

    def test_a_name_inside_a_longer_word_is_not_that_person(self) -> None:
        """The wrong-person case, and it lands on the confident side of the
        caption. "nara" is a substring of "Naraj", "Modi" of "Modinagar" —
        both real Commons subjects — so the match is on word boundaries."""
        river = StockImage(
            source="wikimedia",
            external_id="2",
            title="Brahmani River near Naraj Odisha",
            image_url=PHOTO,
            creator=None,
            license_code="cc0",
            license_version=None,
            license_url=None,
            landing_url=None,
            subject_text="Rivers of Odisha",
        )
        assert not openlicence.depicts_subject(river, "Nara Brahmani portrait")

        town = StockImage(
            source="wikimedia",
            external_id="3",
            title="Modinagar railway station",
            image_url=PHOTO,
            creator=None,
            license_code="cc0",
            license_version=None,
            license_url=None,
            landing_url=None,
            subject_text="Uttar Pradesh",
        )
        assert not openlicence.depicts_subject(town, "Modi portrait")


# --------------------------------------------------------------------------- #
# the service
# --------------------------------------------------------------------------- #
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
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Iterator[None]:
    settings_service.invalidate()
    yield
    settings_service.invalidate()


def set_flag(db: Session, value: bool) -> None:
    key = "crawl.open_licence_images"
    row = db.scalar(select(AppSetting).where(AppSetting.key == key))
    if row is None:
        row = AppSetting(key=key)
        db.add(row)
    row.value = {"v": value}
    db.flush()
    settings_service.invalidate()


class _Storage:
    key = "test"

    def put(self, key: str, raw: bytes, **kw: object) -> StoredObject:
        return StoredObject(
            key=key,
            url=f"https://cdn.example/{key}",
            bytes=len(raw),
            provider="test",
            content_type=str(kw.get("content_type") or ""),
        )


def _jpeg(width: int = 1600, height: int = 900) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), "navy").save(buf, format="JPEG")
    return buf.getvalue()


def make_story(db: Session, slug: str) -> tuple[Article, IngestedItem]:
    source = ContentSource(
        slug=slug,
        name="TV9 Telugu",
        feed_url=f"https://tv9telugu.example/{slug}.xml",
        licence=SourceLicence.RSS_PUBLIC,
        content_policy=ContentPolicy.EXCERPT_ONLY,
    )
    item = IngestedItem(
        source=source,
        guid=f"{slug}-1",
        # The publisher's real slug, section words and all. A trimmed one
        # hid the bug where the query took the first four words.
        url=(
            "https://tv9telugu.example/sports/cricket-news/"
            "wapl-t20-launch-nara-brahmani-mithali-raj-1915280.html"
        ),
        title="మంగళగిరిలో వైభవంగా మహిళల ఆంధ్రా ప్రీమియర్ లీగ్",
        fetched_at=utcnow(),
        content_hash=f"hash-{slug}",
        status=IngestStatus.NEW,
    )
    article = Article(
        short_id=slug[:6],
        slug=slug,
        title_te="మంగళగిరిలో వైభవంగా మహిళల ఆంధ్రా ప్రీమియర్ లీగ్",
        body={"type": "doc", "content": []},
    )
    db.add_all([item, article])
    db.flush()
    return article, item


@pytest.fixture
def stub_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.media_service.get_storage", lambda *_a, **_kw: _Storage()
    )


@pytest.fixture
def stub_download(monkeypatch: pytest.MonkeyPatch) -> None:
    """Skip the shared downloader's socket work, not its existence.

    `_download_image` is `ingestion_service`'s, already covered by
    `test_crawl_images.py` — SSRF guard, streaming size cap, dimension check.
    What matters here is that this service calls it rather than growing a
    second downloader with its own version of those rules.
    """
    monkeypatch.setattr(
        "app.services.ingestion_service._download_image",
        lambda url: (_jpeg(), "image/jpeg", url),
    )


def stub_commons(monkeypatch: pytest.MonkeyPatch, *pages: dict) -> list[str]:
    """Stub the Commons API at the httpx seam, recording the queries sent."""
    sent: list[str] = []

    class _Resp:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"query": {"pages": list(pages)}}

    def _get(url: str, **kw: object) -> _Resp:
        sent.append(str((kw.get("params") or {}).get("gsrsearch", "")))
        return _Resp()

    monkeypatch.setattr("app.integrations.images.openlicence.httpx.get", _get)
    return sent


def commons_page(licence_meta: dict, *, title: str, pageid: int = 1) -> dict:
    return {
        "pageid": pageid,
        "title": f"File:{title}.jpg",
        "imageinfo": [
            {
                "mime": "image/jpeg",
                "width": 3888,
                "height": 2592,
                "thumburl": f"{PHOTO}?utm_source=commons.wikimedia.org",
                "thumbwidth": 1600,
                "thumbheight": 1066,
                "url": PHOTO,
                "descriptionurl": "https://commons.wikimedia.org/wiki/File:x.jpg",
                "extmetadata": licence_meta,
            }
        ],
    }


class TestResolveHero:
    def test_an_incident_never_gets_a_file_photo_of_the_place(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A Tirupati temple on a Tirupati accident reads as the scene; the
        incident is drawn as a representative scene by the next rung instead."""
        article, item = make_story(db, "incident")
        article.title_te = "తిరుపతి జిల్లాలో బ్రహ్మోత్సవాల వేళ ప్రమాదం.. పన్నెండు మందికి గాయాలు"
        set_flag(db, True)

        def _never(*_a: object, **_kw: object) -> None:
            raise AssertionError("searched a photo library for an incident")

        monkeypatch.setattr(openlicence, "search", _never)
        monkeypatch.setattr(story_image_service, "image_query", _never)

        assert story_image_service.resolve_hero(db, article, item) is None

    def test_the_flag_being_off_means_no_search_happens(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The deploy-safety property: nothing changes until an admin says so."""
        article, item = make_story(db, "flag-off")
        set_flag(db, False)

        def _never(*_a: object, **_kw: object) -> None:
            raise AssertionError("searched a photo library with the flag off")

        monkeypatch.setattr(openlicence, "search", _never)
        monkeypatch.setattr(story_image_service, "image_query", _never)

        assert story_image_service.resolve_hero(db, article, item) is None
        assert article.hero_media_id is None

    def test_a_cc0_photo_of_the_named_person_is_attached_with_no_credit(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        article, item = make_story(db, "cc0-hero")
        set_flag(db, True)
        sent = stub_commons(
            monkeypatch, commons_page(CC0, title="Mithali Raj batting 2017")
        )
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Mithali Raj portrait"
        )

        media = story_image_service.resolve_hero(db, article, item)

        assert media is not None
        assert article.hero_media_id == media.id
        # The whole point: no other company's name on the page — and that
        # includes the public payload, not just the rendered caption.
        assert media.credit is None
        assert media.source_type == "public_domain"
        label = (_media_out(media).license_label or "").lower()
        assert label == "cc0"
        assert "wikimedia" not in label and "openverse" not in label
        # ...but the licence is still on the record.
        assert media.meta["open_licence"]["licence"] == "cc0"
        assert media.meta["open_licence"]["page_url"]
        # It is her, so it is a file photo, not a stand-in.
        assert media.caption_te == story_image_service.FILE_PHOTO_TE
        assert not media.meta.get("representative")
        # `haslicense:unrestricted` narrows the search; it never decides.
        assert "haslicense:unrestricted" in sent[0]

    def test_a_person_story_takes_no_photo_rather_than_a_wrong_one(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        """A generic ground shot on a story about a named cricketer is not a
        picture of her, and labelling it ప్రాతినిధ్య చిత్రం does not make it one.

        This asserted the opposite until a live run against fourteen real
        crawled stories showed what "label it and attach it anyway" produces: a
        creek in Georgia on a women's cricket league, a Nebraska shopfront on a
        bank-holiday story, and a photograph of a film's director on a story
        about its lead actress. The rule is all-or-nothing — see
        `openlicence.depicts_subject`."""
        article, item = make_story(db, "stand-in")
        set_flag(db, True)
        page = commons_page(
            _extmeta(
                License="cc0",
                LicenseShortName="CC0",
                AttributionRequired="false",
                Restrictions="",
                Categories="Cricket grounds in Andhra Pradesh",
            ),
            title="Cricket ground at dusk",
        )
        stub_commons(monkeypatch, page)
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Mithali Raj portrait"
        )

        media = story_image_service.resolve_hero(db, article, item)

        # Hero-less, and that is the correct outcome: the AI rung and the
        # editor's own MediaPicker both sit behind this one.
        assert media is None
        assert article.hero_media_id is None

    def test_a_photo_merely_filed_under_the_place_is_not_attached(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        """The generic-bus case. This used to attach as a ప్రాతినిధ్య చిత్రం
        stand-in: the temple is categorised Mangalagiri, so the proper-noun
        test passed while the picture showed nothing named in the story. No
        stand-ins now — the place has to be in the file's title."""
        article, item = make_story(db, "place-query")
        set_flag(db, True)
        stub_commons(
            monkeypatch,
            commons_page(
                _extmeta(
                    License="cc0",
                    LicenseShortName="CC0",
                    AttributionRequired="false",
                    Restrictions="",
                    Categories="Mangalagiri|Temples in Andhra Pradesh",
                ),
                title="Panakala Narasimha temple",
            ),
        )
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Mangalagiri town"
        )

        assert story_image_service.resolve_hero(db, article, item) is None
        assert article.hero_media_id is None

    def test_a_photo_titled_with_the_place_is_a_file_photo(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        article, item = make_story(db, "charminar")
        set_flag(db, True)
        stub_commons(monkeypatch, commons_page(CC0, title="Charminar at night"))
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Charminar building"
        )

        media = story_image_service.resolve_hero(db, article, item)

        assert media is not None
        assert media.caption_te == story_image_service.FILE_PHOTO_TE
        # Alt text says what is in the frame, not what the story is about.
        assert (
            media.alt_te == f"{story_image_service.FILE_PHOTO_TE}: Charminar at night"
        )

    def test_our_own_open_licence_hero_does_not_re_credit_the_publisher(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        """The masthead regression, and it inverted the whole feature: the
        rewrite was published under our name only while the story had no hero
        at all, so attaching a CC0 photo put TV9's name back on it. A hero
        needing no credit is nothing borrowed."""
        from app.services import ingestion_service

        article, item = make_story(db, "masthead")
        set_flag(db, True)
        stub_commons(monkeypatch, commons_page(CC0, title="Mithali Raj batting"))
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Mithali Raj portrait"
        )
        item.source.attribution_required = False
        article.source_type, article.source_credit = "syndicated", item.source.name

        assert story_image_service.resolve_hero(db, article, item) is not None
        ingestion_service._apply_masthead(db, article, item.source, True)

        assert article.source_type == "own"
        assert article.source_credit is None

    def test_a_cc_by_result_is_refused_and_leaves_the_story_hero_less(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        """Every Commons hit needs a credit, so nothing is used. Hero-less is
        the correct outcome — not "use it anyway and print the credit"."""
        article, item = make_story(db, "cc-by-only")
        set_flag(db, True)
        stub_commons(
            monkeypatch,
            commons_page(
                _extmeta(
                    License="cc-by-3.0",
                    LicenseShortName="CC BY 3.0",
                    AttributionRequired="true",
                    Restrictions="",
                ),
                title="Telugu actor at an event",
            ),
            commons_page(
                _extmeta(
                    LicenseShortName="GODL-India",
                    AttributionRequired="true",
                    Restrictions="",
                ),
                title="Chief Minister at a function",
                pageid=2,
            ),
        )
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Nara Brahmani portrait"
        )
        before = db.query(Media).count()

        # `ai.image_enabled` is off by default, so rung (c) declines too.
        assert story_image_service.resolve_hero(db, article, item) is None
        assert article.hero_media_id is None
        # Nothing was downloaded, so no Media row was written at all.
        assert db.query(Media).count() == before

    def test_a_warned_commons_response_is_not_read_as_no_results(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A malformed `haslicense:` value returns zero hits plus a soft
        warning rather than an error. Treating that as "no photo exists" is a
        silent-empty-result bug that would never be noticed."""

        class _Resp:
            status_code = 200

            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {
                    "warnings": {"search": {"*": "haslicense keyword contains no..."}},
                    "query": {"pages": []},
                }

        monkeypatch.setattr(
            "app.integrations.images.openlicence.httpx.get", lambda *a, **k: _Resp()
        )
        assert openlicence.search("Mithali Raj") == []

    def test_a_warning_next_to_real_results_keeps_the_results(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """MediaWiki warns about deprecated parameters and continuations too.
        Discarding a full page of hits over one of those would switch this rung
        off site-wide, and nothing but a log line would say so."""

        class _Resp:
            status_code = 200

            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {
                    "warnings": {"main": {"*": "Subscribe to the mediawiki-api..."}},
                    "query": {"pages": [commons_page(CC0, title="Mithali Raj")]},
                }

        monkeypatch.setattr(
            "app.integrations.images.openlicence.httpx.get", lambda *a, **k: _Resp()
        )
        found = openlicence.search("Mithali Raj")
        assert len(found) == 1
        # And the API's utm_* tracking params are gone: upload.wikimedia.org
        # answers 403 to a request carrying them (measured in wikimedia.py).
        assert "?" not in found[0].image_url


GREEN_CARD = (
    "Charles Green - The Visiting Card - Langham Sketching Club Subject - "
    "B1975.4.882 - Yale Center for British Art"
)
ZELENSKYY = (
    "Rehabilitation of Wounded Soldiers and Potential Patronage Over Ukrainian "
    "Regions – Results of Volodymyr Zelenskyy's Meeting with Iceland’s "
    "President.- 2"
)
VONTIMITTA = "16th century Kodandarama temple, Vontimitta, Andhra Pradesh India - 22"
WW2_CRASH = (
    "Allied bomber crash-landed in Partisan-controlled territory, Yugoslavia, WW2"
)


class TestQuery:
    def test_no_model_means_no_query_not_a_guess(self, db: Session) -> None:
        """The Latin fallback that used to answer here read "Green Card" out of
        an English headline and "Rights Register Review Meeting" out of a URL
        slug. It cannot tell a name from a topic, so without a model there is
        no query — and no Commons photo."""
        _, item = make_story(db, "slug-query")
        assert story_image_service.image_query(db, item) is None

    def test_none_from_the_model_is_final(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        """2026-09-30, the EB-5 story. The model said NONE — rightly: a green
        card is not a person or a place — the fallback searched "Green Card"
        anyway, and Commons answered with a Yale painting."""
        article, item = make_story(db, "eb5-green-card")
        item.title = "U.S. to hike EB-5 Green Card fees"
        set_flag(db, True)
        sent = stub_commons(monkeypatch, commons_page(CC0, title=GREEN_CARD))

        class _Model:
            key = "stub"

            def _complete(self, prompt: str, rules: str) -> str:
                return "NONE"

        monkeypatch.setattr(settings_service, "ai_enabled", lambda _db: True)
        monkeypatch.setattr(settings_service, "ai_credentials", lambda _db, **_kw: {})
        monkeypatch.setattr(story_image_service, "get_ai", lambda **_kw: _Model())
        monkeypatch.setattr(
            story_image_service.ai_usage_service, "check_budget", lambda _db: None
        )
        monkeypatch.setattr(
            story_image_service.ai_usage_service, "record", lambda *_a, **_kw: None
        )

        assert story_image_service.resolve_hero(db, article, item) is None
        assert sent == []
        assert article.hero_media_id is None


class TestExactMatchOnly:
    """What the 2026-09-30 run attached as ప్రాతినిధ్య చిత్రం stand-ins, with the
    query that really produced each one. Now: nothing — and the one exact
    match from the same run still attaches, as a file photo."""

    @pytest.mark.parametrize(
        ("slug", "query", "title"),
        [
            # EB-5 green-card fees. Both words are in the title; the name is not.
            ("gcard1", "Green Card", GREEN_CARD),
            # Telangana graduates' voter registration — the old slug fallback.
            ("voter1", "Rights Register Review Meeting", ZELENSKYY),
            # Brahmotsavam accident near Tirupati; "Andhra:" was the headline's
            # section label, and a state is not a subject.
            ("tirup1", "Andhra temple building", VONTIMITTA),
            # Tu-95 crash in Russia, from the English words in the headline.
            ("tu95b1", "Bomber Crashes", WW2_CRASH),
        ],
    )
    def test_the_stand_ins_attach_nothing(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
        slug: str,
        query: str,
        title: str,
    ) -> None:
        article, item = make_story(db, slug)
        set_flag(db, True)
        stub_commons(monkeypatch, commons_page(CC0, title=title))
        monkeypatch.setattr(story_image_service, "image_query", lambda *_a: query)

        assert story_image_service.resolve_hero(db, article, item) is None
        assert article.hero_media_id is None

    def test_rajamouli_still_gets_his_file_photo(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        article, item = make_story(db, "rajam1")
        set_flag(db, True)
        stub_commons(monkeypatch, commons_page(CC0, title="SS Rajamouli"))
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Rajamouli portrait"
        )

        media = story_image_service.resolve_hero(db, article, item)

        assert media is not None
        assert media.caption_te == story_image_service.FILE_PHOTO_TE
        assert not media.meta.get("representative")

    def _candidate(self, title: str, subject: str = "") -> StockImage:
        return StockImage(
            source="wikimedia",
            external_id="1",
            title=title,
            image_url=PHOTO,
            creator=None,
            license_code="cc0",
            license_version=None,
            license_url=None,
            landing_url=None,
            subject_text=subject,
        )

    def test_other_queries_for_the_same_stories(self) -> None:
        """What a better-behaved model might have asked instead. A generic
        topic, a state, or a place the file does not name: all nothing."""
        match = openlicence.depicts_subject
        assert not match(self._candidate(GREEN_CARD), "green card")
        assert not match(self._candidate(ZELENSKYY), "Telangana voter registration")
        assert not match(self._candidate(VONTIMITTA), "Andhra city")
        assert not match(self._candidate(VONTIMITTA), "Andhra Pradesh temple")
        assert not match(self._candidate(VONTIMITTA), "Tirupati temple")
        assert not match(self._candidate(WW2_CRASH), "Russian bomber crash")
        assert not match(self._candidate("Police exam hall, Kerala"), "police exam")

    def test_a_named_place_or_person_in_the_title_attaches(self) -> None:
        match = openlicence.depicts_subject
        assert match(self._candidate("SS Rajamouli"), "S S Rajamouli portrait")
        assert match(self._candidate("Tirumala Venkateswara Temple"), "Tirumala temple")
        # Punctuation between the words of a name is still that name.
        assert match(
            self._candidate("Tirupati, Andhra Pradesh, from Alipiri"),
            "Tirupati Andhra Pradesh town",
        )
        # A state word inside a real name is part of that name, not a region.
        assert match(
            self._candidate("Andhra University campus, Visakhapatnam"),
            "Andhra University building",
        )

    def test_a_georgia_creek_is_not_a_cricket_league(self) -> None:
        """First live run: query "WAPL", result "Foe Killer Creek, Roswell,
        Georgia"."""
        candidate = self._candidate("Foe Killer Creek, Roswell, Georgia")
        assert openlicence.depicts_subject(candidate, "WAPL") is False

    def test_an_australian_club_is_not_jubilee_hills(self) -> None:
        """First live run: this attached as a stand-in on the word Jubilee
        alone. The name is Jubilee Hills, and it is matched whole."""
        candidate = self._candidate(
            "Bassendean Caledonians SFC club rooms at Jubilee Reserve"
        )
        assert openlicence.depicts_subject(candidate, "Jubilee Hills building") is False

    def test_a_person_story_needs_that_person(self) -> None:
        """The dangerous one: a Deepika Padukone story matched a working still
        of the film's director, categorised under her name."""
        candidate = self._candidate(
            "Danish Aslam 'Break Ke Baad' Working Still",
            subject="Deepika Padukone Break Ke Baad",
        )
        assert (
            openlicence.depicts_subject(candidate, "Deepika Padukone portrait") is False
        )

    def test_a_person_story_accepts_a_picture_of_them(self) -> None:
        candidate = self._candidate("Mithali Raj batting 2017")
        assert openlicence.depicts_subject(candidate, "Mithali Raj portrait") is True

    def test_a_place_story_takes_a_photo_of_that_place(self) -> None:
        candidate = self._candidate("2021 view of the Warangal Museum")
        assert openlicence.depicts_subject(candidate, "Warangal Museum building") is True

    def test_a_query_with_no_proper_noun_attaches_nothing(self) -> None:
        candidate = self._candidate("Adams Block (Crawford, NE)")
        assert openlicence.depicts_subject(candidate, "bank branches closed") is False

    def test_a_landmark_named_after_a_person_is_not_their_portrait(self) -> None:
        match = openlicence.depicts_subject
        for title, query in (
            ("Rajiv Gandhi International Airport, Hyderabad", "Rajiv Gandhi portrait"),
            ("NTR Gardens Hyderabad at night", "NTR portrait"),
            ("Indira Gandhi Municipal Stadium Vijayawada", "Indira Gandhi portrait"),
        ):
            assert not match(self._candidate(title), query), title
        # The same airport is still a picture of the airport.
        assert match(
            self._candidate("Rajiv Gandhi International Airport, Hyderabad"),
            "Rajiv Gandhi International Airport building",
        )

    def test_a_homonym_abroad_is_not_our_place(self) -> None:
        """Live, 2026-09-30: the top CC0 hit for "Guntur city" was Mount Guntur
        in Java; the next, a Javanese gamelan named in its categories."""
        match = openlicence.depicts_subject
        volcano = self._candidate(
            "Vulkaan Guntur te West-Java Gunong Guntur (titel op object) Atlas tot "
            "het werk Java",
            "Mount Guntur|CC-Zero|Lithographs of Java",
        )
        gamelan = self._candidate(
            "Gangsa Kyai Guntur Madu", "CC-Zero|Kanjeng Kyai Guntur Madu (Yogyakarta)"
        )
        assert not match(volcano, "Guntur city")
        assert not match(gamelan, "Guntur city")
        assert not match(self._candidate("Hyderabad, Sindh clock tower"), "Hyderabad city")
        assert match(self._candidate("Guntur skyline", "Guntur"), "Guntur city")

    def test_a_thing_from_the_place_is_not_the_place(self) -> None:
        """Live, "Guntur city": a statue in a Warangal museum."""
        match = openlicence.depicts_subject
        assert not match(
            self._candidate("Buddha from Guntur district, Warangal Museum"), "Guntur city"
        )
        assert not match(self._candidate("View from Charminar"), "Charminar building")
        assert match(
            self._candidate("Tirupati, Andhra Pradesh, from Alipiri"), "Tirupati town"
        )

    def test_a_capitalised_common_noun_is_not_a_name(self) -> None:
        assert not openlicence.depicts_subject(
            self._candidate("Bus accident in Kerala 2019"), "Bus Accident"
        )

    def test_the_query_noun_and_a_trailing_state_are_not_the_name(self) -> None:
        match = openlicence.depicts_subject
        assert match(self._candidate("Amaravati"), "Amaravati Andhra Pradesh city")
        assert match(self._candidate("Charminar at night"), "Charminar Building")
        assert match(self._candidate("SS Rajamouli"), "Rajamouli Portrait")
        assert match(self._candidate("Tirupati, Andhra Pradesh"), "Tirupati City")

    def test_a_photo_taken_in_a_city_is_not_the_city(self) -> None:
        """Live, 2026-09-30: a mall on a Hyderabad meat-ban story, a shadow on a
        Dubai flight story."""
        match = openlicence.depicts_subject
        assert not match(self._candidate("Inorbit Mall, Hyderabad (84459)"), "Hyderabad city")
        assert not match(self._candidate("Dubai building shadow (Unsplash)"), "Dubai city")
        assert not match(self._candidate("Guntur rail station platform"), "Guntur city")
        assert match(self._candidate("Dubai skyline at dusk"), "Dubai city")
        # Live, the retry: the model stacked the nouns past the one it was asked for.
        assert not match(self._candidate("Inorbit Mall, Hyderabad (84459)"), "Hyderabad city portrait")
        assert not match(self._candidate("Dubai festival city"), "Dubai city building")
        assert not match(self._candidate("Dubai building shadow (Unsplash)"), "Dubai building")
        # Off the mandated form: no type noun at all.
        assert not match(self._candidate("Dubai building shadow (Unsplash)"), "Dubai airplane")
        assert match(self._candidate("Dubai, United Arab Emirates (Unsplash)"), "Dubai airplane")

    def test_categories_reach_the_homonym_check(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        article, item = make_story(db, "guntur1")
        set_flag(db, True)
        gamelan = {**CC0, **_extmeta(Categories="Kanjeng Kyai Guntur Madu (Yogyakarta)")}
        stub_commons(
            monkeypatch,
            commons_page(gamelan, title="Gangsa Kyai Guntur Madu"),
            commons_page(CC0, title="Guntur skyline", pageid=2),
        )
        monkeypatch.setattr(story_image_service, "image_query", lambda *_a: "Guntur city")

        media = story_image_service.resolve_hero(db, article, item)

        assert media is not None
        assert media.meta["open_licence"]["title"] == "Guntur skyline"
