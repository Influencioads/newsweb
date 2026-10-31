import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useId, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { absoluteMediaUrl } from '@/api/client';
import type { StoryShotItem } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { useSiteConfig } from '@/lib/siteContent';
import { useMotion } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { IconButton } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * Story Shots — the home shelf (twin of the website's `StoryShotsStrip` in
 * frontend/src/features/wow/StoryShots.tsx).
 *
 * One shot at a time in a vertical window: swipe up for the next shot, down
 * for the previous one (it snaps a whole shot per swipe, like the full-screen
 * deck). The arrows beside it do the same for readers who can't swipe. A tap
 * opens the full-screen deck (`app/story-shots.tsx`) at that shot. As on the
 * website, the pictures are only the ones uploaded in CMS → Story Shots, in the
 * desk's order — never article photos; with none uploaded the shelf is hidden.
 */

/** One uploaded picture, ready for the shelf and the deck. */
export interface StoryShot {
  key: string;
  uri: string | null;
  title_te: string;
  title_en: string;
  /** "Read story": a page on the website or an https address; '' for none. */
  link: string;
}

function fromUpload(shot: StoryShotItem): StoryShot {
  return {
    key: shot.id,
    uri: absoluteMediaUrl(shot.image_url),
    title_te: shot.title_te,
    title_en: shot.title_en,
    link: shot.link,
  };
}

/** The shots, shared by the shelf and the deck (from the site config). */
export function useStoryShots() {
  const config = useSiteConfig();
  const uploaded = config.data?.content?.story_shots?.shots;
  const data = useMemo(() => (uploaded ?? []).map(fromUpload), [uploaded]);
  return { data, isLoading: config.isLoading, isError: config.isError, error: config.error, refetch: config.refetch };
}

/** Open the deck, optionally at one shot. */
export function openStoryShots(start?: string) {
  router.push(start ? { pathname: '/story-shots', params: { start } } : '/story-shots');
}

/**
 * A constant-dark fade from transparent to the overlay, so white type on a
 * photograph reads in both themes. `from` flips it for a top band.
 */
export function StoryScrim({ from = 'bottom', strength = 0.85 }: { from?: 'top' | 'bottom'; strength?: number }) {
  const color = useColors();
  const id = `scrim${useId().replace(/:/g, '')}`;
  const top = from === 'top';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.overlay} stopOpacity={top ? strength : 0} />
            <Stop offset="1" stopColor={color.overlay} stopOpacity={top ? 0 : strength} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** The window's height for a given width: a tall photo card, capped on tablets. */
function windowHeight(width: number) {
  return Math.min(Math.round(width * 1.25), 560);
}

function ShelfCard({
  shot,
  n,
  count,
  height,
}: {
  shot: StoryShot;
  n: number;
  count: number;
  height: number;
}) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick } = useI18n();
  const title = pick(shot.title_te, shot.title_en);
  const name = pick('స్టోరీ షాట్స్', 'Story Shots');

  return (
    <PressableScale
      onPress={() => openStoryShots(shot.key)}
      haptic="select"
      accessibilityRole="link"
      accessibilityLabel={title || `${name} ${n}`}
      style={[styles.card, { height }]}
    >
      {shot.uri ? (
        <Image
          source={{ uri: shot.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={m.imageTransition}
          recyclingKey={shot.key}
          accessible={false}
        />
      ) : null}
      <View style={styles.topBand}>
        <StoryScrim from="top" strength={0.6} />
        <View style={styles.number}>
          <T variant="meta" weight="bold" color="onWow" lang="en">
            {`${n} / ${count}`}
          </T>
        </View>
      </View>
      <View style={styles.caption}>
        <StoryScrim strength={title ? 0.85 : 0.5} />
        {title ? (
          <T variant="headlineMd" weight="bold" color="onOverlay" numberOfLines={4}>
            {title}
          </T>
        ) : null}
        {n < count ? (
          <View style={styles.hint} importantForAccessibility="no-hide-descendants">
            <Icon name="chevronUp" size={16} color={color.mutedLight} />
            <T variant="meta" color="mutedLight" numberOfLines={1}>
              {pick('తదుపరి కథ కోసం పైకి స్వైప్ చేయండి', 'Swipe up for the next story')}
            </T>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Home shelf: a header with a "see all" link and a vertical, one-at-a-time window of shots. */
export function StoryShotsShelf() {
  const styles = useStyles();
  const color = useColors();
  const { pick, t } = useI18n();
  const shots = useStoryShots();
  const items = shots.data;
  const { width: screen } = useWindowDimensions();
  const height = windowHeight(screen - space.lg * 2);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(0);
  const count = items.length;

  // Which shot is showing: the page nearest the scroll position.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.y / height);
      setIndex(Math.min(count - 1, Math.max(0, page)));
    },
    [height, count],
  );
  const go = (to: number) => scroller.current?.scrollTo({ y: to * height, animated: true });

  if (!count) return null;

  const title = pick('స్టోరీ షాట్స్', 'Story Shots');

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Icon name="galleryVertical" size={20} color={color.wowDeep} />
          <T variant="headlineMd" weight="bold" color="brand" accessibilityRole="header" style={styles.title} numberOfLines={1}>
            {title}
          </T>
        </View>
        <PressableScale
          onPress={() => openStoryShots()}
          haptic="select"
          minHeight={TAP}
          accessibilityRole="link"
          accessibilityLabel={`${t('home.seeAll')}: ${title}`}
          style={styles.seeAll}
        >
          <T variant="ui" weight="semibold" color="info" numberOfLines={1}>
            {t('home.seeAll')}
          </T>
          <Icon name="chevronRight" size={16} color={color.info} />
        </PressableScale>
      </View>
      <View style={styles.frame}>
        {/* Its own vertical scroller inside the home list: a swipe that starts on
            a shot moves the shots; anywhere else still scrolls the page. */}
        <ScrollView
          ref={scroller}
          style={{ height }}
          nestedScrollEnabled
          pagingEnabled
          snapToInterval={height}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
        >
          {items.map((shot, i) => (
            <ShelfCard key={shot.key} shot={shot} n={i + 1} count={count} height={height} />
          ))}
        </ScrollView>
        <View pointerEvents="box-none" style={styles.arrows}>
          <IconButton
            name="chevronUp"
            label={pick('మునుపటి కథ', 'Previous story')}
            variant="inverse"
            disabled={index === 0}
            onPress={() => go(index - 1)}
            style={index === 0 ? styles.arrowOff : undefined}
          />
          <IconButton
            name="chevronDown"
            label={pick('తదుపరి కథ', 'Next story')}
            variant="inverse"
            disabled={index === count - 1}
            onPress={() => go(index + 1)}
            style={index === count - 1 ? styles.arrowOff : undefined}
          />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flexShrink: 1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.sm },
  frame: { marginHorizontal: space.lg, marginBottom: space.sm, borderRadius: radius.lg, overflow: 'hidden' },
  card: {
    width: '100%',
    justifyContent: 'space-between',
    overflow: 'hidden',
    backgroundColor: color.inkDeep,
  },
  arrows: { position: 'absolute', right: space.sm, top: 0, bottom: 0, justifyContent: 'center', gap: space.sm },
  arrowOff: { opacity: 0.4 },
  topBand: { padding: space.md, paddingBottom: space.xl, alignItems: 'flex-start' },
  number: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.wowDeep,
  },
  caption: { gap: space.xs, padding: space.lg, paddingTop: space.xxl, paddingRight: space.xxl + space.lg },
  hint: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingTop: space.xs },
}));
