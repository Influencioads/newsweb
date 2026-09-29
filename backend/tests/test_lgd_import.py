"""The LGD geography importer, driven off inline CSV fixtures.

Never touches the network: the fixtures are byte-for-byte the column headers of
the real LGD exports, and the Wikidata label lookup is passed in as a dict.

What has to hold: mandals land under the right district, a district LGD knows
and we do not is skipped *by name* rather than attached to the wrong one, and a
second run writes nothing — the operator is expected to re-run this after
adding the missing districts.
"""

from __future__ import annotations

import csv
import io
import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("APP_ENV", "test")

from app.db.base import Base  # noqa: E402
from app.db.seed import seed_districts, seed_states  # noqa: E402
from app.models.geo import Locality, Mandal, MandalAlias  # noqa: E402
from scripts.import_lgd import (  # noqa: E402
    Report,
    import_mandals,
    import_panchayats,
    parse_gp_mapping,
    parse_panchayats,
    parse_subdistricts,
)

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
TestSession = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, future=True
)

# Real headers. 28 = AP, 36 = TS, 21 = Odisha (must be ignored entirely).
# "Markapuram" is the trap: LGD has the district, our seeded 26 do not.
SUBDISTRICTS_CSV = """\
S.No.,State Code,State Name,District Code,District Name,Sub-district Code,Sub-district Version,Sub-district Name,Census 2001 Code,Census 2011 Code
1,28,Andhra Pradesh,520,Visakhapatnam,4879,2,Bheemunipatnam,1,1
2,28,Andhra Pradesh,504,Y.S.R. Kadapa,5000,1,Chapadu,2,2
3,28,Andhra Pradesh,790,Markapuram,5100,1,Tarlupadu,3,3
4,36,Telangana,686,Hanumakonda,6000,1,Elkathurthy,4,4
5,21,Odisha,360,Kendrapada,2925,2,Aali,5,5
"""

PRI_LOCAL_BODIES_CSV = """\
S.No.,Localbody Type Code,Localbody Type Name,Localbody Code,Localbody Version,Localbody Name (In English),Localbody Name (In Local),Parent Localbody Code,State Code,State Name
1,3,Grama Panchayat,900001,1,Kotha Bheemili,కొత్త భీమిలి,5139,28,Andhra Pradesh
2,3,Grama Panchayat,900002,1,Chapadu East,CHAPADU EAST,5139,28,Andhra Pradesh
3,3,Grama Panchayat,900003,1,Tarlupadu Khurd,తర్లుపాడు ఖుర్ద్,5139,28,Andhra Pradesh
4,2,Mandal Panchayat,6038,1,Achanta,ACHANTA,478,28,Andhra Pradesh
5,3,Grama Panchayat,900004,1,Elkathurthy Rural,ఎల్కతుర్తి రూరల్,7000,36,Telangana
"""

GP_MAPPING_CSV = """\
S.No.,District Code,District Name (In English),District Census 2011 Code,District Census 2001 Code,Subdistrict Code,Subdistrict Name (In English),Subdistrict Census 2011 Code,Subdistrict Census 2001 Code,Village Code,Village Name (In English),Village Census 2011 Code,Village Census 2001 Code,Local Body Code,Local Body Name (In English),State Code,State Name
1,520,Visakhapatnam,1,1,4879,Bheemunipatnam,1,0,111,Kotha A,111,0,900001,Kotha Bheemili,28,Andhra Pradesh
2,504,Y.S.R. Kadapa,2,2,5000,Chapadu,2,0,222,Chapadu A,222,0,900002,Chapadu East,28,Andhra Pradesh
3,504,Y.S.R. Kadapa,2,2,4879,Bheemunipatnam,1,0,223,Stray,223,0,900002,Chapadu East,28,Andhra Pradesh
4,790,Markapuram,3,3,5100,Tarlupadu,3,0,333,Tarlu A,333,0,900003,Tarlupadu Khurd,28,Andhra Pradesh
5,686,Hanumakonda,4,4,6000,Elkathurthy,4,0,444,Elka A,444,0,900004,Elkathurthy Rural,36,Telangana
6,360,Kendrapada,5,5,2925,Aali,5,0,555,Aali A,555,0,900005,Aali GP,21,Odisha
"""

#: Keyed by LGD Sub-district Code, as Wikidata P12748 gives it. Chapadu is
#: deliberately absent — that row must fall back to an English placeholder.
LABELS = {
    "4879": "భీమునిపట్నం మండలం",
    "6000": "ఎల్కతుర్తి మండలం",
}


