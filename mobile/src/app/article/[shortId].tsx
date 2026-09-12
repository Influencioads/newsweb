import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View, type LayoutChangeEvent, type ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { api } from '@/api/client';
import * as publicApi from '@/api/public';
import { ArticleAudio } from '@/components/ArticleAudio';
import { RowCard } from '@/components/ArticleCard';
import { ArticleActionBar, ACTION_BAR_HEIGHT } from '@/components/article/ArticleActionBar';
import { ArticleHeader } from '@/components/article/ArticleHeader';
import { ArticleHero } from '@/components/article/ArticleHero';
import { BodyRenderer } from '@/components/BodyRenderer';
import { Comments } from '@/components/Comments';
import { EngagementRow } from '@/components/EngagementRow';
import { ErrorState, LoadingState } from '@/components/Feedback';
import { FollowChip } from '@/components/FollowChip';
import { PollCard } from '@/components/PollCard';
import { SectionHeader } from '@/components/SectionHeader';
import { useReadingBeacon } from '@/lib/beacon';
import { timeAgo, useI18n } from '@/lib/i18n';
import { SPRING, useMotion } from '@/lib/motion';
import { radius, space } from '@/lib/theme';
import { extractPlainText, useTts } from '@/lib/tts';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Divider } from '@/ui/Divider';
import { Icon } from '@/ui/Icon';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';

/**
 * Article page (§5): hero, headline, standfirst, byline, the Tiptap body
 * rendered natively, the §5 engagement row, follows, poll, comments and
 * related stories.
 *
 * The scroll drives three things off one UI-thread handler: the hero's
 * parallax, the reading-progress rule in the header, and the action bar that
 * tucks away on a scroll down. The §3.1 reading beacon rides the same
 * handler, throttled to 4 Hz before it crosses to JS.
 */

/** Beacon ceiling: 4 scroll-depth reports a second, no more. */
const BEACON_MS = 250;
/** Scroll past this before the action bar is allowed to hide. */
const BAR_HIDE_AFTER = 160;
/** Scroll delta that counts as a deliberate direction change. */
const BAR_DELTA = 8;

