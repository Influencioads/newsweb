"""What link-preview crawlers and search engines get, mounted at the app root.

    /_og/article/{slug-and-id}   Open Graph head for one story
    /_og/bulletin/{date}/{slot}
    /_og/home
    /robots.txt  /sitemap.xml  /news-sitemap.xml  /rss.xml

**Why this exists rather than a prerender service.** WhatsApp,
`facebookexternalhit`, Twitterbot and Telegram run no JavaScript at all. They
want a dozen `<meta>` tags. Rendering a React SPA in headless Chrome — which
this deployment does not have — to produce twelve meta tags is the wrong tool
and a second system to operate. And `infra/nginx/news-platform.conf` already
routes `sitemap*.xml`, `rss*` and `robots.txt` here, to endpoints that until
now did not exist; a crawler module was needed regardless.

**This is not cloaking.** The response body carries the real headline,
standfirst, hero image, byline and a canonical link to the same URL — a
genuine minimal version of the page, not a different one. The nginx rule that
routes here matches **only link-preview crawlers**, never Googlebot, which
renders JavaScript and indexes the SPA perfectly well.

One deployment trap worth repeating from the nginx config: `$is_link_crawler`
must be part of `proxy_cache_key`. Without it the first crawler's stub is
served to every human for the cache TTL, and the site looks broken to readers
while looking fine to whoever tested the preview.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import timedelta
from html import escape
from urllib.parse import urljoin

from fastapi import APIRouter, Depends, Response
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import utcnow
from app.db.session import get_db
from app.models.content import Article
from app.models.enums import ArticleStatus
from app.services import bulletin_service, share_card_service

router = APIRouter(include_in_schema=False)

#: Stories older than this are not in the news sitemap; Google News ignores
#: anything past two days anyway.
_NEWS_WINDOW_DAYS = 2
_SITEMAP_LIMIT = 5_000


def _site() -> str:
    return settings.APP_URL.rstrip("/")


def _abs(path: str | None) -> str:
    return urljoin(_site() + "/", (path or "").lstrip("/"))


def _head(
    *,
    title: str,
    description: str,
    url: str,
    image: str | None,
    og_type: str = "website",
    extra: str = "",
) -> str:
    image_tags = ""
    if image:
        image_tags = (
            f'<meta property="og:image" content="{escape(image)}">'
            '<meta property="og:image:width" content="1200">'
            '<meta property="og:image:height" content="630">'
            f'<meta name="twitter:image" content="{escape(image)}">'
        )
    return (
        '<meta charset="utf-8">'
        f"<title>{escape(title)}</title>"
        f'<link rel="canonical" href="{escape(url)}">'
        f'<meta name="description" content="{escape(description)}">'
        f'<meta property="og:type" content="{og_type}">'
        f'<meta property="og:title" content="{escape(title)}">'
        f'<meta property="og:description" content="{escape(description)}">'
        f'<meta property="og:url" content="{escape(url)}">'
        f'<meta property="og:site_name" content="{escape(settings.APP_NAME)}">'
        '<meta property="og:locale" content="te_IN">'
        '<meta name="twitter:card" content="summary_large_image">'
        f'<meta name="twitter:title" content="{escape(title)}">'
        f'<meta name="twitter:description" content="{escape(description)}">'
        f"{image_tags}{extra}"
    )


def _page(head: str, body: str) -> HTMLResponse:
    html = (
        f'<!doctype html><html lang="te"><head>{head}</head>'
        f"<body>{body}</body></html>"
    )
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "public, max-age=300",
            "CDN-Cache-Control": "public, s-maxage=600",
        },
    )


@router.get("/_og/article/{slug_and_id}", response_class=HTMLResponse)
def og_article(slug_and_id: str, db: Session = Depends(get_db)):
    """The head a link-preview crawler gets for one story.

    The short id is the final hyphen-separated segment of the slug, mirroring
    how the reader app parses the same URL.
    """
    short_id = slug_and_id.rsplit("-", 1)[-1]
    article = db.scalar(
        select(Article).where(
            Article.short_id == short_id,
            Article.status == ArticleStatus.PUBLISHED,
            Article.deleted_at.is_(None),
        )
    )
    if article is None:
        return _page(
            _head(
                title=settings.APP_NAME,
                description="",
                url=_site(),
                image=None,
            ),
            "",
        )

    url = _abs(article.url_path)
    title = article.seo_title or article.title_te or ""
    description = (article.seo_description or article.summary_te or "")[:300]
    image = share_card_service.ensure_card(db, article)
    hero = None
    media = getattr(article, "hero_media", None)
    if media is not None:
        hero = getattr(media, "cdn_url", None) or getattr(media, "url", None)

    extra = ""
    if article.published_at:
        extra += (
            '<meta property="article:published_time" '
            f'content="{article.published_at.isoformat()}">'
        )
    if article.category is not None:
        extra += (
            '<meta property="article:section" '
            f'content="{escape(article.category.name_te or article.category.slug)}">'
        )

    # The JSON-LD the SPA injects client-side, where a crawler can finally see
    # it. Injecting structured data after page load has never helped anyone.
    import json

    ld = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": title,
        "description": description,
        "url": url,
        "datePublished": article.published_at.isoformat()
        if article.published_at
        else None,
        "dateModified": article.updated_at.isoformat() if article.updated_at else None,
        "inLanguage": "te",
        "image": [i for i in (image, hero) if i],
        "author": {"type": "Person", "name": article.byline_te}
        if article.byline_te
        else None,
        "publisher": {"@type": "Organization", "name": settings.APP_NAME},
    }
    extra += (
        '<script type="application/ld+json">'
        + json.dumps({k: v for k, v in ld.items() if v}, ensure_ascii=False)
        + "</script>"
    )

    # A real, minimal version of the page — the same story, not a different
    # one. That is what keeps this the opposite of cloaking.
    body = (
        f"<article><h1>{escape(title)}</h1>"
        + (f"<p>{escape(description)}</p>" if description else "")
        + (f'<img src="{escape(hero)}" alt="">' if hero else "")
        + (f"<p>{escape(article.byline_te)}</p>" if article.byline_te else "")
        + f'<p><a href="{escape(url)}">{escape(url)}</a></p></article>'
    )
    return _page(
        _head(
            title=title,
            description=description,
            url=url,
            image=image or hero,
            og_type="article",
            extra=extra,
        ),
        body,
    )


@router.get("/_og/bulletin/{date}/{slot}", response_class=HTMLResponse)
def og_bulletin(date: date_type, slot: int, db: Session = Depends(get_db)):
    payload = bulletin_service.serialize(
        db, bulletin_service.get(db, date, slot), include_script=False
    )
    title = payload.get("slot_label_te") or "ఆడియో వార్తలు"
    headlines = " · ".join(i["headline_te"] for i in payload.get("items", [])[:4])
    url = _abs("/bulletin")
    return _page(
        _head(title=title, description=headlines[:300], url=url, image=None),
        f"<h1>{escape(title)}</h1><p>{escape(headlines)}</p>",
    )


@router.get("/_og/home", response_class=HTMLResponse)
def og_home() -> HTMLResponse:
    return _page(
        _head(
            title=settings.APP_NAME,
            description="తెలుగు వార్తలు — ఆంధ్రప్రదేశ్, తెలంగాణ, జాతీయం.",
            url=_site(),
            image=None,
        ),
        f"<h1>{escape(settings.APP_NAME)}</h1>",
    )


# --------------------------------------------------------------------------- #
# robots / sitemaps / rss — routed here by nginx, and previously 404
# --------------------------------------------------------------------------- #
@router.get("/robots.txt", response_class=PlainTextResponse)
def robots() -> PlainTextResponse:
    lines = [
        "User-agent: *",
        # The OG stubs are for crawlers that were sent here by nginx; nothing
        # should find or index them directly.
        "Disallow: /_og/",
        "Disallow: /admin",
        "Disallow: /api/",
        "",
        f"Sitemap: {_site()}/sitemap.xml",
        f"Sitemap: {_site()}/news-sitemap.xml",
    ]
    if not settings.is_production:
        # A staging host that gets indexed competes with production for its own
        # search results.
        lines = ["User-agent: *", "Disallow: /"]
    return PlainTextResponse("\n".join(lines) + "\n")


def _urlset(rows: list[tuple[str, str]], *, news: bool = False) -> Response:
    ns = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
    if news:
        ns += ' xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'
    body = "".join(f"<url><loc>{escape(loc)}</loc>{rest}</url>" for loc, rest in rows)
    return Response(
        f'<?xml version="1.0" encoding="UTF-8"?><urlset {ns}>{body}</urlset>',
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=900"},
    )


def _published(db: Session, *, since=None, limit: int = _SITEMAP_LIMIT):
    stmt = select(Article).where(
        Article.status == ArticleStatus.PUBLISHED, Article.deleted_at.is_(None)
    )
    if since is not None:
        stmt = stmt.where(Article.published_at >= since)
    return list(
        db.scalars(stmt.order_by(Article.published_at.desc()).limit(limit)).all()
    )


@router.get("/sitemap.xml")
def sitemap(db: Session = Depends(get_db)) -> Response:
    rows = [
        (
            _abs(a.url_path),
            f"<lastmod>{(a.updated_at or a.published_at).date().isoformat()}</lastmod>"
            if (a.updated_at or a.published_at)
            else "",
        )
        for a in _published(db)
    ]
    return _urlset([(_site() + "/", "")] + rows)


@router.get("/news-sitemap.xml")
def news_sitemap(db: Session = Depends(get_db)) -> Response:
    since = utcnow() - timedelta(days=_NEWS_WINDOW_DAYS)
    rows = []
    for article in _published(db, since=since, limit=1_000):
        if not article.published_at:
            continue
        rows.append(
            (
                _abs(article.url_path),
                "<news:news>"
                f"<news:publication><news:name>{escape(settings.APP_NAME)}</news:name>"
                "<news:language>te</news:language></news:publication>"
                f"<news:publication_date>{article.published_at.isoformat()}</news:publication_date>"
                f"<news:title>{escape(article.title_te or '')}</news:title>"
                "</news:news>",
            )
        )
    return _urlset(rows, news=True)


@router.get("/rss.xml")
def rss(db: Session = Depends(get_db)) -> Response:
    items = "".join(
        "<item>"
        f"<title>{escape(a.title_te or '')}</title>"
        f"<link>{escape(_abs(a.url_path))}</link>"
        f"<guid isPermaLink='true'>{escape(_abs(a.url_path))}</guid>"
        + (f"<description>{escape(a.summary_te or '')}</description>")
        + (
            f"<pubDate>{a.published_at.strftime('%a, %d %b %Y %H:%M:%S %z')}</pubDate>"
            if a.published_at
            else ""
        )
        + "</item>"
        for a in _published(db, limit=50)
    )
    return Response(
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
        f"<title>{escape(settings.APP_NAME)}</title>"
        f"<link>{escape(_site())}</link>"
        "<language>te</language>"
        f"{items}</channel></rss>",
        media_type="application/rss+xml",
        headers={"Cache-Control": "public, max-age=300"},
    )
