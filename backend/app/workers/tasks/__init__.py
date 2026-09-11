"""Celery task bodies.

`celery_app.py` is configuration and a beat schedule; the work lives here, one
module per domain. Importing this package registers every task, which is what
`celery_app` does at the bottom of the file.
"""

from app.workers.tasks import bulletin, crawl, kyc, voice  # noqa: F401

__all__ = ["bulletin", "crawl", "kyc", "voice"]
