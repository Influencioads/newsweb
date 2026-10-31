import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, useWindowDimensions, View, type ListRenderItem } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { absoluteMediaUrl } from '@/api/client';
import type { ArticleCard } from '@/api/types';
import { ShareOptionsSheet } from '@/components/ShareSheet';
import { WowButton } from '@/components/wow/NominateCta';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { useSiteContent } from '@/lib/siteContent';
import { alpha, radius, shadow, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { IconButton } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/** Slides in the banner, as on the website (frontend features/wow/HeroBanner.tsx). */
export const HERO_SLIDES = 10;
/** How long a slide stays before the banner moves on by itself. */
const ADVANCE_MS = 6000;

/**
 * Home's top story banner — the website's HeroBanner on a phone: each slide is
 * the story's photo under a deep-blue wash, with the orange "Every Story Has a
 * WOW!" tag and the section on top, the headline and standfirst, "Read the
 * story" and share; previous / next arrows and the dots under them. Up to ten
 * slides — the desk's own picks from CMS → Home hero slides first, in their
 * order. Swipe to move; it moves on by itself every 6 s, never under reduced
 * motion or a screen reader, nor while a finger is on it.
 */
export function HeroBanner({ stories }: { stories: ArticleCard[]; index?: number }) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick } = useI18n();
  const { brand, home } = useSiteContent();
  const { width: screen } = useWindowDimensions();
  const width = screen - space.lg * 2;
  const slides = stories.slice(0, HERO_SLIDES);
  const count = slides.length;
  const list = useRef<FlatList<ArticleCard>>(null);
  const [shown, setShown] = useState(0);
  const [held, setHeld] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [shareFor, setShareFor] = useState<ArticleCard | null>(null);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (held || screenReader || m.reduce || count < 2 || shareFor) return;
    const id = setTimeout(() => {
      const next = (shown + 1) % count;
      list.current?.scrollToOffset({ offset: next * width, animated: true });
      setShown(next);
    }, ADVANCE_MS);
    return () => clearTimeout(id);
  }, [shown, held, screenReader, m.reduce, count, width, shareFor]);

  if (!count) return null;
  const tag = pick(home.banner_tag_te, home.banner_tag_en);

  const go = (i: number) => {
    const next = (i + count) % count;
    list.current?.scrollToOffset({ offset: next * width, animated: !m.reduce });
    setShown(next);
  };

  const renderItem: ListRenderItem<ArticleCard> = ({ item }) => (
    <Slide article={item} width={width} tag={tag} onShare={setShareFor} />
  );

  return (
    <View>
      {/* The masthead line under the logo on the website; here it leads the page. */}
      <T variant="eyebrow" weight="bold" color="ink" lang="auto" numberOfLines={1} style={styles.caption}>
        {pick(brand.tagline_te, brand.tagline_en)}
      </T>
      <View style={styles.card} accessibilityLabel={pick('ముఖ్య కథనాలు', 'Top stories')}>
        <FlatList
          ref={list}
          data={slides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(a) => a.short_id}
          renderItem={renderItem}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onScrollBeginDrag={() => setHeld(true)}
          onScrollEndDrag={() => setHeld(false)}
          onMomentumScrollEnd={(e) => setShown(Math.round(e.nativeEvent.contentOffset.x / width))}
        />
        {count > 1 ? (
          <View style={styles.controls}>
            <IconButton name="chevronLeft" label={pick('మునుపటి కథ', 'Previous story')} color={color.onOverlay} style={styles.glass} onPress={() => go(shown - 1)} />
            <View style={styles.dots}>
              {slides.map((a, i) => (
                <PressableScale
                  key={a.short_id}
                  onPress={() => go(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1} / ${count}`}
                  accessibilityState={{ selected: i === shown }}
                  style={styles.dotHit}
                >
                  <View style={[styles.dot, i === shown ? styles.dotOn : null]} />
                </PressableScale>
              ))}
            </View>
            <IconButton name="chevronRight" label={pick('తదుపరి కథ', 'Next story')} color={color.onOverlay} style={styles.glass} onPress={() => go(shown + 1)} />
          </View>
        ) : null}
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

function Slide({
  article,
  width,
  tag,
  onShare,
}: {
  article: ArticleCard;
  width: number;
  tag: string;
  onShare: (a: ArticleCard) => void;
}) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick } = useI18n();
  const uri = absoluteMediaUrl(article.hero?.url ?? null);
  const head = pick(article.title_te, article.title_en);
  const open = () => router.push({ pathname: '/article/[shortId]', params: { shortId: article.short_id } });

  return (
    <View style={[styles.slide, { width }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          placeholder={article.hero?.blurhash ? { blurhash: article.hero.blurhash } : undefined}
          transition={m.imageTransition}
          recyclingKey={article.short_id}
          accessible={false}
        />
      ) : null}
      <BlueWash />
      <View style={styles.copy}>
        <View style={styles.pills}>
          <View style={styles.tag}>
            <Icon name="sparkles" size={16} color={color.onWow} />
            <T variant="meta" weight="bold" color="onWow" lang="auto" numberOfLines={1}>
              {tag}
            </T>
          </View>
          {article.category ? (
            <View style={styles.section}>
              <T variant="meta" weight="semibold" color="onOverlay" numberOfLines={1}>
                {pick(article.category.name_te, article.category.name_en)}
              </T>
            </View>
          ) : null}
        </View>
        <PressableScale onPress={open} accessibilityRole="link" accessibilityLabel={head}>
          <T variant="headlineLg" weight="bold" color="onOverlay" numberOfLines={4}>
            {head}
          </T>
        </PressableScale>
        {article.summary_te ? (
          <T variant="bodySmall" color="onOverlay" lang="te" numberOfLines={3} style={styles.soft}>
            {article.summary_te}
          </T>
        ) : null}
        <View style={styles.actions}>
          <WowButton label={pick('పూర్తి కథ చదవండి', 'Read the story')} iconRight="arrowRight" onPress={open} />
          <IconButton name="share" label={pick('షేర్ చేయండి', 'Share')} color={color.onOverlay} style={styles.glass} onPress={() => onShare(article)} />
        </View>
      </View>
    </View>
  );
}

/** The website's phone wash: deep WOW blue, clearing towards the top of the photo. */
function BlueWash() {
  const color = useColors();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroWash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.brandDeep} stopOpacity={0.4} />
            <Stop offset="0.45" stopColor={color.brandDeep} stopOpacity={0.85} />
            <Stop offset="1" stopColor={color.brandDeep} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroWash)" />
      </Svg>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  caption: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  card: {
    marginHorizontal: space.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: color.brandDeep,
    ...shadow('raised', color),
  },
  slide: { minHeight: 400, justifyContent: 'flex-end', overflow: 'hidden' },
  copy: { gap: space.md, padding: space.lg, paddingBottom: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.wowDeep,
  },
  section: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: alpha(color.onOverlay, 0.15),
  },
  soft: { opacity: 0.85 },
  /** The website's see-through round buttons on the photo. */
  glass: { backgroundColor: alpha(color.onOverlay, 0.15), borderRadius: radius.pill },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.xs },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  dots: { flexDirection: 'row', alignItems: 'center' },
  dotHit: { minWidth: 18, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 6, borderRadius: radius.pill, backgroundColor: alpha(color.onOverlay, 0.5) },
  dotOn: { width: 28, backgroundColor: color.wow },
}));
