import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import {
  RefreshControl,
  View,
  type LayoutChangeEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  type SharedValue,
} from 'react-native-reanimated';

import { absoluteMediaUrl } from '@/api/client';
import * as publicApi from '@/api/public';
import type { ShortNewsItem } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { DUR, useMotion } from '@/lib/motion';
import { alpha, radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { T } from '@/ui/Text';

/**
 * Short News (§14): one picture per swipe. The desk adds 4:5 and 9:16 news
 * cards each day (admin → Short News); the words are in the picture, so the
 * screen shows it whole (`contain`, never cropped) on a blurred copy of
 * itself, vertical paging. A card whose story is published taps through to it.
 *
 * The deck height is measured from the container (`onLayout`), never guessed
 * from the window minus a header constant, so the paging interval is exact on
 * a device with a gesture bar, a notch or a shrunken header. Cards scale and
 * fade against the live scroll offset; under reduced motion they sit still.
 */

/** Rail length: enough to feel like progress, short enough to stay readable. */
const DOTS = 7;
/** Half-cycles of the swipe hint's bob — even, so it settles where it started. */
const HINT_BEATS = 6;

const keyOf = (item: ShortNewsItem) => String(item.id);

/** One full-deck card. Memoised: a paging list re-renders the whole window. */
const ShortCard = memo(function ShortCard({
  item,
  index,
  deck,
  scrollY,
  reduce,
}: {
  item: ShortNewsItem;
  index: number;
  deck: number;
  scrollY: SharedValue<number>;
  reduce: boolean;
}) {
  const styles = useStyles();
  const m = useMotion();
  const { t } = useI18n();
  const uri = absoluteMediaUrl(item.image.url);
  const { width, height, blurhash, alt_te } = item.image;
  const shortId = item.article_short_id;
  const open = shortId ? () => router.push({ pathname: '/article/[shortId]', params: { shortId } }) : undefined;

  // The card is full-strength at its own page and recedes towards either
  // neighbour, so a drag reveals the deck behind it.
  const depth = useAnimatedStyle(() => {
    if (reduce || deck === 0) return { opacity: 1, transform: [{ scale: 1 }] };
    const p = interpolate(
      scrollY.get(),
      [(index - 1) * deck, index * deck, (index + 1) * deck],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    return { opacity: 0.4 + 0.6 * p, transform: [{ scale: 0.93 + 0.07 * p }] };
  });

  const picture = uri ? (
    <Image
      source={{ uri }}
      style={styles.fill}
      contentFit="contain"
      // In the card's shape, so the placeholder does not jump from a square.
      placeholder={blurhash ? { blurhash, width: 16, height: Math.round((16 * (height ?? 16)) / (width ?? 16)) } : undefined}
      transition={m.imageTransition}
      recyclingKey={keyOf(item)}
      // The words are in the picture: the alt is what a screen reader has.
      accessible
      accessibilityRole="image"
      accessibilityLabel={alt_te || `${t('shorts.title')} ${index + 1}`}
    />
  ) : null;

  return (
    <Animated.View style={[styles.card, { height: deck }, depth]}>
      {uri ? <Image source={{ uri }} style={styles.fill} contentFit="cover" blurRadius={24} aria-hidden /> : null}
      {/* With a story the whole card taps through; the button stays the
          screen-reader route, so the surface is not one grouped element. */}
      {open ? (
        <PressableScale onPress={open} haptic={false} accessible={false} style={styles.stage}>
          {picture}
        </PressableScale>
      ) : (
        <View style={styles.stage}>{picture}</View>
      )}
      {/* §7.4 — an AI-made picture is labelled wherever it shows. */}
      {item.image.ai_generated ? (
        <Badge tone="ai" icon="sparkles" size="xs" label={t('article.aiImage')} style={styles.aiTag} />
      ) : null}
      {/* Below the picture, never over it: a card's last line is often its source. */}
      {open ? (
        <View style={styles.action}>
          <Button label={t('shorts.readFull')} iconRight="arrowRight" onPress={open} />
        </View>
      ) : null}
    </Animated.View>
  );
});

/** Progress rail down the right edge; a window slides once past `DOTS` cards. */
function Dots({ count, index }: { count: number; index: number }) {
  const styles = useStyles();
  const shown = Math.min(count, DOTS);
  const start = Math.max(0, Math.min(index - Math.floor(DOTS / 2), count - DOTS));
  return (
    <View style={styles.dots} pointerEvents="none" aria-hidden>
      {Array.from({ length: shown }, (_, i) => start + i).map((at) => (
        <View key={at} style={[styles.dot, at === index && styles.dotOn]} />
      ))}
    </View>
  );
}

/** Bobs a few beats on the first card and then stops for good (the screen
 *  drops it once the reader has swiped, so it never replays). */
function SwipeHint() {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { t } = useI18n();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (m.reduce) return;
    bob.set(withRepeat(m.timing(1, DUR.slow), HINT_BEATS, true));
  }, [m, bob]);

  const float = useAnimatedStyle(() => ({
    opacity: 0.55 + 0.45 * bob.get(),
    transform: [{ translateY: -6 * bob.get() }],
  }));

  return (
    <Animated.View style={[styles.hint, float]} pointerEvents="none">
      <View style={styles.hintPill}>
        <Icon name="chevronUp" size={16} color={color.onOverlay} />
        <T variant="meta" style={{ color: color.onOverlay }}>
          {t('shorts.hint')}
        </T>
      </View>
    </Animated.View>
  );
}

