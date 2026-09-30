import { View } from 'react-native';

import { EditorialGradient, toneForSection } from '@/components/home/EditorialGradient';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

export function HomeSectionBand({ title, sectionKey, onSeeAll }: {
  title: string;
  sectionKey: string;
  onSeeAll?: () => void;
}) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();

  return (
    <View style={styles.band}>
      <EditorialGradient tone={toneForSection(sectionKey)} />
      <T variant="headlineMd" weight="bold" color="onOverlay" accessibilityRole="header" style={styles.title}>
        {title}
      </T>
      {onSeeAll ? (
        <PressableScale
          onPress={onSeeAll}
          haptic="select"
          minHeight={TAP}
          accessibilityRole="button"
          accessibilityLabel={`${t('home.seeAll')}: ${title}`}
          style={styles.seeAll}
        >
          <T variant="ui" weight="semibold" color="onOverlay" numberOfLines={1}>
            {t('home.seeAll')}
          </T>
          <Icon name="chevronRight" size={16} color={color.onOverlay} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  band: {
    position: 'relative',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.xl,
    marginBottom: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.inkDeep,
  },
  title: { flex: 1, minWidth: 0, paddingVertical: space.xs },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: space.xs,
    paddingLeft: space.sm,
  },
}));
