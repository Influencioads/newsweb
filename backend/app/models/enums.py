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


class TagType(StrEnum):
    """§5 tags(..., type). `PERSON` rows also form the AI image name blocklist (§7.4)."""

    PERSON = "person"
    PLACE = "place"
    ORG = "org"
    TOPIC = "topic"
    EVENT = "event"


class MediaType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    PDF = "pdf"
    DOC = "doc"
