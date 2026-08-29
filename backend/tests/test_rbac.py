"""RBAC, permission-matrix and district-scoping tests.

Brief §38 names the critical cases. The ones this file covers:

  * Reporter cannot publish
  * Reporter cannot act on another district
  * `ai.publish_without_review` does not exist
  * Unauthorized users cannot reach CMS APIs
  * Self-approval / breaking-news level rules have the constants they depend on

These are unit tests over the permission model, so they run without a database
and fail fast in CI the moment someone widens a role.
"""

from __future__ import annotations

import pytest

from app.core.deps import Principal
from app.core.errors import PermissionDeniedError, ScopeDeniedError
from app.core.permissions import (
    FORBIDDEN_PERMISSION_SUBSTRINGS,
    LEVEL_BREAKING_NEWS,
    LEVEL_PUSH_APPROVE,
    PERMISSION_KEYS,
    ROLE_DEFINITIONS,
    ROLE_PERMISSIONS,
)
from app.models.enums import RoleKey


def principal_for(
    role: RoleKey,
    *,
    districts: set[int] | None = None,
    mandals: set[int] | None = None,
    is_global: bool = False,
) -> Principal:
    return Principal(
        user=None,  # type: ignore[arg-type]  - not touched by these assertions
        session_key="test",
        permissions=frozenset(ROLE_PERMISSIONS[role]),
        level=int(ROLE_DEFINITIONS[role]["level"]),  # type: ignore[arg-type]
        district_ids=frozenset(districts or set()),
        mandal_ids=frozenset(mandals or set()),
        is_global=is_global,
    )


class TestForbiddenPermissions:
    """§6.1: 'The permission ai.publish_without_review does not exist.
    Do not create it.'"""

    def test_no_publish_without_review_permission_exists(self) -> None:
        assert "ai.publish_without_review" not in PERMISSION_KEYS

    def test_no_permission_names_an_approval_bypass(self) -> None:
        offenders = [
            key
            for key in PERMISSION_KEYS
            for banned in FORBIDDEN_PERMISSION_SUBSTRINGS
            if banned in key
        ]
        assert offenders == [], f"approval-bypass permissions found: {offenders}"

    def test_no_role_grants_an_approval_bypass(self) -> None:
        for role, keys in ROLE_PERMISSIONS.items():
            for key in keys:
                for banned in FORBIDDEN_PERMISSION_SUBSTRINGS:
                    assert banned not in key, f"{role} grants {key}"


