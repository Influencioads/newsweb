"""API v1 router aggregation.

Routers are mounted per Build Instructions §13 / brief §29:
/auth /public /cms /users /articles /media /epaper /videos /ai /search
/notifications /audit

Modules are added here as each phase lands, so the OpenAPI document always
reflects exactly what is implemented — no placeholder routes that 404.
"""

from fastapi import APIRouter

from app.api.v1 import auth, cms_admin, cms_articles, cms_dashboard, public

api_router = APIRouter()

# health is mounted at the application root (see app/main.py), not under /api/v1
api_router.include_router(auth.router)
api_router.include_router(public.router)
api_router.include_router(cms_articles.router)
api_router.include_router(cms_dashboard.router)
api_router.include_router(cms_admin.router)
