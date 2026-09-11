"""ORM models.

Importing this package loads **every** model module, which is what keeps
SQLAlchemy's metadata complete. That matters in two places:

  * Alembic autogenerate only sees a table whose module has been imported.
  * A cross-module ForeignKey (articles.hero_media_id -> media.id) cannot resolve
    unless both modules are loaded, and the failure only appears at flush time.

So model modules are registered here, once, rather than at each call site.
"""

from app.db.base import Base
from app.models.ai import AiArticleDraft, AiSource, AiSuggestion
from app.models.audio import AudioAsset
from app.models.bulletin import AudioBulletin, AudioBulletinItem
from app.models.epaper import (
    EpaperAsset,
    EpaperEdition,
    EpaperPage,
    EpaperPageArticle,
    EpaperPageShare,
    EpaperPageTemplate,
    EpaperUserEdition,
    EpaperUserEditionPreference,
)
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
from app.models.creator import AdCampaign, CreatorSubmission
from app.models.discovery import Pin, TrendingScore
from app.models.engagement import (
    ArticleEvent,
    Bookmark,
    Comment,
    Follow,
    Like,
    Reaction,
    ReadingSession,
    Report,
)
from app.models.notify import Notification, NotificationCampaign, PushDevice
from app.models.poll import Poll, PollOption, PollVote, TrendingTopic
from app.models.geo import District, Locality, Mandal, MandalAlias, State
from app.models.ingestion import ContentSource, IngestedItem, IngestedRewrite
from app.models.jobs import JobPosting
from app.models.kyc import ContributorProfile, KycDocument
from app.models.media import ArticleMedia, Media
from app.models.reader import UserPreference
from app.models.setting import AppSetting
from app.models.site import HomepageSection, SearchQuery
from app.models.user import (
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
    UserSession,
)
from app.models.video import Video, VideoChannel, VideoTag

__all__ = [
    "KycDocument",
    "ContributorProfile",
    "AudioBulletinItem",
    "AudioBulletin",
    "JobPosting",
    "IngestedRewrite",
    "MandalAlias",
    "AdCampaign",
    "AiArticleDraft",
    "AiSource",
    "AiSuggestion",
    "AppSetting",
    "Article",
    "AudioAsset",
    "EpaperAsset",
    "EpaperEdition",
    "EpaperPage",
    "EpaperPageArticle",
    "EpaperPageShare",
    "EpaperPageTemplate",
    "EpaperUserEdition",
    "EpaperUserEditionPreference",
    "ContentSource",
    "IngestedItem",
    "Reaction",
    "VideoChannel",
    "VideoTag",
    "CreatorSubmission",
    "ArticleEvent",
    "ArticleMedia",
    "ArticleSearchAlias",
    "Bookmark",
    "Comment",
    "Follow",
    "Like",
    "ReadingSession",
    "Report",
    "ArticleTag",
    "ArticleVersion",
    "AuditLog",
    "Base",
    "Category",
    "District",
    "HomepageSection",
    "Locality",
    "Mandal",
    "Media",
    "Notification",
    "NotificationCampaign",
    "Permission",
    "Pin",
    "Poll",
    "PollOption",
    "PollVote",
    "PushDevice",
    "TrendingScore",
    "TrendingTopic",
    "SearchQuery",
    "State",
    "Role",
    "RolePermission",
    "Tag",
    "TermGlossary",
    "User",
    "UserPreference",
    "UserRole",
    "UserSession",
    "Video",
    "WorkflowTransition",
]
