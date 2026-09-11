import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { IconButton } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { T, type TLang } from '@/ui/Text';

/**
 * ScreenHeader — the in-app header bar (native headers are off).
 *
 * Paper ground, hairline rule, headline title (masthead `display` when
 * `large`), a back IconButton on the left whenever the router can go back,
 * and free slots for other controls. Pass `collapsible` with a scroll
 * SharedValue and the bar shrinks 56 → 44 while the title scales down —
 * skipped entirely under reduced motion.
 */
export const HEADER_HEIGHT = 56;
const HEADER_MIN = 44;

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Left slot; defaults to a back button when `router.canGoBack()`. */
  left?: ReactNode;
  right?: ReactNode;
  /** Collapse against a scroll offset; `range` is the offset window (default 0 → 56). */
  collapsible?: { scrollY: SharedValue<number>; range?: [number, number] };
  showRule?: boolean;
  /** Masthead style: `display` title in brand colour. */
  large?: boolean;
  transparent?: boolean;
  lang?: TLang;
  /** Pad the status-bar inset — for a header rendered outside `<Screen>`. */
  insetTop?: boolean;
}

export function ScreenHeader({
  title,
  subtitle,
  left,
  right,
  collapsible,
  showRule = true,
  large = false,
  transparent = false,
  lang = 'auto',
  insetTop = false,
}: ScreenHeaderProps) {
  const styles = useStyles();
  const m = useMotion();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const idle = useSharedValue(0);
  const scrollY = collapsible?.scrollY ?? idle;
  const range = collapsible?.range ?? [0, HEADER_HEIGHT];
  const active = collapsible !== undefined && !m.reduce;
  const titleMin = large ? 0.66 : 0.9;

  // Drives minHeight (the property the static style sets) so Yoga does not
  // clamp the collapse; the bar still grows to fit a title + subtitle pair.
  const barStyle = useAnimatedStyle(() =>
    active
      ? { minHeight: interpolate(scrollY.value, range, [HEADER_HEIGHT, HEADER_MIN], Extrapolation.CLAMP) }
      : {},
  );
  const titleStyle = useAnimatedStyle(() => {
    if (!active) return {};
    const p = interpolate(scrollY.value, range, [1, 0], Extrapolation.CLAMP);
    return {
      opacity: 0.8 + 0.2 * p,
      transform: [{ scale: titleMin + (1 - titleMin) * p }],
    };
  });
  const subtitleStyle = useAnimatedStyle(() =>
    active ? { opacity: interpolate(scrollY.value, range, [1, 0], Extrapolation.CLAMP) } : {},
  );

  const leading =
    left ??
    (router.canGoBack() ? (
      <IconButton name="arrowLeft" label={t('ui.back')} onPress={() => router.back()} />
    ) : null);

  return (
    <View
      style={[
        transparent ? styles.transparent : styles.paper,
        insetTop && { paddingTop: insets.top },
      ]}
    >
      <Animated.View
        style={[
          styles.bar,
          { paddingLeft: leading ? space.sm : space.lg, paddingRight: right ? space.sm : space.lg },
          barStyle,
        ]}
      >
        {leading}
        <View style={[styles.titles, leading ? styles.titlesAfterControl : null]}>
          <Animated.View style={[styles.titleOrigin, titleStyle]}>
            <T
              variant={large ? 'display' : 'headlineMd'}
              weight={large ? 'heavy' : 'bold'}
              color={large ? 'brand' : 'ink'}
              lang={lang}
              numberOfLines={1}
              accessibilityRole="header"
            >
              {title}
            </T>
          </Animated.View>
          {subtitle ? (
            <Animated.View style={subtitleStyle}>
              <T variant="meta" color="muted" lang={lang} numberOfLines={1}>
                {subtitle}
              </T>
            </Animated.View>
          ) : null}
        </View>
        {right}
      </Animated.View>
      {showRule && !transparent ? <Divider /> : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  paper: { backgroundColor: color.paper },
  transparent: { backgroundColor: 'transparent' },
  bar: {
    minHeight: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  titles: { flex: 1, justifyContent: 'center' },
  titlesAfterControl: { marginLeft: space.xs },
  titleOrigin: { alignSelf: 'flex-start', transformOrigin: 'left center' },
}));
