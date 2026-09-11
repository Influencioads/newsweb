"""Finding a font that can actually render Telugu, and knowing when we cannot.

Two separate things go wrong when server-side rendering meets Telugu, and both
used to fail silently in this codebase.

**Finding a face.** The e-paper PDF hardcoded a Debian path and fell back to
Helvetica inside a bare `except: pass`. Helvetica contains no Telugu glyph, so
on any host without that exact file the "fallback" produced blank pages and
logged nothing. `frontend/public/fonts` is no help either — those are WOFF2,
which neither Pillow nor reportlab can read. So the backend carries its own
TTFs under `app/assets/fonts`, and `telugu_font_path` never falls back to a
Latin face: raising is strictly better than shipping an empty headline.

**Shaping the text.** Telugu needs GSUB/GPOS: consonant clusters become
conjuncts with subscript forms, and vowel marks are positioned rather than
placed in sequence. Pillow only does that when it was built against Raqm
(HarfBuzz + FriBiDi). Without Raqm, `ImageDraw.text` still succeeds — it emits
a perfectly valid PNG with unshaped, wrongly-ordered glyphs that a Telugu
reader cannot read. Nothing raises. So anything that draws Telugu with Pillow
must ask `telugu_shaping_available()` first and decline the job when it is
false, rather than rendering blind.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class FontMissingError(RuntimeError):
    """No font on this host can render Telugu."""


#: Shipped with the application. SIL Open Font License, see the OFL.txt beside
#: them — redistribution is explicitly permitted, which is why vendoring ~1 MB
#: is preferable to depending on the host's font packages.
BUNDLED_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_FILENAMES: dict[str, tuple[str, ...]] = {
    "regular": ("NotoSansTelugu-Regular.ttf", "NotoSerifTelugu-Regular.ttf"),
    "bold": ("NotoSansTelugu-Bold.ttf", "NotoSansTelugu-Regular.ttf"),
}

#: Noto Sans Telugu contains Telugu and digits but **no Latin letters** —
#: verified, not assumed. Drawing "Top Telugu News" or "11 Sep 2026" with it
#: produces a row of .notdef boxes that looks like a rendering bug rather than
#: a missing font. Pillow does no font fallback, so Latin runs need their own
#: face and their own draw call.
_LATIN_FILENAMES: dict[str, tuple[str, ...]] = {
    "regular": ("NotoSans-Regular.ttf", "DejaVuSans.ttf", "arial.ttf"),
    "bold": ("NotoSans-Bold.ttf", "NotoSans-Regular.ttf", "DejaVuSans-Bold.ttf", "arialbd.ttf"),
}

#: Telugu block, plus the Telugu-specific supplement.
_TELUGU_RANGE = range(0x0C00, 0x0C80)


def has_telugu(text: str) -> bool:
    return any(ord(ch) in _TELUGU_RANGE for ch in text or "")

#: Searched after the bundled directory, so a host that has better fonts than
#: we ship can be pointed at them without a rebuild.
_SYSTEM_DIRS: tuple[Path, ...] = (
    Path("/usr/share/fonts/truetype/noto"),
    Path("/usr/share/fonts/truetype/tlwg"),
    Path("/usr/share/fonts"),
    Path("C:/Windows/Fonts"),
)

#: Windows ships Nirmala UI, which covers Telugu. Named separately because the
#: filename bears no resemblance to the others.
_WINDOWS_FALLBACKS: tuple[str, ...] = ("Nirmala.ttf", "gautami.ttf")


def _candidates(weight: str, *, latin: bool = False) -> list[Path]:
    table = _LATIN_FILENAMES if latin else _FILENAMES
    names = table.get(weight, table["regular"])
    found: list[Path] = []

    configured = (settings.TELUGU_FONT_DIR or "").strip()
    dirs: list[Path] = []
    if configured:
        dirs.append(Path(configured))
    dirs.append(BUNDLED_DIR)
    dirs.extend(_SYSTEM_DIRS)

    for directory in dirs:
        for name in names:
            found.append(directory / name)
    for directory in _SYSTEM_DIRS:
        for name in _WINDOWS_FALLBACKS:
            found.append(directory / name)
    return found


@lru_cache(maxsize=8)
def latin_font_path(weight: str = "regular") -> Path:
    """A face that actually contains Latin letters.

    Falls back to the Telugu face only as a last resort, which is wrong but
    still better than crashing a render; callers that care should prefer
    `font_for`, which picks by script.
    """
    for candidate in _candidates(weight, latin=True):
        if candidate.is_file():
            return candidate
    return telugu_font_path(weight)


def font_path_for(text: str, weight: str = "regular") -> Path:
    """The right face for this string, by script.

    Pillow does not do font fallback: a single draw call uses one face, and any
    codepoint it lacks becomes a .notdef box. So mixed-script text must be
    split across draw calls by the caller, and each run asks for its own face.
    """
    return telugu_font_path(weight) if has_telugu(text) else latin_font_path(weight)


@lru_cache(maxsize=8)
def telugu_font_path(weight: str = "regular") -> Path:
    """Absolute path to a TTF that contains Telugu glyphs.

    Raises `FontMissingError` rather than returning a Latin face. A caller that
    wants to degrade gracefully should catch it; a caller that silently
    substitutes Helvetica is shipping blank text to readers.
    """
    for candidate in _candidates(weight):
        if candidate.is_file():
            return candidate
    raise FontMissingError(
        "No Telugu-capable TTF found. Ship app/assets/fonts/"
        "NotoSansTelugu-Regular.ttf or set TELUGU_FONT_DIR."
    )


def telugu_font_available(weight: str = "regular") -> bool:
    try:
        telugu_font_path(weight)
    except FontMissingError:
        return False
    return True


@lru_cache(maxsize=1)
def telugu_shaping_available() -> bool:
    """Whether Pillow can shape Telugu correctly on this host.

    False means Pillow was built without Raqm. Text still *draws* — it is just
    wrong, in a way no exception reports and no automated check on the bytes
    would catch. Install `libraqm0 libfribidi0 libharfbuzz0b` and a Pillow
    built against them; see docs/DEPLOYMENT.md.
    """
    try:
        from PIL import features
    except Exception:  # noqa: BLE001 — Pillow missing is the same outcome
        return False
    try:
        return bool(features.check("raqm"))
    except Exception:  # noqa: BLE001
        return False


def telugu_render_status() -> dict[str, object]:
    """What the settings screen shows, so an operator can see this is off."""
    try:
        path: str | None = str(telugu_font_path("regular"))
    except FontMissingError:
        path = None
    try:
        latin: str | None = str(latin_font_path("regular"))
    except FontMissingError:
        latin = None
    return {
        "font_path": path,
        "latin_font_path": latin,
        "font_available": path is not None,
        "shaping_available": telugu_shaping_available(),
    }
