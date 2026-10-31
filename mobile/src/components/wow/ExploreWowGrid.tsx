import { router } from 'expo-router';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useWowFeatures } from '@/lib/siteContent';
import type { WowFeature } from '@/lib/wow';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * Explore WOW — the website's category cards (frontend/src/features/wow/
 * ExploreWow.tsx): icon and title on one line, the one-line focus under them.
 *
 * `show="main"` (home) lists the six main categories and a link to /explore;
 * `show="all"` (the /explore screen) lists every WOW category, main six first.
 */
export interface ExploreWowGridProps {
  show?: 'main' | 'all';
}

const COLUMNS = 2;
/** Cards past this index arrive without the stagger (it caps at six anyway). */
const STAGGER_MAX = 6;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function FeatureCard({ feature, index }: { feature: WowFeature; index: number }) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick } = useI18n();
  const title = pick(feature.te, feature.en);
  const focus = pick(feature.focusTe, feature.focusEn);
  const entering = Platform.OS === 'web' || index >= STAGGER_MAX ? undefined : m.entering(index);

  return (
    <Animated.View entering={entering} style={styles.cell}>
      <PressableScale
        onPress={() => router.push(feature.href)}
        accessibilityRole="link"
        accessibilityLabel={`${title}, ${focus}`}
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <View style={styles.iconWrap} aria-hidden>
            <Icon name={feature.icon} size={20} color={color.wowDeep} />
          </View>
          <T variant="headlineSm" weight="bold" numberOfLines={2} style={styles.cardTitle}>
            {title}
          </T>
        </View>
        <T variant="meta" color="muted" numberOfLines={2}>
          {focus}
        </T>
      </PressableScale>
    </Animated.View>
  );
}

export function ExploreWowGrid({ show = 'main' }: ExploreWowGridProps) {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();
  // The cards as the desk set them on the CMS Taxonomy page.
  const wow = useWowFeatures();
  const features = show === 'main' ? wow.main : wow.all;
  const moreLabel = pick(
    `మరిన్ని కేటగిరీలు చూడండి (${wow.more.length})`,
    `Explore more categories (${wow.more.length})`,
  );

  return (
    <View>
      <View style={styles.header}>
        <T variant="headlineMd" weight="bold" color="brand" accessibilityRole="header">
          {pick('ఎక్స్‌ప్లోర్ ', 'Explore ')}
          <T variant="headlineMd" weight="bold" color="wowDeep" lang="en">
            WOW
          </T>
        </T>
        <View style={styles.rule} aria-hidden />
      </View>

      <View style={styles.grid}>
        {chunk(features, COLUMNS).map((row, r) => (
          <View key={row[0].slug} style={styles.row}>
            {row.map((feature, c) => (
              <FeatureCard key={feature.slug} feature={feature} index={r * COLUMNS + c} />
            ))}
            {/* Keep a lone last card at half width. */}
            {row.length < COLUMNS ? <View style={styles.cell} aria-hidden /> : null}
          </View>
        ))}
      </View>

      {show === 'main' ? (
        <View style={styles.moreWrap}>
          <PressableScale
            onPress={() => router.push('/explore')}
            haptic="select"
            minHeight={TAP}
            accessibilityRole="link"
            accessibilityLabel={moreLabel}
            style={styles.more}
          >
            <Icon name="layoutGrid" size={16} color={color.wowDeep} />
            <T variant="ui" weight="bold" color="wowDeep" numberOfLines={1} style={styles.moreText}>
              {moreLabel}
            </T>
            <Icon name="arrowRight" size={16} color={color.wowDeep} />
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  header: {
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  rule: { width: 40, height: 3, borderRadius: radius.pill, backgroundColor: color.wow },
  grid: { gap: space.md, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', gap: space.md },
  cell: { flex: 1, minWidth: 0 },
  card: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.surface,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconWrap: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.wowTint,
  },
  cardTitle: { flex: 1, minWidth: 0 },
  moreWrap: { alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.lg },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '100%',
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: color.wow,
    backgroundColor: color.surface,
  },
  moreText: { flexShrink: 1 },
}));
