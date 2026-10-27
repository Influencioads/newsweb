import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { absoluteMediaUrl } from '@/api/client';
import type { ArticleCard } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { ShareOptionsSheet } from '@/components/ShareSheet';
import { StoryScrim, useStoryShots } from '@/components/wow/StoryShotsShelf';
import { timeAgo, useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Button, IconButton } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { T } from '@/ui/Text';

/**
 * `/story-shots` — the full-screen Story Shots viewer, Reels style: one story
 * per screen, stacked vertically. Swipe up for the next story, down for the
 * previous one; the list snaps a whole screen at a time. Each story shows the
 * photo full-bleed, the section, the headline and a short summary, with "Read
 * full story" and share. The top bar (title, "n / N", close) stays put while
 * the stories move under it. `?start=<short_id>` opens at the story tapped on
 * the home shelf.
 */

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function openArticle(shortId: string) {
  router.push({ pathname: '/article/[shortId]', params: { shortId } });
}

export default function StoryShotsScreen() {
  const { pick } = useI18n();
  const shots = useStoryShots();
  const items = useMemo(() => shots.data ?? [], [shots.data]);
  const title = pick('స్టోరీ షాట్స్', 'Story Shots');

  if (items.length) return <Deck items={items} />;

  // Loading, failure and an empty desk are ordinary screens with a back
  // button: there is no photo yet to go full-bleed with.
  return (
    <Screen edges={['top']} bottomInset>
      <Stack.Screen options={{ headerShown: false, title }} />
      <ScreenHeader title={title} />
      {shots.isLoading ? (
        <LoadingState />
      ) : shots.isError ? (
        <ErrorState error={shots.error} onRetry={() => void shots.refetch()} />
      ) : (
        <EmptyState
          icon="galleryVertical"
          title={pick('స్టోరీ షాట్స్ త్వరలో', 'Story Shots are on the way')}
          body={pick('సంపాదకులు కొత్త కథలు సిద్ధం చేస్తున్నారు.', 'The desk is preparing new stories.')}
          action={<Button label={pick('హోమ్‌కి వెళ్లండి', 'Go home')} onPress={() => router.replace('/')} />}
        />
      )}
    </Screen>
  );
}

function Deck({ items }: { items: ArticleCard[] }) {
  const styles = useStyles();
  const color = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { pick } = useI18n();
  const { start } = useLocalSearchParams<{ start?: string }>();
  const count = items.length;

  const startIndex = Math.max(0, start ? items.findIndex((a) => a.short_id === start) : 0);
  const [index, setIndex] = useState(startIndex);
  const [shareFor, setShareFor] = useState<ArticleCard | null>(null);

  // Which story is on screen: the page nearest the scroll position.
  const onSettle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.y / height);
      setIndex(Math.min(count - 1, Math.max(0, page)));
    },
    [height, count],
  );

  // Warm the next photo so swiping up never waits on the network.
  const upcoming = absoluteMediaUrl(items[index + 1]?.hero?.url ?? null);
  useEffect(() => {
    if (upcoming) void Image.prefetch(upcoming);
  }, [upcoming]);

  const deckTitle = pick('స్టోరీ షాట్స్', 'Story Shots');
  const renderItem: ListRenderItem<ArticleCard> = ({ item, index: i }) => (
    <Shot article={item} height={height} last={i === count - 1} onShare={setShareFor} />
  );

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false, title: deckTitle }} />
      <StatusBar style="light" />

      <FlatList
        data={items}
        keyExtractor={(a) => a.short_id}
        renderItem={renderItem}
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
        onScroll={onSettle}
        scrollEventThrottle={32}
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
      />

      {/* Fixed top bar over the moving stories. */}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <StoryScrim from="top" strength={0.7} />
        <View pointerEvents="box-none" style={styles.headerRow}>
          <View style={styles.badge}>
            <Icon name="galleryVertical" size={16} color={color.onWow} />
          </View>
          <View style={styles.headerText}>
            <T variant="ui" weight="bold" color="onOverlay" numberOfLines={1}>
              {deckTitle}
            </T>
            <T variant="meta" color="onOverlay" lang="en" numberOfLines={1}>
              {`${index + 1} / ${count}`}
            </T>
          </View>
          <IconButton name="x" label={pick('మూసివేయండి', 'Close')} color={color.onOverlay} onPress={close} />
        </View>
      </View>

      {shareFor ? (
        <ShareOptionsSheet
          open
          onClose={() => setShareFor(null)}
          shortId={shareFor.short_id}
          url={shareFor.url}
          title={pick(shareFor.title_te, shareFor.title_en)}
        />
      ) : null}
    </View>
  );
}

