"""One-off: load the real AP/TS mandal and gram-panchayat geography from LGD.

The location master shipped with 59 districts, 14 mandals and no localities, so
the reader's picker, the local feed and stringer scoping all had nothing to
offer. This fills the two missing levels from ramSeraph's LGD mirror (GitHub
release assets, no auth):

    subdistricts.<date>.csv.7z      the 1,309 AP+TS mandals — English only
    pri_local_bodies.<date>.csv.7z  rural local bodies; we take Grama Panchayat
    gp_mapping.<date>.csv.7z        panchayat -> mandal, joined by LGD code

Telugu for mandal names comes from Wikidata property P12748 (the LGD Subdistrict
Code), so it joins by code — no fuzzy matching and no invented transliteration.
Where Wikidata has nothing the English name is stored in `name_te` and printed
at the end, for an editor to fix through /cms/locations.

Usage (from backend/):
    .venv/Scripts/python.exe scripts/import_lgd.py --dry-run
    .venv/Scripts/python.exe scripts/import_lgd.py --state AP

Downloads are cached under backend/var/lgd/, so a second run needs no network.
"""

from __future__ import annotations

# ponytail: villages.csv (also in the mirror) is deliberately not loaded — it
# would double the row count and only ~2% of AP villages carry a Telugu name, so
# the picker would fill with English. villages.csv is the upgrade path if
# village-level feeds are ever wanted. Note too that pri_local_bodies is the
# *rural* local-body master: a reader inside a city gets no locality from it.

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

CACHE_DIR = Path(__file__).resolve().parents[1] / "var" / "lgd"
os.environ.setdefault(
    "DATABASE_URL", f"sqlite:///{(CACHE_DIR.parent / 'news-local.db').as_posix()}"
)

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models.geo import District, Locality, Mandal, MandalAlias  # noqa: E402
from app.telugu.transliterate import slugify  # noqa: E402

RELEASE_TAG = "lgd-latest-extra1"
RELEASE_API = (
    f"https://api.github.com/repos/ramSeraph/opendata/releases/tags/{RELEASE_TAG}"
)
# P12748 is the LGD Subdistrict Code, so this joins to the mandal master by code
# — no fuzzy name matching. The PREFIX lines are redundant on WDQS but required
# by the mirror below. Wikidata is CC0.
WIKIDATA_SPARQL = """PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?x ?lgd ?te WHERE {
  VALUES ?cls { wd:Q122987710 wd:Q122987738 }
  ?x wdt:P31 ?cls ; wdt:P12748 ?lgd ; rdfs:label ?te .
  FILTER(lang(?te) = "te")
}"""
SPARQL_ENDPOINTS = (
    "https://query.wikidata.org/sparql",
    # WDQS drops to 1 request/minute whenever it is degraded, and was refusing
    # every request on the day this import ran. QLever serves the same dump.
    "https://qlever.cs.uni-freiburg.de/api/wikidata",
)
# Both endpoints 403 a client with no real User-Agent.
USER_AGENT = "newsweb-lgd-import/1.0 (one-off geography import) python-urllib"

STATE_CODES = {"AP": "28", "TS": "36"}

#: LGD spells seven districts differently from our seeded slugs. Everything else
#: matches on slugify(District.name_en), so only the real drifts are listed.
DISTRICT_ALIASES = {
    "y-s-r-kadapa": "kadapa",
    "hanumakonda": "hanamkonda",
    "jagitial": "jagtial",
    "jangoan": "jangaon",
    "jayashankar-bhupalapally": "jayashankar-bhupalpally",
    "kumuram-bheem-asifabad": "komaram-bheem-asifabad",
    "ranga-reddy": "rangareddy",
}

_TELUGU = re.compile(r"[ఀ-౿]")
_MANDAL_WORD = "మండలం"


