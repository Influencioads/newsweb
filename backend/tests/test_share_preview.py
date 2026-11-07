"""The link-preview picture is the story photo alone, at WhatsApp's 1200x630."""

from __future__ import annotations

import io

from PIL import Image

from app.services import share_card_service


def test_preview_is_the_photo_cropped_to_the_link_shape(monkeypatch) -> None:
    # A tall photo: the crop must keep its middle and fill the whole frame.
    photo = Image.new("RGB", (900, 1600), (200, 40, 40))
    photo.paste((40, 160, 40), (0, 700, 900, 900))
    monkeypatch.setattr(share_card_service, "_fetch_hero", lambda url: photo)

    data = share_card_service.render_preview("https://example.com/hero.webp")

    assert data is not None and len(data) <= share_card_service._PREVIEW_MAX_BYTES
    out = Image.open(io.BytesIO(data))
    assert out.format == "JPEG"
    assert out.size == (1200, 630)
    r, g, _b = out.getpixel((600, 315))
    assert g > r  # the green band from the middle of the photo


def test_no_photo_means_no_preview(monkeypatch) -> None:
    monkeypatch.setattr(share_card_service, "_fetch_hero", lambda url: None)
    assert share_card_service.render_preview("https://example.com/missing.webp") is None
