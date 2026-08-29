"""Storage provider contract.

Build Instructions §1 picks Zata.ai (S3 API) as the origin with Bunny as the
CDN-fronted mirror; the build brief §1 additionally requires that the
application is **not** tightly coupled to one provider.

So every caller talks to this interface and never to boto3, never to Bunny's
REST API, and never to the local filesystem directly. Swapping origin is a
config change (`STORAGE_PROVIDER`), not a code change.

Secrets stay on this side of the boundary: `presign_upload` hands the browser a
time-limited URL so a large e-paper PDF (80-300 MB, §8.1) uploads straight to the
bucket without passing through the API — and without the frontend ever seeing a
key (§12.1, brief §17).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import BinaryIO


@dataclass(frozen=True)
class StoredObject:
    """The result of putting bytes into a bucket."""

    key: str
    url: str
    bytes: int
    provider: str
    content_type: str


@dataclass(frozen=True)
class PresignedUpload:
    """A short-lived direct-to-bucket upload grant."""

    url: str
    method: str = "PUT"
    fields: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    key: str = ""
    expires_in: int = 900


class StorageProvider(ABC):
    """Common contract for local disk, S3/Zata, and Bunny Storage."""

    key: str = "base"

    @abstractmethod
    def put(
        self,
        key: str,
        data: BinaryIO | bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> StoredObject:
        """Store bytes under `key` and return its public URL."""

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Remove an object. Returns False when it was already absent."""

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def url_for(self, key: str) -> str:
        """Public (CDN) URL for a stored key."""

    def presign_upload(
        self, key: str, *, content_type: str, max_bytes: int, expires_in: int = 900
    ) -> PresignedUpload:
        """Direct-to-bucket upload grant.

        Providers that cannot presign (local dev) fall back to an API-mediated
        upload endpoint, which is why this is not abstract.
        """
        raise NotImplementedError(f"{self.key} storage does not support presigned uploads")

    def supports_presign(self) -> bool:
        return False
