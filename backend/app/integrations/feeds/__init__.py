"""Feed fetching and parsing (updated doc §17).

Kept behind an interface like every other integration, so the service layer
never touches `feedparser` or `httpx` directly and a source that needs a real
partner API later slots in beside the RSS reader.
"""

from app.integrations.feeds.extract import PageText, extract_article
from app.integrations.feeds.fetcher import (
    FeedEntry,
    FeedResult,
    PageResult,
    fetch_feed,
    fetch_page,
)

__all__ = [
    "FeedEntry",
    "FeedResult",
    "PageResult",
    "PageText",
    "extract_article",
    "fetch_feed",
    "fetch_page",
]
