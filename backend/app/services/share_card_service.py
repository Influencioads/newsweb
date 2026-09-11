"""The WhatsApp share card: a 1200×630 PNG of the headline.

**Why 1200×630 and not a square.** WhatsApp, Facebook, X, Telegram and Slack
all read `og:image` and lay it out at 1.91:1. A 1080×1080 card gets
centre-cropped or letterboxed in a link preview, losing exactly the headline it
exists to show. WhatsApp link sharing is this product's primary distribution
channel, so the link-preview shape wins. (A square "download for Status"
variant is a different feature and can come later.)

**The Telugu shaping problem, stated plainly.** Pillow only performs complex
text layout — the conjunct formation and mark positioning Telugu requires —
when it was built against Raqm (HarfBuzz + FriBiDi). A plain `draw.text` call
on a Raqm-less build still *succeeds*, producing a valid PNG full of unshaped,
wrongly-ordered glyphs that a Telugu reader cannot read, with nothing raised
anywhere.

Two things stop that shipping. `available()` checks for Raqm and declines the
job; and every draw call here passes `language="te"`, which Pillow refuses
outright without libraqm ("setting text direction, language or font features
is not supported without libraqm"). The second is deliberate belt-and-braces:
it converts the silent-corruption failure into a loud one, so a future edit
that bypasses `available()` breaks visibly instead of quietly.

Declining means the reader falls back to sharing text and a link, which is what
happened before this feature existed. `ensure_card` therefore returns None
rather than raising — an unavailable card is a normal state, not an error.

**A second font trap.** Noto Sans Telugu contains Telugu and digits but no
Latin letters, so a masthead, a domain or an English month name drawn with it
becomes a row of .notdef boxes. Pillow does no font fallback, so mixed-script
text is split into runs and each run picks its own face via `_font_for`.

**Caching is the bucket.** The key is derived from exactly what is drawn, so
the stored object *is* the cache — no database column, no table, no
invalidation logic. An edited headline changes the digest and therefore the
key; bumping `CARD_VERSION` re-renders everything. Orphans are ~120 KB and are
not worth a sweeper.
"""

from __future__ import annotations

import hashlib
import io
from functools import lru_cache

import httpx

from app.core.config import settings
from app.core.fonts import (
    FontMissingError,
    font_path_for,
    telugu_font_path,
    telugu_shaping_available,
)
from app.core.logging import get_logger
from app.integrations.storage import get_storage
from app.models.content import Article
from app.services import settings_service

logger = get_logger(__name__)

CARD_W, CARD_H = 1200, 630

#: Bump to re-render every card. Cheaper than a migration and the old objects
#: simply stop being referenced.
CARD_VERSION = 1

CACHE_CONTROL = "public, max-age=31536000, immutable"

#: Brand tokens from docs/IMPLEMENTATION_MAP.md §A.
BRAND = (166, 28, 36)
INK = (26, 23, 20)
PAPER = (250, 247, 242)
MUTED = (138, 127, 112)

_HERO_H = 340
_PAD = 56


def available(db) -> bool:
    """Whether a card can be produced correctly on this host.

    Three separate things, all required: the admin has not switched cards off,
    a Telugu-capable font exists, and Pillow can shape Telugu. The third is the
    one that silently fails everywhere else.
    """
    if not settings_service.get_bool(db, "share_card.enabled"):
        return False
    try:
        telugu_font_path("bold")
    except FontMissingError:
        return False
    if not telugu_shaping_available():
        logger.warning("share_card_unavailable_no_raqm")
        return False
    return True


def card_hash(article: Article, hero_url: str | None) -> str:
    """A digest of exactly what is drawn — nothing more, nothing less.

    Anything included here that is not on the card would re-render for no
    visible change; anything drawn but omitted would serve a stale image.
    """
    parts = [
        str(CARD_VERSION),
        article.title_te or "",
        article.category.slug if article.category else "",
        article.byline_te or "",
        hero_url or "",
        article.published_at.date().isoformat() if article.published_at else "",
    ]
    return hashlib.sha256(chr(31).join(parts).encode("utf-8")).hexdigest()


def storage_key(article: Article, digest: str) -> str:
    return f"share-cards/{article.short_id}/{digest[:16]}.png"


def _hero_url(article: Article) -> str | None:
    media = getattr(article, "hero_media", None)
    if media is None:
        return None
    return getattr(media, "cdn_url", None) or getattr(media, "url", None)


@lru_cache(maxsize=8)
def _font(weight: str, size: int):
    from PIL import ImageFont

    return ImageFont.truetype(str(telugu_font_path(weight)), size)


@lru_cache(maxsize=16)
def _font_for(text: str, weight: str, size: int):
    """A face that can actually draw this string.

    Noto Sans Telugu has Telugu and digits but no Latin letters, so a masthead
    or a domain name drawn with it comes out as .notdef boxes — a valid PNG
    that looks like a bug. Pillow does no font fallback, so each run of text
    picks its own face here.
    """
    from PIL import ImageFont

    return ImageFont.truetype(str(font_path_for(text, weight)), size)


def _wrap(draw, text: str, font, max_width: int, max_lines: int) -> list[str]:
    """Greedy wrap on word boundaries, measured with the real font."""
    words = (text or "").split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font, language="te") <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) == max_lines and words:
        # Mark the truncation rather than ending mid-thought.
        joined = " ".join(lines)
        if len(joined.split()) < len(words):
            lines[-1] = lines[-1].rstrip() + "…"
    return lines


