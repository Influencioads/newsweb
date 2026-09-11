import * as Haptics from 'expo-haptics';
import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
  withSpring,
  withTiming,
  type BaseAnimationBuilder,
  type EntryOrExitLayoutType,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';

/**
 * Motion tokens — the mobile twin of the web `duration-*` / `ease-*` tokens.
 *
 * Every animation, entering/exiting prop, image transition and haptic in the
 * app goes through `useMotion()`, so the OS "reduce motion" setting (and the
 * Reanimated `ReduceMotion.System` flag) switches all of it off in one place.
 */
export const DUR = { fast: 120, base: 200, slow: 320 } as const;

export const EASE = {
  standard: Easing.bezier(0.2, 0.8, 0.2, 1),
  emphasized: Easing.bezier(0.32, 0.72, 0, 1),
} as const;

export const SPRING = {
  /** Press feedback. */
  press: { damping: 18, stiffness: 220, reduceMotion: ReduceMotion.System } satisfies WithSpringConfig,
  /** Sheets, sliding indicators. */
  sheet: { damping: 20, stiffness: 180, reduceMotion: ReduceMotion.System } satisfies WithSpringConfig,
} as const;

export type HapticKind = 'light' | 'medium' | 'select' | 'success' | 'warning' | 'error';

async function fireHaptic(kind: HapticKind): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    switch (kind) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'select':
        await Haptics.selectionAsync();
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch {
    /* haptics unavailable on this device */
  }
}

export interface Motion {
  /** True when the OS asks for reduced motion. */
  reduce: boolean;
  /** `withTiming` honouring reduce (instant when reduced). */
  timing: (value: number, ms?: number, config?: Partial<WithTimingConfig>) => number;
  /** `withSpring` honouring reduce (instant when reduced). */
  spring: (value: number, config?: WithSpringConfig) => number;
  /** Entering animation for a list row / card (`FadeInDown` 12px, staggered 40ms, max 6). */
  entering: (index?: number) => EntryOrExitLayoutType | undefined;
  /** Simple fade for overlays. */
  fadeIn: () => EntryOrExitLayoutType | undefined;
  exiting: () => EntryOrExitLayoutType | undefined;
  /** Layout transition for reordering / expanding. */
  layout: BaseAnimationBuilder | undefined;
  /** expo-image `transition` ms. */
  imageTransition: number;
  haptic: (kind?: HapticKind) => void;
}

/**
 * `useMotion()` — the one place motion decisions are made.
 *
 *   const m = useMotion();
 *   scale.value = m.spring(0.97, SPRING.press);
 *   <Animated.View entering={m.entering(index)}>
 *   <Image transition={m.imageTransition} />
 */
export function useMotion(): Motion {
  const reduce = useReducedMotion();

  const haptic = useCallback(
    (kind: HapticKind = 'light') => {
      if (reduce) return;
      void fireHaptic(kind);
    },
    [reduce],
  );

  return useMemo<Motion>(
    () => ({
      reduce,
      timing: (value, ms = DUR.base, config) =>
        reduce
          ? withTiming(value, { duration: 0 })
          : withTiming(value, { duration: ms, easing: EASE.standard, ...config }),
      spring: (value, config = SPRING.press) =>
        reduce ? withTiming(value, { duration: 0 }) : withSpring(value, config),
      entering: (index = 0) =>
        reduce
          ? undefined
          : FadeInDown.duration(DUR.slow)
              .delay(Math.min(index, 6) * 40)
              .easing(EASE.standard)
              .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] }),
      fadeIn: () => (reduce ? undefined : FadeIn.duration(DUR.base)),
      exiting: () => (reduce ? undefined : FadeOut.duration(DUR.fast)),
      layout: reduce ? undefined : LinearTransition.duration(DUR.base),
      imageTransition: reduce ? 0 : DUR.base,
      haptic,
    }),
    [reduce, haptic],
  );
}
