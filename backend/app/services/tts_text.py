"""What the synthesiser should be handed, as opposed to what the page shows.

Print copy and spoken copy are different texts, and every rule here is a
mistake that was *heard* — the audio was sent back through Sarvam's own
speech-to-text on 2026-09-19 and the transcript diffed against the input:

  * `₹1,250 కోట్లు`  → "ఒక వెయ్యి రెండు వందల యాభై **రూపీస్** కోట్లు": the
    English word "rupees", in the wrong place. A reader says
    "…కోట్ల రూపాయలు". The sign comes first on paper and last in speech.
  * `40%`           → "నలభై **పర్సెంట్**". Should be "నలభై శాతం".
  * `1.8 లక్షల`     → "ఒకటి **పాయింట్** ఎనిమిది లక్షల". A reader says
    "లక్షా ఎనభై వేల".
  * `2026`          → "**రెండు సున్నా రెండు ఆరు**" — digit by digit, like a
    phone number. Every year in every story. `8,000` with its comma was read
    correctly, so the trigger is a run of four digits with no grouping,
    exactly as Sarvam's own note ("use commas for numbers > 4 digits") warns.
  * `CRDA`          → "సీఆర్డీ". It dropped the A. `IPL` was fine, so the
    model can spell, it just does not do it reliably.
  * The summary and the body's first sentence are routinely the same
    sentence, and the sample read it twice in a row. No human does that.
  * `అమరావతి:` at the top of the body is a print dateline. Read aloud it is
    the place name run straight into the story.
  * Pauses, measured (Sarvam bulbul:v3, same two sentences, one separator
    changed): `.\\n\\n` 0.92 s · `.\\n` 0.86 s · `. ` 0.51 s · `। ` 0.42 s ·
    `; ` 0.29 s · ` — ` 0.29 s · `, ` 0.28 s. A headline's `;` or `—` is a
    full break on air, not a comma's blink.

A second pass, the same day, put the first version in front of three
independent reviewers with real Telugu news copy. What they broke, and the
rule that now covers it:

  * A scale word with a case suffix — `₹10 కోట్లతో`, `₹500కు`, `₹1.5 లక్షలకు`
    — either wedged "రూపాయలు" mid-phrase or was not matched at all. The
    suffix is now captured and carried onto "రూపాయల".
  * `₹3.22 లక్షల కోట్ల`, the budget phrase: two scale words, two decimals.
  * `₹1,250.5 కోట్లు`: the decimal rule matched the "250.5" tail of a grouped
    number and read a fivefold-smaller figure.
  * Helplines — 1912, 1930, 1902, 1098, 1800 — are four digits and were read
    as years. A number with a label before it or a "call/dial/complain"
    after it stays digits.
  * `AP 39 AB 1234`: a plate written with spaces, as painted, read as the
    quantity 1234.
  * `2026-27 బడ్జెట్`: a fiscal year, read digit by digit; en dashes between
    digits split it into two sentences.
  * `1947` read as "వెయ్యి తొమ్మిది వందల…" — a sum, not a date. 19xx and any
    1100–1999 read in hundreds, which is also the TV form for a quantity
    ("పన్నెండు వందల యాభై కోట్లు").
  * `21 లక్షలు` → "ఇరవై **ఒకటి** లక్షలు". The attributive is "ఒక".
  * `8000 మంది` → "ఎనిమిది **వేలు** మంది". A noun follows: "వేల".
  * `MLAలు`, `TDPకి`: `\\b` sees no boundary before a Telugu letter, so every
    suffixed abbreviation — the dominant form — was skipped.
  * `COVID`, `NASA`, `NEET`, `SENSEX`: acronyms said as words, not letters.
  * Dedup compared word *sequences*; Telugu word order is free. It compared
    the summary against the first sentence only; the AI summary is often the
    second. It never compared against the headline. And it deleted a
    standfirst that carried a figure the body never states. Now: a bag-of-
    words containment test, asymmetric (≥80 % of the *earlier* part's words
    must appear in the later text), against the headline, a same-length
    window of the body, and its first four sentences.

What is deliberately NOT here: any number Sarvam already reads right. `18`,
`12`, `905`, `8,000`, `12వ` all came back correct, and rewriting a correct
reading is how a normaliser introduces its own mistakes. `temperature` is
also not here: swept 0.2 → 1.0, the pitch variability stayed at 2.5 ± 0.2
semitones, so it is not a control.
"""

from __future__ import annotations

import re
from collections import Counter

__all__ = ["assemble", "for_speech", "number_words", "same_sentence", "SIMILAR"]

