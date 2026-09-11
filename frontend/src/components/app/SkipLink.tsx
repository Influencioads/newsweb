import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * "Skip to content" link — the first focusable element on every page.
 * Invisible until it receives keyboard focus, then pinned top-left above the
 * header. Requires a `#main` landmark on the page.
 *
 *     <SkipLink />   // first child of the layout, before the header
 */
export function SkipLink() {
  const { t } = useI18n();
  const s = useScript();
  return (
    <a
      href="#main"
      className={cn(
        s.body,
        'sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-toast',
        'focus:flex focus:min-h-tap focus:items-center focus:rounded-xl focus:px-4',
        'bg-brand text-on-brand text-ui font-semibold shadow-raised',
      )}
    >
      {t('ui.skipToContent')}
    </a>
  );
}
