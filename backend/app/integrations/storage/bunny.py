"""Bunny Storage adapter — the CDN-fronted mirror from §1.

Bunny Storage speaks a simple REST API rather than S3, so it gets its own
adapter. Playback/delivery always goes through the pull zone (`BUNNY_CDN_URL`),
never the storage host, so readers hit the edge (§10.1).
"""

from __future__ import annotations

from typing import BinaryIO

import httpx

from app.core.config import settings
from app.core.errors import StorageError
from app.core.logging import get_logger
from app.integrations.storage.base import StorageProvider, StoredObject

logger = get_logger(__name__)


class BunnyStorage(StorageProvider):
    key = "bunny"

    #: Bunny storage endpoints are region-specific; `storage.bunnycdn.com` is the
    #: default zone. Override via BUNNY_STORAGE_ZONE for a regional host.
    BASE_HOST = "https://storage.bunnycdn.com"

    def __init__(
        self,
        *,
        zone: str | None = None,
        access_key: str | None = None,
        cdn_url: str | None = None,
    ) -> None:
        self.zone = zone or settings.BUNNY_STORAGE_ZONE
        self.cdn_url = (cdn_url or settings.BUNNY_CDN_URL or "").rstrip("/")
        self._access_key = access_key or settings.BUNNY_STORAGE_KEY

    def _require_config(self) -> None:
        if not (self.zone and self._access_key):
            raise StorageError(
                message_en="Bunny storage is not configured.",
                message_te="Bunny స్టోరేజ్ కాన్ఫిగర్ కాలేదు.",
                details={"missing": "BUNNY_STORAGE_ZONE / BUNNY_STORAGE_KEY"},
            )

    def _object_url(self, key: str) -> str:
        return f"{self.BASE_HOST}/{self.zone}/{key.lstrip('/')}"

    def put(
        self,
        key: str,
        data: BinaryIO | bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> StoredObject:
        self._require_config()
        body = data if isinstance(data, bytes) else data.read()
        headers = {
            "AccessKey": self._access_key,
            "Content-Type": content_type,
        }
        try:
            resp = httpx.put(
                self._object_url(key), content=body, headers=headers, timeout=60
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("bunny_put_failed", key=key, error=str(exc))
            raise StorageError() from exc

        return StoredObject(
            key=key,
            url=self.url_for(key),
            bytes=len(body),
            provider=self.key,
            content_type=content_type,
        )

    def delete(self, key: str) -> bool:
        self._require_config()
        try:
            resp = httpx.delete(
                self._object_url(key),
                headers={"AccessKey": self._access_key},
                timeout=30,
            )
            return resp.status_code < 400
        except httpx.HTTPError as exc:
            logger.error("bunny_delete_failed", key=key, error=str(exc))
            return False

    def read(self, key: str) -> bytes:
        self._require_config()
        response = httpx.get(
            self._object_url(key),
            headers={"AccessKey": self._access_key},
            timeout=30,
        )
        response.raise_for_status()
        return response.content

    def exists(self, key: str) -> bool:
        self._require_config()
        try:
            resp = httpx.head(
                self._object_url(key),
                headers={"AccessKey": self._access_key},
                timeout=15,
            )
            return resp.status_code == 200
        except httpx.HTTPError:
            return False

    def url_for(self, key: str) -> str:
        if self.cdn_url:
            return f"{self.cdn_url}/{key.lstrip('/')}"
        return self._object_url(key)
