import { useEffect } from 'react';
import { useWindowDimensions, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat } from 'react-native-reanimated';

import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, radius, space, type } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

/**
 * Skeleton — loading placeholders that keep the layout of the content they
 * stand in for, so the feed does not jump when data lands.
 *
 * `Skeleton` is one shimmering block; `SkeletonCard` mirrors the ArticleCard /
 * VideoCard geometry; `SkeletonFeed` is a whole loading feed. The shimmer is a
 * translateX sweep on the UI thread and turns into a static block under
 * "reduce motion".
 */
export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Size by ratio instead of height (image placeholders). */
  aspectRatio?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

const SWEEP_MS = 1400;

export function Skeleton({ width = '100%', height = 14, aspectRatio, radius: r = radius.sm, style }: SkeletonProps) {
  const styles = useStyles();
  const m = useMotion();
  // ponytail: sweep distance is the screen width, not the block's — saves an
  // onLayout per block and no skeleton is wider than the screen.
  const { width: screen } = useWindowDimensions();
  const band = Math.round(screen * 0.4);
  const x = useSharedValue(0);

  useEffect(() => {
    if (m.reduce) return;
    x.value = 0;
    x.value = withRepeat(m.timing(1, SWEEP_MS, { easing: Easing.linear }), -1, false);
  }, [m, x]);

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: -band + x.value * (screen + band) }],
  }));

  return (
    <View style={[styles.block, aspectRatio ? { width, aspectRatio } : { width, height }, { borderRadius: r }, style]}>
      {m.reduce ? null : <Animated.View style={[styles.band, { width: band }, sweep]} />}
    </View>
  );
}

export interface SkeletonCardProps {
  variant: 'lead' | 'row' | 'compact' | 'video';
  style?: StyleProp<ViewStyle>;
}

/** Placeholder with the same box as the matching ArticleCard / VideoCard. */
export function SkeletonCard({ variant, style }: SkeletonCardProps) {
  const styles = useStyles();
  switch (variant) {
    case 'lead':
      return (
        <View style={[styles.lead, style]}>
          <Skeleton aspectRatio={16 / 9} radius={0} />
          <View style={styles.leadBody}>
            <Skeleton width={72} height={type.meta.fontSize} />
            <Skeleton height={type.headlineLg.fontSize} />
            <Skeleton width="70%" height={type.headlineLg.fontSize} />
            <Skeleton height={type.bodySmall.fontSize} style={styles.gapTop} />
            <Skeleton width="85%" height={type.bodySmall.fontSize} />
            <Skeleton width={120} height={type.meta.fontSize} style={styles.gapTop} />
          </View>
        </View>
      );
    case 'row':
      return (
        <View style={[styles.row, style]}>
          <View style={styles.rowText}>
            <Skeleton width={64} height={type.meta.fontSize} />
            <Skeleton height={type.headlineSm.fontSize} />
            <Skeleton width="80%" height={type.headlineSm.fontSize} />
            <Skeleton width={100} height={type.meta.fontSize} style={styles.gapTop} />
          </View>
          <Skeleton width={96} height={72} />
        </View>
      );
    case 'compact':
      return (
        <View style={[styles.compact, style]}>
          <Skeleton width={48} height={type.meta.fontSize} />
          <Skeleton height={type.bodySmall.fontSize} />
          <Skeleton width="60%" height={type.bodySmall.fontSize} />
        </View>
      );
    case 'video':
      return (
        <View style={[styles.video, style]}>
          <Skeleton aspectRatio={16 / 9} />
          <Skeleton height={type.ui.fontSize} style={styles.gapTop} />
          <Skeleton width="65%" height={type.ui.fontSize} />
          <Skeleton width={120} height={type.meta.fontSize} />
        </View>
      );
  }
}

export interface SkeletonFeedProps {
  rows?: number;
  lead?: boolean;
}

/** A loading feed: optional lead card followed by `rows` row cards. */
export function SkeletonFeed({ rows = 6, lead = true }: SkeletonFeedProps) {
  const { t } = useI18n();
  return (
    <View accessible accessibilityLabel={t('state.loading')} accessibilityState={{ busy: true }}>
      {lead ? <SkeletonCard variant="lead" /> : null}
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonCard key={i} variant="row" />
      ))}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  block: { backgroundColor: alpha(color.ink, 0.06), overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, backgroundColor: alpha(color.ink, 0.05) },
  gapTop: { marginTop: space.sm },

  lead: { backgroundColor: color.paper, borderBottomWidth: 1, borderBottomColor: color.rule },
  leadBody: { padding: space.lg, gap: space.sm },

  row: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  rowText: { flex: 1, gap: space.sm },

  compact: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
    backgroundColor: color.paper,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },

  video: { width: 232, gap: space.xs },
}));
