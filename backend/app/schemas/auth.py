"""Auth request/response schemas.

SQLAlchemy models are never returned directly (brief §29) — every response goes
through one of these. Note what is *absent*: no schema here exposes
`password_hash`, `two_factor_secret`, or `refresh_hash`.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models.enums import ScopeType, SessionPlatform, UserStatus


# --------------------------------------------------------------------------- #
# requests
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    """Desk staff, editors, admins (§6.2)."""

    email: EmailStr = Field(description="Registered work email address")
    password: str = Field(min_length=8, max_length=200)
    totp_code: str | None = Field(
        default=None,
        min_length=6,
        max_length=8,
        description="TOTP code. Mandatory when the account has 2FA enabled.",
    )
    device_id: str | None = Field(default=None, max_length=120)
    device_label: str | None = Field(default=None, max_length=160)
    platform: SessionPlatform = SessionPlatform.CMS


class OtpRequestRequest(BaseModel):
    """Reporters and stringers sign in by phone (§6.2)."""

    phone: str = Field(
        min_length=10,
        max_length=20,
        description="Indian mobile number, with or without +91 and spacing",
        examples=["9848012345", "+91 98480 12345"],
    )

    @field_validator("phone")
    @classmethod
    def _has_enough_digits(cls, v: str) -> str:
        if sum(ch.isdigit() for ch in v) < 10:
            raise ValueError("phone must contain at least 10 digits")
        return v


class OtpVerifyRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    otp: str = Field(min_length=4, max_length=8, examples=["472913"])
    device_id: str | None = Field(default=None, max_length=120)
    device_label: str | None = Field(default=None, max_length=160)
    platform: SessionPlatform = SessionPlatform.WEB


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20)


class LogoutRequest(BaseModel):
    refresh_token: str | None = Field(
        default=None, description="Omit to sign out only the current session"
    )
    all_devices: bool = Field(
        default=False, description="Sign out every device for this account"
    )


class RegisterRequest(BaseModel):
    """Reader signup (updated doc §4). Phone is optional: supplying one lets the
    same account also sign in by OTP later."""

    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    confirm_password: str = Field(min_length=8, max_length=200)
    phone: str | None = Field(default=None, max_length=20)
    device_id: str | None = Field(default=None, max_length=120)
    device_label: str | None = Field(default=None, max_length=160)
    platform: SessionPlatform = SessionPlatform.WEB

    @model_validator(mode="after")
    def _passwords_match(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("passwords do not match")
        return self

    @field_validator("phone")
    @classmethod
    def _phone_digits(cls, v: str | None) -> str | None:
        if v and sum(ch.isdigit() for ch in v) < 10:
            raise ValueError("phone must contain at least 10 digits")
        return v


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=20)


class PasswordResetRequestRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=20)
    new_password: str = Field(min_length=10, max_length=200)


class TwoFactorSetupConfirmRequest(BaseModel):
    totp_code: str = Field(min_length=6, max_length=8)


# --------------------------------------------------------------------------- #
# responses
# --------------------------------------------------------------------------- #
class RoleAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role_key: str
    role_label_te: str
    role_label_en: str
    level: int
    scope_type: ScopeType
    scope_id: int | None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name_te: str
    name_en: str
    email: EmailStr | None
    phone: str | None
    status: UserStatus
    two_factor_enabled: bool
    is_author: bool
    author_slug: str | None
    designation_te: str | None
    last_login_at: datetime | None
    created_at: datetime
    # §4 — the profile screen shows what still needs confirming.
    email_verified_at: datetime | None = None
    phone_verified_at: datetime | None = None
    avatar_media_id: int | None = None
    avatar_url: str | None = None
    bio_te: str | None = None


class MeOut(BaseModel):
    """`GET /auth/me` — what the frontend needs to render permission-aware UI.

    The frontend hides controls based on `permissions`; the backend re-checks
    every one of them. Hiding a button is convenience, not security (brief §6).
    """

    user: UserOut
    roles: list[RoleAssignmentOut]
    permissions: list[str]
    level: int
    is_global_scope: bool
    district_ids: list[int]
    mandal_ids: list[int]


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime = Field(description="UTC expiry of the access token")


class LoginResponse(BaseModel):
    tokens: TokenPair
    me: MeOut


class OtpRequestResponse(BaseModel):
    sent: bool = Field(
        description="Always true — the response never reveals whether the number is registered"
    )
    expires_in_seconds: int
    dev_otp: str | None = Field(
        default=None,
        description=(
            "Development convenience only. Populated when OTP_DEV_ECHO=true, which "
            "the production startup check forbids."
        ),
    )


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_key: str
    platform: SessionPlatform
    device_label: str | None
    ip: str | None
    user_agent: str | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    is_current: bool = False


class TwoFactorSetupOut(BaseModel):
    secret: str = Field(description="Base32 TOTP secret — shown once, at enrolment")
    provisioning_uri: str = Field(
        description="otpauth:// URI for the authenticator app QR code"
    )


class SimpleMessage(BaseModel):
    ok: bool = True
    message_en: str
    message_te: str
