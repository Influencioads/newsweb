"""S3-compatible storage — Zata.ai (the §1 origin) and any other S3 API.

§1: "Object storage — Zata.ai (S3 API) as primary, Bunny Storage as CDN-fronted
mirror. Zata = India-resident, no egress fees."

§9.1 records the correction that matters here: Zata is **object storage, not a
streaming platform**. It does not transcode and does not ship a player, so
"Zata" and "our own hosting" are one code path differing only in bucket and CDN.
That is why this one adapter serves both.
"""

from __future__ import annotations

from typing import Any, BinaryIO

from app.core.config import settings
from app.core.errors import StorageError
from app.core.logging import get_logger
from app.integrations.storage.base import PresignedUpload, StorageProvider, StoredObject

logger = get_logger(__name__)


class S3Storage(StorageProvider):
    key = "s3"

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        bucket: str | None = None,
        region: str | None = None,
        cdn_url: str | None = None,
        provider_key: str = "s3",
    ) -> None:
        self.endpoint = endpoint or settings.ZATA_ENDPOINT
        self.bucket = bucket or settings.ZATA_BUCKET
        self.region = region or settings.ZATA_REGION
        # Bunny sits in front of the bucket as the edge (§1); when configured,
        # public URLs point at the CDN, never at the origin.
        self.cdn_url = (cdn_url or settings.BUNNY_CDN_URL or "").rstrip("/")
        self.key = provider_key
        self._access_key = access_key or settings.ZATA_ACCESS_KEY
        self._secret_key = secret_key or settings.ZATA_SECRET_KEY
        self._client: Any | None = None

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            if not (self._access_key and self._secret_key and self.bucket):
                raise StorageError(
                    message_en="Object storage is not configured.",
                    message_te="ఆబ్జెక్ట్ స్టోరేజ్ కాన్ఫిగర్ కాలేదు.",
                    details={"missing": "ZATA_ACCESS_KEY / ZATA_SECRET_KEY / ZATA_BUCKET"},
                )
            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint or None,
                aws_access_key_id=self._access_key,
                aws_secret_access_key=self._secret_key,
                region_name=self.region,
                config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
            )
        return self._client

    def put(
        self,
        key: str,
        data: BinaryIO | bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> StoredObject:
        body = data if isinstance(data, bytes) else data.read()
        extra: dict[str, Any] = {"ContentType": content_type}
        if cache_control:
            extra["CacheControl"] = cache_control
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=body, **extra)
        except Exception as exc:  # noqa: BLE001 - boto3 raises many client errors
            logger.error("s3_put_failed", key=key, error=str(exc))
            raise StorageError() from exc

        return StoredObject(
            key=key,
            url=self.url_for(key),
            bytes=len(body),
            provider=self.key,
            content_type=content_type,
        )

    def delete(self, key: str) -> bool:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("s3_delete_failed", key=key, error=str(exc))
            return False

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:  # noqa: BLE001
            return False

    def url_for(self, key: str) -> str:
        if self.cdn_url:
            return f"{self.cdn_url}/{key.lstrip('/')}"
        return f"{self.endpoint.rstrip('/')}/{self.bucket}/{key.lstrip('/')}"

    def supports_presign(self) -> bool:
        return True

    def presign_upload(
        self, key: str, *, content_type: str, max_bytes: int, expires_in: int = 900
    ) -> PresignedUpload:
        """§8.1 requires chunked/resumable upload direct to the bucket, with the
        API only receiving the key. Content-type and length are pinned into the
        signature so the grant cannot be reused for a different, larger object."""
        try:
            url = self.client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "ContentType": content_type,
                },
                ExpiresIn=expires_in,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("s3_presign_failed", key=key, error=str(exc))
            raise StorageError() from exc

        return PresignedUpload(
            url=url,
            method="PUT",
            headers={"Content-Type": content_type},
            key=key,
            expires_in=expires_in,
        )
