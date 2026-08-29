"""Storage provider factory.

`get_storage()` is the only way feature code obtains a provider, so switching
origin is a `STORAGE_PROVIDER` change and nothing more.
"""

from __future__ import annotations

from functools import lru_cache

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
