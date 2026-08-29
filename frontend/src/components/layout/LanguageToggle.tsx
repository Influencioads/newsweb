import { LANGUAGES, LANGUAGE_LABELS, useI18n } from '@/i18n';

/**
 * Telugu / English switcher.
 *
 * Rendered as two labelled buttons rather than a dropdown: with only two
 * options a select costs an extra tap, and a reader who cannot currently read
 * the interface should be able to see both labels at once and pick the one they
 * recognise. Each label is written in its own script for exactly that reason —
 * "English" stays "English" and "తెలుగు" stays "తెలుగు" whichever mode is active.
 */
export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('reader.language')}
      className="flex items-center gap-0.5 rounded-[6px] border border-rule p-0.5"
    >
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          aria-pressed={language === lang}
          lang={lang}
          className={[
            'rounded-[4px] px-2 font-semibold transition-colors',
            compact ? 'min-h-[26px] text-[10.5px]' : 'min-h-[28px] text-[11.5px]',
            // Telugu needs its own face and a taller line-box even in a chip.
            lang === 'te' ? 'te leading-[1.5]' : 'font-sans',
            language === lang
              ? 'bg-brand text-white'
              : 'text-muted hover:text-ink',
          ].join(' ')}
        >
          {LANGUAGE_LABELS[lang]}
        </button>
      ))}
    </div>
  );
}
