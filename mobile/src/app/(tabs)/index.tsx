import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer, type AudioPlayer } from 'expo-audio';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View, type ListRenderItem } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { absoluteMediaUrl } from '@/api/client';
import * as engagementApi from '@/api/engagement';
import * as epaperApi from '@/api/epaper';
import type { Poll } from '@/api/epaper';
import * as notificationsApi from '@/api/notifications';
import * as publicApi from '@/api/public';
import type { ArticleCard, HomePayload } from '@/api/types';
import { CompactCard, LeadCard, RowCard } from '@/components/ArticleCard';
import { BulletinCard, useBulletin, type BulletinSummary } from '@/components/BulletinCard';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { HomeListHeader } from '@/components/home/HomeListHeader';
import { PollCard } from '@/components/PollCard';
import { SectionHeader } from '@/components/SectionHeader';
import { VideoStrip } from '@/components/VideoStrip';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';
import { IconButton } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { SkeletonFeed } from '@/ui/Skeleton';

/**
 * Home feed: breaking strip, e-paper promo, top topics, lead story, secondary
 * rows, for-you rail, bulletin, big question, latest rail, mandal block, video
 * strip, then the admin-configured section blocks — one `/public/home`
 * request (§23), flattened into a single FlatList so the masthead collapses
 * against one scroll offset.
 */
type Row =
  | { key: string; type: 'lead' | 'row' | 'compact'; article: ArticleCard }
  | { key: string; type: 'section'; title: string; href?: Href }
  | { key: string; type: 'poll'; poll: Poll }
  | { key: string; type: 'bulletin'; bulletin: BulletinSummary; player: AudioPlayer }
  | { key: string; type: 'video' | 'empty' };

const STAGGER_MAX = 6;

function flatten(
  home: HomePayload,
  forYou: ArticleCard[],
  bulletin: { bulletin: BulletinSummary; player: AudioPlayer } | undefined,
  poll: Poll | undefined,
  pick: (te: string | null, en: string | null) => string,
  forYouTitle: string,
  latestTitle: string,
): Row[] {
  const rows: Row[] = [];
  const article = (type: 'lead' | 'row' | 'compact', prefix: string, a: ArticleCard) =>
    rows.push({ key: `${prefix}-${a.short_id}`, type, article: a });

  if (home.lead) article('lead', 'lead', home.lead);
  home.secondary.forEach((a) => article('row', 'sec', a));
  home.mid_column.forEach((a) => article('row', 'mid', a));

  // §3.2 personalised rail — only once there is enough to call it one.
  if (forYou.length >= 3) {
    rows.push({ key: 'fy-h', type: 'section', title: forYouTitle });
    forYou.forEach((a) => article('row', 'fy', a));
  }

  // No row at all when no bulletin is on air (between slots, or switched off).
  if (bulletin) rows.push({ key: 'bulletin', type: 'bulletin', ...bulletin });
  if (poll) rows.push({ key: `poll-${poll.id}`, type: 'poll', poll });

  if (home.latest.length) {
    rows.push({ key: 'latest-h', type: 'section', title: latestTitle });
    home.latest.slice(0, 6).forEach((a) => article('compact', 'latest', a));
  }

  // §3 what's happening in your mandal.
  const mandal = home.mandal_block;
  if (mandal?.articles.length) {
    rows.push({ key: 'mandal-h', type: 'section', title: pick(mandal.title_te, mandal.title_en), href: '/local' });
    article('lead', 'mandal', mandal.articles[0]);
    mandal.articles.slice(1, 5).forEach((a) => article('row', 'mandal', a));
  }

  rows.push({ key: 'video', type: 'video' });

  for (const section of home.sections) {
    rows.push({
      key: `s-${section.key}-h`,
      type: 'section',
      title: pick(section.title_te, section.title_en),
      href: section.key === 'trending' ? '/trending' : { pathname: '/section/[slug]', params: { slug: section.key } },
    });
    if (section.articles[0]) article('lead', `s-${section.key}`, section.articles[0]);
    section.articles.slice(1, 5).forEach((a) => article('row', `s-${section.key}`, a));
  }

  if (!home.lead && !home.sections.length) rows.push({ key: 'empty', type: 'empty' });
  return rows;
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

  const unread = useQuery({
    queryKey: ['inbox-unread'],
    queryFn: () => notificationsApi.fetchInbox(0),
    enabled: authed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // §3.2 personalized rail — fetched separately so the shared home payload
  // stays cacheable; anonymous readers simply never see the block.
  const forYou = useQuery({
    queryKey: ['for-you-home'],
    queryFn: () => engagementApi.fetchForYou(0, 5),
    enabled: authed,
    staleTime: 120_000,
  });

  const config = useQuery({
    queryKey: ['config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const topics = useQuery({
    queryKey: ['top-topics'],
    queryFn: epaperApi.fetchTopics,
  });
  const polls = useQuery({
    queryKey: ['big-question'],
    queryFn: () => epaperApi.fetchPolls(true),
  });

  // The player lives here, not in the row: a virtualised row unmounts a few
  // viewports down and would release the audio mid-bulletin.
  const bulletin = useBulletin();
  const onAir = bulletin.data?.available && bulletin.data.url ? bulletin.data : undefined;
  const player = useAudioPlayer(onAir ? absoluteMediaUrl(onAir.url) : null);

  const district = edition ? config.data?.districts.find((d) => d.slug === edition) : undefined;
  const editionName = district ? pick(district.name_te, district.name_en) : null;
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
      case 'lead':
        return <LeadCard article={item.article} index={stagger} />;
      case 'row':
        return <RowCard article={item.article} index={stagger} />;
      case 'compact':
        return <CompactCard article={item.article} index={stagger} />;
      case 'section': {
        const href = item.href;
        return <SectionHeader title={item.title} onSeeAll={href ? () => router.push(href) : undefined} />;
      }
      case 'poll':
        return <PollCard poll={item.poll} />;
      case 'bulletin':
        return <BulletinCard bulletin={item.bulletin} player={item.player} />;
      case 'video':
        return <VideoStrip />;
      case 'empty':
        return <EmptyState />;
    }
  };

  const rows = home.data
    ? flatten(
        home.data,
        authed ? (forYou.data?.articles ?? []) : [],
        onAir ? { bulletin: onAir, player } : undefined,
        polls.data?.[0],
        pick,
        t('foryou.title'),
        t('home.latest'),
      )
    : [];

  return (
    <Screen>
      <ScreenHeader
        large
        title={t('site.name')}
        subtitle={editionName ?? undefined}
        collapsible={{ scrollY }}
        right={
          <View style={styles.actions}>
            {editionName ? null : (
              <IconButton name="mapPin" label={t('ui.chooseDistrict')} onPress={() => router.push('/local')} />
            )}
            <IconButton name="zap" label={t('shorts.title')} onPress={() => router.push('/short-news')} />
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
              epaper={home.data?.epaper ?? null}
              topics={topics.data?.items ?? []}
            />
          }
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={home.isRefetching}
              onRefresh={() => home.refetch()}
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
  content: { paddingBottom: space.xl },
}));
