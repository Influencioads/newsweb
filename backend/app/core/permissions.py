"""The permission catalogue and the role -> permission matrix.

This module is the single source of truth for what capabilities exist. The seed
writes it into `permissions` / `role_permissions`; the guard checks against the
database, never against this file at request time.

§6.1 is explicit and load-bearing:

    "The permission ai.publish_without_review does not exist. Do not create it."

`FORBIDDEN_PERMISSION_SUBSTRINGS` encodes that as a rule a test can enforce, so
nobody re-adds a bypass later under a different name.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import RoleKey, ScopeType


@dataclass(frozen=True)
class PermissionDef:
    key: str
    group: str
    label_en: str
    label_te: str
    scoped: bool = False
    description: str = ""


#: Substrings that must never appear in a permission key. §0/§6.1 forbid any
#: publishing path that skips human approval, so a key that even *names* one is
#: treated as a defect.
FORBIDDEN_PERMISSION_SUBSTRINGS = (
    "publish_without_review",
    "auto_publish",
    "skip_approval",
    "bypass_approval",
    "publish_without_approval",
)

PERMISSIONS: tuple[PermissionDef, ...] = (
    # --- articles ---------------------------------------------------------
    PermissionDef("article.view", "article", "View articles", "కథనాలు చూడటం"),
    PermissionDef(
        "article.view_own", "article", "View own articles", "సొంత కథనాలు చూడటం"
    ),
    PermissionDef(
        "article.create", "article", "Create article", "కథనం రాయడం", scoped=True
    ),
    PermissionDef(
        "article.edit", "article", "Edit any article", "ఏ కథనాన్నైనా సవరించడం", scoped=True
    ),
    PermissionDef(
        "article.edit_own", "article", "Edit own drafts", "సొంత డ్రాఫ్ట్‌లు సవరించడం"
    ),
    PermissionDef(
        "article.delete", "article", "Delete article", "కథనం తొలగించడం", scoped=True
    ),
    PermissionDef("article.submit", "article", "Submit for review", "సమీక్షకు పంపడం"),
    PermissionDef(
        "article.review", "article", "Pick up for review", "సమీక్షకు తీసుకోవడం", scoped=True
    ),
    PermissionDef(
        "article.approve",
        "article",
        "Approve article",
        "కథనాన్ని ఆమోదించడం",
        scoped=True,
        description="Approver must differ from the author. Self-approval is blocked (§6.3).",
    ),
    PermissionDef(
        "article.reject", "article", "Reject article", "కథనాన్ని తిరస్కరించడం", scoped=True
    ),
    PermissionDef(
        "article.publish",
        "article",
        "Publish article",
        "కథనాన్ని ప్రచురించడం",
        scoped=True,
        description="Requires an APPROVED article approved by someone other than the author.",
    ),
    PermissionDef(
        "article.unpublish",
        "article",
        "Unpublish article",
        "ప్రచురణ ఉపసంహరించడం",
        scoped=True,
    ),
    PermissionDef(
        "article.schedule", "article", "Schedule publish", "షెడ్యూల్ చేయడం", scoped=True
    ),
    PermissionDef(
        "article.breaking",
        "article",
        "Mark as breaking news",
        "బ్రేకింగ్‌గా గుర్తించడం",
        description="Additionally requires role level >= 80 (§6.3).",
    ),
    PermissionDef("article.version.view", "article", "View versions", "వెర్షన్లు చూడటం"),
    PermissionDef(
        "article.version.restore",
        "article",
        "Restore a version",
        "వెర్షన్ పునరుద్ధరణ",
        scoped=True,
    ),
    PermissionDef("article.seo", "article", "Edit SEO fields", "SEO ఫీల్డ్‌లు సవరించడం"),
    PermissionDef(
        "article.assign", "article", "Assign work", "పని కేటాయించడం", scoped=True
    ),
    # --- taxonomy ---------------------------------------------------------
    PermissionDef("taxonomy.view", "taxonomy", "View taxonomy", "వర్గీకరణ చూడటం"),
    PermissionDef(
        "taxonomy.manage",
        "taxonomy",
        "Manage categories/districts/tags",
        "వర్గీకరణ నిర్వహణ",
    ),
    PermissionDef("glossary.manage", "taxonomy", "Manage term glossary", "పదకోశం నిర్వహణ"),
    # --- media ------------------------------------------------------------
    PermissionDef("media.view", "media", "View media library", "మీడియా చూడటం"),
    PermissionDef("media.upload", "media", "Upload media", "మీడియా అప్‌లోడ్"),
    PermissionDef("media.edit", "media", "Edit media metadata", "మీడియా వివరాలు సవరించడం"),
    PermissionDef("media.delete", "media", "Delete media", "మీడియా తొలగించడం"),
    # --- e-paper ----------------------------------------------------------
    PermissionDef("epaper.view", "epaper", "View editions", "ఎడిషన్లు చూడటం"),
    PermissionDef(
        "epaper.upload", "epaper", "Upload edition PDF", "ఎడిషన్ PDF అప్‌లోడ్", scoped=True
    ),
    PermissionDef(
        "epaper.hotspot", "epaper", "Edit hotspots", "హాట్‌స్పాట్‌లు సవరించడం", scoped=True
    ),
    PermissionDef(
        "epaper.publish",
        "epaper",
        "Publish edition",
        "ఎడిషన్ ప్రచురించడం",
        scoped=True,
        description="desk_editor and above only. A dtp_operator never holds this (§6.1).",
    ),
    # --- video ------------------------------------------------------------
    PermissionDef("video.view", "video", "View videos", "వీడియోలు చూడటం"),
    PermissionDef("video.upload", "video", "Ingest video", "వీడియో అప్‌లోడ్"),
    PermissionDef("video.edit", "video", "Edit video metadata", "వీడియో వివరాలు సవరించడం"),
    PermissionDef(
        "video.publish", "video", "Publish video", "వీడియో ప్రచురించడం", scoped=True
    ),
    # --- AI ---------------------------------------------------------------
    PermissionDef(
        "ai.use",
        "ai",
        "Use AI assist tools",
        "AI సాధనాలు వాడటం",
        description="Output is always a DRAFT. There is no permission that publishes AI output.",
    ),
    PermissionDef("ai.view_usage", "ai", "View AI usage and cost", "AI ఖర్చు చూడటం"),
    PermissionDef(
        "kyc.review",
        "user",
        "Review contributor applications",
        "దరఖాస్తుల సమీక్ష",
        description=(
            "See the contributor queue and decide on it, working from the "
            "applicant's own declaration and masked document metadata. Does "
            "not by itself open a government ID."
        ),
    ),
    PermissionDef(
        "kyc.view_document",
        "user",
        "Open an identity document",
        "గుర్తింపు పత్రం చూడటం",
        description=(
            "Open the actual file. Deliberately separate from kyc.review so "
            "triage does not require handling somebody's ID, and so every open "
            "is a deliberate act — each one is written to the audit log with "
            "the actor, their IP and the request id."
        ),
    ),
    PermissionDef(
        "voice.manage",
        "ai",
        "Manage voice and bulletins",
        "వాయిస్, బులెటిన్ నిర్వహణ",
        description=(
            "Bulk audio generation, the audio asset list, and the bulletin "
            "desk. Turning voice on for one article stays with whoever can "
            "edit that article; these are the actions that spend money or "
            "reach every reader at once. Publishes no article."
        ),
    ),
    PermissionDef("ai.manage_prompts", "ai", "Manage prompts", "ప్రాంప్ట్‌లు నిర్వహణ"),
    PermissionDef(
        "ai.manage_providers", "ai", "Manage providers and routing", "ప్రొవైడర్ల నిర్వహణ"
    ),
    PermissionDef(
        "ai.clear_flag", "ai", "Clear the AI-generated flag", "AI గుర్తు తొలగించడం"
    ),
    # --- notifications ----------------------------------------------------
    PermissionDef("push.create", "push", "Compose push campaign", "పుష్ రూపొందించడం"),
    PermissionDef(
        "push.approve",
        "push",
        "Approve and send push",
        "పుష్ ఆమోదించి పంపడం",
        description="Requires role level >= 60; a breaking push requires >= 80 (§11).",
    ),
    # --- comments ---------------------------------------------------------
    PermissionDef("comment.moderate", "comment", "Moderate comments", "వ్యాఖ్యల నియంత్రణ"),
    # --- users & admin ----------------------------------------------------
    PermissionDef("user.view", "user", "View users", "వినియోగదారులను చూడటం"),
    PermissionDef("user.manage", "user", "Create and edit users", "వినియోగదారుల నిర్వహణ"),
    PermissionDef(
        "user.revoke_session", "user", "Force-logout a user", "బలవంతంగా లాగ్ అవుట్"
    ),
    PermissionDef("role.view", "user", "View roles", "పాత్రలు చూడటం"),
    PermissionDef("role.manage", "user", "Edit roles and permissions", "పాత్రల నిర్వహణ"),
    PermissionDef("audit.view", "admin", "View audit log", "ఆడిట్ లాగ్ చూడటం"),
    PermissionDef("settings.view", "admin", "View settings", "సెట్టింగ్‌లు చూడటం"),
    PermissionDef("settings.manage", "admin", "Change settings", "సెట్టింగ్‌లు మార్చడం"),
    PermissionDef("dashboard.view", "admin", "View newsroom dashboard", "డాష్‌బోర్డ్ చూడటం"),
    PermissionDef("analytics.view", "admin", "View analytics", "విశ్లేషణలు చూడటం"),
    PermissionDef("ads.manage", "admin", "Manage ad slots", "ప్రకటనల నిర్వహణ"),
)

PERMISSION_KEYS: frozenset[str] = frozenset(p.key for p in PERMISSIONS)


def _keys(*groups: str) -> set[str]:
    return {p.key for p in PERMISSIONS if p.group in groups}


_ALL = set(PERMISSION_KEYS)

#: §6.1 "Can do" column, expressed as permission keys.
ROLE_PERMISSIONS: dict[RoleKey, set[str]] = {
    # Everything, including user management, settings, AI config.
    RoleKey.SUPER_ADMIN: set(_ALL),
    # Everything except AI provider keys and role editing.
    RoleKey.ADMIN: _ALL - {"ai.manage_providers", "role.manage"},
    # Approve + publish anything incl. breaking; unpublish; push notifications.
    RoleKey.EDITOR_IN_CHIEF: (
        _keys("article", "taxonomy", "media", "epaper", "video", "push", "comment")
        | {
            "ai.use",
            "ai.view_usage",
            "ai.clear_flag",
            "voice.manage",
            "kyc.review",
            "kyc.view_document",
            "audit.view",
            "dashboard.view",
            "analytics.view",
            "user.view",
            "settings.view",
        }
    ),
    # Approve + publish within own desk/district; assign work.
    RoleKey.DESK_EDITOR: {
        "article.view",
        "article.view_own",
        "article.create",
        "article.edit",
        "article.edit_own",
        "article.submit",
        "article.review",
        "article.approve",
        "article.reject",
        "article.publish",
        "article.unpublish",
        "article.schedule",
        "article.version.view",
        "article.version.restore",
        "article.seo",
        "article.assign",
        "taxonomy.view",
        "media.view",
        "media.upload",
        "media.edit",
        "epaper.view",
        "epaper.hotspot",
        "epaper.publish",
        "video.view",
        # With YouTube-links-only video (§15 product decision), "upload" means
        # pasting a link — desk editors curate the hub.
        "video.upload",
        "video.edit",
        "video.publish",
        "ai.use",
        "ai.view_usage",
        "ai.clear_flag",
        "voice.manage",
        # Triage only. Opening a government ID is an escalation to
        # editor-in-chief and above — see kyc.view_document.
        "kyc.review",
        "push.create",
        "push.approve",
        "comment.moderate",
        "dashboard.view",
        "user.view",
    },
    # Edit, copy-fix, send to editor. Cannot publish.
    RoleKey.SUB_EDITOR: {
        "article.view",
        "article.view_own",
        "article.create",
        "article.edit",
        "article.edit_own",
        "article.submit",
        "article.version.view",
        "article.seo",
        "taxonomy.view",
        "media.view",
        "media.upload",
        "media.edit",
        "ai.use",
        "dashboard.view",
    },
    # Create, edit own drafts, submit. Cannot publish.
    RoleKey.REPORTER: {
        "article.view",
        "article.view_own",
        "article.create",
        "article.edit_own",
        "article.submit",
        "article.version.view",
        "taxonomy.view",
        "media.view",
        "media.upload",
        "ai.use",
        "dashboard.view",
    },
    # Create + submit only. Cannot edit after submit. Cannot see others' drafts.
    RoleKey.STRINGER: {
        "article.view_own",
        "article.create",
        "article.edit_own",
        "article.submit",
        "taxonomy.view",
        "media.upload",
        "ai.use",
    },
    # Upload media, no article publish.
    RoleKey.PHOTO_VIDEO: {
        "media.view",
        "media.upload",
        "media.edit",
        "video.view",
        "video.upload",
        "video.edit",
        "article.view",
        "taxonomy.view",
    },
    # Upload e-paper PDFs, mark hotspots. Cannot publish the edition.
    RoleKey.DTP_OPERATOR: {
        "epaper.view",
        "epaper.upload",
        "epaper.hotspot",
        "media.view",
        "media.upload",
        "article.view",
        "taxonomy.view",
    },
    # Ad slots, e-paper ad blocks, no editorial access.
    RoleKey.AD_MANAGER: {
        "ads.manage",
        "media.view",
        "media.upload",
        "epaper.view",
        "analytics.view",
    },
    # Edit SEO fields on published articles only; no body edits.
    RoleKey.SEO_ANALYST: {
        "article.view",
        "article.seo",
        "taxonomy.view",
        "analytics.view",
    },
    # Comment moderation only.
    RoleKey.MODERATOR: {"comment.moderate", "article.view"},
    # Reader account.
    # Deliberately no `article.create`: a contributor files through
    # CreatorSubmission and a moderator converts it, exactly as an unverified
    # reader does. What KYC buys is standing and quota, never CMS access.
    RoleKey.CONTRIBUTOR: {
        "article.view",
        "article.view_own",
        "taxonomy.view",
    },
    RoleKey.SUBSCRIBER: set(),
}

#: §6.1 levels and default scopes.
ROLE_DEFINITIONS: dict[RoleKey, dict[str, object]] = {
    RoleKey.SUPER_ADMIN: {
        "level": 100,
        "scope": ScopeType.GLOBAL,
        "te": "సూపర్ అడ్మిన్",
        "en": "Super Admin",
        "staff": True,
    },
    RoleKey.ADMIN: {
        "level": 90,
        "scope": ScopeType.GLOBAL,
        "te": "అడ్మిన్",
        "en": "Admin",
        "staff": True,
    },
    RoleKey.EDITOR_IN_CHIEF: {
        "level": 80,
        "scope": ScopeType.GLOBAL,
        "te": "ఎడిటర్-ఇన్-చీఫ్",
        "en": "Editor-in-Chief",
        "staff": True,
    },
    RoleKey.DESK_EDITOR: {
        "level": 60,
        "scope": ScopeType.DISTRICT,
        "te": "డెస్క్ ఎడిటర్",
        "en": "Desk Editor",
        "staff": True,
    },
    RoleKey.SUB_EDITOR: {
        "level": 50,
        "scope": ScopeType.DESK,
        "te": "సబ్ ఎడిటర్",
        "en": "Sub Editor",
        "staff": True,
    },
    RoleKey.REPORTER: {
        "level": 40,
        "scope": ScopeType.DISTRICT,
        "te": "రిపోర్టర్",
        "en": "Reporter",
        "staff": True,
    },
    RoleKey.STRINGER: {
        "level": 30,
        "scope": ScopeType.MANDAL,
        "te": "స్ట్రింగర్",
        "en": "Stringer",
        "staff": True,
    },
    RoleKey.PHOTO_VIDEO: {
        "level": 30,
        "scope": ScopeType.GLOBAL,
        "te": "ఫోటో/వీడియో",
        "en": "Photo / Video",
        "staff": True,
    },
    RoleKey.DTP_OPERATOR: {
        "level": 30,
        "scope": ScopeType.EDITION,
        "te": "DTP ఆపరేటర్",
        "en": "DTP Operator",
        "staff": True,
    },
    RoleKey.AD_MANAGER: {
        "level": 30,
        "scope": ScopeType.GLOBAL,
        "te": "ప్రకటనల మేనేజర్",
        "en": "Ad Manager",
        "staff": True,
    },
    RoleKey.SEO_ANALYST: {
        "level": 30,
        "scope": ScopeType.GLOBAL,
        "te": "SEO విశ్లేషకుడు",
        "en": "SEO Analyst",
        "staff": True,
    },
    RoleKey.MODERATOR: {
        "level": 20,
        "scope": ScopeType.GLOBAL,
        "te": "మోడరేటర్",
        "en": "Moderator",
        "staff": True,
    },
    RoleKey.CONTRIBUTOR: {
        "level": 15,
        "scope": ScopeType.SELF,
        "te": "పౌర విలేకరి",
        "en": "Contributor",
        # Not staff. A verified contributor has no CMS access whatsoever; the
        # role records that their identity was checked and raises their
        # submission quota. They still file through the moderation queue.
        "staff": False,
    },
    RoleKey.SUBSCRIBER: {
        "level": 10,
        "scope": ScopeType.SELF,
        "te": "చందాదారు",
        "en": "Subscriber",
        "staff": False,
    },
}

#: Level thresholds the workflow rules reference directly.
LEVEL_BREAKING_NEWS = 80  # §6.3 — is_breaking requires level >= 80
LEVEL_PUSH_APPROVE = 60  # §11  — every push needs approval from level >= 60
LEVEL_PUSH_BREAKING = 80  # §11  — a breaking push needs level >= 80