# --------------------------------------------------------------------------- #
# Telugu numerals
# --------------------------------------------------------------------------- #
_ONES = ("సున్నా", "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది")
_TEENS = {
    10: "పది", 11: "పదకొండు", 12: "పన్నెండు", 13: "పదమూడు", 14: "పద్నాలుగు",
    15: "పదిహేను", 16: "పదహారు", 17: "పదిహేడు", 18: "పద్దెనిమిది", 19: "పందొమ్మిది",
}
_TENS = {20: "ఇరవై", 30: "ముప్పై", 40: "నలభై", 50: "యాభై", 60: "అరవై", 70: "డెబ్భై", 80: "ఎనభై", 90: "తొంభై"}

#: (value, singular, plural nominative, plural oblique). The oblique form is what
#: precedes another word — "రెండు వేల ఇరవై" — the nominative ends the phrase.
_UNITS = (
    (10_000_000, "కోటి", "కోట్లు", "కోట్ల"),
    (100_000, "లక్ష", "లక్షలు", "లక్షల"),
    (1_000, "వెయ్యి", "వేలు", "వేల"),
    (100, "వంద", "వందలు", "వందల"),
)


def _below_100(n: int) -> str:
    if n < 10:
        return _ONES[n]
    if n < 20:
        return _TEENS[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens * 10] if ones == 0 else f"{_TENS[tens * 10]} {_ONES[ones]}"


def _multiplier(count: int) -> str:
    """`count` in front of a unit: "ఇరవై ఒక వేలు", never "ఇరవై ఒకటి వేలు".

    The counting word ఒకటి becomes the attributive ఒక when it is the last
    thing before a noun. `count` is never 1 here (a lone unit takes no word at
    all), so the only trailing ఒకటి is 21, 31 … 101, 121 …, which is exactly
    the set that wants ఒక.
    """
    return re.sub(r"ఒకటి$", "ఒక", number_words(count, oblique=True))


def number_words(n: int, *, oblique: bool = False) -> str:
    """`n` as a Telugu reader says it. `oblique` when a noun follows.

    Irregulars the tables cannot express: one hundred followed by more becomes
    "నూట" (నూట ఐదు, never వంద ఐదు); a lone leading thousand or lakh takes no
    "ఒక" (వెయ్యి రెండు వందలు; లక్షా ఎనభై వేలు — the lengthened "లక్షా" when
    something follows); and 1100–1999 is read in hundreds — "పందొమ్మిది వందల
    నలభై ఏడు" — which is how a year is said and also the on-air form for a
    quantity ("పన్నెండు వందల యాభై కోట్లు").
    """
    if n < 0:
        return "మైనస్ " + number_words(-n, oblique=oblique)
    if n < 100:
        return _below_100(n)
    if 1100 <= n <= 1999:
        hundreds, rest = divmod(n, 100)
        head = f"{_multiplier(hundreds)} {'వందల' if (rest or oblique) else 'వందలు'}"
        return head if not rest else f"{head} {number_words(rest, oblique=oblique)}"
    for value, singular, plural, plural_obl in _UNITS:
        if n < value:
            continue
        count, rest = divmod(n, value)
        if count == 1:
            if value == 100 and rest:
                head = "నూట"
            elif value == 100_000 and rest:
                head = "లక్షా"
            else:
                head = singular
        else:
            head = f"{_multiplier(count)} {plural_obl if (rest or oblique) else plural}"
        return head if not rest else f"{head} {number_words(rest, oblique=oblique)}"
    return _below_100(n)  # pragma: no cover - unreachable, every n >= 100 hits a unit


# --------------------------------------------------------------------------- #
# Vocabulary
# --------------------------------------------------------------------------- #
_TELUGU = "ఀ-౿"
_ZWNJ = "‌"
_SCALE = {"లక్ష": 100_000, "లక్షలు": 100_000, "లక్షల": 100_000,
          "కోటి": 10_000_000, "కోట్లు": 10_000_000, "కోట్ల": 10_000_000}
_OBLIQUE_SCALE = {"కోట్లు": "కోట్ల", "లక్షలు": "లక్షల", "వేలు": "వేల"}