export default function ArticleScreen() {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const reduce = m.reduce;
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const { t, pick, language } = useI18n();
  const insets = useSafeAreaInsets();

  const article = useQuery({
    queryKey: ['article', shortId],
    queryFn: () => publicApi.fetchArticle(shortId!),
    enabled: Boolean(shortId),
  });

  const data = article.data;

  // §3.1 behaviour tracking: view, read heartbeats, scroll depth.
  const reportScroll = useReadingBeacon(data ? shortId : undefined);

  // §16 audio news, v1: the platform's Telugu voice. Headline first so a
  // listener knows immediately which story started.
  const tts = useTts(data ? `${data.title_te}. ${extractPlainText(data.body)}` : '');

  // Which of the four formats this story has. A host that cannot shape Telugu
  // reports `card.available: false`, and the card button is simply not offered.
  const formats = useQuery({
    queryKey: ['formats', shortId],
    queryFn: async () =>
      (await api.get<{ card: { available: boolean } }>(`/public/articles/${shortId}/formats`)).data,
    enabled: Boolean(shortId),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const scrollRef = useAnimatedRef<ScrollView>();
  const scrollY = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const lastY = useSharedValue(0);
  const lastSent = useSharedValue(0);
  /** 0 = action bar shown, 1 = tucked below the edge. */
  const barHidden = useSharedValue(0);
  const commentsY = useSharedValue(0);
  const audioY = useSharedValue(0);

  const progress = useDerivedValue(() => {
    const scrollable = contentHeight.value - viewportHeight.value;
    if (scrollable <= 0) return 0;
    return Math.min(1, Math.max(0, scrollY.value / scrollable));
  });

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      const y = event.contentOffset.y;
      const delta = y - lastY.value;
      scrollY.value = y;
      lastY.value = y;

      if (!reduce) {
        if (delta > BAR_DELTA && y > BAR_HIDE_AFTER) barHidden.value = withSpring(1, SPRING.sheet);
        else if (delta < -BAR_DELTA || y < BAR_HIDE_AFTER) barHidden.value = withSpring(0, SPRING.sheet);
      }

      // Scroll depth, capped at 4 Hz: the beacon only keeps the deepest value,
      // so a finer stream would cost a JS hop for nothing.
      const scrollable = contentHeight.value - viewportHeight.value;
      const now = Date.now();
      if (scrollable > 0 && now - lastSent.value >= BEACON_MS) {
        lastSent.value = now;
        runOnJS(reportScroll)(((y + 0.5) / scrollable) * 100);
      }
    },
    // The throttle can swallow the last frame of a flick; the resting depth is
    // the one that matters most, so it always reports.
    onMomentumEnd: (event) => {
      const scrollable = contentHeight.value - viewportHeight.value;
      if (scrollable > 0) runOnJS(reportScroll)(((event.contentOffset.y + 0.5) / scrollable) * 100);
    },
  });

  function scrollToOffset(y: number) {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: !reduce });
  }

  function onCommentsLayout(event: LayoutChangeEvent) {
    commentsY.value = event.nativeEvent.layout.y;
  }

  // The player lives in the story, not in a sheet, so playback outlives any
  // control the reader opens; listen just brings it back into view.
  function onAudioLayout(event: LayoutChangeEvent) {
    audioY.value = event.nativeEvent.layout.y;
  }

  const headerTitle = data?.category
    ? pick(data.category.name_te, data.category.name_en)
    : t('screen.article');

  return (
    <Screen edges={['top']} background="paper" keyboard>
      <Stack.Screen options={{ headerShown: false, title: t('screen.article') }} />
      <ArticleHeader
        title={headerTitle}
        subtitle={data ? timeAgo(data.published_at, language) : undefined}
        scrollY={scrollY}
        progress={progress}
      />

      {article.isLoading ? <LoadingState variant="article" /> : null}
      {article.isError ? <ErrorState error={article.error} onRetry={() => article.refetch()} /> : null}

      {data ? (
        <>
          <Animated.ScrollView
            ref={scrollRef}
            style={styles.scroll}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={(_, height) => {
              contentHeight.value = height;
            }}
            onLayout={(event) => {
              viewportHeight.value = event.nativeEvent.layout.height;
            }}
            contentContainerStyle={{ paddingBottom: ACTION_BAR_HEIGHT + insets.bottom + space.xl }}
          >
            {data.hero?.url ? <ArticleHero media={data.hero} scrollY={scrollY} /> : null}

            <View style={styles.head}>
              {data.is_breaking || data.is_exclusive || data.ai_generated ? (
                <View style={styles.flags}>
                  {data.is_breaking ? (
                    <Badge tone="breaking" label={t('home.breaking')} icon="zap" size="xs" />
                  ) : null}
                  {data.is_exclusive ? (
                    <Badge tone="exclusive" label={t('article.exclusive')} size="xs" />
                  ) : null}
                  {/* §7 disclosure — an AI-assisted story says so on the story. */}
                  {data.ai_generated ? (
                    <Badge tone="ai" label={t('article.aiLabel')} icon="sparkles" size="xs" />
                  ) : null}
                </View>
              ) : null}

              <T variant="headlineLg" weight="heavy" scaled accessibilityRole="header">
                {data.title_te}
              </T>

              {data.sub_title_te ? (
                <T variant="body" weight="regular" color="inkSoft" scaled style={styles.standfirst}>
                  {data.sub_title_te}
                </T>
              ) : null}

              <Divider style={styles.rule} />

              <View style={styles.byline}>
                {data.byline_te || data.author ? (
                  <T variant="bodySmall" weight="semibold">
                    {data.byline_te ?? pick(data.author?.name_te, data.author?.name_en)}
                  </T>
                ) : null}
                <T variant="meta" color="muted">
                  {[
                    data.district ? pick(data.district.name_te, data.district.name_en) : null,
                    timeAgo(data.published_at, language),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </T>
              </View>
            </View>

            {/* §16/§19 listen — a direct child of the scroll, so its layout y is
                what the action bar's headphones button jumps to, and it keeps
                playing while the reader reads. */}
            <View style={styles.audio} onLayout={onAudioLayout}>
              <ArticleAudio
                shortId={data.short_id}
                deviceSpeaking={tts.speaking}
                onToggleDevice={tts.toggle}
                listenLabel={t('article.listen')}
                stopLabel={t('article.stopListening')}
              />
            </View>

            <View style={styles.body}>
              {/* §7 corrections — the note travels with the story, never silently. */}
              {data.correction_note_te ? (
                <View style={styles.correction}>
                  <Icon name="info" size={20} color={color.exclusive} />
                  <T variant="bodySmall" scaled style={styles.correctionText}>
                    {data.correction_note_te}
                  </T>
                </View>
              ) : null}

              <BodyRenderer doc={data.body} />

              {data.source_credit ? (
                <T variant="meta" scaled color="muted" style={styles.credit}>
                  {data.source_credit}
                </T>
              ) : null}

              {/* Like · save · share · report (§5) */}
              <EngagementRow article={data} cardAvailable={formats.data?.card.available ?? false} />

              {/* Follow the threads this story belongs to (§12) */}
              <View style={styles.followRow}>
                <T variant="meta" weight="semibold" color="muted">
                  {t('engage.follow')}
                </T>
                {data.category ? (
                  <FollowChip
                    targetType="category"
                    slug={data.category.slug}
                    name={pick(data.category.name_te, data.category.name_en)}
                  />
                ) : null}
                {data.district ? (
                  <FollowChip
                    targetType="district"
                    slug={data.district.slug}
                    name={pick(data.district.name_te, data.district.name_en)}
                  />
                ) : null}
                {data.author?.author_slug ? (
                  <FollowChip
                    targetType="author"
                    slug={data.author.author_slug}
                    name={pick(data.author.name_te, data.author.name_en)}
                  />
                ) : null}
              </View>

              {data.poll ? <PollCard poll={data.poll} /> : null}
            </View>

            {/* Comments (§5) — a direct child of the scroll, so its layout y is
                the offset the action bar's comment button jumps to. */}
            <View style={styles.comments} onLayout={onCommentsLayout}>
              <Comments shortId={data.short_id} />
            </View>

            {data.related.length ? (
              <View style={styles.related}>
                <SectionHeader title={t('article.related')} />
                {data.related.map((item, index) => (
                  <RowCard key={item.short_id} article={item} index={index} />
                ))}
              </View>
            ) : null}
          </Animated.ScrollView>

          <ArticleActionBar
            article={data}
            cardAvailable={formats.data?.card.available ?? false}
            speaking={tts.speaking}
            onToggleSpeech={tts.toggle}
            onListen={() => scrollToOffset(audioY.value)}
            hidden={barHidden}
            onComments={() => scrollToOffset(commentsY.value)}
          />
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((color) => ({
  scroll: { flex: 1, backgroundColor: color.paper },
  head: { paddingHorizontal: space.lg, paddingTop: space.lg },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  standfirst: { marginTop: space.sm },
  rule: { marginTop: space.lg },
  byline: { paddingTop: space.md, gap: space.xs },
  audio: { paddingHorizontal: space.lg, paddingTop: space.lg },
  body: { paddingHorizontal: space.lg, paddingTop: space.lg },
  correction: {
    flexDirection: 'row',
    gap: space.sm,
    borderLeftWidth: 3,
    borderLeftColor: color.exclusive,
    backgroundColor: color.exclusiveTint,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.lg,
  },
  correctionText: { flex: 1 },
  credit: { marginTop: space.sm },
  followRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
  },
  comments: { paddingHorizontal: space.lg },
  related: { backgroundColor: color.canvas, marginTop: space.xl },
}));
