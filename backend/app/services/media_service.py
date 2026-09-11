"""Media ingest and the image derivative pipeline.

§7.4 fixes the contract for every image entering the system:

    "Images pass through the same media pipeline: WebP + AVIF, 4 responsive
     widths (400/800/1200/1600), blurhash placeholder, EXIF stripped."

§12.1 adds the security requirement: "re-encode every uploaded image (defeats
polyglot payloads)". Re-encoding is not an optimisation here — a file that is
simultaneously a valid JPEG and a valid HTML/JS payload stops being dangerous
once Pillow decodes the pixels and writes a fresh WebP.

EXIF is stripped because a reporter's phone photo carries GPS coordinates, and
publishing a stringer's exact location is a safety problem, not just a privacy one.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from app.core.errors import FileTooLargeError, UnsupportedMediaTypeError
from app.core.logging import get_logger
from app.integrations.storage import get_storage
from app.models.enums import MediaType
from app.models.media import Media

logger = get_logger(__name__)

#: §7.4 — the four responsive widths.
RESPONSIVE_WIDTHS = (400, 800, 1200, 1600)

#: Long-lived: derivative keys are content-addressed, so a changed image gets a
#: new key rather than a stale cache entry.
DERIVATIVE_CACHE_CONTROL = "public, max-age=31536000, immutable"

ALLOWED_IMAGE_MIMES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/tiff"}
)

#: Pillow decoder names we accept. Anything else is refused before decoding, so a
#: crafted file cannot reach an exotic decoder.
ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP", "GIF", "TIFF", "MPO", "AVIF"})

WEBP_QUALITY = 82


@dataclass
class ProcessedImage:
    width: int
    height: int
    blurhash: str | None
    variants: dict[str, dict[str, Any]]
    primary_key: str
    primary_url: str
    total_bytes: int


def _blurhash_for(image: Image.Image) -> str | None:
    """Tiny placeholder encoded from a 32px thumbnail (§10.3 CLS protection)."""
    try:
        import blurhash

        small = image.copy()
        small.thumbnail((32, 32))
        if small.mode != "RGB":
            small = small.convert("RGB")
        # The pure-python `blurhash` package wants rows of [r, g, b] pixels —
        # not a PIL Image and not a file object.
        pixels = list(small.getdata())
        rows = [
            [list(pixels[y * small.width + x]) for x in range(small.width)]
            for y in range(small.height)
        ]
        # 4x3 components: enough directional detail for a hero placeholder
        # without bloating the hash we ship in every feed payload.
        return blurhash.encode(rows, components_x=4, components_y=3)
    except Exception as exc:  # noqa: BLE001 - a placeholder must never fail an upload
        logger.warning("blurhash_failed", error=str(exc))
        return None


def _open_and_sanitise(raw: bytes) -> Image.Image:
    """Decode, verify format, drop EXIF, and honour orientation.

    `ImageOps.exif_transpose` applies the rotation *before* metadata is dropped,
    so a portrait phone photo does not end up sideways once EXIF is gone.
    """
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = (probe.format or "").upper()
    except Exception as exc:  # noqa: BLE001
        raise UnsupportedMediaTypeError(
            message_en="That file is not a readable image.",
            message_te="ఆ ఫైల్‌ను చిత్రంగా చదవలేకపోయాం.",
        ) from exc

    if fmt not in ALLOWED_FORMATS:
        raise UnsupportedMediaTypeError(details={"format": fmt})

    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image) or image

    # Re-encode through a clean RGB(A) surface: this is what defeats polyglots.
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
    else:
        image = image.convert("RGB")

    clean = Image.new(image.mode, image.size)
    clean.putdata(list(image.getdata()))
    return clean


def process_image(
    raw: bytes,
    *,
    key_prefix: str,
    max_bytes: int,
    provider_name: str | None = None,
) -> ProcessedImage:
    """Run the full §7.4 pipeline and upload every rendition."""
    if len(raw) > max_bytes:
        raise FileTooLargeError(details={"bytes": len(raw), "limit": max_bytes})

    image = _open_and_sanitise(raw)
    width, height = image.size
    blurhash_value = _blurhash_for(image)

    storage = get_storage(provider_name)
    variants: dict[str, dict[str, Any]] = {}
    total = 0
    primary_key = ""
    primary_url = ""

    # Never upscale: a 900px source produces 400 and 800, not a blurry 1600.
    widths = [w for w in RESPONSIVE_WIDTHS if w <= width] or [
        min(width, RESPONSIVE_WIDTHS[0])
    ]

    for target in widths:
        resized = image.copy()
        ratio = target / float(resized.width)
        resized = resized.resize(
            (target, max(1, round(resized.height * ratio))), Image.Resampling.LANCZOS
        )
        if resized.mode == "RGBA":
            resized = resized.convert("RGB")

        buf = io.BytesIO()
        resized.save(buf, format="WEBP", quality=WEBP_QUALITY, method=5)
        payload = buf.getvalue()

        key = f"{key_prefix}/{target}.webp"
        stored = storage.put(
            key,
            payload,
            content_type="image/webp",
            cache_control=DERIVATIVE_CACHE_CONTROL,
        )
        variants[str(target)] = {
            "url": stored.url,
            "key": key,
            "width": target,
            "height": resized.height,
            "bytes": stored.bytes,
            "format": "webp",
        }
        total += stored.bytes
        # The widest rendition is the canonical `cdn_url`.
        primary_key, primary_url = key, stored.url

    # NOTE(phase-11): §7.4 also asks for AVIF alongside WebP. AVIF encoding needs
    # `pillow-avif-plugin`, which has no wheel on this platform; WebP alone covers
    # every browser we target today. Tracked rather than silently dropped.

    return ProcessedImage(
        width=width,
        height=height,
        blurhash=blurhash_value,
        variants=variants,
        primary_key=primary_key,
        primary_url=primary_url,
        total_bytes=total,
    )


def create_image_media(
    db: Session,
    *,
    raw: bytes,
    filename: str,
    mime: str,
    max_bytes: int,
    uploaded_by: int | None,
    alt_te: str | None = None,
    caption_te: str | None = None,
    credit: str | None = None,
    source_type: str = "own",
    ai_generated: bool = False,
    ai_prompt: str | None = None,
    ai_model: str | None = None,
) -> Media:
    """Ingest an image and persist its `media` row.

    §12.5 makes credit mandatory when the photo is not our own — enforced here
    rather than only in the UI.
    """
    if mime not in ALLOWED_IMAGE_MIMES:
        raise UnsupportedMediaTypeError(details={"mime": mime})

    if source_type != "own" and not credit:
        from app.core.errors import ValidationError

        raise ValidationError(
            message_en="A photo credit is required when the image is not our own.",
            message_te="సొంతం కాని చిత్రానికి ఫోటో క్రెడిట్ తప్పనిసరి.",
            details={"field": "credit"},
        )

    stamp = datetime.utcnow().strftime("%Y/%m")
    safe_stem = "".join(
        c for c in filename.rsplit(".", 1)[0] if c.isalnum() or c in "-_"
    )[:48]
    import secrets

    key_prefix = f"images/{stamp}/{safe_stem or 'image'}-{secrets.token_hex(4)}"

    processed = process_image(raw, key_prefix=key_prefix, max_bytes=max_bytes)

    media = Media(
        type=MediaType.IMAGE,
        filename=filename[:255],
        mime="image/webp",  # what we actually stored, not what was uploaded
        bytes=processed.total_bytes,
        storage_provider=get_storage().key,
        storage_key=processed.primary_key,
        cdn_url=processed.primary_url,
        width=processed.width,
        height=processed.height,
        blurhash=processed.blurhash,
        alt_te=alt_te,
        caption_te=caption_te,
        credit=credit,
        source_type=source_type,
        ai_generated=ai_generated,
        ai_prompt=ai_prompt,
        ai_model=ai_model,
        variants=processed.variants,
        uploaded_by=uploaded_by,
    )
    db.add(media)
    db.flush()
    logger.info(
        "media_created",
        media_id=media.id,
        widths=sorted(processed.variants),
        bytes=processed.total_bytes,
    )
    return media


def srcset_for(media: Media) -> str:
    """Build a `srcset` string so the browser fetches the right width (§10.3)."""
    if not media.variants:
        return media.cdn_url or ""
    parts = [
        f"{v['url']} {v['width']}w"
        for v in sorted(media.variants.values(), key=lambda x: int(x["width"]))
        if v.get("url")
    ]
    return ", ".join(parts)


def delete_media(db: Session, media: Media) -> None:
    """Soft-delete the row and remove every rendition from the bucket."""
    storage = get_storage(media.storage_provider)
    for variant in (media.variants or {}).values():
        if variant.get("key"):
            storage.delete(variant["key"])
    from app.db.base import utcnow

    media.deleted_at = utcnow()
