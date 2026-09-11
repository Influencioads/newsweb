"""Storage provider factory.

`get_storage()` is the only way feature code obtains a provider, so switching
origin is a `STORAGE_PROVIDER` change and nothing more.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.integrations.storage.base import PresignedUpload, StorageProvider, StoredObject
from app.integrations.storage.bunny import BunnyStorage
from app.integrations.storage.local import LocalStorage
from app.integrations.storage.s3 import S3Storage

__all__ = [
    "BunnyStorage",
    "LocalStorage",
    "PresignedUpload",
    "S3Storage",
    "StorageProvider",
    "StoredObject",
    "get_private_storage",
    "get_storage",
]


@lru_cache
def get_storage(provider: str | None = None) -> StorageProvider:
    name = (provider or settings.STORAGE_PROVIDER).lower()
    match name:
        case "local":
            return LocalStorage()
        case "zata" | "s3":
            return S3Storage(provider_key=name)
        case "bunny":
            return BunnyStorage()
        case _:
            raise ValueError(f"Unknown STORAGE_PROVIDER '{name}'")


@lru_cache
def get_private_storage() -> StorageProvider:
    """Storage for objects that must never have a public URL.

    Identity documents live here. Three things make this a separate accessor
    rather than a second call to `get_storage`:

      * `get_storage` is `lru_cache`d on a provider *name*, so it cannot return
        two differently-configured instances of the same provider;
      * `S3Storage.url_for` returns a **Bunny CDN URL** whenever `cdn_url` is
        set, which would put a passport scan one guess away from public. This
        builds with `cdn_url=""` so that cannot happen;
      * the bucket itself is separate, so a misconfigured public-read policy on
        the media bucket cannot expose these.

    In development it falls back to a `private/` directory that the `/media`
    StaticFiles mount in `app/main.py` does not serve.
    """
    endpoint = (settings.KYC_STORAGE_ENDPOINT or settings.ZATA_ENDPOINT or "").strip()
    bucket = (settings.KYC_STORAGE_BUCKET or "").strip()
    if bucket and endpoint:
        return S3Storage(
            endpoint=endpoint,
            bucket=bucket,
            access_key=settings.KYC_STORAGE_ACCESS_KEY or settings.ZATA_ACCESS_KEY,
            secret_key=settings.KYC_STORAGE_SECRET_KEY or settings.ZATA_SECRET_KEY,
            # Blank on purpose: see above.
            cdn_url="",
            provider_key="kyc",
        )
    # A SIBLING of the storage directory, never a child of it. `app/main.py`
    # mounts STORAGE_LOCAL_PATH at /media with StaticFiles, so anything beneath
    # it is served to the whole internet — putting a "private" folder in there
    # would publish exactly what this function exists to protect.
    public_root = Path(settings.STORAGE_LOCAL_PATH).resolve()
    return LocalStorage(
        root=str(public_root.parent / f"{public_root.name}-private"),
        # Not a real URL. Nothing should call `url_for` on this provider, and
        # if something does, the result must not be fetchable.
        public_url="private://",
    )