#: Abbreviations Telugu news copy carries in Latin script, spelled the way a
#: reader spells them — and the acronyms a reader says as a word. Anything
#: not listed is spelled letter by letter, which is what the model does on
#: its own, except when it drops one.
_ABBREVIATIONS = {
    "AP": "ఏపీ", "TS": "టీఎస్", "CM": "సీఎం", "PM": "పీఎం", "MLA": "ఎమ్మెల్యే", "MP": "ఎంపీ",
    "MLC": "ఎమ్మెల్సీ", "DGP": "డీజీపీ", "SP": "ఎస్పీ", "IAS": "ఐఏఎస్", "IPS": "ఐపీఎస్",
    "TDP": "టీడీపీ", "YSRCP": "వైఎస్సార్‌సీపీ", "BJP": "బీజేపీ", "BRS": "బీఆర్ఎస్",
    "CRDA": "సీఆర్‌డీఏ", "TTD": "టీటీడీ", "APSRTC": "ఏపీఎస్‌ఆర్టీసీ", "TSRTC": "టీఎస్‌ఆర్టీసీ",
    "RTC": "ఆర్టీసీ", "GST": "జీఎస్టీ", "IMD": "ఐఎండీ", "IPL": "ఐపీఎల్", "ISRO": "ఇస్రో",
    "RBI": "ఆర్‌బీఐ", "SBI": "ఎస్‌బీఐ", "GHMC": "జీహెచ్ఎంసీ", "HMDA": "హెచ్ఎండీఏ",
    "NTR": "ఎన్టీఆర్", "KCR": "కేసీఆర్", "UPI": "యూపీఐ", "AI": "ఏఐ", "IT": "ఐటీ",
    "COVID": "కోవిడ్", "NASA": "నాసా", "NEET": "నీట్", "SEBI": "సెబీ", "SENSEX": "సెన్సెక్స్",
    "NIFTY": "నిఫ్టీ", "AIIMS": "ఎయిమ్స్", "PAN": "పాన్", "PIN": "పిన్", "UNESCO": "యునెస్కో",
    "EAMCET": "ఎంసెట్", "INDIA": "ఇండియా", "KYC": "కేవైసీ", "OTP": "ఓటీపీ", "ATM": "ఏటీఎం",
}
_LETTERS = {
    "A": "ఏ", "B": "బీ", "C": "సీ", "D": "డీ", "E": "ఈ", "F": "ఎఫ్", "G": "జీ", "H": "హెచ్",
    "I": "ఐ", "J": "జే", "K": "కే", "L": "ఎల్", "M": "ఎం", "N": "ఎన్", "O": "ఓ", "P": "పీ",
    "Q": "క్యూ", "R": "ఆర్", "S": "ఎస్", "T": "టీ", "U": "యూ", "V": "వీ", "W": "డబ్ల్యూ",
    "X": "ఎక్స్", "Y": "వై", "Z": "జెడ్",
}

#: A four-digit run is a year — unless the copy says it is a number to call.
#: AP/TS civic stories end with a helpline in almost every case: 1912 (power),
#: 1930 (cyber crime), 1902, 1098 (Childline), 1800. A label before, a
#: "call/dial/complain" after, or another digit group either side, all mean
#: "read the digits".
_LABEL_BEFORE = re.compile(
    r"(?:నంబర్|నెంబర్|నం\.?|నెం\.?|డయల్|హెల్ప్\s*లైన్|హెల్ప్" + _ZWNJ + r"లైన్|టోల్\s*ఫ్రీ|టోల్" + _ZWNJ
    + r"ఫ్రీ|[Nn]o\.?|\d{3,5})\s*[:\-]?\s*$"
)
_CALL_AFTER = re.compile(r"^\s*(?:కు|కి|కూ)?\s*(?:కాల్|డయల్|ఫోన్|ఫిర్యాదు|సంప్రదించ|హెల్ప్|\d{3,5}\b)")


def _protected(s: str, start: int, end: int) -> bool:
    return bool(_LABEL_BEFORE.search(s[max(0, start - 40):start]) or _CALL_AFTER.match(s[end:end + 40]))


def _noun_follows(s: str, end: int) -> bool:
    return bool(re.match(rf"\s*[{_TELUGU}]", s[end:end + 3]))


# --------------------------------------------------------------------------- #
# Rules
# --------------------------------------------------------------------------- #
def _spell(match: re.Match[str]) -> str:
    token = match.group(0)
    spelled = _ABBREVIATIONS.get(token) or _ZWNJ.join(_LETTERS[c] for c in token)
    # A glued suffix ("IASలు") must not fuse into a conjunct with the last letter.
    glued = match.end() < len(match.string) and re.match(rf"[{_TELUGU}]", match.string[match.end()])
    return spelled + _ZWNJ if glued else spelled


