"""Telugu -> Latin transliteration, for slugs and search aliases.

§4.5 is emphatic about why slugs must be Latin:

    "Telugu slugs percent-encode into unreadable 200-character URLs that look
     like spam when shared on WhatsApp — and WhatsApp is our #1 distribution
     channel."

§4.4 needs the same machinery for search: readers type "kadapa", "amaravati",
"pawan kalyan" in English, so every article carries `title_en` plus a
`search_aliases` list.

This is a deterministic ISO-15919-flavoured mapping, deliberately lossy toward
readability (ā -> a, ṭ -> t) because the output is a URL segment, not a
scholarly transliteration. AI fills the *editorial* English headline (§7.3);
this function is the always-available fallback that never costs a token.
"""

from __future__ import annotations

import re
import unicodedata

# Independent vowels
_VOWELS = {
    "అ": "a",
    "ఆ": "aa",
    "ఇ": "i",
    "ఈ": "ee",
    "ఉ": "u",
    "ఊ": "oo",
    "ఋ": "ru",
    "ౠ": "ruu",
    "ఌ": "lu",
    "ఎ": "e",
    "ఏ": "e",
    "ఐ": "ai",
    "ఒ": "o",
    "ఓ": "o",
    "ఔ": "au",
}

# Consonants (inherent 'a' is added during assembly)
_CONSONANTS = {
    "క": "k",
    "ఖ": "kh",
    "గ": "g",
    "ఘ": "gh",
    "ఙ": "ng",
    "చ": "ch",
    "ఛ": "chh",
    "జ": "j",
    "ఝ": "jh",
    "ఞ": "nj",
    "ట": "t",
    "ఠ": "th",
    "డ": "d",
    "ఢ": "dh",
    "ణ": "n",
    "త": "t",
    "థ": "th",
    "ద": "d",
    "ధ": "dh",
    "న": "n",
    "ప": "p",
    "ఫ": "ph",
    "బ": "b",
    "భ": "bh",
    "మ": "m",
    "య": "y",
    "ర": "r",
    "ఱ": "r",
    "ల": "l",
    "ళ": "l",
    "ఴ": "l",
    "వ": "v",
    "శ": "sh",
    "ష": "sh",
    "స": "s",
    "హ": "h",
}

# Dependent vowel signs (matras)
_MATRAS = {
    "ా": "aa",
    "ి": "i",
    "ీ": "ee",
    "ు": "u",
    "ూ": "oo",
    "ృ": "ru",
    "ౄ": "ruu",
    "ె": "e",
    "ే": "e",
    "ై": "ai",
    "ొ": "o",
    "ో": "o",
    "ౌ": "au",
}

_VIRAMA = "్"  # halant: suppresses the inherent vowel
_ANUSVARA = "ం"  # nasal
_VISARGA = "ః"
_CANDRABINDU = "ఁ"

_DIGITS = {c: str(i) for i, c in enumerate("౦౧౨౩౪౫౬౭౮౯")}


def transliterate(text: str) -> str:
    """Telugu -> readable Latin. Non-Telugu characters pass through unchanged."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)

    out: list[str] = []
    i = 0
    n = len(text)

    while i < n:
        ch = text[i]

        if ch in _CONSONANTS:
            out.append(_CONSONANTS[ch])
            i += 1
            # A consonant carries an inherent 'a' unless a matra or virama follows.
            if i < n and text[i] == _VIRAMA:
                i += 1  # conjunct: emit nothing, next consonant follows directly
            elif i < n and text[i] in _MATRAS:
                out.append(_MATRAS[text[i]])
                i += 1
            else:
                out.append("a")
            # Trailing nasal / visarga attach to the syllable just emitted.
            while i < n and text[i] in (_ANUSVARA, _CANDRABINDU, _VISARGA):
                out.append("m" if text[i] in (_ANUSVARA, _CANDRABINDU) else "h")
                i += 1
            continue

        if ch in _VOWELS:
            out.append(_VOWELS[ch])
            i += 1
            while i < n and text[i] in (_ANUSVARA, _CANDRABINDU, _VISARGA):
                out.append("m" if text[i] in (_ANUSVARA, _CANDRABINDU) else "h")
                i += 1
            continue

        if ch in _DIGITS:
            out.append(_DIGITS[ch])
            i += 1
            continue

        # Stray matra/virama with no base consonant — drop rather than emit noise.
        if ch in _MATRAS or ch == _VIRAMA:
            i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_SLUG_EDGES = re.compile(r"^-+|-+$")


def slugify(text: str, *, max_length: int = 80) -> str:
    """Produce the Latin URL segment for an article (§4.5).

    Telugu is transliterated first, so a Telugu headline yields a readable ASCII
    slug rather than a percent-encoded blob.
    """
    if not text:
        return ""
    latin = transliterate(text)
    # Fold any remaining accents to ASCII.
    latin = unicodedata.normalize("NFKD", latin)
    latin = "".join(c for c in latin if not unicodedata.combining(c))
    latin = latin.lower()
    latin = _SLUG_STRIP.sub("-", latin)
    latin = _SLUG_EDGES.sub("", latin)

    if len(latin) > max_length:
        # Cut on a word boundary so the slug never ends mid-word.
        latin = latin[:max_length].rsplit("-", 1)[0] or latin[:max_length]
    return _SLUG_EDGES.sub("", latin)


def search_aliases(title_te: str, title_en: str | None = None) -> list[str]:
    """Candidate transliteration aliases for the Meilisearch document (§4.4).

    Deliberately generous: a reader searching "kadapa" must reach కడప, and
    "kadapha" should too. The editor confirms or edits these in the CMS.
    """
    aliases: set[str] = set()

    latin = transliterate(title_te).lower()
    for word in re.split(r"[^a-z0-9]+", latin):
        if len(word) >= 3:
            aliases.add(word)

    if title_en:
        for word in re.split(r"[^a-zA-Z0-9]+", title_en.lower()):
            if len(word) >= 3:
                aliases.add(word)

    # Common Telugu-to-English spelling drift readers actually type.
    variants: set[str] = set()
    for alias in aliases:
        variants.add(alias.replace("aa", "a"))
        variants.add(alias.replace("ee", "i"))
        variants.add(alias.replace("oo", "u"))
        variants.add(alias.replace("th", "t"))
        variants.add(alias.replace("ph", "f"))
    aliases |= variants

    return sorted(a for a in aliases if len(a) >= 3)
