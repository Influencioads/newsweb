import { create } from 'zustand';

import { clearTokens, getAccessToken, setAuthFailureHandler } from '@/api/client';
import * as authApi from '@/features/auth/api';
import type { Me, PermissionKey } from '@/types/auth';

/**
 * Authenticated session state.
 *
 * `permissions` drives which controls are rendered. That is a **convenience**:
 * the backend re-checks every permission on the actual request (brief §6,
 * "Backend security is authoritative"). Never treat a hidden button as a
 * security boundary.
 *
 * The user object is deliberately not persisted — only tokens are. On reload
 * `bootstrap()` re-fetches `/auth/me`, so a revoked or downgraded account is
 * caught immediately instead of running on stale cached permissions.
 */
export interface AuthState {
  me: Me | null;
  status: 'idle' | 'loading' | 'authenticated' | 'anonymous';
  error: string | null;

  bootstrap: () => Promise<void>;
  setMe: (me: Me) => void;
  signOut: (allDevices?: boolean) => Promise<void>;

  can: (permission: PermissionKey) => boolean;
  canAny: (...permissions: PermissionKey[]) => boolean;
  hasLevel: (minimum: number) => boolean;
  inDistrict: (districtId: number | null | undefined) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  status: 'idle',
  error: null,

  async bootstrap() {
    if (!getAccessToken()) {
      set({ status: 'anonymous', me: null });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const me = await authApi.fetchMe();
      set({ me, status: 'authenticated' });
    } catch {
      clearTokens();
      set({ me: null, status: 'anonymous' });
    }
  },

  setMe(me) {
    set({ me, status: 'authenticated', error: null });
  },

  async signOut(allDevices = false) {
    await authApi.logout(allDevices);
    set({ me: null, status: 'anonymous' });
  },

  can(permission) {
    return get().me?.permissions.includes(permission) ?? false;
  },

  canAny(...permissions) {
    const held = get().me?.permissions;
    if (!held) return false;
    return permissions.some((p) => held.includes(p));
  },

  hasLevel(minimum) {
    return (get().me?.level ?? 0) >= minimum;
  },

  inDistrict(districtId) {
    const me = get().me;
    if (!me) return false;
    if (me.is_global_scope) return true;
    if (districtId == null) return false;
    return me.district_ids.includes(districtId);
  },
}));

// A refresh that cannot be recovered drops the user to anonymous, so the router
// redirects to the login screen instead of rendering an empty CMS.
setAuthFailureHandler(() => {
  useAuth.setState({ me: null, status: 'anonymous' });
});

/** §6.3 / §11 seniority thresholds, mirrored from `app/core/permissions.py`. */
export const LEVEL_BREAKING_NEWS = 80;
export const LEVEL_PUSH_APPROVE = 60;
