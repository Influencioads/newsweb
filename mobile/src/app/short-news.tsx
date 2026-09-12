import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
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
import type { ArticleCard } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { DUR, useMotion } from '@/lib/motion';
import { alpha, radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { ListFooter } from '@/ui/ListFooter';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { T } from '@/ui/Text';

/**
 * Short news (§14): the InShorts/DailyHunt swipe — one full-deck card per
 * story, vertical paging, a tap through to the full article.
 *
 * The deck height is measured from the container (`onLayout`), never guessed
 * from the window minus a header constant, so the paging interval is exact on
 * a device with a gesture bar, a notch or a shrunken header. Cards scale and
 * fade against the live scroll offset; under reduced motion they simply sit
 * still.
 */

/** Rail length: enough to feel like progress, short enough to stay readable. */
const DOTS = 7;
/** Half-cycles of the swipe hint's bob — even, so it settles where it started. */
const HINT_BEATS = 6;

const keyOf = (article: ArticleCard) => article.short_id;

/** One full-deck card. Memoised: a paging list re-renders the whole window. */
const ShortCard = memo(function ShortCard({
  article,
  index,
  deck,
  scrollY,
  reduce,
}: {
  article: ArticleCard;
  index: number;
  deck: number;
  scrollY: SharedValue<number>;
  reduce: boolean;
}) {
  const styles = useStyles();
  const m = useMotion();
  const { t, pick, language } = useI18n();
  const heroUrl = absoluteMediaUrl(article.hero?.url ?? null);

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

  return (
    <Animated.View style={[styles.card, { height: deck }, depth]}>
      {heroUrl ? (
        <Image
          source={{ uri: heroUrl }}
          style={styles.hero}
          contentFit="cover"
          placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
          transition={m.imageTransition}
          recyclingKey={article.short_id}
          accessibilityLabel={article.hero?.alt_te ?? ''}
        />
      ) : null}

      <View style={styles.body}>
        <View style={styles.kickers}>
          {article.is_breaking ? <Badge tone="breaking" icon="zap" size="xs" label={t('home.breaking')} /> : null}
          {article.is_exclusive ? <Badge tone="exclusive" size="xs" label={t('ui.exclusive')} /> : null}
          {article.ai_generated ? <Badge tone="ai" icon="sparkles" size="xs" label={t('ui.ai')} /> : null}
          {article.category ? (
            <Badge tone="brand" size="xs" label={pick(article.category.name_te, article.category.name_en)} />
          ) : null}
        </View>

        {/* The text is the only thing that may give: the CTA below it is
            pinned, so it stays on the page at every font step. */}
        <View style={styles.text}>
          <T variant="headlineMd" weight="bold" scaled numberOfLines={3} style={styles.flexText}>
            {pick(article.title_te, article.title_en)}
          </T>
          {article.summary_te ? (
            <T variant="body" color="inkSoft" scaled numberOfLines={4} style={styles.flexText}>
              {article.summary_te}
            </T>
          ) : null}
        </View>
        <T variant="meta" color="muted">
          {timeAgo(article.published_at, language)}
        </T>

        <View style={styles.action}>
          <Button
            label={t('shorts.readFull')}
            iconRight="arrowRight"
            onPress={() =>
              router.push({ pathname: '/article/[shortId]', params: { shortId: article.short_id } })
            }
          />
        </View>
      </View>
    </Animated.View>
  );
});

/** Progress rail down the right edge; a window slides once past `DOTS` cards. */
function Dots({ count, index }: { count: number; index: number }) {
  const styles = useStyles();
  const shown = Math.min(count, DOTS);
  const start = Math.max(0, Math.min(index - Math.floor(DOTS / 2), count - DOTS));
  return (
    <View
      style={styles.dots}
      pointerEvents="none"
      aria-hidden
    >
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
      <Icon name="chevronUp" size={16} color={color.muted} />
      <T variant="meta" color="muted">
        {t('shorts.hint')}
      </T>
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
  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];

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

  const renderItem: ListRenderItem<ArticleCard> = ({ item, index: i }) => (
    <ShortCard article={item} index={i} deck={deck} scrollY={scrollY} reduce={m.reduce} />
  );

  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title: t('shorts.title') }} />
      <ScreenHeader title={t('shorts.title')} />

      <View style={styles.deck} onLayout={measure}>
        {feed.isLoading ? (
          <LoadingState variant="feed" />
        ) : feed.isError && !feed.data ? (
          <ErrorState error={feed.error} onRetry={() => feed.refetch()} />
        ) : articles.length === 0 ? (
          <EmptyState icon="zap" />
        ) : deck > 0 ? (
          <>
            <Animated.FlatList
              data={articles}
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
            <Dots count={articles.length} index={index} />
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
    backgroundColor: color.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.rule,
  },
  hero: {
    width: '100%',
    height: '38%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: color.placeholder,
  },
  // Room at the foot for the swipe hint that floats over the first card.
  body: { flex: 1, padding: space.lg, paddingBottom: space.xxl, gap: space.sm },
  kickers: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  text: { flex: 1, minHeight: 0, gap: space.sm },
  flexText: { flexShrink: 1, minWidth: 0 },
  action: { flexShrink: 0, alignSelf: 'flex-start' },
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
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: alpha(color.ink, 0.18) },
  dotOn: { height: 18, backgroundColor: color.brand },

  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
}));
