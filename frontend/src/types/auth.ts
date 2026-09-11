/**
 * Auth types.
 *
 * These mirror `backend/app/schemas/auth.py`. The Build Instructions put DTOs in
 * a shared package; with a Python backend that is not possible, so the contract
 * is kept honest by the OpenAPI document at /api/v1/openapi.json — regenerate
 * and diff these when the backend schema changes.
 */

export type ScopeType = 'global' | 'district' | 'mandal' | 'desk' | 'edition' | 'self';
export type UserStatus = 'active' | 'invited' | 'suspended' | 'disabled';
export type SessionPlatform = 'web' | 'android' | 'ios' | 'cms' | 'unknown';

export interface AuthUser {
  id: number;
  name_te: string;
  name_en: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  two_factor_enabled: boolean;
  is_author: boolean;
  author_slug: string | null;
  designation_te: string | null;
  last_login_at: string | null;
  created_at: string;
  // §4 / §5 — verification state and profile picture.
  email_verified_at: string | null;
  phone_verified_at: string | null;
  avatar_media_id: number | null;
  avatar_url: string | null;
  bio_te: string | null;
}

export interface RoleAssignment {
  role_key: string;
  role_label_te: string;
  role_label_en: string;
  level: number;
  scope_type: ScopeType;
  scope_id: number | null;
}

export interface Me {
  user: AuthUser;
  roles: RoleAssignment[];
  permissions: string[];
  level: number;
  is_global_scope: boolean;
  district_ids: number[];
  mandal_ids: number[];
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
}

export interface LoginResponse {
  tokens: TokenPair;
  me: Me;
}

export interface OtpRequestResponse {
  sent: boolean;
  expires_in_seconds: number;
  /** Development only — the backend refuses to boot in production with OTP echo on. */
  dev_otp: string | null;
}

export interface UserSession {
  id: number;
  session_key: string;
  platform: SessionPlatform;
  device_label: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  is_current: boolean;
}

/** Permission keys the UI checks. Kept as a union so a typo fails typecheck. */
export type PermissionKey =
  | 'article.view'
  | 'article.view_own'
  | 'article.create'
  | 'article.edit'
  | 'article.edit_own'
  | 'article.delete'
  | 'article.submit'
  | 'article.review'
  | 'article.approve'
  | 'article.reject'
  | 'article.publish'
  | 'article.unpublish'
  | 'article.schedule'
  | 'article.breaking'
  | 'article.version.view'
  | 'article.version.restore'
  | 'article.seo'
  | 'article.assign'
  | 'taxonomy.view'
  | 'taxonomy.manage'
  | 'glossary.manage'
  | 'media.view'
  | 'media.upload'
  | 'media.edit'
  | 'media.delete'
  | 'epaper.view'
  | 'epaper.upload'
  | 'epaper.hotspot'
  | 'epaper.publish'
  | 'video.view'
  | 'video.upload'
  | 'video.edit'
  | 'video.publish'
  | 'ai.use'
  | 'ai.view_usage'
  | 'voice.manage'
  | 'kyc.review'
  | 'kyc.view_document'
  | 'ai.manage_prompts'
  | 'ai.manage_providers'
  | 'ai.clear_flag'
  | 'push.create'
  | 'push.approve'
  | 'comment.moderate'
  | 'user.view'
  | 'user.manage'
  | 'user.revoke_session'
  | 'role.view'
  | 'role.manage'
  | 'audit.view'
  | 'settings.view'
  | 'settings.manage'
  | 'dashboard.view'
  | 'analytics.view'
  | 'ads.manage';