class TestRoleMatrix:
    """§6.1 'Can do' column, asserted role by role."""

    def test_all_thirteen_roles_are_defined(self) -> None:
        assert len(ROLE_DEFINITIONS) == 13
        assert set(ROLE_DEFINITIONS) == set(RoleKey)

    def test_levels_match_the_specification(self) -> None:
        expected = {
            RoleKey.SUPER_ADMIN: 100,
            RoleKey.ADMIN: 90,
            RoleKey.EDITOR_IN_CHIEF: 80,
            RoleKey.DESK_EDITOR: 60,
            RoleKey.SUB_EDITOR: 50,
            RoleKey.REPORTER: 40,
            RoleKey.STRINGER: 30,
            RoleKey.PHOTO_VIDEO: 30,
            RoleKey.DTP_OPERATOR: 30,
            RoleKey.AD_MANAGER: 30,
            RoleKey.SEO_ANALYST: 30,
            RoleKey.MODERATOR: 20,
            RoleKey.SUBSCRIBER: 10,
        }
        for role, level in expected.items():
            assert ROLE_DEFINITIONS[role]["level"] == level, role

    def test_every_granted_permission_exists(self) -> None:
        for role, keys in ROLE_PERMISSIONS.items():
            unknown = keys - PERMISSION_KEYS
            assert unknown == set(), f"{role} references unknown permissions {unknown}"

    # --- the "cannot" rules, stated one by one ---------------------------- #
    @pytest.mark.parametrize(
        "role",
        [RoleKey.REPORTER, RoleKey.STRINGER, RoleKey.SUB_EDITOR, RoleKey.PHOTO_VIDEO],
    )
    def test_these_roles_cannot_publish(self, role: RoleKey) -> None:
        assert "article.publish" not in ROLE_PERMISSIONS[role]

    @pytest.mark.parametrize("role", [RoleKey.REPORTER, RoleKey.STRINGER, RoleKey.SUB_EDITOR])
    def test_these_roles_cannot_approve(self, role: RoleKey) -> None:
        assert "article.approve" not in ROLE_PERMISSIONS[role]

    def test_dtp_operator_cannot_publish_an_edition(self) -> None:
        """§6.1: 'Upload e-paper PDFs, mark hotspots. Cannot publish edition.'"""
        perms = ROLE_PERMISSIONS[RoleKey.DTP_OPERATOR]
        assert "epaper.upload" in perms
        assert "epaper.hotspot" in perms
        assert "epaper.publish" not in perms

    def test_stringer_cannot_see_other_drafts(self) -> None:
        """§6.1: 'Cannot see others' drafts.' — only the own-scoped view is granted."""
        perms = ROLE_PERMISSIONS[RoleKey.STRINGER]
        assert "article.view_own" in perms
        assert "article.view" not in perms

    def test_seo_analyst_cannot_edit_bodies(self) -> None:
        """§6.1: 'Edit SEO fields on published articles only; no body edits.'"""
        perms = ROLE_PERMISSIONS[RoleKey.SEO_ANALYST]
        assert "article.seo" in perms
        assert "article.edit" not in perms
        assert "article.publish" not in perms

    def test_moderator_has_comment_moderation_only(self) -> None:
        perms = ROLE_PERMISSIONS[RoleKey.MODERATOR]
        assert "comment.moderate" in perms
        assert not {"article.edit", "article.publish", "media.upload"} & perms

    def test_ad_manager_has_no_editorial_access(self) -> None:
        """§6.1: 'Ad slots, e-paper ad blocks, no editorial access.'"""
        perms = ROLE_PERMISSIONS[RoleKey.AD_MANAGER]
        assert "ads.manage" in perms
        assert not {"article.edit", "article.publish", "article.approve"} & perms

    def test_subscriber_holds_no_cms_permissions(self) -> None:
        assert ROLE_PERMISSIONS[RoleKey.SUBSCRIBER] == set()

    def test_admin_cannot_manage_ai_keys_or_roles(self) -> None:
        """§6.1: admin = 'Everything except AI provider keys and role editing.'"""
        perms = ROLE_PERMISSIONS[RoleKey.ADMIN]
        assert "ai.manage_providers" not in perms
        assert "role.manage" not in perms

    def test_super_admin_holds_everything(self) -> None:
        assert ROLE_PERMISSIONS[RoleKey.SUPER_ADMIN] == PERMISSION_KEYS

    def test_editor_in_chief_can_publish_and_push(self) -> None:
        perms = ROLE_PERMISSIONS[RoleKey.EDITOR_IN_CHIEF]
        assert {"article.publish", "article.unpublish", "article.breaking", "push.approve"} <= perms


