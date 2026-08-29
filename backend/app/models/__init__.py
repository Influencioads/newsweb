"""ORM models.

Importing this package loads **every** model module, which is what keeps
SQLAlchemy's metadata complete. That matters in two places:

  * Alembic autogenerate only sees a table whose module has been imported.
  * A cross-module ForeignKey (articles.hero_media_id -> media.id) cannot resolve
    unless both modules are loaded, and the failure only appears at flush time.

So model modules are registered here, once, rather than at each call site.
"""

from app.db.base import Base
from app.models.audit import AuditLog
from app.models.content import (
    Article,
    ArticleSearchAlias,
    ArticleTag,
    ArticleVersion,
    Category,
    Tag,
    TermGlossary,
    WorkflowTransition,
)
from app.models.geo import District, Mandal
from app.models.media import ArticleMedia, Media
from app.models.user import (
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
    UserSession,
)

__all__ = [
    "Article",
    "ArticleMedia",
    "ArticleSearchAlias",
    "ArticleTag",
    "ArticleVersion",
    "AuditLog",
    "Base",
    "Category",
    "District",
    "Mandal",
    "Media",
    "Permission",
    "Role",
    "RolePermission",
    "Tag",
    "TermGlossary",
    "User",
    "UserRole",
    "UserSession",
    "WorkflowTransition",
]
