"""Social news cards: the story's glimpse over a photo, under our logo.

The Instagram / WhatsApp Status / X image a desk posts for every story — a
photo, a short punchy headline, two lines of what happened, the masthead. The
competition makes these by hand in a design tool; this makes one from the
story in a second, in the four shapes the platforms want.

**Why the text is typeset here and not drawn by the image model.** GPT Image
2.5 can letter Telugu — measured 2026-09-23, the headline came out right. In
the same picture it also invented a price board (`₹60/kg`, `₹50/kg`) that the
story never mentioned. A news card is read as a statement of fact, and a model
that adds a figure it was not given cannot be the one holding the pen. So the
model draws only the picture (`ai_image_service`, picture only, no text),
and every word on the card is the editor's, set in a real Telugu face.

**The Telugu shaping trap** is the one `share_card_service` documents: Pillow
without Raqm draws unshaped, unreadable Telugu and raises nothing. Every draw
here passes `language=`, which Pillow refuses without Raqm, and
`unavailable_reason` declines the job up front.

**Mixed script.** Noto Sans Telugu has no Latin letters, and headlines are full
of "iPhone 18 Pro", "UPI", "BRS". Pillow does no font fallback, so every word is
split into Telugu and non-Telugu runs and each run is drawn in its own face.

**The creative studio** (`/admin/creative`) renders through here too, at any
size, over a design backdrop GPT Image 2.5 drew in the style of the desk's
reference designs (`ai_image_service.generate_backdrop`). The same rule holds
there: the model draws only the design; the article's real photograph is
placed untouched and every word is typeset here. Copy a model wrote may carry
only figures the article states (`_invented_numbers`).
"""

from __future__ import annotations

import hashlib
import io
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache

import httpx
from sqlalchemy.orm import Session

from app.core.config import SITE_NAME_TE, settings
from app.core.errors import AppError, NotFoundError
from app.core.fonts import (
    BUNDLED_DIR,
    FontMissingError,
    latin_font_path,
    telugu_font_path,
    telugu_shaping_available,
)
from app.core.logging import get_logger
from app.db.session import session_scope
from app.integrations.ai import get_ai
from app.integrations.ai.base import CardText
from app.integrations.storage import get_storage
from app.models.content import Article
from app.models.media import Media
from app.services import ai_image_service, ai_usage_service, settings_service

logger = get_logger(__name__)

__all__ = [
    "ASPECTS",
    "TEMPLATES",
    "CardInput",
    "card_text",
    "make_card",
    "nearest_aspect",
    "photo_aspect",
    "render",
    "unavailable_reason",
]

#: Pixel sizes the platforms actually ask for. 4:5 is Instagram's tallest feed
#: post and what every reference card the desk sent us uses.
ASPECTS: dict[str, tuple[int, int]] = {
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
}
TEMPLATES = ("panel", "overlay", "frame")

#: Bump to change every card's storage key after a template change.
CARD_VERSION = 2

#: Drop a transparent PNG here and it replaces the drawn wordmark.
LOGO_FILE = BUNDLED_DIR.parent / "brand" / "logo.png"

# The logo's red and deep blue (frontend/src/assets/index.css) plus the two card accents.
RED = (208, 16, 26)
DEEP = (11, 42, 110)
DEEPER = (6, 24, 66)
NIGHT = (10, 13, 26)
CREAM = (247, 233, 188)
HEAD = (255, 214, 64)
WHITE = (255, 255, 255)

_TELUGU = range(0x0C00, 0x0C80)
#: Drawn with the Telugu face although outside its block: the joiners, and the
#: dandas, which Noto Sans Telugu carries and Noto Sans does not.
_TE_EXTRA = {"‌", "‍", "।", "॥"}

DEFAULT_TAG = "తాజా వార్తలు"


def unavailable_reason() -> str | None:
    """Why a card cannot be typeset on this host, or None when it can."""
    try:
        telugu_font_path("bold")
    except FontMissingError:
        return "No Telugu font is installed on this server."
    if not telugu_shaping_available():
        return (
            "This server's Pillow was built without Raqm, so Telugu cannot be "
            "shaped. A card made here would be unreadable, so none is made."
        )
    return None


# --------------------------------------------------------------------------- #
# Text
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=64)
def _face(weight: str, size: int, telugu: bool):
    from PIL import ImageFont

    path = telugu_font_path(weight) if telugu else latin_font_path(weight)
    return ImageFont.truetype(str(path), size)


def _runs(word: str) -> list[tuple[str, bool]]:
    """Split one word into (text, is_telugu) runs.

    ASCII digits are in both faces, so they stay with whichever run they touch
    (Telugu digits are in the Telugu block and go there); a joiner always
    belongs to the Telugu run it sits inside.
    """
    runs: list[tuple[str, bool]] = []
    for ch in word:
        if ch in "0123456789" and runs:
            kind = runs[-1][1]
        else:
            kind = ord(ch) in _TELUGU or ch in _TE_EXTRA
        if runs and runs[-1][1] == kind:
            runs[-1] = (runs[-1][0] + ch, kind)
        else:
            runs.append((ch, kind))
    # A leading digit took the Latin face before the Telugu run it belongs to
    # arrived ("2026లో"); give it to that run instead.
    if len(runs) > 1 and runs[0][0].isascii() and runs[0][0].isdigit() and runs[1][1]:
        runs[1] = (runs[0][0] + runs[1][0], True)
        runs.pop(0)
    return runs


def _lang(telugu: bool) -> str:
    return "te" if telugu else "en"


def _word_width(draw, word: str, weight: str, size: int) -> float:
    return sum(
        draw.textlength(text, font=_face(weight, size, te), language=_lang(te))
        for text, te in _runs(word)
    )


def _space(draw, weight: str, size: int) -> float:
    return draw.textlength(" ", font=_face(weight, size, True), language="te")


