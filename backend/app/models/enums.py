"""Domain enumerations.

These are persisted as VARCHAR + CHECK constraints (SQLAlchemy `Enum` with
`native_enum=False`) rather than MySQL's native ENUM. Native ENUM requires an
`ALTER TABLE` to add a value, which on a large `articles` table is a locking
migration; a CHECK constraint is edited in one statement.
"""

from __future__ import annotations

from enum import StrEnum


class UserStatus(StrEnum):
    ACTIVE = "active"
    INVITED = "invited"
    SUSPENDED = "suspended"
    DISABLED = "disabled"


class ScopeType(StrEnum):
    """Geographic/organisational reach of a role assignment (§6.1, brief §7).

    GLOBAL beats everything. DISTRICT limits a reporter to their district.
    MANDAL limits a stringer further. DESK is an editorial desk (a category
    grouping). EDITION scopes a dtp_operator to an e-paper edition. SELF is a
    subscriber acting only on their own records.
    """

    GLOBAL = "global"
    DISTRICT = "district"
    MANDAL = "mandal"
    DESK = "desk"
    EDITION = "edition"
    SELF = "self"


class RoleKey(StrEnum):
    """§6.1 — seed these exactly. Levels live in the roles table."""

    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    EDITOR_IN_CHIEF = "editor_in_chief"
    DESK_EDITOR = "desk_editor"
    SUB_EDITOR = "sub_editor"
    REPORTER = "reporter"
    STRINGER = "stringer"
    PHOTO_VIDEO = "photo_video"
    DTP_OPERATOR = "dtp_operator"
    AD_MANAGER = "ad_manager"
    SEO_ANALYST = "seo_analyst"
    MODERATOR = "moderator"
    SUBSCRIBER = "subscriber"


class SessionPlatform(StrEnum):
    WEB = "web"
    ANDROID = "android"
    IOS = "ios"
    CMS = "cms"
    UNKNOWN = "unknown"


class AuditAction(StrEnum):
    """Actions the audit log records (§13 of the brief, §5 of the doc)."""

    LOGIN = "login"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    SESSION_REVOKED = "session_revoked"
    OTP_REQUESTED = "otp_requested"
    PASSWORD_CHANGED = "password_changed"
    TWO_FACTOR_ENABLED = "two_factor_enabled"
    TWO_FACTOR_DISABLED = "two_factor_disabled"

    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    RESTORE = "restore"

    SUBMIT = "submit"
    REVIEW_START = "review_start"
    APPROVE = "approve"
    REJECT = "reject"
    REQUEST_CHANGES = "request_changes"
    PUBLISH = "publish"
    UNPUBLISH = "unpublish"
    SCHEDULE = "schedule"
    VERSION_RESTORE = "version_restore"

    ROLE_ASSIGNED = "role_assigned"
    ROLE_REVOKED = "role_revoked"
    PERMISSION_CHANGED = "permission_changed"

    AI_RUN = "ai_run"
    AI_FLAG_CLEARED = "ai_flag_cleared"

    MEDIA_UPLOAD = "media_upload"
    MEDIA_DELETE = "media_delete"

    EPAPER_UPLOAD = "epaper_upload"
    EPAPER_PUBLISH = "epaper_publish"
    HOTSPOT_SAVED = "hotspot_saved"

    PUSH_CREATED = "push_created"
    PUSH_APPROVED = "push_approved"
    PUSH_SENT = "push_sent"

    SETTING_CHANGED = "setting_changed"


class LoginMethod(StrEnum):
    PASSWORD = "password"
    OTP = "otp"
    GOOGLE = "google"


class ArticleStatus(StrEnum):
    """Coarse lifecycle, separate from the editorial workflow state.

    Kept apart from `WorkflowState` so an already-published article being edited
    can sit in UPDATE_REVIEW while its status stays PUBLISHED — which is what
    §6.3's "the live version stays live until re-approved" requires.
    """

    DRAFT = "draft"
    PENDING = "pending"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    UNPUBLISHED = "unpublished"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class WorkflowState(StrEnum):
    """§6.3 editorial state machine."""

    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    IN_REVIEW = "IN_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    APPROVED = "APPROVED"
    SCHEDULED = "SCHEDULED"
    PUBLISHED = "PUBLISHED"
    UPDATE_REVIEW = "UPDATE_REVIEW"
    UNPUBLISHED = "UNPUBLISHED"
    REJECTED = "REJECTED"


class ArticleType(StrEnum):
    """Where an article came from (updated doc §23).

    Orthogonal to `source_type`, which records the *copyright* origin (own /
    agency / syndicated). This records the *production* origin, so the pending
    queue can be filtered by it and AI output can never be mistaken for desk
    copy. NORMAL is the default for everything written in the CMS.
    """

    NORMAL = "NORMAL"
    REPORTER = "REPORTER"
    USER_SUBMITTED = "USER_SUBMITTED"
    AI_SUGGESTED = "AI_SUGGESTED"
    AI_DRAFT = "AI_DRAFT"
    BREAKING_NEWS = "BREAKING_NEWS"


