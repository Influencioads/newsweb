"""Development demo imagery.

These are **generated** abstract editorial graphics, not photographs. That is a
deliberate choice: seeding a newsroom database with third-party press photos
would put unlicensed images into the product, and §12.5 is explicit that photos
need credit and licensing. Generated art carries neither problem and still
exercises the real pipeline end to end — the bytes go through
`media_service.process_image`, get re-encoded, resized to the four §7.4 widths,
blurhashed, and uploaded through the configured `StorageProvider`.

Replace these the moment the client supplies real photography; nothing in the
application knows or cares that these were generated.
"""

from __future__ import annotations

import io
import random

from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.models.content import Article
from app.models.media import ArticleMedia, Media
from app.services import media_service, tiptap

logger = get_logger("seed.media")

#: Palettes keyed by category slug, drawn from the approved mockup's own tokens
#: so generated art sits inside the brand rather than fighting it.
PALETTES: dict[str, tuple[tuple[int, int, int], ...]] = {
    "andhra-pradesh": ((166, 28, 36), (198, 17, 31), (232, 200, 180), (250, 247, 242)),
    "telangana": ((30, 102, 200), (46, 125, 79), (206, 222, 240), (250, 247, 242)),
    "national": ((26, 23, 20), (166, 28, 36), (216, 210, 200), (250, 247, 242)),
    "business": ((46, 125, 79), (30, 102, 200), (208, 226, 212), (250, 247, 242)),
    "sports": ((185, 138, 46), (46, 125, 79), (240, 226, 190), (250, 247, 242)),
    "cinema": ((109, 79, 196), (166, 28, 36), (222, 210, 242), (250, 247, 242)),
    "default": ((107, 99, 90), (166, 28, 36), (233, 226, 214), (250, 247, 242)),
}

WIDTH, HEIGHT = 1600, 900


def _lerp(
    a: tuple[int, int, int], b: tuple[int, int, int], t: float
) -> tuple[int, int, int]:
    return tuple(round(a[c] + (b[c] - a[c]) * t) for c in range(3))  # type: ignore[return-value]


