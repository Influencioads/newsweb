import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, radius, shadow, space, TAP } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { PressableScale } from '@/ui/PressableScale';

/**
 * Card — the bordered surface block stories, settings groups and promos sit
 * in. radius.md, hairline rule, surface fill; `elevated` adds the card
 * shadow; `onPress` turns it into a PressableScale (gentler 0.985 scale) whose
 * shadow lifts to `raised` while held.
 *
 * `tone="ink"` is the constant-dark panel (inkDeep in both themes): give its
 * text `color="onOverlay"`, the same way the ink footer does.
 */
export interface CardProps {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  tone?: 'surface' | 'paper' | 'ink';
  elevated?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Required when `onPress` is set; on a static card it makes the block one accessible element. */
  accessibilityLabel?: string;
}

const PAD = { none: 0, sm: space.md, md: space.lg, lg: space.xl } as const;

const useStyles = makeStyles((color) => ({
  base: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.rule,
    justifyContent: 'flex-start',
  },
  surface: { backgroundColor: color.surface },
  paper: { backgroundColor: color.paper },
  ink: { backgroundColor: color.inkDeep, borderColor: alpha(color.onOverlay, 0.28) },
  elevated: shadow('card', color),
  raised: shadow('raised', color),
}));

export function Card({
  padding = 'md',
  tone = 'surface',
  elevated = false,
  onPress,
  style,
  children,
  accessibilityLabel,
}: CardProps) {
  const styles = useStyles();
  const [held, setHeld] = useState(false);
  const box = [
    styles.base,
    styles[tone],
    elevated && (held ? styles.raised : styles.elevated),
    { padding: PAD[padding] },
    style,
  ];

  if (!onPress) {
    return (
      <View style={box} accessible={accessibilityLabel !== undefined} accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      scaleTo={0.985}
      minHeight={TAP}
      accessibilityLabel={accessibilityLabel}
      style={box}
    >
      {children}
    </PressableScale>
  );
}