def _fetch_hero(url: str):
    from PIL import Image

    try:
        response = httpx.get(url, timeout=8.0, follow_redirects=True)
        response.raise_for_status()
        return Image.open(io.BytesIO(response.content)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 — a missing photo is not a failure
        logger.info("share_card_hero_failed", url=url[:120], error=str(exc)[:120])
        return None


def render(article: Article, hero_url: str | None) -> bytes:
    """Draw the card. Assumes `available()` has already returned True."""
    from PIL import Image, ImageDraw

    canvas = Image.new("RGB", (CARD_W, CARD_H), PAPER)
    draw = ImageDraw.Draw(canvas)

    hero = _fetch_hero(hero_url) if hero_url else None
    if hero is not None:
        # Cover-crop into the top band, keeping the centre.
        ratio = max(CARD_W / hero.width, _HERO_H / hero.height)
        resized = hero.resize(
            (max(1, int(hero.width * ratio)), max(1, int(hero.height * ratio))),
            Image.Resampling.LANCZOS,
        )
        left = max(0, (resized.width - CARD_W) // 2)
        top = max(0, (resized.height - _HERO_H) // 2)
        canvas.paste(resized.crop((left, top, left + CARD_W, top + _HERO_H)), (0, 0))

        # A bottom-up scrim, so a bright photo cannot swallow the headline.
        scrim = Image.new("RGBA", (CARD_W, _HERO_H), (0, 0, 0, 0))
        scrim_draw = ImageDraw.Draw(scrim)
        for y in range(_HERO_H):
            alpha = int(115 * (y / _HERO_H) ** 2)
            scrim_draw.line([(0, y), (CARD_W, y)], fill=(0, 0, 0, alpha))
        canvas.paste(scrim, (0, 0), scrim)
    else:
        draw.rectangle([0, 0, CARD_W, _HERO_H], fill=BRAND)

    # Brand bar
    name = settings.APP_NAME[:28]
    draw.text((_PAD, 34), name, font=_font_for(name, "bold", 30), fill=PAPER, language="te")
    if article.category is not None:
        label = (article.category.name_te or article.category.slug)[:22]
        chip = _font_for(label, "bold", 20)
        width = draw.textlength(label, font=chip, language="te")
        draw.rounded_rectangle(
            [CARD_W - _PAD - width - 28, 32, CARD_W - _PAD, 74], radius=21, fill=BRAND
        )
        draw.text(
            (CARD_W - _PAD - width - 14, 42), label, font=chip, fill=PAPER, language="te"
        )

    # Headline, shrink-to-fit
    title = article.title_te or ""
    max_width = CARD_W - 2 * _PAD
    lines: list[str] = []
    size = 58
    while size >= 40:
        font = _font("bold", size)
        lines = _wrap(draw, title, font, max_width, max_lines=4)
        if len(lines) <= 4:
            break
        size -= 4
    font = _font("bold", size)
    # 1.45x here rather than the 1.65x body rule: this is display type at a
    # fixed size we control, and the wrapper guarantees no clipping.
    line_height = int(size * 1.45)
    y = _HERO_H + 40
    for line in lines:
        draw.text((_PAD, y), line, font=font, fill=INK, language="te")
        y += line_height

    # Footer. Drawn as separate runs because the byline is Telugu and the date
    # and domain are Latin — one draw call cannot cover both faces.
    draw.line(
        [(_PAD, CARD_H - 78), (CARD_W - _PAD, CARD_H - 78)], fill=(229, 223, 214), width=2
    )
    runs: list[str] = []
    if article.byline_te:
        runs.append(article.byline_te[:40])
    if article.published_at:
        # A numeric date rather than "11 Sep 2026": digits exist in both faces,
        # so this run never has to switch mid-string.
        runs.append(article.published_at.strftime("%d-%m-%Y"))
    domain = _domain()
    if domain:
        runs.append(domain)

    x: float = _PAD
    for index, run in enumerate(runs):
        if index:
            sep_font = _font_for("·", "regular", 22)
            draw.text((x, CARD_H - 58), "  ·  ", font=sep_font, fill=MUTED)
            x += draw.textlength("  ·  ", font=sep_font)
        run_font = _font_for(run, "regular", 22)
        draw.text((x, CARD_H - 58), run, font=run_font, fill=MUTED, language="te")
        x += draw.textlength(run, font=run_font, language="te")

    out = io.BytesIO()
    canvas.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _domain() -> str:
    from urllib.parse import urlparse

    return (urlparse(settings.APP_URL).netloc or "").replace("www.", "")


def ensure_card(db, article: Article) -> str | None:
    """The card's public URL, rendering it on a miss. Never raises."""
    if not available(db):
        return None
    try:
        hero_url = _hero_url(article)
        digest = card_hash(article, hero_url)
        key = storage_key(article, digest)
        storage = get_storage()

        # A hit costs one HEAD. The key is content-addressed, so an existing
        # object is by definition the current card.
        try:
            if storage.exists(key):
                return storage.url_for(key)
        except Exception:  # noqa: BLE001 — a storage hiccup means re-render
            pass

        stored = storage.put(
            key, render(article, hero_url), content_type="image/png",
            cache_control=CACHE_CONTROL,
        )
        logger.info("share_card_rendered", short_id=article.short_id, key=key)
        return stored.url
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "share_card_failed", short_id=article.short_id, error=str(exc)[:200]
        )
        return None
