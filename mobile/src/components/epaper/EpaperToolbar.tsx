import { router } from 'expo-router';
import { View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { IconButton } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { T } from '@/ui/Text';

/**
 * EpaperToolbar — the reader's own header (the route hides the native one).
 *
 * Two rows of 44pt IconButtons, every one of them labelled: the edition and
 * its share/download actions on top, page turning and zoom underneath with
 * the page indicator between the arrows. Eight glyph-only controls do not fit
 * one phone-width row, and shrinking them below 44 is not an option.
 */
export interface EpaperToolbarProps {
  title: string;
  pageNumber: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onShare: () => void;
  onDownload: () => void;
  downloading?: boolean;
}

export function EpaperToolbar({
  title,
  pageNumber,
  pageCount,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onZoomIn,
  onZoomOut,
  onShare,
  onDownload,
  downloading = false,
}: EpaperToolbarProps) {
  const styles = useStyles();
  const { t } = useI18n();

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <IconButton name="arrowLeft" label={t('ui.back')} onPress={() => router.back()} />
        <T variant="headlineSm" weight="bold" lang="te" numberOfLines={1} style={styles.title}>
          {title}
        </T>
        <IconButton name="share2" label={t('epaper.sharePage')} onPress={onShare} />
        <IconButton
          name="download"
          label={t('epaper.download')}
          onPress={onDownload}
          disabled={downloading}
        />
      </View>
      <Divider />
      <View style={styles.row}>
        <IconButton
          name="chevronLeft"
          label={t('ui.previous')}
          onPress={onPrev}
          disabled={!canPrev}
        />
        {/* Turning a page leaves focus on the chevron, so the indicator has to
            announce the change itself. */}
        <T
          variant="meta"
          weight="medium"
          color="muted"
          align="center"
          style={styles.indicator}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          {`${t('epaper.page')} ${pageNumber} / ${pageCount}`}
        </T>
        <IconButton name="chevronRight" label={t('ui.next')} onPress={onNext} disabled={!canNext} />
        <IconButton name="zoomOut" label={t('epaper.zoomOut')} onPress={onZoomOut} />
        <IconButton name="zoomIn" label={t('epaper.zoomIn')} onPress={onZoomIn} />
      </View>
      <Divider />
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  bar: { backgroundColor: color.paper },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
  },
  title: { flex: 1, minWidth: 0 },
  indicator: { flex: 1, minWidth: 0 },
}));
