"""Telugu text normalisation — §4.2, applied on **every** content write.

The spec is blunt about why: "Copy-paste from Word/WhatsApp arrives in mixed
forms; without NFC, search and dedupe silently fail."

Rules implemented here, in order:
  1. Unicode NFC normalise.
  2. Strip zero-width characters **except** ZWJ/ZWNJ inside Telugu runs — those
     two are load-bearing for conjunct formation and removing them breaks glyphs.
  3. Replace non-breaking spaces and Word smart quotes with plain equivalents.
  4. Collapse 3+ newlines, trim trailing spaces per line.
  5. Telugu digits are converted to Latin **only in numeric fields**; body text
     keeps whatever the journalist typed.
"""

from __future__ import annotations

import re
import unicodedata

# Telugu block, plus the Telugu-specific signs that sit outside it.
TELUGU_RANGE = (
    "ఀ-౿"  # Telugu
    "॑-॒"  # Vedic tone marks used in Telugu text
    "᳚ᳲ"
)

ZWNJ = "‌"
ZWJ = "‍"

#: Zero-width and bidi controls that carry no meaning in Telugu news copy.
#: ZWJ/ZWNJ are deliberately absent — see rule 2.
_INVISIBLE = {
    "​",  # zero-width space
    "‎",  # LTR mark
    "‏",  # RTL mark
    " ",  # line separator
    " ",  # paragraph separator
    "‪",
    "‫",
    "‬",
    "‭",
    "‮",  # bidi overrides
    "⁠",  # word joiner
    "﻿",  # BOM / zero-width no-break space
}

#: Word/WhatsApp punctuation that must not reach the database.
_PUNCTUATION_MAP = {
    " ": " ",   # non-breaking space
    " ": " ",   # figure space
    " ": " ",   # narrow no-break space
    "‘": "'",   # left single quote
    "’": "'",   # right single quote / apostrophe
    "‚": "'",
    "‛": "'",
    "“": '"',   # left double quote
    "”": '"',   # right double quote
    "„": '"',
    "′": "'",   # prime
    "″": '"',   # double prime
}

TELUGU_DIGITS = "౦౧౨౩౪౫౬౭౮౯"
_DIGIT_MAP = {ord(te): str(i) for i, te in enumerate(TELUGU_DIGITS)}

_TELUGU_CHAR = re.compile(f"[{TELUGU_RANGE}]")
_MULTI_NEWLINE = re.compile(r"\n{3,}")
_TRAILING_WS = re.compile(r"[ \t]+$", re.MULTILINE)
_MULTI_SPACE = re.compile(r"[ \t]{2,}")


def _strip_invisibles_preserving_joiners(text: str) -> str:
    """Remove zero-width characters, but keep ZWJ/ZWNJ that sit inside Telugu runs.

    A joiner between two Telugu characters is doing real work (it controls whether
    a conjunct forms). The same joiner floating in Latin text or at a boundary is
    stray paste residue and is dropped.
    """
    out: list[str] = []
    for i, ch in enumerate(text):
        if ch in _INVISIBLE:
            continue
        if ch in (ZWJ, ZWNJ):
            prev = text[i - 1] if i > 0 else ""
            nxt = text[i + 1] if i + 1 < len(text) else ""
            if _TELUGU_CHAR.match(prev) and _TELUGU_CHAR.match(nxt):
                out.append(ch)
            continue
        out.append(ch)
    return "".join(out)


def normalize_text(text: str | None, *, collapse_spaces: bool = True) -> str:
    """Full §4.2 normalisation for a free-text content field."""
    if not text:
        return ""

    # 1. NFC. Telugu combining marks must be in canonical order or two visually
    #    identical headlines compare unequal and dedupe silently fails.
    text = unicodedata.normalize("NFC", text)

    # 3. punctuation (before invisible-stripping, so NBSP becomes a real space)
    text = text.translate(str.maketrans(_PUNCTUATION_MAP))

    # 2. invisibles
    text = _strip_invisibles_preserving_joiners(text)

    # 4. whitespace
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _TRAILING_WS.sub("", text)
    if collapse_spaces:
        text = _MULTI_SPACE.sub(" ", text)
    text = _MULTI_NEWLINE.sub("\n\n", text)

    return text.strip()


def normalize_headline(text: str | None) -> str:
    """Headlines are single-line: newlines become spaces."""
    normalised = normalize_text(text)
    return _MULTI_SPACE.sub(" ", normalised.replace("\n", " ")).strip()


def to_latin_digits(text: str | None) -> str:
    """Convert Telugu digits to Latin — for numeric fields only (§4.2 rule 5)."""
    if not text:
        return ""
    return text.translate(_DIGIT_MAP)


def has_telugu(text: str | None) -> bool:
    return bool(text) and _TELUGU_CHAR.search(text) is not None


def telugu_ratio(text: str | None) -> float:
    """Share of letters that are Telugu. Used by legacy-paste detection (§4.3)."""
    if not text:
        return 0.0
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if _TELUGU_CHAR.match(c)) / len(letters)


def count_words(text: str | None) -> int:
    """Word count for reading-time estimation.

    Telugu is space-separated, so a whitespace split is correct here; it is not
    for scripts like Thai, but this product is Telugu + English only.
    """
    if not text:
        return 0
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def reading_time_seconds(text: str | None, words_per_minute: int = 160) -> int:
    """Telugu reading speed runs slower than English prose; 160 wpm is the
    working assumption, tunable once we have real analytics."""
    words = count_words(text)
    if words == 0:
        return 0
    return max(30, round(words / words_per_minute * 60))
