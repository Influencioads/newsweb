"""The edition as a PDF: one raster page per e-paper page, bound together.

Why raster and not a text PDF: the only PDF library in the stack (reportlab,
now removed) cannot shape Telugu, so conjuncts and vowel signs came out as a
row of disconnected glyphs. Pillow can, when built against Raqm, and the share
cards already draw Telugu that way. So each page is drawn as an image with the
same slot geometry the web sheet uses (`epaper_layouts`), and Pillow's PDF
writer binds the pages. Readers get a file that looks like the sheet; nobody
gets unreadable text. Selectable text is the price, and e-paper PDFs are page
images everywhere else too.

Everything here is pure: it takes the serialized edition and returns bytes.
The caller (`epaper_service.generate_pdf`) owns the shaping check, storage and
the asset row.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Any

from app.core.config import settings
from app.schemas.epaper import EpaperArticleOut, EpaperEditionOut, EpaperPageOut, SlotOut
from app.services.epaper_layouts import GRID_COLS, GRID_ROWS
from app.services.share_card_service import (
    BRAND,
    INK,
    MUTED,
    PAPER,
    _fetch_hero,
    _font,
    _font_for,
    _wrap,
)

if TYPE_CHECKING:  # pragma: no cover
    from PIL.Image import Image

#: A4 at 150 dpi. Big enough to read on a phone when zoomed, small enough that
#: an eight-page edition stays a few megabytes.
PAGE_W, PAGE_H = 1240, 1754
MARGIN, MASTHEAD_H, FOOTER_H, GUTTER, PAD = 48, 150, 40, 14, 16

TITLE_LINES = {"lead": 3, "standard": 3, "brief": 2}
SUMMARY_LINES = {"lead": 5, "standard": 2, "brief": 0}
TITLE_SIZE = {"lead": 40, "standard": 28, "brief": 22}
SUMMARY_SIZE = {"lead": 22, "standard": 20, "brief": 20}
#: Share of the slot height given to the photo, when there is one.
IMAGE_SHARE = {"lead": 0.45, "standard": 0.40, "brief": 0.0}

RULE = (229, 223, 214)
INK_SOFT = (74, 68, 60)
LINE_HEIGHT = 1.45


def content_box() -> tuple[int, int, int, int]:
    """The area the slot grid occupies: below the masthead, above the footer."""
    return MARGIN, MARGIN + MASTHEAD_H, PAGE_W - MARGIN, PAGE_H - MARGIN - FOOTER_H


def slot_box(slot: SlotOut) -> tuple[int, int, int, int]:
    """Pixel rectangle (x0, y0, x1, y1) of a slot on the page."""
    x0, y0, x1, y1 = content_box()
    cell_w = (x1 - x0 - GUTTER * (GRID_COLS - 1)) / GRID_COLS
    cell_h = (y1 - y0 - GUTTER * (GRID_ROWS - 1)) / GRID_ROWS
    left = x0 + slot.x * (cell_w + GUTTER)
    top = y0 + slot.y * (cell_h + GUTTER)
    right = left + slot.w * cell_w + (slot.w - 1) * GUTTER
    bottom = top + slot.h * cell_h + (slot.h - 1) * GUTTER
    return int(left), int(top), int(right), int(bottom)


def _paste_cover(canvas: Any, photo: Any, box: tuple[int, int, int, int]) -> None:
    """Cover-crop `photo` into `box`, keeping the centre."""
    from PIL import Image

    x0, y0, x1, y1 = box
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    ratio = max(width / photo.width, height / photo.height)
    resized = photo.resize(
        (max(1, int(photo.width * ratio)), max(1, int(photo.height * ratio))),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    canvas.paste(resized.crop((left, top, left + width, top + height)), (x0, y0))


def _text(draw: Any, xy: tuple[float, float], text: str, font: Any, fill: Any) -> None:
    # `language="te"` on every run: Pillow refuses it without Raqm, which turns
    # a silently unshaped page into a loud failure (same policy as share cards).
    draw.text(xy, text, font=font, fill=fill, language="te")


def _masthead(draw: Any, edition: EpaperEditionOut, page: EpaperPageOut) -> None:
    name = settings.APP_NAME[:40]
    _text(draw, (MARGIN, MARGIN), name, _font_for(name, "bold", 56), INK)
    stamp = edition.edition_date.strftime("%d-%m-%Y")
    _text(draw, (MARGIN, MARGIN + 78), stamp, _font_for(stamp, "regular", 26), MUTED)
    title_font = _font_for(page.title, "bold", 34)
    width = draw.textlength(page.title, font=title_font, language="te")
    _text(draw, (PAGE_W - MARGIN - width, MARGIN + 66), page.title, title_font, INK)
    rule_y = MARGIN + MASTHEAD_H - 12
    draw.rectangle([MARGIN, rule_y, PAGE_W - MARGIN, rule_y + 4], fill=BRAND)


def _story(canvas: Any, draw: Any, slot: SlotOut, article: EpaperArticleOut, images: bool) -> None:
    x0, y0, x1, y1 = slot_box(slot)
    draw.rectangle([x0, y0, x1, y1], outline=RULE, width=1)
    size = slot.size if slot.size in TITLE_SIZE else "standard"
    y = y0
    band = int((y1 - y0) * IMAGE_SHARE[size])
    if images and band and article.hero_url:
        photo = _fetch_hero(article.hero_url)
        if photo is not None:
            _paste_cover(canvas, photo, (x0 + 1, y0 + 1, x1 - 1, y0 + band))
            y = y0 + band
    y += PAD
    x, width = x0 + PAD, x1 - x0 - 2 * PAD

    if article.category_name_te:
        label = article.category_name_te[:22]
        chip = _font_for(label, "bold", 18)
        chip_w = draw.textlength(label, font=chip, language="te")
        draw.rounded_rectangle([x, y, x + chip_w + 20, y + 30], radius=15, fill=BRAND)
        _text(draw, (x + 10, y + 5), label, chip, PAPER)
        y += 40

    title_font = _font_for(article.title_te, "bold", TITLE_SIZE[size])
    step = int(TITLE_SIZE[size] * LINE_HEIGHT)
    for line in _wrap(draw, article.title_te, title_font, width, TITLE_LINES[size]):
        if y + step > y1 - PAD:
            return
        _text(draw, (x, y), line, title_font, INK)
        y += step

    if SUMMARY_LINES[size] and article.summary_te:
        y += 6
        body = _font_for(article.summary_te, "regular", SUMMARY_SIZE[size])
        step = int(SUMMARY_SIZE[size] * LINE_HEIGHT)
        for line in _wrap(draw, article.summary_te, body, width, SUMMARY_LINES[size]):
            if y + step > y1 - PAD:
                return
            _text(draw, (x, y), line, body, INK_SOFT)
            y += step


def render_page(edition: EpaperEditionOut, page: EpaperPageOut, *, images: bool = True) -> Image:
    """Draw one page. Assumes Telugu shaping is available."""
    from PIL import Image, ImageDraw

    canvas = Image.new("RGB", (PAGE_W, PAGE_H), PAPER)
    draw = ImageDraw.Draw(canvas)
    _masthead(draw, edition, page)

    slots = page.slots
    for article in page.articles:
        if 0 <= article.slot < len(slots):
            _story(canvas, draw, slots[article.slot], article, images)

    if page.poll_id:
        # The `breaking` layout keeps its last row free for the Big Question.
        strip = SlotOut(index=-1, x=0, y=GRID_ROWS - 1, w=GRID_COLS, h=1, size="brief")
        x0, y0, x1, y1 = slot_box(strip)
        draw.rounded_rectangle([x0, y0, x1, y1], radius=18, fill=BRAND)
        label = "బిగ్ క్వశ్చన్ · ఈరోజు పోల్‌లో ఓటు వేయండి"
        _text(draw, (x0 + PAD, y0 + (y1 - y0) // 2 - 22), label, _font("bold", 30), PAPER)

    footer = f"{page.page_number} / {edition.page_count}"
    foot_font = _font_for(footer, "regular", 22)
    foot_w = draw.textlength(footer, font=foot_font, language="te")
    _text(draw, (PAGE_W - MARGIN - foot_w, PAGE_H - MARGIN - 28), footer, foot_font, MUTED)
    return canvas


def render_edition(edition: EpaperEditionOut, *, images: bool = True) -> bytes:
    """Every page, in order, as one PDF."""
    pages = [render_page(edition, page, images=images) for page in edition.pages]
    if not pages:
        raise ValueError("edition has no pages")
    out = io.BytesIO()
    pages[0].save(out, format="PDF", save_all=True, append_images=pages[1:], resolution=150.0)
    return out.getvalue()
