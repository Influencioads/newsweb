import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { LANGUAGES, STRINGS, type Language, type StringKey } from './strings';

export { LANGUAGES, LANGUAGE_LABELS, type Language, type StringKey } from './strings';

/**
 * Reader language.
 *
 * Telugu is the default and the fallback everywhere. English is an alternate
 * surface, not a replacement — if an English string or an English headline is
 * missing, the reader gets Telugu rather than a blank.
 *
 * The choice persists (localStorage) and is written onto `<html lang>` so
 * screen readers switch voice and search engines index the page correctly.
 */

function applyLang(lang: Language): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
}

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggle: () => void;
}

export const useLanguage = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: 'te',
      setLanguage: (language) => {
        applyLang(language);
        set({ language });
      },
      toggle: () => get().setLanguage(get().language === 'te' ? 'en' : 'te'),
    }),
    {
      name: 'tn.language',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // Re-apply after hydration, otherwise <html lang> keeps the SSR default.
        applyLang(state?.language ?? 'te');
      },
    },
  ),
);

/** Translate a key. Falls back to Telugu, then to the key itself. */
export function translate(key: StringKey, lang: Language): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.te || key;
}

/**
 * Hook for components.
 *
 * `t` translates UI chrome. `pick` chooses between a Telugu and an English
 * value that came from the **database** (a headline, a category name), applying
 * the same Telugu-fallback rule.
 */
export function useI18n() {
  const language = useLanguage((s) => s.language);
  const setLanguage = useLanguage((s) => s.setLanguage);
  const toggle = useLanguage((s) => s.toggle);

  return {
    language,
    setLanguage,
    toggle,
    isTelugu: language === 'te',
    t: (key: StringKey) => translate(key, language),
    /**
     * Content picker for bilingual DB fields.
     * Returns the Telugu value whenever the English one is absent, so a
     * partially-translated archive never shows an empty headline.
     */
    pick: (te: string | null | undefined, en: string | null | undefined): string =>
      (language === 'en' ? en || te : te || en) ?? '',
    /**
     * Whether the value actually rendered is Telugu, so the caller can set
     * `lang="te"` on that element while the page is in English mode. Mixed-script
     * pages need this or a screen reader reads Telugu with an English voice.
     */
    isFallback: (te: string | null | undefined, en: string | null | undefined): boolean =>
      language === 'en' && !en && Boolean(te),
  };
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
