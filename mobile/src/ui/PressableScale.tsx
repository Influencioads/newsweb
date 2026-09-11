import type { ReactNode } from 'react';
import {
  Pressable,
  type AccessibilityRole,
  type AccessibilityState,
  type Insets,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { SPRING, useMotion, type HapticKind } from '@/lib/motion';
import { alpha, TAP } from '@/lib/theme';
import { useColors } from '@/lib/useTheme';

/**
 * PressableScale — the one touchable in the app.
 *
 * Every tap target (Button, IconButton, Chip, Card, list rows) is built on
 * this. It is the only file outside legacy screens allowed to import
 * `Pressable`: press feedback (spring scale + slight dim + haptic), the 44pt
 * minimum height and the accessibility props all live here once.
 */
export interface PressableScaleProps {
  onPress?: () => void;
  onLongPress?: () => void;
  /** Pressed-state hooks for callers that swap a shadow / tint while held. */
  onPressIn?: () => void;
  onPressOut?: () => void;
  /** Haptic fired on press (only when there is an `onPress`). `false` for silent controls (e.g. list rows). */
  haptic?: HapticKind | false;
  /** Scale while pressed. */
  scaleTo?: number;
  /** Minimum hit-target height; never below TAP for a control. */
  minHeight?: number;
  hitSlop?: Insets | number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityHint?: string;
  /** Android ripple (ink at 8%). */
  ripple?: boolean;
  children?: ReactNode;
  testID?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  haptic = 'light',
  scaleTo = 0.97,
  minHeight = TAP,
  hitSlop,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  accessibilityHint,
  ripple = false,
  children,
  testID,
  onLayout,
}: PressableScaleProps) {
  const m = useMotion();
  const color = useColors();
  /** 0 = rest, 1 = pressed; one spring drives both scale and dim. */
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (scaleTo - 1) * pressed.value }],
    opacity: disabled ? 0.5 : 1 - 0.08 * pressed.value,
  }));

  return (
    <AnimatedPressable
      onPress={() => {
        // No handler (e.g. a pending Button) → no buzz for a tap that does nothing.
        if (haptic && onPress) m.haptic(haptic);
        onPress?.();
      }}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressed.value = m.spring(1, SPRING.press);
        onPressIn?.();
      }}
      onPressOut={() => {
        pressed.value = m.spring(0, SPRING.press);
        onPressOut?.();
      }}
      disabled={disabled}
      hitSlop={hitSlop}
      android_ripple={ripple ? { color: alpha(color.ink, 0.08) } : undefined}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      testID={testID}
      onLayout={onLayout}
      style={[{ minHeight, justifyContent: 'center' }, style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