class TagType(StrEnum):
    """§5 tags(..., type). `PERSON` rows also form the AI image name blocklist (§7.4)."""

    PERSON = "person"
    PLACE = "place"
    ORG = "org"
    TOPIC = "topic"
    EVENT = "event"


class EventType(StrEnum):
    """Reader-behaviour events (updated doc §3.1) — one append-only stream that
    trending (§8), analytics (§25) and personalization (§3.2) all read."""

    VIEW = "view"
    READ = "read"          # value = seconds since the last heartbeat
    SCROLL = "scroll"      # value = max scroll depth, percent
    SHARE = "share"
    LIKE = "like"
    UNLIKE = "unlike"
    BOOKMARK = "bookmark"
    UNBOOKMARK = "unbookmark"
    NOT_INTERESTED = "not_interested"


class CommentStatus(StrEnum):
    """Post-moderation model: comments publish immediately, moderators hide.
    DELETED = removed by the author; HIDDEN = removed by a moderator."""

    VISIBLE = "visible"
    PENDING = "pending"
    HIDDEN = "hidden"
    DELETED = "deleted"


class ReportTargetType(StrEnum):
    ARTICLE = "article"
    COMMENT = "comment"


class ReportStatus(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class FollowTargetType(StrEnum):
    """What a reader can follow (updated doc §12)."""

    CATEGORY = "category"
    TAG = "tag"
    DISTRICT = "district"
    MANDAL = "mandal"
    AUTHOR = "author"
    #: A video publisher (§15). Distinct from AUTHOR, which is one of our own
    #: journalists — a channel is somebody else's newsroom.
    CHANNEL = "channel"


class CommentTargetType(StrEnum):
    """What a comment thread hangs off (§15).

    Comments began article-only. Videos are the second surface, so the target
    became explicit rather than implied by which FK happened to be set.
    """

    ARTICLE = "article"
    VIDEO = "video"


class ReactionKind(StrEnum):
    """The three-way sentiment bar ("మీ స్పందన ఏంటి?").

    Deliberately not a like: a like is endorsement, and a reader reacting to a
    story about a disaster is not endorsing it. One reaction per reader per
    item, changeable.
    """

    HAPPY = "happy"
    SAD = "sad"
    ANGRY = "angry"


class PinPlacement(StrEnum):
    """Where a pinned story surfaces (updated doc §9)."""

    HOME = "home"
    CATEGORY = "category"
    LOCAL = "local"
    BREAKING = "breaking"
    #: §8 forbids editor overrides from inflating a trending score, so forcing
    #: a story into Top trending is a pin like any other: it leads the rail,
    #: expires by itself, and leaves an audit row.
    TRENDING = "trending"


class TrendingScope(StrEnum):
    """§8: global trending is kept separate from category/location trending."""

    GLOBAL = "global"
    CATEGORY = "category"
    DISTRICT = "district"


class NotificationKind(StrEnum):
    """§13 triggers. BREAKING outranks LOCAL outranks TOPIC when one article
    would qualify for several — a reader gets one notification per story."""

    BREAKING = "breaking"
    LOCAL = "local"
    TOPIC = "topic"
    SYSTEM = "system"


class SubmissionStatus(StrEnum):
    """Creator submissions (updated doc §17): moderation, not publication.
    APPROVED means the text became a real Article in the normal editorial
    workflow — publishing still requires an editor, like everything else."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class AdPlacement(StrEnum):
    """House-ad slots (updated doc §26)."""

    TOP_BANNER = "top_banner"
    IN_FEED = "in_feed"
    ARTICLE = "article"
    CATEGORY = "category"


class HomeSectionKind(StrEnum):
    """What a configurable homepage section renders (updated doc §23–24).

    CATEGORY pulls the latest stories of one category. The other kinds are
    engine-backed blocks that light up as their phases land; a kind whose
    engine is not live yet simply yields no articles and is skipped.
    """

    CATEGORY = "category"
    TRENDING = "trending"
    LATEST = "latest"
    SHORT_NEWS = "short_news"
    VIDEOS = "videos"


class MediaType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    PDF = "pdf"
    DOC = "doc"


class AudioStatus(StrEnum):
    """Lifecycle of one server-side TTS rendition (§19). FAILED is kept rather
    than deleted so a repeated provider error is visible instead of silently
    retried on every request."""

    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"


class AiSuggestionStatus(StrEnum):
    """§16. An editor accepts (a draft gets written) or rejects; USED means a
    real article came out of it. Nothing moves without a person."""

    NEW = "new"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    USED = "used"


class AiDraftStatus(StrEnum):
    """§15. CONVERTED = an Article now exists, entering the normal workflow at
    SUBMITTED — there is no state here that means "published"."""

    DRAFT = "draft"
    CONVERTED = "converted"
    DISCARDED = "discarded"