export default function ShortNewsScreen() {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { t } = useI18n();

  const [deck, setDeck] = useState(0);
  const [index, setIndex] = useState(0);
  const [hinted, setHinted] = useState(false);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });

  const feed = useInfiniteQuery({
    queryKey: ['short-news'],
    queryFn: ({ pageParam }) => publicApi.fetchShortNews({ offset: pageParam, limit: 10 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });
  // Offset pages over a newest-first feed: cards added while the reader swipes
  // push older ones into the next page, so a card can come back. Show it once.
  const seen = new Set<number>();
  const items = (feed.data?.pages.flatMap((page) => page.items) ?? []).filter((i) => !seen.has(i.id) && !!seen.add(i.id));

  const measure = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    setDeck((prev) => (prev === next ? prev : next));
  };

  const onSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (deck <= 0) return;
    const at = Math.round(e.nativeEvent.contentOffset.y / deck);
    setIndex((prev) => (prev === at ? prev : at));
    // Once they have swiped they know how: the hint never comes back.
    if (at > 0) setHinted(true);
  };

  const renderItem: ListRenderItem<ShortNewsItem> = ({ item, index: i }) => (
    <ShortCard item={item} index={i} deck={deck} scrollY={scrollY} reduce={m.reduce} />
  );

  return (
    <Screen>
      <ScreenHeader title={t('shorts.title')} />

      <View style={styles.deck} onLayout={measure}>
        {feed.isLoading ? (
          <LoadingState variant="feed" />
        ) : feed.isError && !feed.data ? (
          <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="zap" title={t('shorts.empty')} />
        ) : deck > 0 ? (
          <>
            <Animated.FlatList
              data={items}
              keyExtractor={keyOf}
              renderItem={renderItem}
              getItemLayout={(_, i) => ({ length: deck, offset: deck * i, index: i })}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onMomentumScrollEnd={onSettled}
              pagingEnabled
              decelerationRate="fast"
              snapToInterval={deck}
              snapToAlignment="start"
              showsVerticalScrollIndicator={false}
              windowSize={5}
              onEndReached={() => {
                if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
              }}
              onEndReachedThreshold={2}
              ListFooterComponent={
                <View style={[styles.footer, { height: deck }]}>
                  <ListFooter
                    loading={feed.isFetchingNextPage}
                    end={!feed.hasNextPage}
                    error={feed.isError}
                    onRetry={() => void feed.fetchNextPage()}
                  />
                </View>
              }
              refreshControl={
                <RefreshControl
                  refreshing={feed.isRefetching && !feed.isFetchingNextPage}
                  onRefresh={() => feed.refetch()}
                  tintColor={color.brand}
                  colors={[color.brand]}
                  progressBackgroundColor={color.surface}
                />
              }
            />
            <Dots count={items.length} index={index} />
            {index === 0 && !hinted ? <SwipeHint /> : null}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  deck: { flex: 1 },
  card: {
    backgroundColor: color.overlay,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  stage: { flex: 1 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  aiTag: { position: 'absolute', top: space.md, left: space.md },
  // Room under the button for the swipe hint that floats over the first card.
  action: { alignItems: 'center', paddingTop: space.md, paddingBottom: space.xxl },
  // Its own snap page, so the end-of-list line and its retry are reachable.
  footer: { justifyContent: 'center' },

  dots: {
    position: 'absolute',
    right: space.xs,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: space.xs,
  },
  // Light on the dark stage in either theme.
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: alpha(color.onOverlay, 0.45) },
  // White, not brand: the desk's cards are often navy, which swallows a blue pill.
  dotOn: { height: 18, backgroundColor: color.onOverlay },

  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.sm,
    alignItems: 'center',
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: alpha(color.overlay, 0.6),
  },
}));
