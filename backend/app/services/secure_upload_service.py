"""Accepting a file that is not a news photograph.

`media_service.create_image_media` exists for the public pipeline: it accepts
images, re-encodes everything to WebP, and hands back a CDN URL. All three of
those are wrong for an identity document — a bonafide certificate is often a
PDF, and nothing here should ever have a public URL.

So this is a separate, deliberately small path:

  * **Magic bytes decide the type.** A declared `Content-Type` is a hint from
    whoever is uploading, not a fact about the bytes.
  * **Images are decoded and re-encoded**, which normalises the format and —
    more to the point here than in the news pipeline — strips the GPS EXIF off
    a phone photograph of somebody's ID.
  * **PDFs are accepted on magic bytes and the absence of active content**, and
    are never parsed. We do not need to read them; a reviewer does.
  * The result goes to the **private** bucket with `no-store`, under a key
    derived from its own hash.
"""

from __future__ import annotations

import hashlib
import io

from app.core.errors import ValidationError
from app.core.logging import get_logger
from app.integrations.storage import get_private_storage

logger = get_logger(__name__)

ALLOWED_DOC_MIMES = frozenset(
    {"image/jpeg", "image/png", "image/webp", "application/pdf"}
)
MAX_DOC_BYTES = 8 * 1024 * 1024

_PDF_MAGIC = b"%PDF-"

#: A PDF containing any of these can act when opened. A reviewer opening an
#: applicant's document should not be executing the applicant's JavaScript.
_PDF_DANGEROUS = (
    b"/JavaScript",
    b"/JS",
    b"/OpenAction",
    b"/AA",
    b"/Launch",
    b"/EmbeddedFile",
)

_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
)


def sniff(raw: bytes, declared_mime: str | None = None) -> str:
    """The real content type, from the bytes.

    `declared_mime` is used only to disambiguate WebP, whose signature needs
    two separate checks, and is otherwise ignored.
    """
    for signature, mime in _MAGIC:
        if raw.startswith(signature):
            return mime
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    raise ValidationError(
        message_en="That file type is not accepted. Use a JPEG, PNG or PDF.",
        message_te="ఈ ఫైల్ రకం అంగీకరించబడదు. JPEG, PNG లేదా PDF వాడండి.",
        details={"file": f"unrecognised content (declared {declared_mime})"},
    )


def _sanitise_image(raw: bytes, mime: str) -> tuple[bytes, str]:
    """Decode and re-encode, dropping every metadata block.

    A phone photo of an ID card carries the GPS coordinates of wherever it was
    taken — usually the applicant's home. Keeping that alongside their identity
    document would be collecting something nobody asked for.
    """
    from PIL import Image

    with Image.open(io.BytesIO(raw)) as image:
        image.load()
        clean = Image.new(image.mode, image.size)
        clean.putdata(list(image.getdata()))
        out = io.BytesIO()
        if mime == "image/png":
            clean.save(out, format="PNG", optimize=True)
            return out.getvalue(), "image/png"
        clean.convert("RGB").save(out, format="JPEG", quality=88, optimize=True)
        return out.getvalue(), "image/jpeg"


def _check_pdf(raw: bytes) -> None:
    if not raw.startswith(_PDF_MAGIC):
        raise ValidationError(details={"file": "not a valid PDF"})
    for token in _PDF_DANGEROUS:
        if token in raw:
            raise ValidationError(
                message_en="That PDF contains active content and was not accepted.",
                message_te="ఈ PDFలో యాక్టివ్ కంటెంట్ ఉంది, అంగీకరించలేదు.",
                details={"file": f"contains {token.decode()}"},
            )


def store_private(
    raw: bytes, *, key_prefix: str, declared_mime: str | None = None
) -> tuple[str, int, str, str]:
    """Sanitise and store one document.

    Returns `(storage_key, bytes, sha256, mime)`. The key ends in the content
    hash, which makes it unguessable without also being a secret we have to
    store separately.
    """
    if not raw:
        raise ValidationError(details={"file": "empty upload"})
    if len(raw) > MAX_DOC_BYTES:
        raise ValidationError(
            message_en=f"Files must be under {MAX_DOC_BYTES // (1024 * 1024)} MB.",
            message_te=f"ఫైల్ {MAX_DOC_BYTES // (1024 * 1024)} MB కంటే తక్కువ ఉండాలి.",
            details={"file": "too large"},
        )

    mime = sniff(raw, declared_mime)
    if mime not in ALLOWED_DOC_MIMES:
        raise ValidationError(details={"file": f"{mime} is not accepted"})

    if mime == "application/pdf":
        _check_pdf(raw)
        payload, final_mime = raw, mime
        extension = "pdf"
    else:
        payload, final_mime = _sanitise_image(raw, mime)
        extension = "png" if final_mime == "image/png" else "jpg"

    digest = hashlib.sha256(payload).hexdigest()
    key = f"{key_prefix.rstrip('/')}/{digest[:32]}.{extension}"
    get_private_storage().put(
        key,
        payload,
        content_type=final_mime,
        # Never cached anywhere. Not by a CDN, not by a browser, not by a proxy.
        cache_control="private, no-store",
    )
    logger.info("private_document_stored", key=key, bytes=len(payload), mime=final_mime)
    return key, len(payload), digest, final_mime


def read_private(key: str) -> bytes:
    """Fetch a stored document. Callers must have checked permission first."""
    return get_private_storage().read(key)


def mask_number(value: str | None) -> str | None:
    """What a reviewer sees without opening anything: the last four digits.

    The full value is encrypted separately and only decrypted for a vendor
    submission. A reviewer comparing "XXXXXX1234" against the document in front
    of them does not need the rest.
    """
    cleaned = "".join(ch for ch in (value or "") if ch.isalnum())
    if len(cleaned) < 4:
        return None
    return "X" * max(4, len(cleaned) - 4) + cleaned[-4:]
