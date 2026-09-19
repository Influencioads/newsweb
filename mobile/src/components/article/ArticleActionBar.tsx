import { useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchSiteConfig } from '@/api/public';
import type { ArticleDetail } from '@/api/types';
import { ArticleActions } from '@/components/ArticleActions';
import { LocationSheet } from '@/components/LocationSheet';
import { useI18n } from '@/lib/i18n';
import { space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';
import { Button } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { useQuery } from '@tanstack/react-query';

/**
 * The pinned bar at the bottom of a story: the action row, and the reader's
 * location.
 *
 * It is a *shell*. Everything the buttons do lives in `ArticleActions`, which
 * is the same component every feed card mounts — so like, comment, share,
 * report and WhatsApp behave identically wherever a reader meets them, and
 * there is exactly one implementation to change. The reading controls (text
 * size, listen, save) moved to `ArticleHeader`; nothing renders in both
 * places any more.
 *
 * The bar slides away on a scroll down and returns on a scroll up (the screen
 * drives `hidden` 0 → 1 with a spring), so the story owns the screen while the
 * controls stay one flick away.
 *
 * The location button is here rather than on the home screen because it has to
 * be reachable from *every* story — a reader who has just read something from
 * the wrong mandal is exactly the reader who wants to change it. Being in the
 * pinned bar also means it appears once per story and never twice.
 */
export interface ArticleActionBarProps {
  article: ArticleDetail;
  /** §19 — the server says whether a shareable card exists for this story. */
  cardAvailable: boolean;
  /** 0 = shown, 1 = tucked below the edge. */
  hidden: SharedValue<number>;
  onComments: () => void;
}

/**
 * Bar height above the home-indicator inset — the screen pads its scroll by
 * it. Two rows now: the actions, and the location button.
 */
export const ACTION_BAR_HEIGHT = TAP * 2 + space.sm * 3;

export function ArticleActionBar({
  article,
  cardAvailable,
  hidden,
  onComments,
}: ArticleActionBarProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { t, pick } = useI18n();
  const [locationOpen, setLocationOpen] = useState(false);
  const edition = usePrefs((s) => s.edition);

  // The masthead config is already warm in the cache from first paint, so
  // naming the reader's district costs no request.
  const config = useQuery({ queryKey: ['config'], queryFn: fetchSiteConfig, staleTime: 5 * 60_000 });
  // Naming the place the reader is currently getting news from is the whole
  // point of the button — "choose" tells them nothing about what is set.
  const district = config.data?.districts.find((d) => d.slug === edition);
  const label = district
    ? pick(district.name_te, district.name_en)
    : t('local.choosePlace');

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: hidden.value * (ACTION_BAR_HEIGHT + insets.bottom) }],
  }));

  return (
    <>
      <Animated.View style={[styles.bar, { paddingBottom: insets.bottom }, slide]}>
        <Divider />
        <ArticleActions
          article={article}
          size="article"
          cardAvailable={cardAvailable}
          onComment={onComments}
          flags="fetch"
        />
        <View style={styles.locationRow}>
          <Button
            variant="secondary"
            icon="place"
            label={label}
            accessibilityLabel={`${t('local.change')}: ${label}`}
            full
            onPress={() => setLocationOpen(true)}
          />
        </View>
      </Animated.View>

      <LocationSheet open={locationOpen} onClose={() => setLocationOpen(false)} />
    </>
  );
}

const useStyles = makeStyles((color) => ({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.paper },
  locationRow: { paddingHorizontal: space.md, paddingBottom: space.sm },
}));