# --------------------------------------------------------------------------- #
# source files
# --------------------------------------------------------------------------- #
def ensure_csv(prefix: str) -> Path:
    """Return the cached `<prefix>.<date>.csv`, downloading and unpacking once."""
    cached = sorted(CACHE_DIR.glob(f"{prefix}.*.csv"))
    if cached:
        return cached[-1]

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(RELEASE_API, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        assets = json.load(response)["assets"]
    for asset in assets:
        name = asset["name"]
        if name.startswith(f"{prefix}.") and name.endswith(".csv.7z"):
            break
    else:
        raise SystemExit(f"No {prefix}.*.csv.7z asset in release {RELEASE_TAG}")

    archive = CACHE_DIR / name
    if not archive.exists():
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(asset["browser_download_url"], archive)

    try:
        from py7zr import SevenZipFile
    except ImportError:
        raise SystemExit(
            "LGD archives are .7z. Install the unpacker into this venv:\n"
            "  .venv/Scripts/python.exe -m pip install py7zr"
        ) from None
    SevenZipFile(archive).extractall(path=str(CACHE_DIR))
    return sorted(CACHE_DIR.glob(f"{prefix}.*.csv"))[-1]


def read_rows(path: Path) -> Iterator[dict[str, str]]:
    """Stream one LGD CSV. gp_mapping is 75 MB — never hold it in a list."""
    with path.open(encoding="utf-8-sig", newline="") as handle:
        yield from csv.DictReader(handle)


def _sparql(query: str) -> str:
    encoded = urllib.parse.quote(query)
    failure: Exception | None = None
    for attempt in range(3):
        for endpoint in SPARQL_ENDPOINTS:
            request = urllib.request.Request(
                f"{endpoint}?format=json&query={encoded}",
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/sparql-results+json",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    return response.read().decode("utf-8")
            except urllib.error.URLError as exc:
                failure = exc
                print(f"  {endpoint}: {exc}")
        if attempt < 2:
            print("  every SPARQL endpoint refused; waiting 90s")
            time.sleep(90)
    raise SystemExit(f"No SPARQL endpoint answered: {failure}")


def wikidata_labels() -> dict[str, str]:
    """LGD subdistrict code -> Telugu label, cached to var/lgd/."""
    cache = CACHE_DIR / "wikidata_mandals.json"
    if not cache.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_text(_sparql(WIKIDATA_SPARQL), encoding="utf-8")

    data = json.loads(cache.read_text(encoding="utf-8"))
    labels: dict[str, str] = {}
    for binding in data["results"]["bindings"]:
        labels.setdefault(binding["lgd"]["value"].strip(), binding["te"]["value"])
    return labels


# --------------------------------------------------------------------------- #
# parsing — pure, so tests can drive it from an inline fixture
# --------------------------------------------------------------------------- #
class LgdMandal(NamedTuple):
    code: str
    district: str  # LGD's English district name
    name_en: str


class LgdPanchayat(NamedTuple):
    code: str
    mandal_code: str
    name_en: str
    name_te: str | None


def clean_telugu(text: str | None) -> str | None:
    """NFC, or None when the field is really romanised (LGD often ALL-CAPS it)."""
    normalised = unicodedata.normalize("NFC", (text or "").strip())
    return normalised if _TELUGU.search(normalised) else None


def parse_subdistricts(
    rows: Iterable[dict[str, str]], state_code: str
) -> list[LgdMandal]:
    return [
        LgdMandal(
            row["Sub-district Code"].strip(),
            row["District Name"].strip(),
            row["Sub-district Name"].strip(),
        )
        for row in rows
        if row["State Code"].strip() == state_code
    ]


def parse_gp_mapping(rows: Iterable[dict[str, str]], state_code: str) -> dict[str, str]:
    """Local Body Code -> Sub-district Code.

    One row per village, so a panchayat repeats; a few dozen straddle two
    mandals and the mandal holding most of their villages wins (code order
    breaks a tie, so the result is the same on every run).
    """
    spread: dict[str, Counter[str]] = {}
    for row in rows:
        if row["State Code"].strip() != state_code:
            continue
        code = row["Local Body Code"].strip()
        if not code or code == "0":
            continue
        spread.setdefault(code, Counter())[row["Subdistrict Code"].strip()] += 1
    return {
        code: sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        for code, counts in spread.items()
    }


def parse_panchayats(
    rows: Iterable[dict[str, str]], gp_to_mandal: dict[str, str], state_code: str
) -> tuple[list[LgdPanchayat], int]:
    """Grama Panchayats only — mandal and zilla bodies are not places readers pick."""
    panchayats: list[LgdPanchayat] = []
    unmapped = 0
    for row in rows:
        if row["State Code"].strip() != state_code:
            continue
        if row["Localbody Type Name"].strip() != "Grama Panchayat":
            continue
        code = row["Localbody Code"].strip()
        mandal_code = gp_to_mandal.get(code)
        if mandal_code is None:
            unmapped += 1
            continue
        panchayats.append(
            LgdPanchayat(
                code,
                mandal_code,
                row["Localbody Name (In English)"].strip(),
                clean_telugu(row["Localbody Name (In Local)"]),
            )
        )
    return panchayats, unmapped


# --------------------------------------------------------------------------- #
# import
# --------------------------------------------------------------------------- #
@dataclass
class Report:
    mandals_added: int = 0
    mandals_updated: int = 0
    mandals_te: int = 0
    mandals_total: int = 0
    localities_added: int = 0
    localities_updated: int = 0
    localities_te: int = 0
    localities_total: int = 0
    aliases_added: int = 0
    unmapped_panchayats: int = 0
    unknown_districts: Counter[str] = field(default_factory=Counter)
    placeholder_mandals: list[str] = field(default_factory=list)
    placeholder_localities: list[str] = field(default_factory=list)
    suffixed: list[str] = field(default_factory=list)


def _claim(taken: set[str], slug: str, code: str, rep: Report, parent: str) -> str:
    """A slug unique within its parent. Deterministic: rows are walked in LGD
    code order, so a re-run assigns the same suffixes to the same rows."""
    base = slug or f"lgd-{code}"
    candidate, n = base, 1
    while candidate in taken:
        n += 1
        candidate = f"{base}-{n}"
    if candidate != base:
        rep.suffixed.append(f"{parent}/{candidate}")
    taken.add(candidate)
    return candidate


def district_index(db: Session, state: str) -> dict[str, District]:
    index: dict[str, District] = {}
    for district in db.scalars(select(District).where(District.state == state)):
        index[district.slug] = district
        index[slugify(district.name_en)] = district
    return index


def import_mandals(
    db: Session,
    state: str,
    rows: Iterable[LgdMandal],
    labels: dict[str, str],
    rep: Report,
) -> dict[str, Mandal]:
    districts = district_index(db, state)
    existing = {(m.district_id, m.slug): m for m in db.scalars(select(Mandal))}
    claimed: dict[int, set[str]] = {}
    by_code: dict[str, Mandal] = {}
    pending_aliases: list[tuple[Mandal, str, str]] = []

    for row in sorted(rows, key=lambda r: int(r.code)):
        key = slugify(row.district)
        district = districts.get(DISTRICT_ALIASES.get(key, key))
        if district is None:
            rep.unknown_districts[row.district] += 1
            continue

        rep.mandals_total += 1
        label = clean_telugu(labels.get(row.code))
        name_te = label
        if name_te and name_te.endswith(_MANDAL_WORD):
            name_te = name_te[: -len(_MANDAL_WORD)].strip()
        if name_te:
            rep.mandals_te += 1
        else:
            rep.placeholder_mandals.append(f"{district.slug}/{row.name_en}")

        slug = _claim(
            claimed.setdefault(district.id, set()),
            slugify(row.name_en),
            row.code,
            rep,
            district.slug,
        )
        mandal = existing.get((district.id, slug))
        if mandal is None:
            mandal = Mandal(
                district_id=district.id,
                slug=slug,
                name_en=row.name_en,
                name_te=name_te or row.name_en,
                is_active=True,
            )
            db.add(mandal)
            existing[(district.id, slug)] = mandal
            rep.mandals_added += 1
        else:
            # Never stomp a Telugu name the desk fixed by hand with our English
            # placeholder, and leave is_active alone — deactivating is editorial.
            if mandal.name_en != row.name_en or (name_te and mandal.name_te != name_te):
                rep.mandals_updated += 1
            mandal.name_en = row.name_en
            if name_te:
                mandal.name_te = name_te

        by_code[row.code] = mandal
        pending_aliases.append((mandal, row.name_en, "en"))
        if label and label != mandal.name_te:
            pending_aliases.append((mandal, label, "te"))

    db.flush()
    known = {(a.mandal_id, a.alias) for a in db.scalars(select(MandalAlias))}
    for mandal, alias, lang in pending_aliases:
        if (mandal.id, alias) in known:
            continue
        db.add(MandalAlias(mandal_id=mandal.id, alias=alias, lang=lang))
        known.add((mandal.id, alias))
        rep.aliases_added += 1
    db.flush()
    return by_code


def import_panchayats(
    db: Session, by_code: dict[str, Mandal], rows: Iterable[LgdPanchayat], rep: Report
) -> None:
    existing = {(loc.mandal_id, loc.slug): loc for loc in db.scalars(select(Locality))}
    claimed: dict[int, set[str]] = {}

    for row in sorted(rows, key=lambda r: int(r.code)):
        mandal = by_code.get(row.mandal_code)
        if mandal is None:
            rep.unmapped_panchayats += 1
            continue

        rep.localities_total += 1
        if row.name_te:
            rep.localities_te += 1
        else:
            rep.placeholder_localities.append(f"{mandal.slug}/{row.name_en}")

        slug = _claim(
            claimed.setdefault(mandal.id, set()),
            slugify(row.name_en),
            row.code,
            rep,
            mandal.slug,
        )
        locality = existing.get((mandal.id, slug))
        if locality is None:
            locality = Locality(
                mandal_id=mandal.id,
                slug=slug,
                name_en=row.name_en,
                name_te=row.name_te or row.name_en,
                kind="panchayat",
                is_active=True,
            )
            db.add(locality)
            existing[(mandal.id, slug)] = locality
            rep.localities_added += 1
        else:
            # `kind` is left alone on update: an editor may have promoted a
            # panchayat to town, and LGD cannot know that.
            if locality.name_en != row.name_en or (
                row.name_te and locality.name_te != row.name_te
            ):
                rep.localities_updated += 1
            locality.name_en = row.name_en
            if row.name_te:
                locality.name_te = row.name_te
    db.flush()


# --------------------------------------------------------------------------- #
# report
# --------------------------------------------------------------------------- #
def _pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.1f}%" if whole else "n/a"


def print_report(state: str, rep: Report) -> None:
    print(f"\n{'=' * 66}\n{state}\n{'=' * 66}")
    print(
        f"  mandals     {rep.mandals_added:>6} added  {rep.mandals_updated:>6} updated"
        f"  ({rep.mandals_total} seen, Telugu {_pct(rep.mandals_te, rep.mandals_total)})"
    )
    print(
        f"  panchayats  {rep.localities_added:>6} added  {rep.localities_updated:>6} updated"
        f"  ({rep.localities_total} seen, Telugu {_pct(rep.localities_te, rep.localities_total)})"
    )
    print(f"  aliases     {rep.aliases_added:>6} added")

    if rep.unknown_districts:
        print(
            "\n  SKIPPED — LGD districts we do not have. Add them in /cms/locations\n"
            "  and re-run; their mandals were not attached to anything else:"
        )
        for name, count in sorted(rep.unknown_districts.items()):
            print(f"    {name:<32} {count} mandals")

    if rep.suffixed:
        print(f"\n  slug collisions resolved with a suffix ({len(rep.suffixed)}):")
        for slug in rep.suffixed[:20]:
            print(f"    {slug}")

    if rep.placeholder_mandals:
        print(
            f"\n  ENGLISH PLACEHOLDER in name_te — {len(rep.placeholder_mandals)} mandals"
            " with no Telugu label on Wikidata. Fix in /cms/locations:"
        )
        for name in rep.placeholder_mandals:
            print(f"    {name}")

    if rep.placeholder_localities:
        print(
            f"\n  ENGLISH PLACEHOLDER in name_te — {len(rep.placeholder_localities)}"
            " panchayats (LGD has no Telugu name). First 20:"
        )
        for name in rep.placeholder_localities[:20]:
            print(f"    {name}")

    if rep.unmapped_panchayats:
        print(f"\n  {rep.unmapped_panchayats} panchayats had no mandal and were skipped")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import LGD mandals and gram panchayats into the location master"
    )
    parser.add_argument(
        "--state", choices=sorted(STATE_CODES), action="append", help="default: both"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="report, then roll back — writes nothing"
    )
    args = parser.parse_args()

    subdistricts = ensure_csv("subdistricts")
    local_bodies = ensure_csv("pri_local_bodies")
    gp_mapping = ensure_csv("gp_mapping")
    labels = wikidata_labels()
    print(f"wikidata: {len(labels)} Telugu mandal labels")

    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        for state in args.state or sorted(STATE_CODES):
            code = STATE_CODES[state]
            rep = Report()
            by_code = import_mandals(
                db, state, parse_subdistricts(read_rows(subdistricts), code), labels, rep
            )
            gp_to_mandal = parse_gp_mapping(read_rows(gp_mapping), code)
            panchayats, unmapped = parse_panchayats(
                read_rows(local_bodies), gp_to_mandal, code
            )
            rep.unmapped_panchayats = unmapped
            import_panchayats(db, by_code, panchayats, rep)
            print_report(state, rep)

        if args.dry_run:
            db.rollback()
            print("\n--dry-run: rolled back, nothing written.")
        else:
            db.commit()
            print("\ncommitted.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
