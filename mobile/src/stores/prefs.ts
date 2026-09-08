import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { FontStep } from '@/lib/theme';

/**
 * Reader preferences — the mobile twin of frontend/src/stores/readerPrefs.ts.
 *
 * Language, the location choice (district edition + mandal) and the §4.1 font
 * step all persist locally; a signed-in reader's server preferences overwrite
 * these on load so devices converge.
 */
interface PrefsState {
  language: 'te' | 'en';
  /** 'system' follows the OS; the other two are the reader's explicit choice. */
  theme: 'system' | 'light' | 'dark';
  /** District slug anchoring the local feed and the home edition. */
  edition: string | null;
  mandal: string | null;
  fontStep: FontStep;
  setLanguage: (language: 'te' | 'en') => void;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  setEdition: (slug: string | null) => void;
  setMandal: (slug: string | null) => void;
  setFontStep: (step: FontStep) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      language: 'te',
      theme: 'system',
      edition: null,
      mandal: null,
      fontStep: 'A',
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      // Changing the district invalidates the mandal beneath it (§4 hierarchy).
      setEdition: (edition) => set({ edition, mandal: null }),
      setMandal: (mandal) => set({ mandal }),
      setFontStep: (fontStep) => set({ fontStep }),
    }),
    {
      name: 'tn.prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
