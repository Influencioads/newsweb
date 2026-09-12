import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import * as publicApi from '@/api/public';
import type { VideoOut, VideoRail } from '@/api/types';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { SectionHeader } from '@/components/SectionHeader';
import { VIDEO_CARD_WIDTH, VideoCard } from '@/components/VideoCard';
import { useI18n } from '@/lib/i18n';
import { SPRING, useMotion } from '@/lib/motion';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Chip, ChipRail } from '@/ui/Chip';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonCard } from '@/ui/Skeleton';

/**
 * Video hub (§15) — the app twin of the web page.
 *
 * A tab strip of the categories that actually have video, then a snapping
 * rail per category. Choosing a tab filters to that rail instead of
 * navigating, so comparing sections costs nothing; the brand underline
 * springs to the tab the reader picked rather than cutting.
 */

const ALL = 'all';
const SNAP = VIDEO_CARD_WIDTH + space.md;

interface TabItem {
  key: string;
  label: string;
}

/** Chips in a rail with a sliding brand underline measured off the chips themselves. */
function TabStrip({
  items,
  active,
  onSelect,
}: {
  items: TabItem[];
  active: string;
  onSelect: (key: string) => void;
}) {
  const styles = useStyles();
  const m = useMotion();
  const [spots, setSpots] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);

  // Identity is stable until that chip actually moves, so this settles in one pass.
  const spot = spots[active];
  useEffect(() => {
    if (!spot) return;
    x.value = m.spring(spot.x, SPRING.sheet);
    w.value = m.spring(spot.width, SPRING.sheet);
  }, [spot, m, x, w]);

  // scaleX on a 1dp bar, not an animated width: a width animation runs a Yoga
  // pass every frame; this stays on the UI thread (same house pattern as the
  // article header rule).
  const bar = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scaleX: w.value }],
  }));

  const measure = (key: string) => (e: LayoutChangeEvent) => {
    const { x: left, width } = e.nativeEvent.layout;
    setSpots((prev) =>
      prev[key]?.x === left && prev[key]?.width === width ? prev : { ...prev, [key]: { x: left, width } },
    );
  };

  return (
    <View accessibilityRole="radiogroup">
      <ChipRail contentContainerStyle={styles.tabs}>
        {items.map((item) => (
          <View key={item.key} onLayout={measure(item.key)}>
            <Chip role="radio" label={item.label} selected={item.key === active} onPress={() => onSelect(item.key)} />
          </View>
        ))}
        <Animated.View style={[styles.indicator, bar]} pointerEvents="none" />
      </ChipRail>
    </View>
  );
}

const keyOfVideo = (video: VideoOut) => String(video.id);
const renderVideo = ({ item }: { item: VideoOut }) => <VideoCard video={item} />;

function Rail({ rail }: { rail: VideoRail }) {
  const styles = useStyles();
  const { pick } = useI18n();
  return (
    <View style={styles.rail}>
      <SectionHeader title={pick(rail.title_te, rail.title_en)} />
      <FlatList
        horizontal
        data={rail.videos}
        keyExtractor={keyOfVideo}
        renderItem={renderVideo}
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.track}
      />
    </View>
  );
}

const keyOfRail = (rail: VideoRail) => rail.key;
const renderRail = ({ item }: { item: VideoRail }) => <Rail rail={item} />;

export default function VideosScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t, pick, isTelugu } = useI18n();
  const L = (te: string, en: string) => (isTelugu ? te : en);
  const [active, setActive] = useState(ALL);

  const hub = useQuery({
    queryKey: ['video-rails'],
    queryFn: publicApi.fetchVideoRails,
    staleTime: 120_000,
  });

  const tabs: TabItem[] = [
    { key: ALL, label: L('అన్నీ', 'All') },
    ...(hub.data?.tabs ?? []).map((tab) => ({ key: tab.slug, label: pick(tab.name_te, tab.name_en) })),
  ];
  const rails = (hub.data?.rails ?? []).filter((rail) => active === ALL || rail.key === active);

  return (
    <Screen>
      <ScreenHeader title={t('videos.title')} showRule={tabs.length <= 1} />
      {tabs.length > 1 ? <TabStrip items={tabs} active={active} onSelect={setActive} /> : null}

      {hub.isLoading ? (
        <View
          style={styles.skeleton}
          accessible
          accessibilityLabel={t('state.loading')}
          accessibilityState={{ busy: true }}
        >
          <View style={styles.skeletonRow}>
            <SkeletonCard variant="video" />
            <SkeletonCard variant="video" />
          </View>
          <View style={styles.skeletonRow}>
            <SkeletonCard variant="video" />
            <SkeletonCard variant="video" />
          </View>
        </View>
      ) : hub.isError && !hub.data ? (
        <ErrorState error={hub.error} onRetry={() => hub.refetch()} />
      ) : rails.length === 0 ? (
        <EmptyState icon="video" message={t('videos.empty')} />
      ) : (
        <FlatList
          data={rails}
          keyExtractor={keyOfRail}
          renderItem={renderRail}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ListFooterComponent={<ListFooter end />}
          refreshControl={
            <RefreshControl
              refreshing={hub.isRefetching}
              onRefresh={() => hub.refetch()}
              tintColor={color.brand}
              colors={[color.brand]}
              progressBackgroundColor={color.surface}
            />
          }
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  tabs: { paddingTop: space.sm, paddingBottom: space.md },
  indicator: {
    position: 'absolute',
    bottom: space.xs,
    // 1dp wide and scaled on X — a rounded cap would stretch with the scale.
    width: 1,
    transformOrigin: 'left center',
    height: 3,
    backgroundColor: color.brand,
  },
  list: { paddingBottom: space.xl },
  rail: { paddingBottom: space.sm },
  track: { paddingHorizontal: space.lg },
  skeleton: { padding: space.lg, gap: space.lg },
  skeletonRow: { flexDirection: 'row', gap: space.md },
}));
