import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { EpaperPage } from '@/api/epaper';
import { useI18n } from '@/lib/i18n';
import { DUR, useMotion } from '@/lib/motion';
import { radius, shadow, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { T } from '@/ui/Text';

/**
 * EpaperSheet — the printed page itself: masthead, the story grid in one,
 * two or three columns, and the page's big-question link.
 *
 * Zoom lives in `useEpaperZoom()` so the toolbar can drive it from outside
 * the gesture area. Shared values are only ever written through `.set()` —
 * the React-Compiler-safe half of the Reanimated 4 API — which is what keeps
 * the pinch/pan worklets and the toolbar's buttons writing the same values
 * without tripping `react-hooks/immutability`.
 */
const MIN = 0.8;
const MAX = 3;
const STEP = 0.2;
const DOUBLE_TAP = 2;
/** Horizontal travel that turns a swipe into a page turn (only while unzoomed). */
const PAGE_SWIPE = 70;
/** Above this the page is "zoomed": pan moves the sheet instead of turning the page. */
const ZOOMED = 1.05;

export interface EpaperZoom {
  scale: SharedValue<number>;
  saved: SharedValue<number>;
  /** Horizontal offset while zoomed (vertical travel is the ScrollView's job). */
  tx: SharedValue<number>;
  /** Animate to an absolute scale (clamped). Safe to call from JS or via scheduleOnRN. */
  to: (next: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export function useEpaperZoom(): EpaperZoom {
  const m = useMotion();
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);

  const to = (next: number) => {
    const v = Math.min(MAX, Math.max(MIN, Math.round(next * 100) / 100));
    scale.set(m.timing(v, DUR.fast));
    saved.set(v);
    if (v <= ZOOMED) tx.set(m.timing(0, DUR.fast));
  };

  return {
    scale,
    saved,
    tx,
    to,
    zoomIn: () => to(saved.get() + STEP),
    zoomOut: () => to(saved.get() - STEP),
    reset: () => to(1),
  };
}

export interface EpaperSheetProps {
  page: EpaperPage;
  /** ISO edition date, printed under the masthead. */
  dateLabel: string;
  zoom: EpaperZoom;
  /** Page-follow swipe: -1 back, +1 forward. */
  onPageDelta: (delta: number) => void;
}

export function EpaperSheet({ page, dateLabel, zoom, onPageDelta }: EpaperSheetProps) {
  const styles = useStyles();
  const m = useMotion();
  const { t, isTelugu, language } = useI18n();
  const { width } = useWindowDimensions();
  // The sheet, not the window, is what the pan has to stay inside — they part
  // company above 924pt, where the sheet stops growing.
  const sheetWidth = Math.min(width - space.xl, 900);

  const startX = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      zoom.scale.set(Math.min(MAX, Math.max(MIN, zoom.saved.get() * e.scale)));
    })
    .onEnd(() => {
      zoom.saved.set(zoom.scale.get());
      if (zoom.saved.get() <= ZOOMED) zoom.tx.set(0);
    });

  // Horizontal only: the page sheet lives in a vertical ScrollView, and a pan
  // that claimed vertical travel would stop the reader scrolling the page.
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      startX.set(zoom.tx.get());
    })
    .onUpdate((e) => {
      if (zoom.saved.get() <= ZOOMED) return;
      // Keep the page within its own overflow, so it can never be dragged away.
      const slack = (sheetWidth * (zoom.saved.get() - 1)) / 2;
      zoom.tx.set(Math.min(slack, Math.max(-slack, startX.get() + e.translationX)));
    })
    .onEnd((e) => {
      if (zoom.saved.get() <= ZOOMED && Math.abs(e.translationX) > PAGE_SWIPE) {
        scheduleOnRN(onPageDelta, e.translationX < 0 ? 1 : -1);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      scheduleOnRN(zoom.to, zoom.saved.get() > ZOOMED ? 1 : DOUBLE_TAP);
    });

  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: zoom.tx.get() }, { scale: zoom.scale.get() }],
  }));

  const cols = width > 650 ? (page.layout_type === 'three_column' ? 3 : 2) : 1;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.sheet, { width: sheetWidth }, animated]}>
        <View style={styles.mast}>
          <T variant="display" weight="heavy" lang="te" align="center">
            {t('site.name')}
          </T>
          <T variant="meta" color="muted" align="center">
            {`${new Date(dateLabel).toLocaleDateString(language === 'te' ? 'te-IN' : 'en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })} · ${t('epaper.page')} ${page.page_number}`}
          </T>
          <T variant="headlineLg" weight="heavy" lang="te" align="center">
            {page.title}
          </T>
        </View>

        <View style={styles.grid}>
          {page.articles.map((a, i) => (
            <View key={a.id} style={[styles.cell, { width: `${100 / cols}%` }]}>
              <Card
                padding="sm"
                accessibilityLabel={a.title_te}
                onPress={() =>
                  router.push({ pathname: '/article/[shortId]', params: { shortId: a.short_id } })
                }
              >
                {a.hero_url ? (
                  <Image
                    source={{ uri: a.hero_url }}
                    style={i === 0 ? styles.heroLead : styles.hero}
                    contentFit="cover"
                    transition={m.imageTransition}
                    recyclingKey={a.short_id}
                    accessibilityLabel=""
                  />
                ) : null}
                {a.is_breaking ? (
                  <Badge tone="breaking" size="xs" label={t('home.breaking')} style={styles.flag} />
                ) : null}
                <T
                  variant={i === 0 ? 'headlineLg' : 'headlineMd'}
                  weight="heavy"
                  lang="te"
                  style={styles.headline}
                >
                  {a.title_te}
                </T>
                {a.summary_te ? (
                  <T variant="bodySmall" color="inkSoft" lang="te" scaled numberOfLines={4}>
                    {a.summary_te}
                  </T>
                ) : null}
              </Card>
            </View>
          ))}
        </View>

        {page.poll_id ? (
          <Button
            variant="secondary"
            icon="helpCircle"
            iconRight="arrowRight"
            full
            label={isTelugu ? 'బిగ్ క్వశ్చన్ · ఓటు వేయండి' : 'Big question · Vote now'}
            onPress={() =>
              router.push({ pathname: '/poll/[id]', params: { id: String(page.poll_id) } })
            }
            style={styles.poll}
          />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const useStyles = makeStyles((color) => ({
  sheet: {
    alignSelf: 'center',
    backgroundColor: color.paper,
    borderRadius: radius.md,
    padding: space.lg,
    marginVertical: space.sm,
    ...shadow('card', color),
  },
  mast: {
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderColor: color.ink,
    paddingVertical: space.sm,
    marginBottom: space.md,
    gap: space.xs,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { padding: space.xs },
  hero: { width: '100%', height: 110, borderRadius: radius.sm, backgroundColor: color.placeholder },
  heroLead: { width: '100%', height: 190, borderRadius: radius.sm, backgroundColor: color.placeholder },
  flag: { marginTop: space.xs },
  headline: { marginTop: space.xs },
  poll: { marginTop: space.md },
}));
