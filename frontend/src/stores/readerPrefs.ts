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
 *
 * §1.1 dark mode is three-state: `system` follows `prefers-color-scheme` (and
 * tracks it live), `light` / `dark` are the reader's explicit choice. The
 * inline script in index.html reads the same persisted key before first paint
 * so a dark reader never sees a light flash.
 */

export const FONT_STEPS = ['A-', 'A', 'A+', 'A++'] as const;
export type FontStep = (typeof FONT_STEPS)[number];

const SCALE: Record<FontStep, number> = {
  'A-': 0.9,
  A: 1,
  'A+': 1.15,
  'A++': 1.32,
};

export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Brand red in light, the paper tone in dark — what the browser chrome tints to. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#A61C24', dark: '#201B16' };

export interface ReaderPrefsState {
  fontStep: FontStep;
  /** District edition slug, or null for the national/default edition. */
  edition: string | null;
  /** Finer local-feed levels (updated doc §4). Child never persists without its parent. */
  mandal: string | null;
  locality: string | null;
  /** §1.1 dark mode. `system` follows the OS; persisted. */
  theme: Theme;
  /** What is actually on screen right now (system resolved). Not persisted. */
  resolvedTheme: ResolvedTheme;
  setFontStep: (step: FontStep) => void;
  setEdition: (slug: string | null) => void;
  setLocalLevels: (mandal: string | null, locality: string | null) => void;
  setTheme: (theme: Theme) => void;
  /** Flips between light and dark (an explicit choice, leaving `system`). */
  toggleTheme: () => void;
}

function applyScale(step: FontStep): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--reader-scale', String(SCALE[step]));
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[resolved];
}

export const useReaderPrefs = create<ReaderPrefsState>()(
  persist(
    (set, get) => ({
      fontStep: 'A',
      edition: null,
      mandal: null,
      locality: null,
      theme: 'system',
      resolvedTheme: 'light',
      setFontStep: (fontStep) => {
        applyScale(fontStep);
        set({ fontStep });
      },
      // Changing the district invalidates the mandal/locality beneath it.
      setEdition: (edition) => set({ edition, mandal: null, locality: null }),
      setLocalLevels: (mandal, locality) => set({ mandal, locality: mandal ? locality : null }),
      setTheme: (theme) => {
        const resolvedTheme = resolveTheme(theme);
        applyTheme(resolvedTheme);
        set({ theme, resolvedTheme });
      },
      toggleTheme: () => {
        get().setTheme(get().resolvedTheme === 'dark' ? 'light' : 'dark');
      },
    }),
    {
      name: 'tn.reader-prefs',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // v1 persisted only 'light' | 'dark'; both remain valid Theme values.
      migrate: (persisted) => persisted as ReaderPrefsState,
      partialize: (s) => ({
        fontStep: s.fontStep,
        edition: s.edition,
        mandal: s.mandal,
        locality: s.locality,
        theme: s.theme,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-apply the persisted scale once the store has hydrated, otherwise a
        // reader who chose A++ sees a flash of default-size text on every load.
        if (state) {
          applyScale(state.fontStep);
          const theme: Theme = state.theme ?? 'system';
          const resolvedTheme = resolveTheme(theme);
          applyTheme(resolvedTheme);
          useReaderPrefs.setState({ theme, resolvedTheme });
        }
      },
    },
  ),
);

// Track the OS preference live while the reader is on `system`.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    const { theme } = useReaderPrefs.getState();
    if (theme !== 'system') return;
    const resolvedTheme = resolveTheme('system');
    applyTheme(resolvedTheme);
    useReaderPrefs.setState({ resolvedTheme });
  };
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
  else if (typeof mql.addListener === 'function') mql.addListener(onChange);
}

export function fontScaleFor(step: FontStep): number {
  return SCALE[step];
}
