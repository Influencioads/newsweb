import type { ReactNode } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';

import type { HapticKind } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T, type TLang } from '@/ui/Text';

/**
 * Chip / ChipRail — pill filters (sections, districts, font steps).
 *
 * A Chip is a 44-tall pill on PressableScale: surface + rule border at rest,
 * brand fill with onBrand text when `selected`. `count` renders a small
 * trailing figure. ChipRail is the horizontal, scrollbar-less strip chips
 * live in, with the page's edge padding built in.
 */
export interface ChipProps {
  label: string;
  selected?: boolean;
  icon?: IconName;
  onPress?: () => void;
  count?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  lang?: TLang;
  /** Defaults to `select`. */
  haptic?: HapticKind | false;
  /** `radio` inside a radiogroup (announces checked instead of selected). */
  role?: 'button' | 'radio';
  /** Defaults to the label (plus the count). */
  accessibilityLabel?: string;
}

const useStyles = makeStyles((color) => ({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.surface,
  },
  selected: { backgroundColor: color.brand, borderColor: color.brand },
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
}));

export function Chip({
  label,
  selected = false,
  icon,
  onPress,
  count,
  disabled = false,
  style,
  lang = 'auto',
  haptic = 'select',
  role = 'button',
  accessibilityLabel,
}: ChipProps) {
  const styles = useStyles();
  const color = useColors();
  const fg = selected ? 'onBrand' : 'ink';

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      minHeight={TAP}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? (count == null ? label : `${label} ${count}`)}
      accessibilityState={role === 'radio' ? { checked: selected, disabled } : { selected, disabled }}
      style={[styles.chip, selected && styles.selected, style]}
    >
      {icon ? <Icon name={icon} size={16} color={color[fg]} /> : null}
      <T variant="ui" weight="semibold" color={fg} lang={lang} numberOfLines={1}>
        {label}
      </T>
      {count != null ? (
        <T variant="meta" weight="medium" color={selected ? 'onBrand' : 'muted'} lang="en">
          {String(count)}
        </T>
      ) : null}
    </PressableScale>
  );
}

export interface ChipRailProps {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Snap each chip to the leading edge while scrolling. */
  snap?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ChipRail({ children, contentContainerStyle, snap = false, style }: ChipRailProps) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToAlignment={snap ? 'start' : undefined}
      decelerationRate={snap ? 'fast' : undefined}
      contentContainerStyle={[styles.rail, contentContainerStyle]}
      style={style}
    >
      {children}
    </ScrollView>
  );
}
