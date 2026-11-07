import { useId } from 'react';

import { FontSizeGroup } from '@/components/article/ReaderToolbar';
import { LocationPicker, useReaderPlace } from '@/components/location/LocationPicker';
import { Dialog } from '@/components/ui/Dialog';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { LanguageToggle } from './LanguageToggle';

/**
 * ReaderSettings — the one place for location, text size and language (the
 * site is light-only, so there is no theme switch).
 * Opens from the masthead's sliders button; a bottom sheet under md.
 *
 * Only the location <Select>s sit in Fields (a label needs a control to point
 * at); the chip groups carry a visible caption that names them through
 * `aria-labelledby`, so nothing renders a dangling <label for>.
 *
 *     <ReaderSettings open={open} onClose={() => setOpen(false)} />
 */

export interface ReaderSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ReaderSettings({ open, onClose }: ReaderSettingsProps) {
  const { t } = useI18n();
  const s = useScript();
  const fontId = useId();
  const langId = useId();
  // Same look as Field's label, without the <label> element.
  const caption = cn(s.body, 'mb-1.5 text-ui-sm font-semibold text-ink');
  const place = useReaderPlace();

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

      </div>
    </Dialog>
  );
}
