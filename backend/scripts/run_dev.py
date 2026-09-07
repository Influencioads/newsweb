"""Run the API locally against the SQLite dev database.

The one-command dev server: pins DATABASE_URL to var/news-local.db (create it
first with scripts/init_dev_db.py) and starts uvicorn. Redis-backed features
degrade to their development fallbacks, so neither Docker nor MySQL is needed
for reader-facing work.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
# Relative paths in settings (STORAGE_LOCAL_PATH=./var/storage) assume the
# backend directory is the working directory, exactly as `uvicorn app.main:app`
# run from backend/ would have it.
os.chdir(BACKEND)
os.environ.setdefault(
    "DATABASE_URL", f"sqlite:///{(BACKEND / 'var' / 'news-local.db').as_posix()}"
)

import uvicorn  # noqa: E402

if __name__ == "__main__":
    # 0.0.0.0 so a phone on the same Wi-Fi can reach the API — the mobile app
    # derives this machine's LAN address from the Metro host (see
    # mobile/src/api/client.ts) and would otherwise hit a closed port. This is
    # the local dev entrypoint only; production serves through nginx.
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)  # noqa: S104
