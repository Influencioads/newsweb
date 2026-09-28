import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { FontSizeGroup } from '@/components/article/ReaderToolbar';
import { LocationPicker, useReaderPlace } from '@/components/location/LocationPicker';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import { type LucideIcon } from '@/components/ui/Icon';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { useReaderPrefs, type Theme } from '@/stores/readerPrefs';
import { cn } from '@/utils/cn';
import { withViewTransition } from '@/utils/motion';

import { LanguageToggle } from './LanguageToggle';

/**
 * ReaderSettings — the one place for location, text size, language and theme.
 * Opens from the masthead's sliders button; a bottom sheet under md.
 *
 * Only the location <Select>s sit in Fields (a label needs a control to point
 * at); the chip groups carry a visible caption that names them through
 * `aria-labelledby`, so nothing renders a dangling <label for>.
 *
 *     <ReaderSettings open={open} onClose={() => setOpen(false)} />
 */

const THEMES: { value: Theme; icon: LucideIcon; key: StringKey }[] = [
  { value: 'system', icon: Monitor, key: 'ui.themeSystem' },
  { value: 'light', icon: Sun, key: 'ui.themeLight' },
  { value: 'dark', icon: Moon, key: 'ui.themeDark' },
];

export interface ReaderSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ReaderSettings({ open, onClose }: ReaderSettingsProps) {
  const { t } = useI18n();
  const s = useScript();
  const fontId = useId();
  const langId = useId();
  const themeId = useId();
  // Same look as Field's label, without the <label> element.
  const caption = cn(s.body, 'mb-1.5 text-ui-sm font-semibold text-ink');
  const place = useReaderPlace();
  const theme = useReaderPrefs((p) => p.theme);
  const setTheme = useReaderPrefs((p) => p.setTheme);

  return (
    <Dialog open={open} onClose={onClose} title={t('ui.readerSettings')} size="sm" sheetOnMobile>
      <div className="space-y-5">
        <LocationPicker levels="locality" layout="stack" {...place} />

        {/* §4.1 — the A-/A/A+/A++ switcher is a required feature; this is its one home. */}
        <div>
          <p id={fontId} className={caption}>
            {t('reader.fontSize')}
          </p>
          <FontSizeGroup aria-labelledby={fontId} className="flex-wrap" />
        </div>

        <div>
          <p id={langId} className={caption}>
            {t('reader.language')}
          </p>
          <LanguageToggle aria-labelledby={langId} />
        </div>

        {/* §1.1 three-state dark mode. */}
        <div>
          <p id={themeId} className={caption}>
            {t('ui.theme')}
          </p>
          <div role="group" aria-labelledby={themeId} className="flex flex-wrap gap-2">
            {THEMES.map((th) => (
              <Chip
                key={th.value}
                as="button"
                icon={th.icon}
                selected={theme === th.value}
                onClick={() => withViewTransition(() => setTheme(th.value))}
              >
                {t(th.key)}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
