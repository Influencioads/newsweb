import { Image } from 'expo-image';
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
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
 * `/story-shots` — the full-screen Story Shots deck (twin of the website's
 * `StoryShotsPage` in frontend/src/features/wow/StoryShots.tsx), the way
 * readers already know from WhatsApp Status and Instagram Stories:
 *
 *   - one shot per screen: the photo full-bleed, the section, the headline
 *     and a short summary, with "Read full story" and share underneath;
 *   - segmented progress bars across the top; the current one fills over
 *     SHOT_MS and the next shot opens on its own, stopping after the last;
 *   - tap the right half for next, the left half for previous; press and
 *     hold anywhere on the photo to pause; fling sideways to step, fling
 *     down (or the close button) to leave;
 *   - `?start=<short_id>` opens at the shot tapped on the home shelf.
 *
 * Readers who ask the OS for reduced motion, and screen-reader users, get no
 * autoplay — they step through by hand. The deck also holds still while it
 * is covered (an article pushed on top, the share sheet open).
 */

/** How long each shot stays up before the deck moves on by itself. */
const SHOT_MS = 9000;

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
  const m = useMotion();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { pick, language } = useI18n();
  const { start } = useLocalSearchParams<{ start?: string }>();

  // The open shot is remembered by id, not position, so a background refetch
  // that reorders the feed never swaps the story under the reader.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const startIndex = Math.max(0, start ? items.findIndex((a) => a.short_id === start) : 0);
  const found = currentId ? items.findIndex((a) => a.short_id === currentId) : -1;
  const index = found >= 0 ? found : startIndex;
  const article = items[index];
  const count = items.length;

  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (live) setScreenReader(on);
    });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const autoplay = !m.reduce && !screenReader;
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const running = autoplay && !paused && !held && !shareOpen && focused;

  const next = useCallback(() => {
    if (index < count - 1) setCurrentId(items[index + 1].short_id);
    // After the last shot, stop on it rather than looping forever.
    else setPaused(true);
  }, [index, count, items]);
  const prev = useCallback(() => {
    if (index > 0) setCurrentId(items[index - 1].short_id);
  }, [index, items]);

  // The current bar. `elapsed` is the time this shot has already been on
  // screen, so a pause resumes where it stopped instead of starting over.
  const progress = useSharedValue(0);
  const elapsed = useRef(0);
  const shownId = useRef<string | null>(null);
  useEffect(() => {
    if (shownId.current !== article.short_id) {
      shownId.current = article.short_id;
      elapsed.current = 0;
    }
    cancelAnimation(progress);
    if (!autoplay) {
      progress.set(1);
      return;
    }
    progress.set(elapsed.current / SHOT_MS);
    if (!running) return;
    const remaining = Math.max(0, SHOT_MS - elapsed.current);
    const startedAt = Date.now();
    progress.set(m.timing(1, remaining, { easing: Easing.linear }));
    const timer = setTimeout(next, remaining);
    return () => {
      clearTimeout(timer);
      elapsed.current = Math.min(SHOT_MS, elapsed.current + Date.now() - startedAt);
    };
  }, [article.short_id, autoplay, running, next, progress, m]);

  const togglePlay = useCallback(() => {
    if (paused && index === count - 1 && elapsed.current >= SHOT_MS) {
      // Play pressed on the finished deck: start again from the first shot.
      elapsed.current = 0;
      setCurrentId(items[0].short_id);
    }
    setPaused((p) => !p);
  }, [paused, index, count, items]);

  // Warm the next photo so stepping on never waits on the network.
  const upcoming = absoluteMediaUrl(items[index + 1]?.hero?.url ?? null);
  useEffect(() => {
    if (upcoming) void Image.prefetch(upcoming);
  }, [upcoming]);

  const fling = useMemo(
    () =>
      Gesture.Race(
        Gesture.Fling().direction(Directions.LEFT).runOnJS(true).onStart(next),
        Gesture.Fling().direction(Directions.RIGHT).runOnJS(true).onStart(prev),
        Gesture.Fling().direction(Directions.DOWN).runOnJS(true).onStart(close),
      ),
    [next, prev],
  );

  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  const head = pick(article.title_te, article.title_en);
  const category = article.category ? pick(article.category.name_te, article.category.name_en) : null;
  const meta = [
    article.district ? pick(article.district.name_te, article.district.name_en) : null,
    timeAgo(article.published_at, language),
  ]
    .filter(Boolean)
    .join(' · ');
  const deckTitle = pick('స్టోరీ షాట్స్', 'Story Shots');
  const labels = {
    prev: pick('మునుపటి', 'Previous'),
    next: pick('తదుపరి', 'Next'),
    play: pick('ప్లే', 'Play'),
    pause: pick('ఆపు', 'Pause'),
    close: pick('మూసివేయండి', 'Close'),
    share: pick('షేర్ చేయండి', 'Share'),
    read: pick('పూర్తి కథ చదవండి', 'Read full story'),
  };

  // Press and hold on either half pauses; the no-op long press keeps the
  // release after a hold from also stepping on.
  const hold = { onPressIn: () => setHeld(true), onPressOut: () => setHeld(false), onLongPress: () => {} };

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false, title: deckTitle }} />
      <StatusBar style="light" />

      <GestureDetector gesture={fling}>
        <View style={styles.fill}>
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

          {/* Tap zones: left half back, right half forward. */}
          <View style={styles.zones}>
            <PressableScale
              {...hold}
              onPress={prev}
              haptic="select"
              scaleTo={1}
              disabled={index === 0}
              accessibilityLabel={labels.prev}
              style={styles.zone}
            />
            <PressableScale
              {...hold}
              onPress={next}
              haptic="select"
              scaleTo={1}
              accessibilityLabel={labels.next}
              style={styles.zone}
            />
          </View>

          {/* Top: progress + controls over the photo. */}
          <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
            <StoryScrim from="top" strength={0.7} />
            <View style={styles.bars} aria-hidden>
              {items.map((a, i) => (
                <View key={a.short_id} style={styles.track}>
                  {i < index ? (
                    <View style={styles.full} />
                  ) : i === index ? (
                    <CurrentFill progress={progress} />
                  ) : null}
                </View>
              ))}
            </View>
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
              {autoplay ? (
                <IconButton
                  name={paused ? 'play' : 'pause'}
                  label={paused ? labels.play : labels.pause}
                  color={color.onOverlay}
                  onPress={togglePlay}
                />
              ) : null}
              <IconButton name="x" label={labels.close} color={color.onOverlay} onPress={close} />
            </View>
          </View>

          {/* Bottom: the shot itself. */}
          <View pointerEvents="box-none" style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
            <StoryScrim strength={0.92} />
            <Animated.View key={article.short_id} entering={m.fadeIn()} pointerEvents="box-none" style={styles.copy}>
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
            </Animated.View>
            <View pointerEvents="box-none" style={styles.actions}>
              <PressableScale
                onPress={() => openArticle(article.short_id)}
                minHeight={TAP_LG}
                accessibilityRole="link"
                accessibilityLabel={`${labels.read}: ${head}`}
                style={styles.read}
              >
                <T variant="ui" weight="bold" color="onWow" numberOfLines={1}>
                  {labels.read}
                </T>
                <Icon name="arrowRight" size={20} color={color.onWow} />
              </PressableScale>
              <IconButton
                name="share"
                label={labels.share}
                size={TAP_LG}
                variant="inverse"
                onPress={() => setShareOpen(true)}
              />
            </View>
          </View>
        </View>
      </GestureDetector>

      <ShareOptionsSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shortId={article.short_id}
        url={article.url}
        title={head}
      />
    </View>
  );
}

/** The filling segment of the current shot. */
function CurrentFill({ progress }: { progress: SharedValue<number> }) {
  const styles = useStyles();
  const fill = useAnimatedStyle(() => ({ width: `${Math.min(1, Math.max(0, progress.value)) * 100}%` }));
  return <Animated.View style={[styles.fillBar, fill]} />;
}

const useStyles = makeStyles((color) => ({
  // Constant-dark in both themes: the deck is a photo viewer.
  page: { flex: 1, backgroundColor: color.inkDeep },
  fill: { flex: 1 },
  zones: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  zone: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.sm },
  bars: { flexDirection: 'row', gap: space.xs },
  track: { flex: 1, height: 3, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: color.mutedLight },
  full: { flex: 1, backgroundColor: color.onOverlay },
  fillBar: { height: 3, backgroundColor: color.onOverlay },
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