def _currency(match: re.Match[str]) -> str:
    """`₹N [scale][suffix]` → `N [scale-oblique] రూపాయలు[suffix]`.

    The sign moves to the end. A suffix glued to the scale word ("కోట్లతో") or
    to the bare number ("500కు") is the case a noun would carry, so it moves
    with the sign — "కోట్ల రూపాయలతో", "రూపాయలకు" — and puts everything before
    it in the oblique. A scale already oblique ("కోట్ల నిధులు") does the same.
    """
    number, scale, suffix = match.group(1), match.group(2) or "", match.group(3) or ""
    oblique = bool(suffix) or (scale.endswith("ల") and not scale.endswith("లు"))
    rupees = ("రూపాయల" if oblique else "రూపాయలు") + suffix
    if not scale:
        return f"{number} {rupees}"
    scale = re.sub(r"(కోట్లు|లక్షలు|వేలు)$", lambda m: _OBLIQUE_SCALE[m.group(1)], scale)
    return f"{number} {scale} {rupees}"


def _whole(text: str) -> int:
    return int(text.replace(",", ""))


def _fraction(unit_value: int, frac: str) -> int:
    return int(frac) * unit_value // 10 ** len(frac)


def _decimal_lakh_crore(match: re.Match[str]) -> str:
    """`3.22 లక్షల కోట్ల` → `మూడు లక్షల ఇరవై రెండు వేల కోట్ల`."""
    lakhs = _whole(match.group(1)) * 100_000 + _fraction(100_000, match.group(2))
    return f"{number_words(lakhs, oblique=True)} {match.group(4)}"


def _decimal_scale(match: re.Match[str]) -> str:
    """`1.8 లక్షల` → `లక్షా ఎనభై వేల`; `2.75 కోట్లు` → `రెండు కోట్ల డెబ్భై ఐదు లక్షలు`."""
    unit = match.group(3)
    value = _whole(match.group(1)) * _SCALE[unit] + _fraction(_SCALE[unit], match.group(2))
    return number_words(value, oblique=unit.endswith("ల") and not unit.endswith("లు"))


def _fiscal_year(match: re.Match[str]) -> str:
    """`2026-27` → `రెండు వేల ఇరవై ఆరు-ఇరవై ఏడు`, only when it really is one."""
    first, second = int(match.group(1)), int(match.group(2))
    if second != (first + 1) % 100 or _protected(match.string, match.start(), match.end()):
        return match.group(0)
    return f"{number_words(first)}-{number_words(second)}"


def _year(match: re.Match[str]) -> str:
    s, start, end = match.string, match.start(), match.end()
    if _protected(s, start, end):
        return match.group(0)
    return number_words(int(match.group(0)), oblique=_noun_follows(s, end))


def _sentence_end(part: str) -> str:
    part = part.rstrip()
    return part if part.rstrip("”\"')]")[-1:] in ".!?।" else part + "."


_SCALE_WORD = r"(?:లక్షల?\s+)?(?:కోట్లు|కోట్ల|కోటి)|లక్షలు|లక్షల|లక్ష|వేలు|వేల|వెయ్యి"


