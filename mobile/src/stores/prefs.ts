import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { FontStep } from '@/lib/theme';

/**
 * Reader preferences — the mobile twin of frontend/src/stores/readerPrefs.ts.
 *
 * Language, the location choice (district edition, mandal, village) and the
 * §4.1 font step and the Home category pick all persist locally, and this store is what the feeds read.
 * Nothing pulls the server's copy back in: the location is only ever set by the
 * reader in `LocationSheet`, which also mirrors a signed-in reader's choice to
 * their server preferences (local push targets the district stored there).
 */
interface PrefsState {
  language: 'te' | 'en';
  /** 'system' follows the OS; the other two are the reader's explicit choice. */
  theme: 'system' | 'light' | 'dark';
  /** District slug anchoring the local feed and the home edition. */
  edition: string | null;
  mandal: string | null;
  /** Village / town / city under the mandal — the finest feed granularity. */
  locality: string | null;
  fontStep: FontStep;
  /** Category slugs the reader picked on Home; empty means every category. */
  homeCategories: string[];
  setLanguage: (language: 'te' | 'en') => void;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  setEdition: (slug: string | null) => void;
  setMandal: (slug: string | null) => void;
  setLocality: (slug: string | null) => void;
  /** Set the whole place at once, without the per-level resets. */
  setPlace: (place: {
    edition: string | null;
    mandal?: string | null;
    locality?: string | null;
  }) => void;
  setFontStep: (step: FontStep) => void;
  /** Add the category to the Home pick, or take it out if it is already in. */
  toggleHomeCategory: (slug: string) => void;
  clearHomeCategories: () => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      language: 'te',
      theme: 'system',
      edition: null,
      mandal: null,
      locality: null,
      fontStep: 'A',
      homeCategories: [],
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      // Changing a level invalidates every level beneath it (§4 hierarchy):
      // a mandal belongs to one district and a locality to one mandal, so
      // keeping the old one would query a pair that cannot match and leave no
      // chip looking selected.
      setEdition: (edition) => set({ edition, mandal: null, locality: null }),
      setMandal: (mandal) => set({ mandal, locality: null }),
      setLocality: (locality) => set({ locality }),
      setPlace: ({ edition, mandal = null, locality = null }) =>
        set({ edition, mandal, locality }),
      setFontStep: (fontStep) => set({ fontStep }),
      toggleHomeCategory: (slug) =>
        set((s) => ({
          homeCategories: s.homeCategories.includes(slug)
            ? s.homeCategories.filter((c) => c !== slug)
            : [...s.homeCategories, slug],
        })),
      clearHomeCategories: () => set({ homeCategories: [] }),
    }),
    {
      name: 'tn.prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
