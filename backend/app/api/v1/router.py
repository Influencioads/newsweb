"""API v1 router aggregation.

Routers are mounted per Build Instructions §13 / brief §29:
/auth /public /cms /users /articles /media /epaper /videos /ai /search
/notifications /audit

Modules are added here as each phase lands, so the OpenAPI document always
reflects exactly what is implemented — no placeholder routes that 404.
"""

from fastapi import APIRouter

from app.api.v1 import (
    ads,
    audio,
    auth,
    cms_admin,
    cms_ai,
    cms_articles,
    cms_dashboard,
    cms_discovery,
    cms_ingestion,
    creator,
    engagement,
    notifications,
    public,
    users,
    videos,
)

api_router = APIRouter()

# health is mounted at the application root (see app/main.py), not under /api/v1
api_router.include_router(auth.router)
api_router.include_router(public.router)
api_router.include_router(users.router)
api_router.include_router(engagement.router)
api_router.include_router(notifications.router)
api_router.include_router(videos.router)
api_router.include_router(creator.router)
api_router.include_router(ads.router)
api_router.include_router(audio.router)
api_router.include_router(cms_articles.router)
api_router.include_router(cms_dashboard.router)
api_router.include_router(cms_admin.router)
api_router.include_router(cms_ai.router)
api_router.include_router(cms_discovery.router)
api_router.include_router(cms_ingestion.router)
