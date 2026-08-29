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

export interface ReaderPrefsState {
  fontStep: FontStep;
  /** District edition slug, or null for the national/default edition. */
  edition: string | null;
  setFontStep: (step: FontStep) => void;
  setEdition: (slug: string | null) => void;
}

function applyScale(step: FontStep): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--reader-scale', String(SCALE[step]));
}

export const useReaderPrefs = create<ReaderPrefsState>()(
  persist(
    (set) => ({
      fontStep: 'A',
      edition: null,
      setFontStep: (fontStep) => {
        applyScale(fontStep);
        set({ fontStep });
      },
      setEdition: (edition) => set({ edition }),
    }),
    {
      name: 'tn.reader-prefs',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // Re-apply the persisted scale once the store has hydrated, otherwise a
        // reader who chose A++ sees a flash of default-size text on every load.
        if (state) applyScale(state.fontStep);
      },
    },
  ),
);

export function fontScaleFor(step: FontStep): number {
  return SCALE[step];
}
