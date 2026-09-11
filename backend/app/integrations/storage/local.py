"""Local-disk storage — development only.

Files land under `STORAGE_LOCAL_PATH` and are served by FastAPI at
`STORAGE_LOCAL_PUBLIC_URL`. This provider exists so a developer can run the whole
media pipeline without Zata or Bunny credentials; it is never selected in
staging or production.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings
from app.core.errors import StorageError
from app.core.logging import get_logger
from app.integrations.storage.base import StorageProvider, StoredObject

logger = get_logger(__name__)


class LocalStorage(StorageProvider):
    key = "local"

    def __init__(self, root: str | None = None, public_url: str | None = None) -> None:
        self.root = Path(root or settings.STORAGE_LOCAL_PATH).resolve()
        self.public_url = (public_url or settings.STORAGE_LOCAL_PUBLIC_URL).rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Resolve and confirm the result is still inside the root: a key like
        # "../../etc/passwd" must not escape the storage directory.
        candidate = (self.root / key.lstrip("/")).resolve()
        if not candidate.is_relative_to(self.root):
            raise StorageError(details={"reason": "key escapes storage root"})
        return candidate

    def put(
        self,
        key: str,
        data: BinaryIO | bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> StoredObject:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if isinstance(data, bytes):
                path.write_bytes(data)
                size = len(data)
            else:
                with path.open("wb") as fh:
                    shutil.copyfileobj(data, fh)
                size = path.stat().st_size
        except OSError as exc:
            logger.error("local_storage_write_failed", key=key, error=str(exc))
            raise StorageError() from exc

        return StoredObject(
            key=key,
            url=self.url_for(key),
            bytes=size,
            provider=self.key,
            content_type=content_type,
        )

    def delete(self, key: str) -> bool:
        path = self._path(key)
        if not path.exists():
            return False
        try:
            path.unlink()
            return True
        except OSError as exc:
            logger.error("local_storage_delete_failed", key=key, error=str(exc))
            return False

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def read(self, key: str) -> bytes:
        # `_path` refuses to escape the storage root, so a crafted key cannot
        # read /etc/passwd through this.
        return self._path(key).read_bytes()

    def url_for(self, key: str) -> str:
        return f"{self.public_url}/{key.lstrip('/')}"