def _wrap(draw, words: list[str], weight: str, size: int, width: int) -> list[list[str]]:
    lines: list[list[str]] = []
    current: list[str] = []
    for word in words:
        candidate = current + [word]
        if not current or _line_width(draw, candidate, weight, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = [word]
    if current:
        lines.append(current)
    return lines


def _line_width(draw, words: list[str], weight: str, size: int) -> float:
    return sum(_word_width(draw, w, weight, size) for w in words) + _space(
        draw, weight, size
    ) * max(0, len(words) - 1)


@dataclass(slots=True)
class _Block:
    lines: list[list[str]] = field(default_factory=list)
    size: int = 0
    line_h: int = 0
    weight: str = "bold"
    truncated: bool = False

    @property
    def height(self) -> int:
        return len(self.lines) * self.line_h


def _fit(
    draw,
    text: str,
    *,
    weight: str,
    width: int,
    height: int,
    max_lines: int,
    hi: int,
    lo: int,
    leading: float,
) -> _Block:
    """The largest size in [lo, hi] at which `text` fits the box.

    Below `lo` the text is cut at a word with an ellipsis and `truncated` is
    set, so the CMS can tell the editor rather than shipping a card that
    quietly lost its last clause.
    """
    words = (text or "").split()
    if not words:
        return _Block(weight=weight)
    for size in [*range(hi, lo, -2), lo]:
        line_h = int(size * leading)
        lines = _wrap(draw, words, weight, size, width)
        fits_width = all(_line_width(draw, ln, weight, size) <= width for ln in lines)
        if fits_width and len(lines) <= max_lines and len(lines) * line_h <= height:
            return _Block(lines, size, line_h, weight)

    size, line_h = lo, int(lo * leading)
    keep = max(1, min(max_lines, height // line_h))
    wrapped = _wrap(draw, words, weight, size, width)
    # `_wrap` puts a word wider than the box on a line of its own (a URL, a
    # hashtag); cut it rather than let it run off the card.
    lines = [
        ln if _line_width(draw, ln, weight, size) <= width
        else [_shorten(draw, ln[0], weight, size, width)]
        for ln in wrapped[:keep]
    ]
    if len(wrapped) > keep:
        last = lines[-1]
        while len(last) > 1 and _line_width(draw, last[:-1] + [last[-1] + "…"], weight, size) > width:
            last = last[:-1]
        tail = last[-1] if last[-1].endswith("…") else last[-1] + "…"
        if _line_width(draw, last[:-1] + [tail], weight, size) > width:
            tail = _shorten(draw, last[-1], weight, size, width)
        lines[-1] = last[:-1] + [tail]
    return _Block(lines, size, line_h, weight, truncated=True)


def _shorten(draw, word: str, weight: str, size: int, width: int) -> str:
    """`word` cut to fit `width` with an ellipsis, never ending on a virama or
    joiner — half a conjunct reads as a different letter."""
    word = word.rstrip("…")
    while len(word) > 1 and _word_width(draw, word + "…", weight, size) > width:
        word = word[:-1].rstrip("్‌‍")
    return word + "…"


def _draw_block(draw, block: _Block, x: int, y: int, fill, *, shadow: bool = False) -> int:
    """Draw left-aligned; returns the y just below the block."""
    if not block.lines:
        return y
    space = _space(draw, block.weight, block.size)
    for index, words in enumerate(block.lines):
        # Baseline sits ~0.95em below the line's top: Telugu stacks vowel
        # signs above the headline and conjuncts below the baseline, and the
        # leading (1.35-1.5em) is what gives both room.
        baseline = y + index * block.line_h + int(block.size * 0.98)
        cursor = float(x)
        for word in words:
            for text, te in _runs(word):
                face = _face(block.weight, block.size, te)
                if shadow:
                    draw.text(
                        (cursor + 2, baseline + 3), text, font=face, fill=(0, 0, 0),
                        anchor="ls", language=_lang(te),
                    )
                draw.text(
                    (cursor, baseline), text, font=face, fill=fill,
                    anchor="ls", language=_lang(te),
                )
                cursor += draw.textlength(text, font=face, language=_lang(te))
            cursor += space
    return y + block.height


# --------------------------------------------------------------------------- #
# Pieces
# --------------------------------------------------------------------------- #
def _gradient(w: int, h: int, top, bottom):
    """Vertical RGBA gradient, top colour to bottom colour."""
    from PIL import Image

    mask = Image.linear_gradient("L").resize((max(1, w), max(1, h)))
    return Image.composite(
        Image.new("RGBA", (w, h), bottom), Image.new("RGBA", (w, h), top), mask
    )


def _cover(photo, w: int, h: int):
    """Scale to cover w×h and crop, keeping heads: a tall photo is cut from
    30% down rather than the middle, because news photos are of people."""
    from PIL import Image

    # The crop is chosen in the photo's own pixels and only that box is
    # resampled. Scaling the whole photo first costs memory in proportion to
    # its aspect: a 1600x16 banner on a Story became 192000x1920.
    ratio = max(w / photo.width, h / photo.height)
    # min/max: float rounding otherwise lands a hair outside the photo, which
    # Pillow refuses ("box offset can't be negative").
    cw, ch = min(photo.width, w / ratio), min(photo.height, h / ratio)
    left = max(0.0, (photo.width - cw) / 2)
    top = max(0.0, (photo.height - ch) * 0.3)
    return photo.resize((w, h), Image.Resampling.LANCZOS, box=(left, top, left + cw, top + ch))


def _chip(text: str, size: int, bg, fg, *, radius: int | None = None, max_width: int = 0):
    """A filled label sized to its text, shrinking to `max_width` if given."""
    from PIL import Image, ImageDraw

    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    width = _line_width(probe, text.split(), "bold", size)
    while max_width and width + 2 * int(size * 0.62) > max_width and size > 14:
        size -= 1
        width = _line_width(probe, text.split(), "bold", size)
    if max_width and width + 2 * int(size * 0.62) > max_width:
        text = _shorten(probe, text, "bold", size, max_width - 2 * int(size * 0.62))
        width = _line_width(probe, text.split(), "bold", size)
    pad_x, h = int(size * 0.62), int(size * 1.75)
    chip = Image.new("RGBA", (int(width) + 2 * pad_x, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(chip)
    d.rounded_rectangle(
        [0, 0, chip.width - 1, h - 1], radius=radius if radius is not None else h // 5, fill=bg
    )
    block = _Block([text.split()], size, h, "bold")
    _draw_block(d, block, pad_x, int((h - size * 1.3) / 2) - int(size * 0.02), fg)
    return chip


def _tracked(draw, xy, text: str, face, fill, tracking: float) -> None:
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=face, fill=fill, anchor="ls", language="en")
        x += draw.textlength(ch, font=face, language="en") + tracking


def _tracked_width(draw, text: str, face, tracking: float) -> float:
    return sum(draw.textlength(ch, font=face, language="en") for ch in text) + tracking * (
        len(text) - 1
    )


@lru_cache(maxsize=8)
def _logo(h: int):
    """The masthead lockup at height `h`: a gold "తె" tile and the wordmark.

    Drawn, not loaded, because the site has no logo file — the masthead is
    type (`Masthead.tsx`). A PNG at `LOGO_FILE` replaces it.
    """
    from PIL import Image, ImageDraw

    if LOGO_FILE.is_file():
        custom = Image.open(LOGO_FILE).convert("RGBA")
        return custom.resize(
            (max(1, round(custom.width * h / custom.height)), h), Image.Resampling.LANCZOS
        )

    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    te_size, en_size = int(h * 0.36), int(h * 0.15)
    en_face = _face("bold", en_size, False)
    tracking = en_size * 0.28
    en_text = "TOP TELUGU NEWS"
    text_w = max(
        _line_width(probe, SITE_NAME_TE.split(), "bold", te_size),
        _tracked_width(probe, en_text, en_face, tracking),
    )
    pad = int(h * 0.2)
    tile = h
    w = tile + pad + int(text_w) + pad

    logo = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(logo)
    radius = int(h * 0.18)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=RED)
    d.rounded_rectangle([0, 0, tile - 1, h - 1], radius=radius, fill=WHITE)
    d.rectangle([tile - radius, 0, tile - 1, h - 1], fill=WHITE)

    mono = _face("bold", int(h * 0.56), True)
    d.text((tile / 2, h * 0.52), "తె", font=mono, fill=RED, anchor="mm", language="te")

    x = tile + pad
    _draw_block(
        d,
        _Block([SITE_NAME_TE.split()], te_size, te_size, "bold"),
        x,
        int(h * 0.5 - te_size * 1.02),
        CREAM,
    )
    _tracked(d, (x, int(h * 0.8)), en_text, en_face, WHITE, tracking)
    return logo


def _paste(canvas, piece, xy) -> None:
    canvas.alpha_composite(piece, (int(xy[0]), int(xy[1])))


def _small_logo(canvas, inp: "CardInput", logo, xy) -> None:
    """The corner masthead — skipped when the brand fill already shows it large."""
    if inp.photo is not None:
        _paste(canvas, logo, xy)


def _domain() -> str:
    from urllib.parse import urlparse

    return (urlparse(settings.APP_URL).netloc or "").replace("www.", "")


def _footer(size: int, max_width: int):
    domain = _domain()
    text = f"పూర్తి వార్త · {domain}" if domain else "పూర్తి వార్త మా వెబ్‌సైట్‌లో"
    return _chip(text, size, WHITE, DEEP, radius=int(size * 1.75) // 2, max_width=max_width)


# --------------------------------------------------------------------------- #
# Templates
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class CardInput:
    aspect: str
    template: str
    headline: str
    summary: str = ""
    tag: str = ""
    #: A PIL image, or None for the brand background.
    photo: object | None = None
    #: "ప్రతీకాత్మక AI చిత్రం", "AI చిత్రం" or "ప్రతీకాత్మక చిత్రం" — drawn on the picture.
    photo_label: str | None = None
    #: A PIL image drawn under everything in place of our dark blue: the
    #: creative studio's design backdrop. Text then sits on dark panels.
    backdrop: object | None = None
    #: Exact pixels for a custom canvas; `aspect` then names the nearest shape,
    #: which is what the layout tables are keyed by.
    size: tuple[int, int] | None = None


def _brand_fill(w: int, h: int, cy: float = 0.5, backdrop=None):
    """What stands where a photo would: the logo on a clean white ground, or
    on the design backdrop when there is one.

    `cy` is where the masthead's centre sits, as a fraction of the height —
    the overlay card keeps its lower half for text.
    """
    fill = (
        _cover(backdrop, w, h).convert("RGBA")
        if backdrop is not None
        else _gradient(w, h, WHITE + (255,), (226, 230, 236, 255))
    )
    logo = _logo(max(40, int(min(w, h) * 0.16)))
    if logo.width > w * 0.8:
        logo = _logo(max(40, int(logo.height * w * 0.8 / logo.width)))
    fill.alpha_composite(logo, ((w - logo.width) // 2, int(h * cy - logo.height / 2)))
    return fill


#: Below this share of the photo surviving a cover-crop, the whole photo is
#: shown instead. Measured on the desk's own stories: a 16:9 collage cropped
#: into a 9:16 overlay kept 32% of its width and landed on a bystander between
#: the two panels, while the person the story is about was cut off.
_MIN_KEPT = 0.62


def _placed(photo, w: int, h: int, cy: float):
    """The photo in a w×h slot: cover-cropped when little is lost, otherwise
    whole, over a blurred and darkened copy of itself.

    `cy` is where the whole photo's centre sits, as a fraction of the height,
    so an overlay card keeps it clear of the text at the bottom.
    """
    from PIL import Image, ImageEnhance, ImageFilter

    slot, own = w / h, photo.width / photo.height
    if min(slot / own, own / slot) >= _MIN_KEPT:
        return _cover(photo, w, h)
    # Blurred at a tenth of the size and scaled back up: the same look for a
    # fraction of the cost of blurring 2 million pixels.
    small = _cover(photo, max(1, w // 10), max(1, h // 10)).filter(ImageFilter.GaussianBlur(3))
    backdrop = ImageEnhance.Brightness(small.resize((w, h), Image.Resampling.BILINEAR)).enhance(0.45)
    scale = min(w / photo.width, h / photo.height)
    pw, ph = max(1, round(photo.width * scale)), max(1, round(photo.height * scale))
    backdrop.paste(
        photo.resize((pw, ph), Image.Resampling.LANCZOS),
        ((w - pw) // 2, min(max(0, int(h * cy - ph / 2)), h - ph)),
    )
    return backdrop


def _photo_or_brand(inp: CardInput, w: int, h: int, cy: float = 0.5):
    if inp.photo is None:
        return _brand_fill(w, h, cy, inp.backdrop)
    return _placed(inp.photo, w, h, cy).convert("RGBA")


def _ground(inp: CardInput, w: int, h: int, top, bottom):
    """What the text stands on: our dark gradient, or over a design backdrop
    only a light shade, so the design shows and `_behind` keeps the contrast."""
    if inp.backdrop is None:
        return _gradient(w, h, top + (255,), bottom + (255,))
    return _gradient(w, h, (0, 0, 0, 40), (0, 0, 0, 90))


def _behind(canvas, inp: CardInput, x: int, y: int, w: int, h: int, unit: int) -> None:
    """A dark rounded panel under a text block — only over a design backdrop,
    whose colours are the model's and cannot be trusted to carry white type."""
    if inp.backdrop is None or h <= 0:
        return
    from PIL import Image, ImageDraw

    pad = int(unit * 0.45)
    panel = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle(
        [0, 0, panel.width - 1, panel.height - 1], radius=int(unit * 0.5), fill=NIGHT + (210,)
    )
    _paste(canvas, panel, (max(0, x - pad), max(0, y - pad)))


def _label(canvas, inp: CardInput, right: int, top: int, unit: int) -> None:
    if not inp.photo_label or inp.photo is None:
        return
    chip = _chip(
        inp.photo_label, int(unit * 0.42), (0, 0, 0, 150), WHITE,
        max_width=canvas.width // 2,
    )
    _paste(canvas, chip, (right - chip.width, top))


#: A Story has 80% more height than a square at the same width; its type may
#: grow to use some of it.
_TYPE_BOOST = {"9:16": 1.24, "4:5": 1.06}


def _text_blocks(draw, inp: CardInput, *, width: int, head_h: int, sum_h: int,
                 head_lines: int, sum_lines: int, unit: int):
    boost = _TYPE_BOOST.get(inp.aspect, 1.0)
    head = _fit(draw, inp.headline, weight="bold", width=width, height=head_h,
                max_lines=head_lines, hi=int(unit * 1.62 * boost), lo=int(unit * 0.95),
                leading=1.38)
    summ = _fit(draw, inp.summary, weight="regular", width=width, height=sum_h,
                max_lines=sum_lines, hi=int(unit * 0.94 * boost), lo=int(unit * 0.64),
                leading=1.52)
    return head, summ


def _tag(inp: CardInput, unit: int, max_width: int):
    return _chip(inp.tag or DEFAULT_TAG, int(unit * 0.6), HEAD, DEEP, radius=6, max_width=max_width)


def _panel(canvas, draw, inp: CardInput, W: int, H: int, unit: int, m: int):
    landscape = W > H
    tag = _tag(inp, unit, (W // 2 if landscape else W) - 2 * m)
    logo = _logo(int(unit * 1.55))
    footer = _footer(int(unit * 0.44), W - m)

    if landscape:
        seam = W // 2
        _paste(canvas, _photo_or_brand(inp, seam, H), (0, 0))
        _paste(canvas, _ground(inp, W - seam, H, DEEP, DEEPER), (seam, 0))
        draw.rectangle([seam, 0, seam + 7, H], fill=RED)
        _label(canvas, inp, seam - m // 2, m // 2, unit)
        x, width = seam + m, W - seam - 2 * m
        _small_logo(canvas, inp, logo, (x, m))
        y = m + logo.height + int(unit * 0.8)
        _paste(canvas, tag, (x, y))
        y += tag.height + int(unit * 0.55)
        bottom = H - m - footer.height - int(unit * 0.5)
        head, summ = _text_blocks(draw, inp, width=width, head_h=int((bottom - y) * 0.52),
                                  sum_h=int((bottom - y) * 0.48), head_lines=4,
                                  sum_lines=5, unit=unit)
    else:
        share = {"1:1": 0.5, "4:5": 0.5, "9:16": 0.47}.get(inp.aspect, 0.5)
        seam = int(H * share)
        _paste(canvas, _photo_or_brand(inp, W, seam), (0, 0))
        _paste(canvas, _gradient(W, seam // 2, (0, 0, 0, 0), (0, 0, 0, 110)), (0, seam - seam // 2))
        _paste(canvas, _ground(inp, W, H - seam, DEEP, DEEPER), (0, seam))
        draw.rectangle([0, seam, W, seam + 6], fill=RED)
        _label(canvas, inp, W - m // 2, m // 2, unit)
        x, width = m, W - 2 * m
        _paste(canvas, tag, (x, seam - tag.height // 2))
        _small_logo(canvas, inp, logo, (x, seam - tag.height // 2 - logo.height - int(unit * 0.35)))
        y = seam + tag.height // 2 + int(unit * 0.6)
        bottom = H - m // 2 - footer.height - int(unit * 0.45)
        lines = {"1:1": (3, 3), "4:5": (3, 4), "9:16": (4, 6)}.get(inp.aspect, (3, 4))
        head, summ = _text_blocks(draw, inp, width=width, head_h=int((bottom - y) * 0.55),
                                  sum_h=int((bottom - y) * 0.45), head_lines=lines[0],
                                  sum_lines=lines[1], unit=unit)

    gap = int(head.size * 0.3) if head.lines and summ.lines else 0
    # Unused height goes mostly below the text, a little above: top-aligned
    # like the reference cards, without a dead band over the footer.
    y += max(0, (bottom - y) - (head.height + gap + summ.height)) * 3 // 10
    _behind(canvas, inp, x, y, width, head.height + gap + summ.height, unit)
    y = _draw_block(draw, head, x, y, HEAD)
    _draw_block(draw, summ, x, y + gap, WHITE)
    _paste(canvas, footer, (W - m // 2 - footer.width if not landscape else W - m - footer.width,
                            H - m // 2 - footer.height))
    return head, summ


def _overlay(canvas, draw, inp: CardInput, W: int, H: int, unit: int, m: int):
    landscape = W > H
    _paste(canvas, _photo_or_brand(inp, W, H, cy=0.28), (0, 0))
    _paste(canvas, _gradient(W, int(H * 0.22), (0, 0, 0, 150), (0, 0, 0, 0)), (0, 0))

    logo = _logo(int(unit * 1.55))
    footer = _footer(int(unit * 0.44), W - m)
    width = int(W * 0.62) if landscape else W - 2 * m
    tag = _tag(inp, unit, width)
    room = int(H * (0.52 if landscape else 0.46))
    lines = {"1:1": (3, 3), "4:5": (3, 3), "9:16": (4, 5), "16:9": (3, 3)}.get(inp.aspect, (3, 3))
    head, summ = _text_blocks(draw, inp, width=width, head_h=int(room * 0.55),
                              sum_h=int(room * 0.45), head_lines=lines[0],
                              sum_lines=lines[1], unit=unit)

    gap = int(head.size * 0.3) if head.lines and summ.lines else 0
    text_h = tag.height + int(unit * 0.5) + head.height + gap + summ.height
    bottom = H - m // 2 - footer.height - int(unit * 0.55)
    top = bottom - text_h
    scrim_top = max(0, top - int(H * 0.18))
    _paste(canvas, _gradient(W, top - scrim_top, (0, 0, 0, 0), (0, 0, 0, 165)), (0, scrim_top))
    _paste(canvas, _gradient(W, H - top, (0, 0, 0, 165), (0, 0, 0, 235)), (0, top))

    _small_logo(canvas, inp, logo, (m, m))
    _label(canvas, inp, W - m // 2, m // 2, unit)
    _paste(canvas, tag, (m, top))
    y = top + tag.height + int(unit * 0.5)
    y = _draw_block(draw, head, m, y, HEAD, shadow=True)
    _draw_block(draw, summ, m, y + gap, WHITE, shadow=True)
    _paste(canvas, footer, (W - m // 2 - footer.width, H - m // 2 - footer.height))
    return head, summ


def _frame(canvas, draw, inp: CardInput, W: int, H: int, unit: int, m: int):
    from PIL import Image, ImageDraw

    landscape = W > H
    _paste(canvas, _ground(inp, W, H, NIGHT, DEEPER), (0, 0))
    logo = _logo(int(unit * 1.4))
    # Portrait puts the tag in the logo's row, so it gets what the logo leaves.
    tag = _tag(
        inp, unit,
        int(W * 0.46) - m - int(unit * 0.6) if landscape
        else W - 2 * m - (logo.width + int(unit * 0.5) if inp.photo is not None else 0),
    )
    footer = _footer(int(unit * 0.44), W - m)
    radius = int(unit * 0.7)

    def framed(w: int, h: int):
        pic = _photo_or_brand(inp, w, h)
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        out.paste(pic, (0, 0), mask)
        return out

    if landscape:
        col = int(W * 0.46)
        x, width = m, col - m - int(unit * 0.6)
        _small_logo(canvas, inp, logo, (x, m))
        y = m + logo.height + int(unit * 0.8)
        _paste(canvas, tag, (x, y))
        y += tag.height + int(unit * 0.5)
        bottom = H - m - footer.height - int(unit * 0.5)
        head, summ = _text_blocks(draw, inp, width=width, head_h=int((bottom - y) * 0.55),
                                  sum_h=int((bottom - y) * 0.45), head_lines=4,
                                  sum_lines=4, unit=unit)
        _behind(canvas, inp, x, y, width, head.height + int(head.size * 0.3) + summ.height, unit)
        y = _draw_block(draw, head, x, y, HEAD)
        _draw_block(draw, summ, x, y + int(head.size * 0.3), WHITE)
        pic_x, pic_w = col, W - col - m
        _paste(canvas, framed(pic_w, H - 2 * m), (pic_x, m))
        _label(canvas, inp, pic_x + pic_w - int(unit * 0.4), m + int(unit * 0.4), unit)
        _paste(canvas, footer, (x, H - m - footer.height))
        return head, summ

    x, width = m, W - 2 * m
    _small_logo(canvas, inp, logo, (x, m))
    _paste(canvas, tag, (W - m - tag.width, m + (logo.height - tag.height) // 2))
    y = m + logo.height + int(unit * 0.7)
    lines = {"1:1": (2, 3), "4:5": (3, 3), "9:16": (4, 4)}.get(inp.aspect, (3, 3))
    head, summ = _text_blocks(draw, inp, width=width, head_h=int(H * 0.21),
                              sum_h=int(H * 0.17), head_lines=lines[0],
                              sum_lines=lines[1], unit=unit)
    _behind(canvas, inp, x, y, width, head.height, unit)
    y = _draw_block(draw, head, x, y, HEAD) + int(unit * 0.55)
    footer_y = H - m // 2 - footer.height
    sum_y = footer_y - int(unit * 0.5) - summ.height
    pic_h = sum_y - int(unit * 0.55) - y
    _paste(canvas, framed(width, pic_h), (x, y))
    _label(canvas, inp, x + width - int(unit * 0.4), y + int(unit * 0.4), unit)
    _behind(canvas, inp, x, sum_y, width, summ.height, unit)
    _draw_block(draw, summ, x, sum_y, WHITE)
    _paste(canvas, footer, (W - m // 2 - footer.width, footer_y))
    return head, summ


def render(inp: CardInput) -> tuple[bytes, list[str]]:
    """Draw the card. Returns JPEG bytes and warnings for the editor.

    Assumes `unavailable_reason()` is None.
    """
    from PIL import Image, ImageDraw

    if inp.template not in TEMPLATES or (inp.size is None and inp.aspect not in ASPECTS):
        raise ValueError(f"unknown card shape {inp.aspect}/{inp.template}")
    W, H = inp.size or ASPECTS[inp.aspect]
    canvas = Image.new("RGBA", (W, H), DEEP + (255,))
    if inp.backdrop is not None:
        canvas.paste(_cover(inp.backdrop, W, H).convert("RGBA"))
    draw = ImageDraw.Draw(canvas)
    # One layout unit: 1/19 of the short side, ~57 px on every shape, so a
    # headline is the same physical size on a Story as on a square.
    unit = min(W, H) // 19
    margin = int(unit * 1.05)
    head, summ = {"panel": _panel, "overlay": _overlay, "frame": _frame}[inp.template](
        canvas, draw, inp, W, H, unit, margin
    )

    warnings = []
    if head.truncated:
        warnings.append("headline_truncated")
    if summ.truncated:
        warnings.append("summary_truncated")
    if inp.photo is None:
        warnings.append("no_photo")
    if _foreign_glyph(f"{inp.headline} {inp.summary} {inp.tag}"):
        # Neither face has it (emoji, another script): it printed as a box.
        warnings.append("unsupported_characters")

    out = io.BytesIO()
    # JPEG q90: every platform recompresses on upload, so a PNG buys nothing
    # but a 3 MB file on a reporter's phone data.
    canvas.convert("RGB").save(out, format="JPEG", quality=90, optimize=True, progressive=True)
    return out.getvalue(), warnings


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #
def nearest_aspect(width: int, height: int) -> str:
    """The named shape closest to a custom canvas; the layout tables are keyed
    by it, so a 1200x630 link preview is laid out as a 16:9 card."""
    ratio = width / height
    return min(ASPECTS, key=lambda a: abs(math.log(ASPECTS[a][0] / ASPECTS[a][1] / ratio)))


def photo_aspect(template: str, aspect: str) -> str:
    """The shape of the picture slot, which is what the image model should draw.

    A 4:5 panel card puts its photo in a landscape band; asking for a portrait
    picture there would crop away most of what was paid for.
    """
    landscape = aspect == "16:9"
    if template == "overlay":
        return aspect
    if template == "panel":
        return "4:5" if landscape else "16:9"
    return "1:1" if landscape else "16:9"


def _load(media: Media):
    from PIL import Image

    raw: bytes | None = None
    try:
        raw = get_storage().read(media.storage_key)
    except Exception:  # noqa: BLE001 — fall back to the public URL
        raw = None
    if not raw and media.cdn_url:
        try:
            response = httpx.get(media.cdn_url, timeout=10.0, follow_redirects=True)
            response.raise_for_status()
            raw = response.content
        except httpx.HTTPError as exc:
            logger.info("social_card_photo_failed", media_id=media.id, error=str(exc)[:120])
            return None
    if not raw:
        return None
    try:
        image = Image.open(io.BytesIO(raw))
        image.draft("RGB", (1920, 1920))
        return image.convert("RGB")
    except Exception as exc:  # noqa: BLE001 — a broken file is a card without a photo
        logger.info("social_card_photo_unreadable", media_id=media.id, error=str(exc)[:120])
        return None


def _photo_label(media: Media) -> str | None:
    """What kind of picture this is, printed on it.

    An AI picture is labelled (§7.4), and today's realistic ones also say they
    are representative, so nobody takes the scene for the event. A library
    stand-in (older rows only; none is attached since 2026-09-30) says it is
    representative, which is the correction `share_card_service` could not
    print and so refused to use one. No photo credit is printed: the owner's
    decision (2026-09-23), made knowing a borrowed photo is still the source's
    work — `Media.credit` keeps the record either way.
    """
    if media.ai_generated:
        # A realistic AI scene must say it is not the event, not only that it is AI.
        return "ప్రతీకాత్మక AI చిత్రం" if (media.meta or {}).get("representative") else "AI చిత్రం"
    if (media.meta or {}).get("representative"):
        return "ప్రతీకాత్మక చిత్రం"
    return None


def _usable(media: Media | None) -> bool:
    return (
        media is not None
        and media.deleted_at is None
        and (media.mime or "").startswith("image/")
    )


def make_card(
    db: Session,
    article: Article,
    *,
    aspect: str,
    template: str,
    headline: str,
    summary: str,
    tag: str | None,
    photo: str,
    photo_media_id: int | None,
    brief: str | None,
    actor_id: int | None,
    size: tuple[int, int] | None = None,
    reference_media_ids: list[int] | None = None,
    backdrop_media_id: int | None = None,
    use_ai_backdrop: bool = False,
    backdrop_brief: str | None = None,
    save: bool = False,
) -> dict:
    """Render, store and describe one card. See the route for the contract.

    `size` is a custom canvas and replaces `aspect`, which becomes the nearest
    named shape. A design backdrop is either one already drawn
    (`backdrop_media_id`, free) or drawn now (`use_ai_backdrop`, paid). `save`
    also files the finished card in the media library.
    """
    reason = unavailable_reason()
    if reason:
        return {"available": False, "reason": reason, "card": None}
    if size is not None:
        aspect = nearest_aspect(*size)
    width, height = size or ASPECTS[aspect]

    media: Media | None = None
    drawn: Media | None = None
    if photo == "none":
        pass
    elif photo_media_id is not None:
        media = db.get(Media, photo_media_id)
        if not _usable(media):
            raise NotFoundError(message_en="That picture is not in the media library.")
    elif photo == "story" and article.hero_media_id:
        media = db.get(Media, article.hero_media_id)
        media = media if _usable(media) else None
    elif photo == "ai":
        reason = ai_image_service.unavailable_reason(db)
        if reason:
            return {"available": False, "reason": reason, "card": None}
        media = drawn = ai_image_service.generate_for_article(
            db, article, actor_id=actor_id, brief=brief, aspect=photo_aspect(template, aspect)
        )
        # A paid draw survives whatever happens to the render below: the
        # picture and its ledger row are committed now, and the editor's next
        # attempt reuses it by id instead of paying again.
        db.commit()

    # Paid pictures to hand back on any later failure, so the retry reuses them.
    held: dict[str, int] = {"photo_media_id": drawn.id} if drawn is not None else {}
    backdrop: Media | None = None
    try:
        if backdrop_media_id is not None:
            backdrop = db.get(Media, backdrop_media_id)
            if not _usable(backdrop) or not (backdrop.meta or {}).get("creative_backdrop"):
                raise NotFoundError(message_en="That design backdrop is not in the media library.")
            # A design drawn for one story, reused on another: still an AI
            # image on this story, so screened like a fresh one.
            ai_image_service._screen(article, backdrop_brief)
        # Not under a full-photo card: the photo covers all of it, so the
        # design would be paid for and never seen.
        elif use_ai_backdrop and not (template == "overlay" and media is not None):
            reason = ai_image_service.unavailable_reason(db)
            if reason:
                return {"available": False, "reason": reason, "card": None}
            backdrop = ai_image_service.generate_backdrop(
                db, article, reference_media_ids=reference_media_ids or [], width=width,
                height=height, actor_id=actor_id, brief=backdrop_brief,
            )
            db.commit()  # paid: see the photo above
            held["backdrop_media_id"] = backdrop.id

        raw, stored, shape, warnings = _render_and_store(
            article, media, aspect=aspect, template=template, headline=headline,
            summary=summary, tag=tag, size=size, backdrop=backdrop,
        )
        saved = (
            _save_card(db, article, raw, shape=shape, size=(width, height), headline=headline,
                       photo=media, actor_id=actor_id)
            if save
            else None
        )
    except AppError as exc:
        # The pictures are paid for and committed; hand their ids back so the
        # retry reuses them instead of buying more.
        if held:
            exc.details = {**exc.details, **held}
        raise
    if _invented_numbers(f"{headline} {summary} {tag or ''}", _article_text(article)):
        warnings.append("unverified_figure")
    logger.info("social_card_rendered", short_id=article.short_id, key=stored.key, template=template)
    return {
        "available": True,
        "reason": None,
        "card": {
            "url": stored.url,
            "width": width,
            "height": height,
            "aspect": aspect,
            "template": template,
            "filename": f"toptelugunews-{article.short_id}-{shape}.jpg",
            "warnings": warnings,
            # Present whenever a picture was chosen, even one that failed to
            # load (then `no_photo` says so): the CMS holds this id, and a
            # drawn picture dropped here would be bought twice.
            "photo": (
                {"media_id": media.id, "url": media.cdn_url, "ai_generated": bool(media.ai_generated)}
                if media is not None
                else None
            ),
            # Same reason: sent back as `backdrop_media_id`, a text edit
            # re-renders over the same design for free.
            "backdrop": (
                {"media_id": backdrop.id, "url": backdrop.cdn_url} if backdrop is not None else None
            ),
            "media_id": saved.id if saved is not None else None,
        },
    }


def _render_and_store(
    article: Article,
    media: Media | None,
    *,
    aspect: str,
    template: str,
    headline: str,
    summary: str,
    tag: str | None,
    size: tuple[int, int] | None = None,
    backdrop: Media | None = None,
):
    image = _load(media) if media is not None else None
    label = _photo_label(media) if media is not None and image is not None else None
    tag_text = (tag or "").strip() or (
        article.category.name_te if article.category and article.category.name_te else DEFAULT_TAG
    )
    raw, warnings = render(
        CardInput(
            aspect=aspect,
            template=template,
            headline=headline.strip(),
            summary=(summary or "").strip(),
            tag=tag_text[:32],
            photo=image,
            photo_label=label,
            # A backdrop that will not load is a card on our own blue, not an error.
            backdrop=_load(backdrop) if backdrop is not None else None,
            size=size,
        )
    )
    digest = hashlib.sha256(raw).hexdigest()[:16]
    shape = f"{size[0]}x{size[1]}" if size else aspect.replace(":", "x")
    key = f"social-cards/{article.short_id}/{digest}-{shape}.jpg"
    stored = get_storage().put(
        key, raw, content_type="image/jpeg", cache_control="public, max-age=31536000, immutable"
    )
    return raw, stored, shape, warnings


def _save_card(
    db: Session,
    article: Article,
    raw: bytes,
    *,
    shape: str,
    size: tuple[int, int],
    headline: str,
    photo: Media | None,
    actor_id: int | None,
) -> Media:
    """The finished card as a media-library row, beside the JPEG download.

    The library re-encodes to WebP at up to 1600 px wide, so the download URL
    stays the full-size original. `ai_generated` follows the photo slot: the
    design backdrop is decoration that depicts nothing, and labelling a real
    news photograph "AI" would be its own falsehood. The photo's credit is
    kept on the row (§12.5) although the card does not print it.

    Shrunk to 1600 px first: the library keeps nothing wider, and its sanitiser
    copies every pixel into a Python list (~72 B each) — a 4096² card would
    need over a gigabyte on a VPS with ~800 MB free.
    """
    from PIL import Image

    from app.services import media_service

    card = Image.open(io.BytesIO(raw))
    if max(card.size) > 1600:
        card.thumbnail((1600, 1600))
        out = io.BytesIO()
        card.save(out, format="JPEG", quality=90)
        raw = out.getvalue()
    return media_service.create_image_media(
        db,
        raw=raw,
        filename=f"creative-{article.short_id}-{shape}.jpg",
        mime="image/jpeg",
        max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
        uploaded_by=actor_id,
        alt_te=headline.strip()[:500],
        credit=photo.credit if photo is not None else None,
        source_type=photo.source_type if photo is not None and photo.credit else "own",
        ai_generated=bool(photo is not None and photo.ai_generated),
        meta={"creative": True, "article_id": article.id, "size": list(size)},
    )


def _foreign_glyph(text: str) -> bool:
    """A letter from neither Telugu nor Latin — Myanmar, Tamil, CJK.

    Measured on the bulk model: 3 of 16 rewrites carried one (`ఎစ်భై` for
    `ఎనభై`), and it reads as Telugu at a glance, so an editor will not catch it
    on a card. Quotes, dashes, the ellipsis and ₹ are allowed.
    """
    return any(
        not (
            ord(ch) < 0x0300
            or 0x0C00 <= ord(ch) <= 0x0C7F
            or 0x2000 <= ord(ch) <= 0x206F
            or ch in "₹।॥"
        )
        for ch in text
    )


def card_text(db: Session, article: Article, *, actor_id: int | None) -> dict:
    """The card's words, written by the bulk model when AI is on.

    The bulk model, not the editorial one: measured 2026-09-23 on three stories,
    the editorial model took 12-18 s and timed out (billed) on one of three at
    the 25 s ceiling; the bulk model answered in 1.3 s at a twentieth of the
    price with the same proper nouns right. A card hook is short; the wait is
    the whole cost.

    With AI off, or no key, the keyless provider trims our own headline and
    standfirst — a correct card, so the button never dead-ends. A model answer
    carrying a stray script falls back to the same.
    """
    provider = (
        get_ai(**settings_service.ai_credentials(db, bulk=True))
        if settings_service.ai_enabled(db)
        else get_ai("heuristic")
    )
    billed = provider.key != "heuristic"
    if billed:
        ai_usage_service.guard(db, actor_id)
    try:
        text = provider.card_text(
            headline=article.title_te or "",
            summary=article.summary_te or "",
            body=article.body_plain or "",
        )
    except Exception as exc:  # noqa: BLE001 — a malformed answer is still billed
        if billed:
            with session_scope() as ledger:
                ai_usage_service.record(
                    ledger, operation="card_text", provider=provider.key,
                    model=getattr(provider, "model_name", None), actor_id=actor_id,
                    usage=getattr(provider, "last_usage", None), ok=False,
                    error=str(getattr(exc, "details", exc))[:300],
                )
        raise
    if billed:
        ai_usage_service.record(
            db, operation="card_text", provider=provider.key,
            model=getattr(provider, "model_name", None), actor_id=actor_id,
            usage=getattr(provider, "last_usage", None),
        )
    warnings: list[str] = []
    invented = _invented_numbers(f"{text.headline} {text.summary} {text.tag}", _article_text(article))
    if invented:
        # A figure the story never gave is the price board GPT Image drew:
        # read as fact, and wrong. Our own words carry no such figure.
        logger.warning("social_card_text_invented_number", article_id=article.id, numbers=sorted(invented))
        warnings.append("unverified_figure")
    if invented or _foreign_glyph(f"{text.headline} {text.summary} {text.tag}"):
        if not invented:
            logger.warning("social_card_text_foreign_glyph", article_id=article.id)
        text = get_ai("heuristic").card_text(
            headline=article.title_te or "",
            summary=article.summary_te or "",
            body=article.body_plain or "",
        )
    return _card_text_out(article, text, warnings)


def _card_text_out(article: Article, text: CardText, warnings: list[str]) -> dict:
    category = article.category.name_te if article.category and article.category.name_te else ""
    return {
        "headline": text.headline,
        "summary": text.summary,
        "tag": text.tag or category or DEFAULT_TAG,
        "engine": text.engine,
        "warnings": warnings,
    }


#: Telugu digits read as the Latin ones, so "౨౦" in the copy matches "20" in
#: the story.
_TE_DIGITS = str.maketrans("౦౧౨౩౪౫౬౭౮౯", "0123456789")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def _numbers(text: str) -> set[str]:
    # Grouping commas dropped: "1,20,000" and "120000" are the same figure.
    return {n.replace(",", "") for n in _NUMBER.findall((text or "").translate(_TE_DIGITS))}


def _invented_numbers(card: str, article_text: str) -> set[str]:
    """Figures in the card copy that the story itself never states."""
    return _numbers(card) - _numbers(article_text)


def _article_text(article: Article) -> str:
    return " ".join(x for x in (article.title_te, article.summary_te, article.body_plain) if x)

