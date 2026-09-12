import { Chip } from '@/components/ui/Chip';
import { LANGUAGES, LANGUAGE_LABELS, useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Telugu / English switcher — two 44px pressed-pill Chips in one group.
 *
 * Two labelled buttons rather than a dropdown: with only two options a select
 * costs an extra tap, and a reader who cannot currently read the interface
 * should see both labels at once and pick the one they recognise. Each label is
 * written in its own script for exactly that reason — "English" stays "English"
 * and "తెలుగు" stays "తెలుగు" whichever mode is active.
 *
 * The group names itself (`reader.language`) unless a visible caption is
 * passed through `aria-labelledby`, as ReaderSettings does.
 *
 *     <LanguageToggle />                          // masthead, NavDrawer, admin
 *     <LanguageToggle aria-labelledby={capId} />  // under a visible caption
 */
export interface LanguageToggleProps {
  className?: string;
  'aria-labelledby'?: string;
}

export function LanguageToggle({ className, 'aria-labelledby': labelledBy }: LanguageToggleProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : t('reader.language')}
      aria-labelledby={labelledBy}
      className={cn('inline-flex items-center gap-1', className)}
    >
      {LANGUAGES.map((lang) => (
        <Chip key={lang} as="button" lang={lang} selected={language === lang} onClick={() => setLanguage(lang)}>
          {LANGUAGE_LABELS[lang]}
        </Chip>
      ))}
    </div>
  );
}
