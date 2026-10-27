import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import * as notificationsApi from '@/api/notifications';
import * as publicApi from '@/api/public';
import type { ArticleCard, HomePayload } from '@/api/types';
import { CompactCard } from '@/components/ArticleCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { HomeListHeader } from '@/components/home/HomeListHeader';
import { HomeSectionBand } from '@/components/home/HomeSectionBand';
import { LocationSheet, usePlaceName } from '@/components/LocationSheet';
import { ExploreWowGrid } from '@/components/wow/ExploreWowGrid';
import { FeaturedHeroes } from '@/components/wow/FeaturedHeroes';
import { HeroBanner } from '@/components/wow/HeroBanner';
import { NominateCta } from '@/components/wow/NominateCta';
import { StoryShotsShelf } from '@/components/wow/StoryShotsShelf';
import { WowRadioCard } from '@/components/wow/WowRadioCard';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';
import { IconButton } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';
import { T } from '@/ui/Text';

/**
 * Home — the WOW Indian layout, in the website's order (frontend
 * src/pages/public/Home.tsx): the top-story banner, WOW Radio and the Nominate
 * call straight under it, Explore WOW, the Story Shots shelf, Trending, then
 * Our Heroes. One `/public/home` request feeds the banner and Trending; the WOW
 * blocks fetch their own stories. Flattened into a single FlatList so the
 * masthead collapses against one scroll offset.
 */
type Row =
  | { key: string; type: 'hero'; articles: ArticleCard[] }
  | { key: string; type: 'radio' | 'nominate' | 'explore' | 'shots' | 'heroes' | 'empty' }
  | { key: string; type: 'section'; title: string }
  | { key: string; type: 'compact'; article: ArticleCard };

const STAGGER_MAX = 6;
const TRENDING_COUNT = 6;

function flatten(home: HomePayload, trendingTitle: string): Row[] {
  const rows: Row[] = [];
  if (home.lead) rows.push({ key: 'hero', type: 'hero', articles: [home.lead, ...home.secondary] });
  rows.push({ key: 'radio', type: 'radio' }, { key: 'nominate', type: 'nominate' });
  rows.push({ key: 'explore', type: 'explore' }, { key: 'shots', type: 'shots' });

  const trending = (home.sections.find((s) => s.key === 'trending')?.articles ?? home.latest)
    .filter((a) => a.short_id !== home.lead?.short_id)
    .slice(0, TRENDING_COUNT);
  if (trending.length) {
    rows.push({ key: 'trending-h', type: 'section', title: trendingTitle });
    trending.forEach((a) => rows.push({ key: `trending-${a.short_id}`, type: 'compact', article: a }));
  }
  rows.push({ key: 'heroes', type: 'heroes' });
  if (!home.lead && !trending.length) rows.push({ key: 'empty', type: 'empty' });
  return rows;
}

const keyOf = (row: Row) => row.key;

export default function HomeScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const authed = useAuth((s) => s.status === 'authenticated');

  const home = useQuery({
    queryKey: ['home', edition, mandal],
    queryFn: () => publicApi.fetchHome(edition, mandal),
  });

  const unread = useQuery({
    queryKey: ['inbox-unread'],
    queryFn: () => notificationsApi.fetchInbox(0),
    enabled: authed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Always on screen, naming the reader's place: the chooser is the only way a
  // location is ever set, so it must never be hard to find.
  const placeName = usePlaceName();
  const placeLabel = placeName ?? t('ui.chooseDistrict');
  const [locationOpen, setLocationOpen] = useState(false);
  // The logo (140 wide) and the header's padding keep their room; the place
  // name shrinks to whatever is left beside the icon buttons.
  const { width } = useWindowDimensions();
  const unreadCount = authed ? (unread.data?.unread ?? 0) : 0;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // The entering stagger is a first-paint effect: once the reader has scrolled,
  // rows 0–5 (recycled by removeClippedSubviews + windowSize) get no index, so
  // they re-enter plainly. State, not a ref — reading a ref in render is a
  // Compiler rule violation.
  const [firstPaint, setFirstPaint] = useState(true);
  const renderRow: ListRenderItem<Row> = ({ item, index }) => {
    const stagger = firstPaint && index < STAGGER_MAX ? index : undefined;
    switch (item.type) {
      case 'hero':
        return <HeroBanner stories={item.articles} index={stagger} />;
      case 'radio':
        return <View style={styles.block}><WowRadioCard variant="card" /></View>;
      case 'nominate':
        return <View style={styles.block}><NominateCta /></View>;
      case 'explore':
        return <ExploreWowGrid show="main" />;
      case 'shots':
        return <StoryShotsShelf />;
      case 'section':
        return <HomeSectionBand title={item.title} sectionKey="trending" onSeeAll={() => router.push('/trending')} />;
      case 'compact':
        return <CompactCard article={item.article} index={stagger} />;
      case 'heroes':
        return <FeaturedHeroes />;
      case 'empty':
        return <EmptyState />;
    }
  };

  const rows = home.data ? flatten(home.data, t('trending.title')) : [];

  return (
    <Screen>
      <ScreenHeader
        large
        title={t('site.name')}
        collapsible={{ scrollY }}
        right={
          <View style={[styles.actions, { maxWidth: width - 172 }]}>
            <PressableScale
              onPress={() => setLocationOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`${t('local.change')}: ${placeLabel}`}
              style={styles.place}
            >
              <Icon name="mapPin" size={16} color={color.brand} />
              <T variant="ui" weight="semibold" numberOfLines={1} style={styles.placeText}>
                {placeLabel}
              </T>
            </PressableScale>
            <IconButton name="search" label={t('ui.search')} onPress={() => router.push('/search')} />
            {authed ? (
              <IconButton
                name="bell"
                label={t('notify.title')}
                badge={unreadCount > 99 ? '99+' : unreadCount}
                onPress={() => router.push('/notifications')}
              />
            ) : null}
          </View>
        }
      />
      <LocationSheet open={locationOpen} onClose={() => setLocationOpen(false)} />

      {home.isLoading ? (
        <SkeletonFeed />
      ) : home.isError && !home.data ? (
        <ErrorState error={home.error} onRetry={() => home.refetch()} />
      ) : (
        <Animated.FlatList
          data={rows}
          keyExtractor={keyOf}
          renderItem={renderRow}
          onScroll={onScroll}
          onScrollBeginDrag={() => setFirstPaint(false)}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <HomeListHeader
              breaking={home.data?.breaking ?? []}
            />
          }
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={home.isRefetching}
              onRefresh={() => {
                void home.refetch();
              }}
              tintColor={color.brand}
              colors={[color.brand]}
              progressBackgroundColor={color.surface}
            />
          }
          removeClippedSubviews
          windowSize={7}
          initialNumToRender={8}
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  actions: { flexDirection: 'row', alignItems: 'center' },
  place: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: 160, paddingHorizontal: space.sm, flexShrink: 1 },
  placeText: { flexShrink: 1 },
  content: { paddingBottom: space.xl },
  block: { paddingHorizontal: space.lg, paddingTop: space.xl },
}));