class TestPermissionEnforcement:
    def test_require_raises_for_a_missing_permission(self) -> None:
        reporter = principal_for(RoleKey.REPORTER, districts={5})
        with pytest.raises(PermissionDeniedError) as exc:
            reporter.require("article.publish")
        assert exc.value.details["required_permission"] == "article.publish"

    def test_require_passes_for_a_held_permission(self) -> None:
        principal_for(RoleKey.REPORTER, districts={5}).require("article.create")

    def test_level_gate_blocks_below_threshold(self) -> None:
        """§6.3 — is_breaking requires level >= 80."""
        desk = principal_for(RoleKey.DESK_EDITOR, districts={5})
        assert desk.level < LEVEL_BREAKING_NEWS
        with pytest.raises(PermissionDeniedError):
            desk.require_level(LEVEL_BREAKING_NEWS)

    def test_editor_in_chief_clears_the_breaking_threshold(self) -> None:
        principal_for(RoleKey.EDITOR_IN_CHIEF, is_global=True).require_level(LEVEL_BREAKING_NEWS)

    def test_desk_editor_clears_the_push_approval_threshold(self) -> None:
        """§11 — every push needs approval from level >= 60."""
        principal_for(RoleKey.DESK_EDITOR, districts={5}).require_level(LEVEL_PUSH_APPROVE)

    def test_reporter_is_below_push_approval(self) -> None:
        with pytest.raises(PermissionDeniedError):
            principal_for(RoleKey.REPORTER, districts={5}).require_level(LEVEL_PUSH_APPROVE)


class TestDistrictScoping:
    """Brief §7 — 'A reporter assigned to District A must not be able to modify
    District B content unless their permission scope allows it.'"""

    def test_reporter_can_act_in_their_own_district(self) -> None:
        reporter = principal_for(RoleKey.REPORTER, districts={10})
        assert reporter.in_scope(district_id=10)
        reporter.assert_scope(district_id=10)

    def test_reporter_is_blocked_in_another_district(self) -> None:
        reporter = principal_for(RoleKey.REPORTER, districts={10})
        assert not reporter.in_scope(district_id=11)
        with pytest.raises(ScopeDeniedError) as exc:
            reporter.assert_scope(district_id=11)
        assert exc.value.details["resource_district_id"] == 11
        assert exc.value.code == "SCOPE_DENIED"

    def test_scope_error_carries_a_telugu_message(self) -> None:
        with pytest.raises(ScopeDeniedError) as exc:
            principal_for(RoleKey.REPORTER, districts={10}).assert_scope(district_id=11)
        assert exc.value.message_te

    def test_global_scope_reaches_every_district(self) -> None:
        eic = principal_for(RoleKey.EDITOR_IN_CHIEF, is_global=True)
        assert eic.in_scope(district_id=1)
        assert eic.in_scope(district_id=99)
        assert eic.in_scope()  # content with no geography

    def test_stringer_is_limited_to_their_mandal(self) -> None:
        stringer = principal_for(RoleKey.STRINGER, mandals={7})
        assert stringer.in_scope(mandal_id=7)
        assert not stringer.in_scope(mandal_id=8)

    def test_stringer_cannot_reach_district_wide_content(self) -> None:
        # A mandal-scoped user holds no district scope, so district-level content
        # is out of reach even inside their own district.
        stringer = principal_for(RoleKey.STRINGER, mandals={7})
        assert not stringer.in_scope(district_id=10)

    def test_ungeographic_content_needs_global_scope(self) -> None:
        # National/cinema copy has no district. If a district-scoped reporter
        # could edit it, every district reporter could edit the national desk.
        reporter = principal_for(RoleKey.REPORTER, districts={10})
        assert not reporter.in_scope()

    def test_multi_district_desk_editor(self) -> None:
        desk = principal_for(RoleKey.DESK_EDITOR, districts={3, 4})
        assert desk.in_scope(district_id=3)
        assert desk.in_scope(district_id=4)
        assert not desk.in_scope(district_id=5)


class TestUnauthenticatedAccess:
    """Brief §38 — 'Unauthorized user cannot access admin APIs.'"""

    def test_cms_style_endpoint_requires_a_token(self, client) -> None:  # type: ignore[no-untyped-def]
        r = client.get("/api/v1/auth/me")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHORIZED"

    def test_a_garbage_token_is_rejected(self, client) -> None:  # type: ignore[no-untyped-def]
        r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer abc.def.ghi"})
        assert r.status_code == 401

    def test_sessions_endpoint_requires_a_token(self, client) -> None:  # type: ignore[no-untyped-def]
        assert client.get("/api/v1/auth/sessions").status_code == 401
