import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';

/**
 * Screen — the root of every route.
 *
 * Owns the safe area (top by default; the tab bar supplies the bottom, so
 * routes pushed outside the tabs opt in with `bottomInset`), the themed
 * ground, and the optional ScrollView / KeyboardAvoidingView / branded
 * RefreshControl so screens never assemble those themselves.
 */
export interface ScreenProps {
  children?: ReactNode;
  /** Safe-area edges to pad. */
  edges?: Edge[];
  background?: 'canvas' | 'paper' | 'surface';
  /** Wrap the content in a ScrollView. */
  scroll?: boolean;
  /** KeyboardAvoidingView (`padding` on iOS, native resize on Android). */
  keyboard?: boolean;
  /** Pull-to-refresh state; only meaningful with `scroll`. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Horizontal gutter of `space.lg`. */
  padded?: boolean;
  /** Pad the home-indicator inset — for routes that live outside the tab bar. */
  bottomInset?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  edges = ['top'],
  background = 'canvas',
  scroll = false,
  keyboard = false,
  refreshing = false,
  onRefresh,
  padded = false,
  bottomInset = false,
  contentContainerStyle,
  style,
  testID,
}: ScreenProps) {
  const styles = useStyles();
  const color = useColors();
  const insets = useSafeAreaInsets();
  const content: StyleProp<ViewStyle> = [
    padded && styles.padded,
    bottomInset && { paddingBottom: insets.bottom },
    contentContainerStyle,
  ];

  let body: ReactNode = scroll ? (
    <ScrollView
      style={styles.fill}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={content}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={color.brand}
            colors={[color.brand]}
            progressBackgroundColor={color.surface}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, content]}>{children}</View>
  );

  if (keyboard) {
    body = (
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    );
  }

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.fill, { backgroundColor: color[background] }, style]}
      testID={testID}
    >
      {body}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(() => ({
  fill: { flex: 1 },
  padded: { paddingHorizontal: space.lg },
}));
