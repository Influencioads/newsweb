import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { MiniPlayer, useKeyboardShown } from '@/components/player/MiniPlayer';
import { SPRING, useMotion } from '@/lib/motion';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * TabBar — the custom bottom tab bar passed to `<Tabs tabBar={...}>`.
 *
 * 56pt + the home-indicator inset on paper with a hairline rule. One
 * brand-tint pill springs to the focused tab behind its icon and label; the
 * icon comes from each screen's `tabBarIcon` option (a `<TabIcon>`), the
 * label from its `title` (already localised by the layout) and the badge from
 * `tabBarBadge`. Hidden while the keyboard is up.
 *
 * While audio is loaded, the global player's dock (MiniPlayer) rides on top
 * of the tab row, in flow — so the tab screens shrink to make room for it
 * rather than being covered by it.
 */
export const TAB_BAR_HEIGHT = 56;

export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const [width, setWidth] = useState(0);
  const keyboard = useKeyboardShown();
  const x = useSharedValue(0);
  const settled = useRef(false);
  const tabWidth = state.routes.length ? width / state.routes.length : 0;

  useEffect(() => {
    if (!tabWidth) return;
    const target = state.index * tabWidth + space.sm;
    // First measurement lands the pill in place; later changes spring.
    x.value = settled.current ? m.spring(target, SPRING.sheet) : target;
    settled.current = true;
  }, [state.index, tabWidth, m, x]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (keyboard) return null;

  return (
    <View>
      <MiniPlayer placement="tabs" />
      <View
        style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, { width: Math.max(0, tabWidth - space.lg) }, pill]}
        />
        <View style={styles.row} accessibilityRole="tablist">
          {state.routes.map((route, index) => {
            const focused = index === state.index;
            const { options } = descriptors[route.key];
            const label =
              typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : (options.title ?? route.name);
            const tint = focused ? color.brand : color.muted;
            const badge = options.tabBarBadge;
            const hasBadge = badge !== undefined && badge !== null && badge !== '';
            return (
              <PressableScale
                key={route.key}
                haptic="select"
                accessibilityRole="tab"
                accessibilityLabel={options.tabBarAccessibilityLabel ?? (hasBadge ? `${label}, ${badge}` : label)}
                accessibilityState={{ selected: focused }}
                testID={options.tabBarButtonTestID}
                style={styles.tab}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
                }}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              >
                <View style={styles.icon}>
                  {options.tabBarIcon?.({ focused, color: tint, size: 24 })}
                  {hasBadge ? (
                    <View style={styles.badge}>
                      <T variant="meta" weight="semibold" color="onBrand" lang="en">
                        {String(badge)}
                      </T>
                    </View>
                  ) : null}
                </View>
                {/* Shrinks rather than truncates: "షార్ట్ న్యూస్" at a large OS font step. */}
                <T variant="meta" weight="semibold" color={focused ? 'brand' : 'muted'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {label}
                </T>
              </PressableScale>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  bar: {
    backgroundColor: color.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  row: { flexDirection: 'row', flex: 1 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  pill: {
    position: 'absolute',
    top: space.xs,
    left: 0,
    height: TAB_BAR_HEIGHT - space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.brandTint,
  },
  icon: { height: 24, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -space.sm,
    left: 14,
    minWidth: 20,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.breaking,
    alignItems: 'center',
  },
}));
