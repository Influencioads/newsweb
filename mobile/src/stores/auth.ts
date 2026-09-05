import { create } from 'zustand';

import { clearTokens, hasSession, loadTokens, setAuthFailureHandler } from '@/api/client';
import * as readerApi from '@/api/reader';
import type { Me } from '@/api/types';

/**
 * Session state. Tokens live in SecureStore (see api/client); only the profile
 * is held here. `bootstrap()` re-fetches /auth/me on launch so a revoked
 * account is caught immediately rather than trusted from cache.
 */
interface AuthState {
  me: Me | null;
  status: 'idle' | 'loading' | 'authenticated' | 'anonymous';
  bootstrap: () => Promise<void>;
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  me: null,
  status: 'idle',

  async bootstrap() {
    set({ status: 'loading' });
    await loadTokens();
    if (!hasSession()) {
      set({ status: 'anonymous', me: null });
      return;
    }
    try {
      const me = await readerApi.fetchMe();
      set({ me, status: 'authenticated' });
    } catch {
      await clearTokens();
      set({ me: null, status: 'anonymous' });
    }
  },

  setMe(me) {
    set({ me, status: 'authenticated' });
  },

  async signOut() {
    await readerApi.logout();
    await clearTokens();
    set({ me: null, status: 'anonymous' });
  },
}));

setAuthFailureHandler(() => {
  useAuth.setState({ me: null, status: 'anonymous' });
});
