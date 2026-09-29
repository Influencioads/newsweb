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
        assert openlicence.is_photograph("Mithali Raj batting", PHOTO)

    def test_the_proper_noun_floor_is_three_characters(self) -> None:
        """Raj, Rao and Roy are surnames. A four-character floor tested
        "Mithali" alone and called that a match for "Mithali Raj"."""
        assert openlicence._CAPITALISED.findall("Mithali Raj") == ["Mithali", "Raj"]

    def test_depicts_subject_needs_every_proper_noun(self) -> None:
        her = StockImage(
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
        assert openlicence.depicts_subject(her, "Mithali Raj cricketer portrait")
        # Same photo, different story: one of the two names is missing, so it
        # is not a picture of that person and must be labelled a stand-in.
        assert not openlicence.depicts_subject(her, "Nara Brahmani portrait")
        # No proper noun at all — nothing to be a picture *of*.
        assert not openlicence.depicts_subject(her, "cricket stadium")

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
        assert media.meta["representative"] is False
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
        about its lead actress. For a named person the rule is now all-or-
        nothing — see `openlicence.may_attach`."""
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

    def test_a_photo_of_a_named_place_is_a_stand_in_not_a_file_photo(
        self,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
        stub_storage: None,
        stub_download: None,
    ) -> None:
        """The generic-bus case. "Mangalagiri" matches every Commons file
        categorised Mangalagiri — a temple, a street — so the proper-noun test
        passes while the picture shows nothing to do with the story. "File
        photo" would claim it is an older shot of the thing in the story; only
        a named *person* earns that label."""
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
                title="Panakala Narasimha temple Mangalagiri",
            ),
        )
        monkeypatch.setattr(
            story_image_service, "image_query", lambda *_a: "Mangalagiri town"
        )

        media = story_image_service.resolve_hero(db, article, item)

        assert media is not None
        assert media.caption_te == story_image_service.REPRESENTATIVE_TE
        # Alt text describes the picture, not the headline — the qualifier
        # cannot arrive after the claim.
        assert media.alt_te.startswith(story_image_service.REPRESENTATIVE_TE)
        assert "Mangalagiri" in media.alt_te

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


class TestQueryFallback:
    def test_names_come_out_of_the_source_slug_when_ai_is_off(
        self, db: Session
    ) -> None:
        """AI off, Telugu headline, no Latin script in it — the publisher's own
        URL slug is where the proper nouns are, and nothing is invented."""
        _, item = make_story(db, "slug-query")
        query = story_image_service.image_query(db, item)
        assert query is not None
        # Three-letter surnames survive: Raj, Rao, Roy.
        assert "Mithali" in query and "Raj" in query
        # The numeric story id is not a name.
        assert "1915280" not in query

        # And the fallback cannot separate "Launch" from "Mithali Raj", so it
        # can never claim a result depicts the subject. Anything it finds is
        # captioned a stand-in, which is the honest way to be unsure.
        her = StockImage(
            source="wikimedia",
            external_id="1",
            title="Mithali Raj batting",
            image_url=PHOTO,
            creator=None,
            license_code="cc0",
            license_version=None,
            license_url=None,
            landing_url=None,
            subject_text="Mithali Raj",
        )
        assert not openlicence.depicts_subject(her, query)


class TestNotJustAnyPhotograph:
    """A label saying "representative image" does not rescue a photo of
    somewhere else entirely.

    Every case here is from the first live run against fourteen real crawled
    stories: the licence filter was sound and the matching was not.
    """

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

    def test_a_georgia_creek_is_not_a_cricket_league(self) -> None:
        """Query "WAPL", result "Foe Killer Creek, Roswell, Georgia"."""
        candidate = self._candidate("Foe Killer Creek, Roswell, Georgia")
        assert openlicence.may_attach(candidate, "WAPL") is False

    def test_an_australian_club_is_not_jubilee_hills(self) -> None:
        """Matched on the word Jubilee alone. One shared word is not a place."""
        candidate = self._candidate(
            "Bassendean Caledonians SFC club rooms at Jubilee Reserve"
        )
        assert openlicence.may_attach(candidate, "Jubilee Hills building") is True
        # It attaches — "Jubilee" really is in the title — but it must never
        # claim to be a picture of the story.
        assert openlicence.depicts_subject(candidate, "Jubilee Hills building") is False

    def test_a_person_story_needs_that_person(self) -> None:
        """The dangerous one: a Deepika Padukone story matched a working still
        of the film's director, categorised under her name."""
        candidate = self._candidate(
            "Danish Aslam 'Break Ke Baad' Working Still",
            subject="Deepika Padukone Break Ke Baad",
        )
        assert openlicence.is_person_query("Deepika Padukone portrait") is True
        assert openlicence.may_attach(candidate, "Deepika Padukone portrait") is False

    def test_a_person_story_accepts_a_picture_of_them(self) -> None:
        candidate = self._candidate(
            "Mithali Raj batting 2017", subject="Mithali Raj cricket"
        )
        assert openlicence.may_attach(candidate, "Mithali Raj portrait") is True
        assert openlicence.depicts_subject(candidate, "Mithali Raj portrait") is True

    def test_a_place_story_takes_a_photo_of_that_place(self) -> None:
        candidate = self._candidate(
            "2021 view of the Warangal Museum", subject="Warangal district"
        )
        assert openlicence.may_attach(candidate, "Warangal city building") is True

    def test_a_query_with_no_proper_noun_attaches_nothing(self) -> None:
        candidate = self._candidate("Adams Block (Crawford, NE)")
        assert openlicence.may_attach(candidate, "bank branches closed") is False
