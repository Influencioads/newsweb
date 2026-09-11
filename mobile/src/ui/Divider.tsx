import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/useTheme';

/**
 * Divider — a hairline rule between rows or, with `vertical`, between
 * siblings in a row. `inset` pulls the line in from both ends (e.g. to align
 * with a row's text column). Hidden from assistive tech.
 */
export interface DividerProps {
  inset?: number;
  tone?: 'rule' | 'ruleSoft' | 'ruleStrong';
  vertical?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Divider({ inset = 0, tone = 'rule', vertical = false, style }: DividerProps) {
  const color = useColors();
  const line: ViewStyle = vertical
    ? { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: inset }
    : { height: StyleSheet.hairlineWidth, marginHorizontal: inset };
  return (
    <View
      style={[line, { backgroundColor: color[tone] }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