def for_speech(text: str) -> str:
    """Rewrite print copy as read copy. Idempotent, so re-running is harmless."""
    t = text.replace("\r\n", "\n")

    # A plate written as painted — "AP 39 AB 1234" — is joined first, so the
    # letter guard on the year rule sees it as one token and leaves it alone.
    t = re.sub(r"\b([A-Z]{2}) ?(\d{2}) ?([A-Z]{1,3}) ?(\d{4})\b", r"\1\2\3\4", t)
    # An en/em dash between digits is a range, not a break.
    t = re.sub(r"(?<=\d)[—–](?=\d)", "-", t)

    # Currency before anything touches the digits.
    t = re.sub(
        rf"₹\s*(\d[\d,]*(?:\.\d+)?)(?:\s*({_SCALE_WORD}))?([{_TELUGU}]*)",
        _currency, t,
    )
    t = re.sub(r"(?<![\d,])(\d[\d,]*)\.(\d{1,2})\s+(లక్షలు|లక్షల|లక్ష)\s+(కోట్లు|కోట్ల|కోటి)", _decimal_lakh_crore, t)
    t = re.sub(r"(?<![\d,])(\d[\d,]*)\.(\d{1,2})\s+(లక్షలు|లక్షల|లక్ష|కోట్లు|కోట్ల|కోటి)", _decimal_scale, t)
    t = re.sub(r"(\d+(?:\.\d+)?)\s*%", r"\1 శాతం", t)
    t = re.sub(r"(?<![\d\-])((?:19|20)\d\d)-(\d\d)(?![\d\-])", _fiscal_year, t)
    # Exactly four ungrouped digits: a year, or an "8000" someone forgot to
    # group. Longer runs stay — a PIN, a phone number — where digit by digit
    # is the right reading, and "12000" should have been "12,000" on the page.
    # Letters or a hyphen either side mean a plate or an ID; a following "."
    # or "," is fine unless a digit comes after it (8,000 · 1,250.5).
    t = re.sub(r"(?<![A-Za-z\d,.\-–—])\d{4}(?![A-Za-z\d\-–—]|[.,]\d|వ)", _year, t)
    # Abbreviations, including the dominant suffixed form ("MLAలు", "TDPకి"):
    # Telugu letters are \w, so \b cannot be the guard.
    t = re.sub(r"(?<![A-Za-z\d])[A-Z]{2,6}(?![A-Za-z\d])", _spell, t)

    # Breaks. A headline's semicolon, dash or colon is a full stop on air. A
    # clock time is never followed by a space after its colon, so `:(?=\s)`
    # is exactly the labelled colon — dateline, "గమనిక:", "అమరావతి, సెప్టెంబర్ 19:".
    t = re.sub(r"\s*;\s*", ". ", t)
    t = re.sub(r"\s*[—–]\s*", ". ", t)
    t = re.sub(r"(?<=\S)\s+-\s+(?=\S)", ". ", t)
    t = re.sub(r":(?=\s)", ".", t)
    t = t.replace("…", ".")
    t = re.sub(r"\.(?:\s*\.)+", ".", t)
    # Every paragraph ends as a sentence and is followed by a blank line, so
    # the break buys its measured 0.92 s.
    parts = [p.strip() for p in re.split(r"\n+", t) if p.strip()]
    t = "\n\n".join(_sentence_end(p) for p in parts)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


# --------------------------------------------------------------------------- #
# Structure: the parts of an article, without the repeats
# --------------------------------------------------------------------------- #
#: This share of an earlier part's words appearing in a later one makes it,
#: to a listener, the same sentence.
SIMILAR = 0.8


def _words(s: str) -> list[str]:
    return re.findall(rf"[{_TELUGU}\w]+", s)


def same_sentence(earlier: str, later: str) -> bool:
    """Would a listener hear `later` as a repeat of `earlier`?

    A bag of words, not a sequence: Telugu word order is free, and a standfirst
    that fronts the time or the actor is the same sentence with two words
    moved. Asymmetric on purpose: ≥80 % of *earlier*'s words must be in
    `later`. The other direction would drop a standfirst that carries a figure
    the body never states — the listener would learn less than the reader.
    """
    a, b = _words(earlier), _words(later)
    if not a or not b:
        return False
    return sum((Counter(a) & Counter(b)).values()) / len(a) >= SIMILAR


def _core(body: str) -> str:
    """The body without its print dateline — "అమరావతి:", "అమరావతి, సెప్టెంబర్ 19:",
    "సాక్షి, అమరావతి:" — whose tokens otherwise dilute the comparison."""
    return re.sub(r"^[^:\n]{2,60}:\s+", "", body.strip(), count=1)


def _sentences(text: str) -> list[str]:
    # Not after a 1–3 letter token: "రూ.", "డా.", "సి.ఎం." are not sentence ends.
    return [s for s in re.split(r"(?<=[!?।])\s+|(?<=[^\s.]{4}\.)\s+|\n+", text) if s.strip()]


def _repeats(part: str, later: str) -> bool:
    """Is `part` already said in `later` — verbatim, as its opening, or as
    one of its first few sentences (an AI summary is often the second)?"""
    stripped = part.rstrip("…. ")
    if stripped and stripped in later:
        return True
    window = " ".join(_words(later)[: len(_words(part)) + 3])
    if same_sentence(part, window):
        return True
    return any(same_sentence(part, s) for s in _sentences(later)[:4])


def assemble(title: str, sub_title: str, summary: str, body: str) -> str:
    """Headline, standfirst, summary, body — each once.

    Print stacks a summary on top of a body whose first sentence says the same
    thing; on air that is a stutter. Drop whichever earlier part the headline
    or the body already says, then hand the whole thing to `for_speech`.
    """
    title, sub, summ, body = ((x or "").strip() for x in (title, sub_title, summary, body))
    core = _core(body)
    if summ and (same_sentence(summ, title) or _repeats(summ, core)):
        summ = ""
    if sub and (same_sentence(sub, title) or (summ and same_sentence(sub, summ)) or _repeats(sub, core)):
        sub = ""
    return for_speech("\n\n".join(p for p in (title, sub, summ, body) if p))
