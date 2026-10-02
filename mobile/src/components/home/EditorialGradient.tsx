import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Palette } from '@/lib/theme';
import { useColors, useThemeName } from '@/lib/useTheme';

export type EditorialTone = 'featured' | 'breaking' | 'national' | 'international' | 'business' | 'exclusive' | 'default';

export function toneForSection(key: string): EditorialTone {
  switch (key.toLowerCase()) {
    case 'breaking':
      return 'breaking';
    case 'national':
      return 'national';
    case 'world':
    case 'international':
      return 'international';
    case 'business':
      return 'business';
    case 'exclusive':
      return 'exclusive';
    default:
      return 'default';
  }
}

function accents(color: Palette, tone: EditorialTone): [string, string] {
  switch (tone) {
    case 'featured':
      return [color.brand, color.breaking];
    case 'breaking':
      return [color.breaking, color.exclusive];
    case 'national':
      return [color.brand, color.info];
    case 'international':
      return [color.info, color.ai];
    case 'business':
      return [color.partial, color.brand];
    case 'exclusive':
      return [color.exclusive, color.ai];
    default:
      return [color.inkSoft, color.brand];
  }
}

/** A constant-dark base keeps white headline text legible in both themes. */
export function EditorialGradient({ tone }: { tone: EditorialTone }) {
  const color = useColors();
  const theme = useThemeName();
  const id = useId().replace(/:/g, '');
  const [start, middle] = accents(color, tone);
  const strength = theme === 'dark' ? 0.52 : 0.78;

  // The wrapper View matters: Yoga resolves an absolute child's 100% against the
  // parent's box minus its padding, so a bare Svg stops short of padded bands and
  // leaves a black strip on the right and bottom.
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={start} stopOpacity={strength} />
            <Stop offset="0.54" stopColor={middle} stopOpacity={strength * 0.55} />
            <Stop offset="1" stopColor={color.brandDeep} stopOpacity="0.95" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={color.inkDeep} />
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
