import { View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { FONT_STEPS, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { T } from '@/ui/Text';

/**
 * FontSizeSheet — the reader's A-/A/A+/A++ choice (§4.1).
 *
 * Four chips bound to `prefs.fontStep` with a live preview line rendered
 * through the same `scaled` path article bodies use, so what the reader sees
 * here is exactly what the story will look like.
 */
export interface FontSizeSheetProps {
  open: boolean;
  onClose: () => void;
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  chip: { flex: 1, justifyContent: 'center' },
  preview: { paddingVertical: space.lg },
  done: { marginTop: space.sm },
}));

export function FontSizeSheet({ open, onClose }: FontSizeSheetProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const fontStep = usePrefs((s) => s.fontStep);
  const setFontStep = usePrefs((s) => s.setFontStep);

  return (
    <BottomSheet open={open} onClose={onClose} title={t('ui.fontSize')}>
      <View style={styles.row} accessibilityRole="radiogroup">
        {FONT_STEPS.map((step) => (
          <Chip
            key={step}
            label={step}
            lang="en"
            role="radio"
            selected={step === fontStep}
            onPress={() => setFontStep(step)}
            style={styles.chip}
          />
        ))}
      </View>
      <View style={styles.preview}>
        <T scaled lang="te">{t('ui.fontSizePreview')}</T>
      </View>
      <Button label={t('ui.done')} onPress={onClose} full style={styles.done} />
    </BottomSheet>
  );
}
