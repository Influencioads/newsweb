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
    #: A reader whose identity has been checked, who may file stories. Holds no
    #: CMS access at all — the role carries verified standing and a higher
    #: submission quota, not the ability to write into the newsroom.
    CONTRIBUTOR = "contributor"
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
    #: Ingested from a licensed feed (§17). Distinct from AGENCY copy a
    #: sub-editor rewrote — this is the publisher's own words, republished
    #: under agreement and labelled as such.
    SYNDICATED = "SYNDICATED"
    #: Crawled, then rewritten in our own Telugu by the AI gateway, with the
    #: original publisher credited. The opposite of SYNDICATED: none of the
    #: source's sentences survive, which is why it may be stored for sources
    #: whose licence would never permit republication.
    AI_REWRITE = "AI_REWRITE"


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
    READ = "read"  # value = seconds since the last heartbeat
    SCROLL = "scroll"  # value = max scroll depth, percent
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


class SourceLicence(StrEnum):
    """What right we hold over a source's words (§17).

    This is the field that decides whether the platform is an aggregator with
    agreements or a scraper with a nice UI. RSS_PUBLIC is the honest default:
    a public feed is an invitation to *link*, not a republication licence, so
    it can only ever produce a headline, an excerpt and a link out.
    """

    #: A wire contract — PTI, IANS, ANI. Full text, republished verbatim.
    AGENCY_CONTRACT = "agency_contract"
    #: A named agreement with one publisher.
    PUBLISHER_PARTNER = "publisher_partner"
    #: Issued for redistribution: press releases, PIB, government bulletins.
    PRESS_RELEASE = "press_release"
    GOVERNMENT = "government"
    #: CC-BY and friends. Attribution is mandatory and enforced.
    CREATIVE_COMMONS = "creative_commons"
    #: Another title we own.
    OWN_NETWORK = "own_network"
    #: A public feed with no agreement behind it. Excerpt and link only.
    RSS_PUBLIC = "rss_public"


class ContentPolicy(StrEnum):
    """How much of an ingested item we may keep (§17).

    EXCERPT_ONLY stores a headline, a short standfirst and a link — the shape
    every feed reader has used for twenty years. FULL_TEXT is only reachable
    when the licence supports it; the model enforces that pairing.
    """

    LINK_ONLY = "link_only"
    EXCERPT_ONLY = "excerpt_only"
    FULL_TEXT = "full_text"


class IngestStatus(StrEnum):
    """Where a fetched item sits in the editorial queue (§17)."""

    NEW = "new"
    IMPORTED = "imported"
    REJECTED = "rejected"
    DUPLICATE = "duplicate"


class SourceBeat(StrEnum):
    """What a crawl source is *for*.

    Coverage is organised by beat rather than by geography because that is how
    feeds actually exist. There is no RSS feed per mandal — there are roughly
    1,290 mandals across the two states and a few dozen usable feeds — so a
    mandal is derived from the text (see `gazetteer_service`), while the beat
    is declared once per source and is what the hourly quota is shared out by.
    """

    GENERAL = "general"
    NATIONAL = "national"
    STATE = "state"
    DISTRICT_LOCAL = "district_local"
    BREAKING = "breaking"
    SPORTS = "sports"
    FILM = "film"
    GOVT_JOBS = "govt_jobs"


class RewriteStatus(StrEnum):
    """How the AI rewrite of one ingested item ended.

    `REFUSED` and `HUMAN_ONLY` are outcomes, not errors. A model that declines
    a three-sentence stub instead of inventing five paragraphs around it has
    done the right thing, and a story about a communal incident reaching a
    human untouched is the design working.
    """

    NONE = "none"
    PENDING = "pending"
    READY = "ready"
    #: The model declined: too little source material, or a sensitive subject.
    REFUSED = "refused"
    #: Our own pre-filter caught a sensitive subject, so no provider was called.
    HUMAN_ONLY = "human_only"
    #: Below the minimum word count, or the beat's quota was already spent.
    SKIPPED = "skipped"
    FAILED = "failed"


class MandalMatchMethod(StrEnum):
    """How an item's mandal was decided, so the queue can show its working.

    `AMBIGUOUS` exists because Telugu mandal names collide across districts —
    కొత్తపేట, గాంధీనగర్ and రామాపురం each name several places. Picking the
    first match would put a Nellore story on a Karimnagar page and nobody would
    notice for a week, so two distinct candidates means we decline and keep the
    district.
    """

    NONE = "none"
    SOURCE_DEFAULT = "source_default"
    KEYWORD = "keyword"
    AMBIGUOUS = "ambiguous"
    EDITOR = "editor"


class JobState(StrEnum):
    """Which government a job notification belongs to (§ govt-jobs beat)."""

    AP = "AP"
    TS = "TS"
    BOTH = "BOTH"
    CENTRAL = "CENTRAL"


class BulletinStatus(StrEnum):
    """Where a three-hourly audio bulletin has got to.

    `SKIPPED` is a real outcome, not a failure: a slot with no published
    stories in its window should produce nothing rather than a bulletin that
    says nothing.
    """

    PENDING = "pending"
    SCRIPTED = "scripted"
    READY = "ready"
    PUBLISHED = "published"
    FAILED = "failed"
    SKIPPED = "skipped"


class ContributorType(StrEnum):
    """What kind of contributor somebody is applying as (§ citizen journalism).

    The three differ in what they must prove, not in what they may do: a
    student journalist shows a college ID, a freelance one shows accreditation
    or a portfolio, a citizen shows a government photo ID. All three end up
    filing through the same moderated queue.
    """

    CITIZEN = "citizen"
    FREELANCE = "freelance"
    STUDENT = "student"


class KycStatus(StrEnum):
    """Where a contributor application has got to.

    `MORE_INFO` is deliberately distinct from `REJECTED`: "your college ID was
    unreadable, send another" and "no" are different answers and the applicant
    needs to be able to tell them apart.
    """

    NOT_STARTED = "not_started"
    DRAFT = "draft"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    MORE_INFO = "more_info"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class KycDocumentKind(StrEnum):
    """What an applicant may upload.

    **Aadhaar is deliberately absent.** Storing a full Aadhaar number without
    being a UIDAI-registered entity is a compliance problem, not a schema
    decision, and PAN / Voter ID / Driving Licence / Passport already cover
    every applicant. If it is ever added, store the masked last four only.
    """

    PAN = "pan"
    VOTER_ID = "voter_id"
    DRIVING_LICENCE = "driving_licence"
    PASSPORT = "passport"
    PRESS_ACCREDITATION = "press_accreditation"
    STUDENT_ID = "student_id"
    COLLEGE_BONAFIDE = "college_bonafide"
    SELFIE = "selfie"
