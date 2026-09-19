"""The screen that stands between a keyword and a picture (updated doc §17).

`is_sensitive` is a **screen, not a classifier**. It does not read the text, it
cannot weigh context, and it will call an ordinary court report sensitive. That
is the trade it is built to make.

It exists for the one AI failure in this product that has no recovery. An image
model asked to illustrate a communal clash, a rape case or a named minor will
cheerfully draw it, and a synthetic photograph of a real incident published
under a masthead is not undone by deleting the file. Every other AI mistake
here is a bad draft an editor throws away. So the generator asks this first,
and a match means no call is made at all — not a gentler prompt, no call.

The lists err toward matching, but a term earns its place only if it *names* a
sensitive story rather than merely turning up in one. Police, court, protest,
arrest, party names and temple festivals are absent for that reason, and so
are the community, caste-category and child words: "హిందూ" is the front of
Hindupur, "ఎస్సీ" and "ఎస్టీ" are in every corporation-loan and scholarship
story, "బాలిక" and "చిన్నారి" are in every prize-day report. A screen that
refuses the district page is a screen the desk learns to click past, and that
costs more than the few stories these terms would have caught.

There is an older boolean twin in `services.crawl_service.is_sensitive` that
answers the same question for the rewrite path. It stays where it is: this
module must import nothing but the normaliser, and that one lives inside a
service that pulls in the database.
"""

from __future__ import annotations

import re

from app.telugu.normalize import normalize_text

__all__ = ["is_sensitive"]

#: Topic -> the words that name it, Telugu and English together.
#:
#: Order is the answer order — first match wins — so the specific topic sits
#: above the general one it contains: a communal riot must report "communal",
#: not "religion", or the refusal an editor reads names the wrong thing.
#:
#: Telugu terms are stems rather than dictionary forms, because Telugu attaches
#: case endings and these are matched as substrings ("ఆత్మహత్యకు" must trip
#: "ఆత్మహత్య"). That cuts both ways, so a stem that also sits inside an
#: unrelated word — or inside routine copy — is left out rather than accepted:
#: bare "మత" because of "మమత", bare "minor" because of "minor injuries",
#: "హిందూ" because of "హిందూపురం", "కులం" because of "వ్యాకులం".
_TOPICS: dict[str, tuple[str, ...]] = {
    "communal": (
        "ఘర్షణ", "అల్లర్లు", "కలహా", "మూకదాడి",
        "communal", "riot", "riots", "rioting", "lynching",
        "mob attack", "hate crime",
    ),
    "sexual_assault": (
        "అత్యాచారం", "లైంగిక", "వేధింపుల", "అఘాయిత్యం",
        "rape", "raped", "gang rape", "sexual assault",
        "sexual harassment", "molest", "molested", "molestation",
    ),
    "minor": (
        "మైనర్",
        "minor girl", "minor boy", "juvenile", "pocso",
        "child abuse", "underage", "schoolgirl",
    ),
    "suicide": (
        "ఆత్మహత్య", "బలవన్మరణం",
        "suicide", "suicidal", "self-immolation", "self immolation",
    ),
    "caste": (
        "కులా", "దళిత", "అగ్రవర్ణ", "అంటరానితనం",
        "caste", "casteist", "dalit", "untouchability",
        "scheduled caste", "scheduled tribe",
    ),
    "religion": (
        "మతం", "మతా", "మతపరమైన", "మతమార్పిడి",
        "religious conversion", "blasphemy",
    ),
}

_LATIN = re.compile(r"[a-z]")


def _matcher(terms: tuple[str, ...]) -> re.Pattern[str]:
    """One pattern per topic: word boundaries for English, stem-initial for Telugu.

    English needs the boundaries — a bare "rape" substring matches "grape" and
    a bare "riot" matches "patriotic". Telugu cannot use `\\b`: the script has
    no case and the boundary sits at every Latin/Telugu transition, so a stem
    with an inflection glued to it would never match.

    But a bare substring is wrong in the other direction, and measured so:
    "మతం" sits inside **సమ్మతం** — consent — which is in every council,
    land-acquisition and government notice a district desk files, and "కులా"
    sits inside **వ్యాకులం**, distress. Both were refusing ordinary civic copy
    as religion and caste.

    So a Telugu stem must start a word: the lookbehind refuses a preceding
    Telugu letter while leaving every suffix free. `కులాల` still matches,
    `వ్యాకులానికి` no longer does; `మతపరమైన` still matches, `సమ్మతం` no longer
    does. The cost is a genuine compound like హిందూమతం, which the phrase terms
    (`మతమార్పిడి`, `మతపరమైన`) already cover — and a screen that cries wolf on
    consent notices is the one that gets clicked past when it is right.
    """
    parts = [
        rf"\b{re.escape(term)}\b"
        if _LATIN.search(term)
        else rf"(?<![ఀ-౿]){re.escape(term)}"
        for term in terms
    ]
    return re.compile("|".join(parts))


_MATCHERS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (topic, _matcher(terms)) for topic, terms in _TOPICS.items()
)


def is_sensitive(text: str) -> str | None:
    """The topic that bars this copy from an image model, or None.

    The topic is returned rather than a bare True so the refusal an editor sees
    can say which subject stopped it — "we do not illustrate sexual assault" is
    an answer, "blocked" is an argument.
    """
    if not text:
        return None
    normalised = normalize_text(text).casefold()
    for topic, matcher in _MATCHERS:
        if matcher.search(normalised):
            return topic
    return None
