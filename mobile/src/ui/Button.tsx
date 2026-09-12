import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import type { HapticKind } from '@/lib/motion';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T, type PaletteKey, type TLang } from '@/ui/Text';

/**
 * Button / IconButton — the app's two labelled tap targets.
 *
 * `Button` is a text button (optionally with a leading/trailing glyph) on
 * PressableScale: 44/48 tall, radius.md, `ui` semibold label that switches to
 * Noto Sans Telugu when the label is Telugu. `pending` swaps the leading slot
 * for a spinner and marks the control busy; `disabled` dims it via
 * PressableScale.
 *
 * `IconButton` is a round 44/48 glyph-only control with an optional count
 * badge; `active` paints it brand-on-brandTint (bookmarked, liked, …).
 *
 * `inverse` (both controls) is the fill for constant-dark panels (Card
 * tone="ink", BulletinCard): onOverlay disc with an inkDeep label, since the
 * brand fill sinks into inkDeep in light mode.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 44 | 48;
  icon?: IconName;
  iconRight?: IconName;
  /** Shows a spinner in the icon slot and blocks presses (not dimmed). */
  pending?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  full?: boolean;
  haptic?: HapticKind | false;
  style?: StyleProp<ViewStyle>;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  lang?: TLang;
}

const FG: Record<ButtonVariant, PaletteKey> = {
  primary: 'onBrand',
  secondary: 'ink',
  ghost: 'ink',
  danger: 'onBrand',
  inverse: 'inkDeep',
};

const useStyles = makeStyles((color) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
  },
  primary: { backgroundColor: color.brand },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.rule },
  ghost: {},
  danger: { backgroundColor: color.breaking },
  inverse: { backgroundColor: color.onOverlay },
  full: { alignSelf: 'stretch' },
  // IconButton
  icon: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  iconSecondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.rule },
  iconPrimary: { backgroundColor: color.brand },
  iconInverse: { backgroundColor: color.onOverlay },
  active: { backgroundColor: color.brandTint },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 20,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.breaking,
    alignItems: 'center',
  },
}));

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = TAP,
  icon,
  iconRight,
  pending = false,
  disabled = false,
  full = false,
  haptic,
  style,
  accessibilityLabel,
  lang = 'auto',
}: ButtonProps) {
  const styles = useStyles();
  const color = useColors();
  const fg = FG[variant];

  return (
    <PressableScale
      onPress={pending ? undefined : onPress}
      disabled={disabled}
      haptic={haptic}
      minHeight={size}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: pending, disabled }}
      style={[styles.base, styles[variant], size === 48 && { paddingHorizontal: space.xl }, full && styles.full, style]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={color[fg]} />
      ) : icon ? (
        <Icon name={icon} size={20} color={color[fg]} />
      ) : null}
      <T variant="ui" weight="semibold" color={fg} lang={lang} numberOfLines={1}>
        {label}
      </T>
      {iconRight ? <Icon name={iconRight} size={20} color={color[fg]} /> : null}
    </PressableScale>
  );
}

export interface IconButtonProps {
  name: IconName;
  /** Read by assistive tech — the glyph alone says nothing. */
  label: string;
  onPress?: () => void;
  size?: 44 | 48;
  /** Toggled-on look: brand glyph on a brandTint disc. */
  active?: boolean;
  /** Count bubble; hidden when null/0/''. */
  badge?: number | string | null;
  variant?: 'ghost' | 'secondary' | 'primary' | 'inverse';
  /** Glyph colour override (a palette value). */
  color?: string;
  disabled?: boolean;
  haptic?: HapticKind | false;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  name,
  label,
  onPress,
  size = TAP,
  active = false,
  badge,
  variant = 'ghost',
  color: tint,
  disabled = false,
  haptic,
  style,
}: IconButtonProps) {
  const styles = useStyles();
  const color = useColors();
  const fg = tint ?? (active ? color.brand : variant === 'primary' ? color.onBrand : variant === 'inverse' ? color.inkDeep : color.ink);
  const showBadge = badge != null && badge !== 0 && badge !== '';

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      minHeight={size}
      accessibilityLabel={showBadge ? `${label}, ${badge}` : label}
      accessibilityState={{ selected: active, disabled }}
      style={[
        styles.icon,
        { width: size, height: size },
        variant === 'secondary' && styles.iconSecondary,
        variant === 'primary' && styles.iconPrimary,
        variant === 'inverse' && styles.iconInverse,
        active && variant !== 'primary' && styles.active,
        style,
      ]}
    >
      <Icon name={name} size={size === 48 ? 24 : 20} color={fg} strokeWidth={active ? 2 : 1.75} />
      {showBadge ? (
        <View style={styles.badge} pointerEvents="none">
          <T variant="meta" weight="semibold" color="onBrand" numberOfLines={1}>
            {String(badge)}
          </T>
        </View>
      ) : null}
    </PressableScale>
  );
}
