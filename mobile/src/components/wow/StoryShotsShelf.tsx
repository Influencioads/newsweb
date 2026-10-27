import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useId } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { absoluteMediaUrl } from '@/api/client';
import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * Story Shots — the home shelf (twin of the website's `StoryShotsStrip` in
 * frontend/src/features/wow/StoryShots.tsx).
 *
 * A sideways row of tall 9:16 cards, one per shot; a tap opens the
 * full-screen deck (`app/story-shots.tsx`) at that shot. The source is the
 * same as the website's: the newest stories that carry a hero photo. The
 * short-news feed is deliberately not used — its items are picture-only
 * cards, with no headline or standfirst for a shot to show.
 */

export const STORY_SHOTS_LIMIT = 12;

/** The shots, shared by the shelf and the deck (one query key, one request). */
export function useStoryShots() {
  return useQuery({
    queryKey: ['public', 'story-shots'],
    queryFn: async () => {
      const latest = (await publicApi.fetchFeed({ limit: STORY_SHOTS_LIMIT * 2 })).articles;
      return latest.filter((a) => a.hero?.url).slice(0, STORY_SHOTS_LIMIT);
    },
    staleTime: 60_000,
  });
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

const CARD_WIDTH = 148;

function ShelfCard({ article, n }: { article: ArticleCard; n: number }) {
  const styles = useStyles();
  const m = useMotion();
  const { pick } = useI18n();
  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  const title = pick(article.title_te, article.title_en);
  const category = article.category ? pick(article.category.name_te, article.category.name_en) : null;

  return (
    <PressableScale
      onPress={() => openStoryShots(article.short_id)}
      haptic="select"
      accessibilityRole="link"
      accessibilityLabel={[category, title].filter(Boolean).join(', ')}
      style={styles.card}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
          transition={m.imageTransition}
          recyclingKey={article.short_id}
          accessibilityLabel={article.hero?.alt_te ?? ''}
        />
      ) : null}
      <View style={styles.topBand}>
        <StoryScrim from="top" strength={0.6} />
        <View style={styles.number}>
          <T variant="meta" weight="bold" color="onWow" lang="en">
            {String(n)}
          </T>
        </View>
      </View>
      <View style={styles.caption}>
        <StoryScrim />
        {category ? (
          <T variant="meta" weight="bold" color="wow" numberOfLines={1}>
            {category}
          </T>
        ) : null}
        <T variant="headlineSm" weight="bold" color="onOverlay" numberOfLines={4}>
          {title}
        </T>
      </View>
    </PressableScale>
  );
}

/** Home shelf: a header with a "see all" link and a sideways row of shots. */
export function StoryShotsShelf() {
  const styles = useStyles();
  const color = useColors();
  const { pick, t } = useI18n();
  const shots = useStoryShots();
  const items = shots.data ?? [];
  if (!items.length) return null;

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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + space.md}
        snapToAlignment="start"
        contentContainerStyle={styles.row}
      >
        {items.map((article, i) => (
          <ShelfCard key={article.short_id} article={article} n={i + 1} />
        ))}
      </ScrollView>
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
  row: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  card: {
    width: CARD_WIDTH,
    aspectRatio: 9 / 16,
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: color.inkDeep,
    borderWidth: 1,
    borderColor: color.rule,
  },
  topBand: { padding: space.sm, paddingBottom: space.xl, alignItems: 'flex-start' },
  number: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.wowDeep,
  },
  caption: { gap: space.xs, padding: space.md, paddingTop: space.xxl },
}));