/** One full-screen story in the vertical list. */
function Shot({
  article,
  height,
  last,
  onShare,
}: {
  article: ArticleCard;
  height: number;
  last: boolean;
  onShare: (a: ArticleCard) => void;
}) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const insets = useSafeAreaInsets();
  const { pick, language } = useI18n();

  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  const head = pick(article.title_te, article.title_en);
  const category = article.category ? pick(article.category.name_te, article.category.name_en) : null;
  const meta = [
    article.district ? pick(article.district.name_te, article.district.name_en) : null,
    timeAgo(article.published_at, language),
  ]
    .filter(Boolean)
    .join(' · ');
  const read = pick('పూర్తి కథ చదవండి', 'Read full story');

  return (
    <View style={[styles.shot, { height }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
          transition={m.imageTransition}
          accessibilityLabel={article.hero?.alt_te ?? ''}
        />
      ) : null}

      <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <StoryScrim strength={0.92} />
        <View pointerEvents="box-none" style={styles.copy}>
          {category ? (
            <View style={styles.category}>
              <T variant="meta" weight="bold" color="onWow" numberOfLines={1}>
                {category}
              </T>
            </View>
          ) : null}
          <T variant="headlineLg" weight="bold" color="onOverlay" numberOfLines={5} accessibilityRole="header">
            {head}
          </T>
          {article.summary_te ? (
            <T variant="body" color="onOverlay" lang="te" numberOfLines={4}>
              {article.summary_te}
            </T>
          ) : null}
          {meta ? (
            <T variant="meta" color="mutedLight" numberOfLines={1}>
              {meta}
            </T>
          ) : null}
        </View>
        <View pointerEvents="box-none" style={styles.actions}>
          <PressableScale
            onPress={() => openArticle(article.short_id)}
            minHeight={TAP_LG}
            accessibilityRole="link"
            accessibilityLabel={`${read}: ${head}`}
            style={styles.read}
          >
            <T variant="ui" weight="bold" color="onWow" numberOfLines={1}>
              {read}
            </T>
            <Icon name="arrowRight" size={20} color={color.onWow} />
          </PressableScale>
          <IconButton
            name="share"
            label={pick('షేర్ చేయండి', 'Share')}
            size={TAP_LG}
            variant="inverse"
            onPress={() => onShare(article)}
          />
        </View>
        {!last ? (
          <View style={styles.hint} importantForAccessibility="no-hide-descendants">
            <Icon name="chevronUp" size={16} color={color.mutedLight} />
            <T variant="meta" color="mutedLight" numberOfLines={1}>
              {pick('తదుపరి కథ కోసం పైకి స్వైప్ చేయండి', 'Swipe up for the next story')}
            </T>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  // Constant-dark in both themes: the deck is a photo viewer.
  page: { flex: 1, backgroundColor: color.inkDeep },
  shot: { width: '100%', overflow: 'hidden', backgroundColor: color.inkDeep },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.wowDeep,
  },
  headerText: { flex: 1, minWidth: 0 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.xxl * 3,
    gap: space.lg,
  },
  copy: { gap: space.sm },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  category: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: color.wowDeep,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  read: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.wowDeep,
  },
}));