def _generate_image(seed: str, palette: tuple[tuple[int, int, int], ...]) -> bytes:
    """Deterministic abstract composition — same article always gets the same art.

    Kept legible on purpose: heavy blur turns every image into one flat colour,
    which is no more useful to a reader than an empty grey box. The shapes stay
    crisp enough to read as artwork at thumbnail size.
    """
    rng = random.Random(seed)
    base, accent, mid, paper = palette

    img = Image.new("RGB", (WIDTH, HEIGHT), paper)
    draw = ImageDraw.Draw(img, "RGBA")

    # --- ground: a two-stop vertical gradient, dark at the top ---------------
    top = _lerp(base, (0, 0, 0), 0.15)
    bottom = _lerp(mid, paper, 0.25)
    for y in range(HEIGHT):
        draw.line([(0, y), (WIDTH, y)], fill=_lerp(top, bottom, y / HEIGHT))

    # --- horizon band: gives every frame a landscape-like structure ----------
    horizon = rng.randint(int(HEIGHT * 0.45), int(HEIGHT * 0.68))
    draw.rectangle([0, horizon, WIDTH, HEIGHT], fill=(*_lerp(mid, paper, 0.35), 235))

    # --- silhouette skyline / terrain along the horizon ---------------------
    step = WIDTH // rng.randint(7, 12)
    x = -step
    silhouette = _lerp(base, (0, 0, 0), 0.25)
    while x < WIDTH + step:
        w = rng.randint(int(step * 0.5), int(step * 1.3))
        h = rng.randint(int(HEIGHT * 0.06), int(HEIGHT * 0.26))
        draw.rectangle([x, horizon - h, x + w, horizon + 2], fill=(*silhouette, 205))
        x += w + rng.randint(4, int(step * 0.35))

    # --- sun/moon disc, placed off-centre ------------------------------------
    disc_r = rng.randint(70, 130)
    disc_x = rng.randint(int(WIDTH * 0.15), int(WIDTH * 0.85))
    disc_y = rng.randint(int(horizon * 0.28), int(horizon * 0.66))
    draw.ellipse(
        [disc_x - disc_r, disc_y - disc_r, disc_x + disc_r, disc_y + disc_r],
        fill=(*_lerp(accent, paper, 0.35), 230),
    )

    # --- diagonal light shafts for depth -------------------------------------
    for _ in range(rng.randint(2, 4)):
        sx = rng.randint(-300, WIDTH)
        w = rng.randint(70, 190)
        skew = rng.randint(150, 420)
        draw.polygon(
            [(sx, 0), (sx + w, 0), (sx + w + skew, horizon), (sx + skew, horizon)],
            fill=(255, 255, 255, rng.randint(14, 30)),
        )

    # --- foreground colour blocks along the base -----------------------------
    for _ in range(rng.randint(3, 5)):
        bw = rng.randint(120, 340)
        bx = rng.randint(-80, WIDTH - 40)
        bh = rng.randint(30, 110)
        draw.rectangle(
            [bx, HEIGHT - bh, bx + bw, HEIGHT],
            fill=(*rng.choice((accent, base, mid)), rng.randint(70, 140)),
        )

    # A whisper of blur only — enough to soften edges, not erase them.
    img = img.filter(ImageFilter.GaussianBlur(radius=1.4))

    # Fine grain so the result reads as artwork rather than a flat CSS gradient.
    grain = Image.new("L", (WIDTH // 3, HEIGHT // 3))
    grain.putdata([rng.randint(108, 148) for _ in range(grain.width * grain.height)])
    grain = grain.resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)
    img = Image.blend(img, Image.merge("RGB", (grain, grain, grain)), 0.07)

    # Brand rule along the bottom edge, echoing the masthead.
    ImageDraw.Draw(img).rectangle([0, HEIGHT - 12, WIDTH, HEIGHT], fill=accent)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def seed_article_images(db: Session, *, force: bool = False) -> int:
    """Give every published demo article a hero image.

    Idempotent: an article that already has `hero_media_id` is skipped unless
    `force` is set.
    """
    if settings.is_production:
        raise RuntimeError("Refusing to write demo imagery in production (brief §40)")

    articles = list(
        db.execute(
            select(Article).where(Article.deleted_at.is_(None)).order_by(Article.id)
        ).scalars()
    )

    created = 0
    for article in articles:
        if article.hero_media_id and not force:
            continue

        slug = article.category.slug if article.category else "default"
        palette = PALETTES.get(slug, PALETTES["default"])
        raw = _generate_image(article.short_id, palette)

        media = media_service.create_image_media(
            db,
            raw=raw,
            filename=f"{article.slug[:40] or 'hero'}.png",
            mime="image/png",
            max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
            uploaded_by=article.created_by,
            # Alt text is the headline: a screen-reader user gets the same
            # information a sighted reader gets from the image slot.
            alt_te=article.title_te[:400],
            caption_te=article.sub_title_te or article.summary_te,
            credit="టాప్ తెలుగు న్యూస్ · ప్రాతినిధ్య చిత్రం",
            source_type="own",
        )

        article.hero_media_id = media.id
        db.add(
            ArticleMedia(article_id=article.id, media_id=media.id, role="hero", sort=0)
        )
        created += 1

    db.flush()
    logger.info("seeded_article_images", created=created, total=len(articles))
    return created


def clear_demo_media(db: Session) -> int:
    """Remove generated imagery — used when real photography replaces it."""
    media_rows = list(
        db.execute(
            select(Media).where(Media.credit.like("టాప్ తెలుగు న్యూస్ · ప్రాతినిధ్య%"))
        ).scalars()
    )
    for media in media_rows:
        media_service.delete_media(db, media)
    return len(media_rows)


# --------------------------------------------------------------------------- #
# Inline body imagery and per-article galleries
# --------------------------------------------------------------------------- #
#: Caption lines for the secondary imagery, keyed by category. Written as
#: representative-image captions because that is what they are — no generated
#: picture is presented as documentary evidence of an event (§7.4).
INLINE_CAPTIONS: dict[str, tuple[str, ...]] = {
    "andhra-pradesh": (
        "ప్రాజెక్టు ప్రాంతంలో కొనసాగుతున్న పనులు",
        "అధికారుల క్షేత్రస్థాయి పరిశీలన",
        "నిర్మాణ ప్రాంతం దృశ్యం",
    ),
    "telangana": (
        "నగరంలో కొనసాగుతున్న అభివృద్ధి పనులు",
        "సమీక్షా సమావేశం అనంతరం",
        "ప్రతిపాదిత మార్గం పరిశీలన",
    ),
    "national": (
        "ఢిల్లీలో జరిగిన సమావేశం",
        "ప్రకటన వెలువడిన సందర్భం",
        "అధికారిక కార్యక్రమం",
    ),
    "business": (
        "పారిశ్రామిక ప్రాంతం దృశ్యం",
        "ఉత్పత్తి కేంద్రం పరిశీలన",
        "మార్కెట్ కార్యకలాపాలు",
    ),
    "sports": ("శిక్షణా శిబిరం", "క్రీడాకారుల సన్నాహాలు", "మైదానం దృశ్యం"),
    "cinema": ("చిత్రీకరణ ప్రాంతం", "కార్యక్రమం సందర్భంగా", "విడుదల సన్నాహాలు"),
    "default": ("సంబంధిత దృశ్యం", "ప్రాంత పరిశీలన", "కార్యక్రమ దృశ్యం"),
}

DEMO_CREDIT = "టాప్ తెలుగు న్యూస్ · ప్రాతినిధ్య చిత్రం"


def _make_media(db: Session, article: Article, variant: str, caption: str) -> Media:
    """Generate one supporting image for an article."""
    slug = article.category.slug if article.category else "default"
    palette = PALETTES.get(slug, PALETTES["default"])
    # Vary the seed per variant so the images differ from the hero and each other.
    raw = _generate_image(f"{article.short_id}:{variant}", palette)
    return media_service.create_image_media(
        db,
        raw=raw,
        filename=f"{(article.slug[:34] or 'image')}-{variant}.png",
        mime="image/png",
        max_bytes=settings.UPLOAD_IMAGE_MAX_BYTES,
        uploaded_by=article.created_by,
        alt_te=caption,
        caption_te=caption,
        credit=DEMO_CREDIT,
        source_type="own",
    )


def _figure_node(media: Media, caption: str) -> dict:
    """A Tiptap `figure` wrapping an image and its caption.

    Written as real ProseMirror nodes rather than an HTML string, because the
    JSON document is the source of truth (§1) and the same node renders on web
    today and in the React Native app later.
    """
    return {
        "type": "figure",
        "content": [
            {
                "type": "image",
                "attrs": {
                    "src": media.cdn_url,
                    # The responsive candidates are embedded in the node so the
                    # renderer needs no media lookup — the document stays
                    # self-contained, which is what lets the same JSON render in
                    # the React Native app later (§1, §11).
                    "srcset": media_service.srcset_for(media),
                    "sizes": "(max-width: 768px) 100vw, 680px",
                    "alt": media.alt_te or caption,
                    "width": media.width,
                    "height": media.height,
                    "mediaId": media.id,
                    "blurhash": media.blurhash,
                },
            },
            {
                "type": "figcaption",
                "content": [
                    {"type": "text", "text": f"{caption} · ఫోటో: {media.credit}"}
                ],
            },
        ],
    }


def seed_inline_and_gallery_images(
    db: Session, *, gallery_size: int = 3, force: bool = False
) -> tuple[int, int]:
    """Add one inline body image and a small gallery to each article.

    Returns (inline_count, gallery_count). Idempotent unless `force`.
    """
    if settings.is_production:
        raise RuntimeError("Refusing to write demo imagery in production (brief §40)")

    articles = list(
        db.execute(
            select(Article).where(Article.deleted_at.is_(None)).order_by(Article.id)
        ).scalars()
    )

    inline_added = 0
    gallery_added = 0

    for article in articles:
        existing_roles = {
            row.role
            for row in db.execute(
                select(ArticleMedia).where(ArticleMedia.article_id == article.id)
            ).scalars()
        }
        slug = article.category.slug if article.category else "default"
        captions = INLINE_CAPTIONS.get(slug, INLINE_CAPTIONS["default"])

        # --- inline image, dropped into the body after the opening paragraph ---
        if force or "inline" not in existing_roles:
            media = _make_media(db, article, "inline", captions[0])
            db.add(
                ArticleMedia(
                    article_id=article.id, media_id=media.id, role="inline", sort=0
                )
            )

            body = dict(article.body or {"type": "doc", "content": []})
            content = [
                n for n in (body.get("content") or []) if n.get("type") != "figure"
            ]
            insert_at = 1 if len(content) > 1 else len(content)
            content.insert(insert_at, _figure_node(media, captions[0]))
            body["content"] = content

            # Derived columns must be recomputed, never hand-edited (§4.4).
            clean, plain, html, words, reading = tiptap.derive(body)
            article.body = clean
            article.body_plain = plain
            article.body_html = html
            article.word_count = words
            article.reading_time_sec = reading
            inline_added += 1

        # --- gallery ---------------------------------------------------------
        if force or "gallery" not in existing_roles:
            for i in range(gallery_size):
                caption = captions[(i + 1) % len(captions)]
                media = _make_media(db, article, f"gallery{i}", caption)
                db.add(
                    ArticleMedia(
                        article_id=article.id, media_id=media.id, role="gallery", sort=i
                    )
                )
                gallery_added += 1

    db.flush()
    logger.info(
        "seeded_inline_and_gallery",
        inline=inline_added,
        gallery=gallery_added,
        articles=len(articles),
    )
    return inline_added, gallery_added
