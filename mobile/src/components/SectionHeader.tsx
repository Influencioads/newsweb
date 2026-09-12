import { View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * Section header: brand headline with a short brand rule under it, optional
 * subtitle, optional "see all" row on the right — the block header the web
 * home uses.
 */
export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
}

export function SectionHeader({ title, subtitle, onSeeAll }: SectionHeaderProps) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <T variant="headlineMd" weight="bold" color="brand" accessibilityRole="header">
          {title}
        </T>
        <View style={styles.rule} aria-hidden />
        {subtitle ? (
          <T variant="meta" color="muted">
            {subtitle}
          </T>
        ) : null}
      </View>
      {onSeeAll ? (
        <PressableScale
          onPress={onSeeAll}
          haptic="select"
          minHeight={TAP}
          accessibilityRole="button"
          accessibilityLabel={`${t('home.seeAll')}: ${title}`}
          style={styles.seeAll}
        >
          <T variant="ui" weight="semibold" color="info" numberOfLines={1}>
            {t('home.seeAll')}
          </T>
          <Icon name="chevronRight" size={16} color={color.info} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  text: { flex: 1, minWidth: 0, gap: space.xs },
  rule: { width: 40, height: 3, borderRadius: radius.pill, backgroundColor: color.brand },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.sm },
}));
