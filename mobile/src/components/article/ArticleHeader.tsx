import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { radius } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * The article screen's header: the standard ScreenHeader (collapsing against
 * the reader's scroll) with the reading-progress rule welded to its bottom
 * edge, so the bar that says "where am I in this story" is part of the chrome
 * rather than a floating overlay.
 *
 * `progress` is 0 → 1, derived from contentOffset / (contentSize - viewport)
 * on the UI thread; the fill is a full-width bar scaled on X from its left
 * edge, which keeps the whole thing off the JS thread.
 */
export interface ArticleHeaderProps {
  title: string;
  subtitle?: string;
  scrollY: SharedValue<number>;
  progress: SharedValue<number>;
}

const TRACK = 3;

export function ArticleHeader({ title, subtitle, scrollY, progress }: ArticleHeaderProps) {
  const styles = useStyles();
  // Deliberately not gated on `m.reduce`: this is a scrollbar, not motion. It
  // has no duration, no easing and no life of its own — it only reports where
  // the finger already is, and hiding it would take a position readout away
  // from the reader who most needs one.
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        collapsible={{ scrollY }}
        showRule={false}
      />
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no">
        <Animated.View style={[styles.fill, fill]} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  root: { backgroundColor: color.paper },
  track: { height: TRACK, backgroundColor: color.ruleSoft },
  fill: {
    width: '100%',
    height: TRACK,
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
    backgroundColor: color.brand,
    transformOrigin: 'left center',
  },
}));