def _rows(text: str) -> Iterator[dict[str, str]]:
    return csv.DictReader(io.StringIO(text))


@pytest.fixture(scope="module")
def db() -> Iterator[Session]:
    Base.metadata.create_all(engine)
    session = TestSession()
    seed_states(session)
    seed_districts(session)
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


def _run(session: Session, state: str) -> Report:
    rep = Report()
    by_code = import_mandals(
        session, state, parse_subdistricts(_rows(SUBDISTRICTS_CSV), _code(state)), LABELS, rep
    )
    gp_to_mandal = parse_gp_mapping(_rows(GP_MAPPING_CSV), _code(state))
    panchayats, unmapped = parse_panchayats(
        _rows(PRI_LOCAL_BODIES_CSV), gp_to_mandal, _code(state)
    )
    rep.unmapped_panchayats = unmapped
    import_panchayats(session, by_code, panchayats, rep)
    return rep


def _code(state: str) -> str:
    return "28" if state == "AP" else "36"


def test_gp_mapping_picks_the_mandal_holding_most_villages() -> None:
    """900002 has one village in Chapadu and one in Bheemunipatnam; the tie is
    broken by the lower subdistrict code, so the result never flip-flops."""
    mapping = parse_gp_mapping(_rows(GP_MAPPING_CSV), "28")
    assert mapping == {"900001": "4879", "900002": "4879", "900003": "5100"}


def test_panchayats_skip_non_gram_bodies() -> None:
    mapping = parse_gp_mapping(_rows(GP_MAPPING_CSV), "28")
    panchayats, unmapped = parse_panchayats(_rows(PRI_LOCAL_BODIES_CSV), mapping, "28")
    assert unmapped == 0
    assert [p.name_en for p in panchayats] == [
        "Kotha Bheemili",
        "Chapadu East",
        "Tarlupadu Khurd",
    ]
    # LGD writes the "local" name romanised for some rows; that is not Telugu.
    assert [p.name_te for p in panchayats][1] is None


def test_import_maps_rows_and_skips_unknown_districts(db: Session) -> None:
    rep = _run(db, "AP")

    assert rep.unknown_districts == {"Markapuram": 1}
    assert rep.mandals_added == 2  # Markapuram's mandal was not attached anywhere
    assert rep.localities_added == 2  # nor was its panchayat

    mandal = db.scalars(select(Mandal).where(Mandal.slug == "bheemunipatnam")).one()
    assert mandal.district.slug == "visakhapatnam"
    assert mandal.name_te == "భీమునిపట్నం"  # the " మండలం" suffix is stripped

    # LGD spells the district "Y.S.R. Kadapa"; our slug is "kadapa".
    chapadu = db.scalars(select(Mandal).where(Mandal.slug == "chapadu")).one()
    assert chapadu.district.slug == "kadapa"
    assert chapadu.name_te == "Chapadu"  # honest English placeholder, not invented
    assert "kadapa/Chapadu" in rep.placeholder_mandals

    localities = db.scalars(
        select(Locality).where(Locality.mandal_id == mandal.id)
    ).all()
    assert [(loc.slug, loc.kind, loc.name_te) for loc in localities] == [
        ("kotha-bheemili", "panchayat", "కొత్త భీమిలి"),
        ("chapadu-east", "panchayat", "Chapadu East"),
    ]

    aliases = {
        a.alias for a in db.scalars(select(MandalAlias).where(MandalAlias.mandal_id == mandal.id))
    }
    assert aliases == {"Bheemunipatnam", "భీమునిపట్నం మండలం"}


def test_second_run_writes_nothing(db: Session) -> None:
    before = (
        len(db.scalars(select(Mandal)).all()),
        len(db.scalars(select(Locality)).all()),
        len(db.scalars(select(MandalAlias)).all()),
    )
    rep = _run(db, "AP")
    after = (
        len(db.scalars(select(Mandal)).all()),
        len(db.scalars(select(Locality)).all()),
        len(db.scalars(select(MandalAlias)).all()),
    )

    assert before == after
    assert (rep.mandals_added, rep.localities_added, rep.aliases_added) == (0, 0, 0)
    assert (rep.mandals_updated, rep.localities_updated) == (0, 0)


def test_other_state_is_a_separate_pass(db: Session) -> None:
    rep = _run(db, "TS")
    assert rep.mandals_added == 1
    assert rep.localities_added == 1
    elkathurthy = db.scalars(select(Mandal).where(Mandal.slug == "elkathurthy")).one()
    assert elkathurthy.district.slug == "hanamkonda"
    assert elkathurthy.name_te == "ఎల్కతుర్తి"
