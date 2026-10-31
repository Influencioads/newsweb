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
import { HomeControls } from '@/components/home/HomeControls';
import { HomeListHeader } from '@/components/home/HomeListHeader';
import { HomeSectionBand } from '@/components/home/HomeSectionBand';
import { LocationSheet, usePlaceName } from '@/components/LocationSheet';
import { ExploreWowGrid } from '@/components/wow/ExploreWowGrid';
import { FeaturedHeroes } from '@/components/wow/FeaturedHeroes';
import { HERO_SLIDES, HeroBanner } from '@/components/wow/HeroBanner';
import { MyVillageBlock } from '@/components/wow/MyVillageBlock';
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
 * call straight under it, My Village, Explore WOW, the Story Shots shelf, then
 * Our Heroes.
 * One `/public/home` request feeds the banner; the WOW blocks fetch their own
 * stories. Flattened into a single FlatList so the
 * masthead collapses against one scroll offset.
 *
 * At the top, `HomeControls` holds the language and light/dark switches and the
 * category pick. With categories picked, Home shows only their stories (newest
 * first, merged from each category's feed) instead of the WOW layout.
 */
type Row =
  | { key: string; type: 'hero'; articles: ArticleCard[] }
  | { key: string; type: 'radio' | 'nominate' | 'village' | 'explore' | 'shots' | 'heroes' | 'empty' | 'loading' | 'pickedEmpty' }
  | { key: string; type: 'section'; title: string }
  | { key: string; type: 'compact'; article: ArticleCard };

const STAGGER_MAX = 6;

/** The desk's slides (CMS → Home hero slides) in their order, topped up to
 *  HERO_SLIDES with the newest top stories — as the website's Home does. */
function heroStories(home: HomePayload): ArticleCard[] {
  const seen = new Set<string>();
  const out: ArticleCard[] = [];
  const all = [...(home.hero ?? []), home.lead, ...home.secondary, ...home.mid_column, ...home.latest, ...home.sections.flatMap((sec) => sec.articles)];
  for (const a of all) {
    if (!a || seen.has(a.short_id)) continue;
    seen.add(a.short_id);
    out.push(a);
    if (out.length === HERO_SLIDES) break;
  }
  return out;
}

function flatten(home: HomePayload): Row[] {
  const rows: Row[] = [];
  const hero = heroStories(home);
  if (hero.length) rows.push({ key: 'hero', type: 'hero', articles: hero });
  rows.push({ key: 'radio', type: 'radio' }, { key: 'nominate', type: 'nominate' });
  rows.push({ key: 'village', type: 'village' });
  rows.push({ key: 'explore', type: 'explore' }, { key: 'shots', type: 'shots' });
  rows.push({ key: 'heroes', type: 'heroes' });
  if (!home.lead) rows.push({ key: 'empty', type: 'empty' });
  return rows;
}

/** Home for a category pick: those categories' stories only, newest first. */
function pickedRows(articles: ArticleCard[] | undefined, title: string): Row[] {
  if (!articles) return [{ key: 'loading', type: 'loading' }];
  if (!articles.length) return [{ key: 'picked-empty', type: 'pickedEmpty' }];
  const rows: Row[] = [];
  const lead = articles.filter((a) => a.hero?.url).slice(0, 4);
  if (lead.length) rows.push({ key: 'hero', type: 'hero', articles: lead });
  const shown = new Set(lead.map((a) => a.short_id));
  rows.push({ key: 'picked-h', type: 'section', title });
  articles
    .filter((a) => !shown.has(a.short_id))
    .forEach((a) => rows.push({ key: `picked-${a.short_id}`, type: 'compact', article: a }));
  return rows;
}

/** Each picked category's newest stories, merged: one copy each, newest first. */
async function fetchPicked(slugs: string[]): Promise<ArticleCard[]> {
  const feeds = await Promise.all(slugs.map((category) => publicApi.fetchFeed({ category, limit: 20 })));
  const byId = new Map<string, ArticleCard>();
  feeds.forEach((f) => f.articles.forEach((a) => byId.set(a.short_id, a)));
  return [...byId.values()].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}

const keyOf = (row: Row) => row.key;

export default function HomeScreen() {
  const styles = useStyles();
  const color = useColors();
  const { t, pick } = useI18n();
  const edition = usePrefs((s) => s.edition);
  const mandal = usePrefs((s) => s.mandal);
  const authed = useAuth((s) => s.status === 'authenticated');

  const home = useQuery({
    queryKey: ['home', edition, mandal],
    queryFn: () => publicApi.fetchHome(edition, mandal),
  });

  const picked = usePrefs((s) => s.homeCategories);
  const filtering = picked.length > 0;
  const pickedFeed = useQuery({
    queryKey: ['home-picked', [...picked].sort()],
    queryFn: () => fetchPicked(picked),
    enabled: filtering,
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
      case 'village':
        return <View style={styles.block}><MyVillageBlock /></View>;
      case 'explore':
        return <ExploreWowGrid show="main" />;
      case 'shots':
        return <StoryShotsShelf />;
      case 'section':
        return <HomeSectionBand title={item.title} sectionKey="trending" />;
      case 'compact':
        return <CompactCard article={item.article} index={stagger} />;
      case 'heroes':
        return <FeaturedHeroes />;
      case 'empty':
        return <EmptyState />;
      case 'loading':
        return <SkeletonFeed rows={4} />;
      case 'pickedEmpty':
        return (
          <EmptyState
            icon="filter"
            title={pick('ఈ విభాగాల్లో ఇంకా కథలు లేవు', 'No stories in these categories yet')}
            body={pick('ఇంకో విభాగం ఎంచుకోండి, లేదా "అన్నీ" నొక్కండి.', 'Pick another category, or tap "All".')}
          />
        );
    }
  };

  const rows = filtering
    ? pickedRows(pickedFeed.data, pick('మీరు ఎంచుకున్న విభాగాలు', 'Your categories'))
    : home.data
      ? flatten(home.data)
      : [];

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
            <>
              <HomeControls />
              {filtering ? null : <HomeListHeader breaking={home.data?.breaking ?? []} />}
            </>
          }
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={filtering ? pickedFeed.isRefetching : home.isRefetching}
              onRefresh={() => {
                void (filtering ? pickedFeed.refetch() : home.refetch());
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
