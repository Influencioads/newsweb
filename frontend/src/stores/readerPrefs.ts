import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Reader preferences.
 *
 * §4.1 makes the A- / A / A+ / A++ font-size switcher a **required feature, not a
 * nice-to-have**, and requires it to persist. The scale is applied as a CSS
 * custom property on <html> so every `.reader-body` / `.reader-lead` element
 * resizes together without a re-render cascade.
 *
 * §10.2 requires the district edition selector to persist in localStorage too,
 * so it lives here rather than in a second store.
 */

export const FONT_STEPS = ['A-', 'A', 'A+', 'A++'] as const;
export type FontStep = (typeof FONT_STEPS)[number];

const SCALE: Record<FontStep, number> = {
  'A-': 0.9,
  A: 1,
  'A+': 1.15,
  'A++': 1.32,
};

export type Theme = 'light' | 'dark';

export interface ReaderPrefsState {
  fontStep: FontStep;
  /** District edition slug, or null for the national/default edition. */
  edition: string | null;
  /** Finer local-feed levels (updated doc §4). Child never persists without its parent. */
  mandal: string | null;
  locality: string | null;
  /** §1.1 dark mode. Applied as the `dark` class on <html>; persisted. */
  theme: Theme;
  setFontStep: (step: FontStep) => void;
  setEdition: (slug: string | null) => void;
  setLocalLevels: (mandal: string | null, locality: string | null) => void;
  toggleTheme: () => void;
}

function applyScale(step: FontStep): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--reader-scale', String(SCALE[step]));
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useReaderPrefs = create<ReaderPrefsState>()(
  persist(
    (set, get) => ({
      fontStep: 'A',
      edition: null,
      mandal: null,
      locality: null,
      theme: 'light',
      setFontStep: (fontStep) => {
        applyScale(fontStep);
        set({ fontStep });
      },
      // Changing the district invalidates the mandal/locality beneath it.
      setEdition: (edition) => set({ edition, mandal: null, locality: null }),
      setLocalLevels: (mandal, locality) => set({ mandal, locality: mandal ? locality : null }),
      toggleTheme: () => {
        const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'tn.reader-prefs',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // Re-apply the persisted scale once the store has hydrated, otherwise a
        // reader who chose A++ sees a flash of default-size text on every load.
        if (state) {
          applyScale(state.fontStep);
          applyTheme(state.theme ?? 'light');
        }
      },
    },
  ),
);

export function fontScaleFor(step: FontStep): number {
  return SCALE[step];
}
