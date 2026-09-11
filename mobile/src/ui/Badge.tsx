import { View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon, type IconName } from '@/ui/Icon';
import { T, type PaletteKey } from '@/ui/Text';

/**
 * Badge — a small tinted pill label: BREAKING, EXCLUSIVE, AI, a district tag,
 * a moderation status. Not a control; it just names a tone.
 *
 * Every tone maps to a `<tone>Tint` background with the tone colour as text,
 * so it reads in both themes. `xs` uses the meta step, `sm` the ui step —
 * both through <T>, so Telugu labels keep their line-height.
 */
export type BadgeTone =
  | 'brand'
  | 'breaking'
  | 'exclusive'
  | 'ai'
  | 'success'
  | 'info'
  | 'partial'
  | 'muted'
  | 'district';

export interface BadgeProps {
  tone?: BadgeTone;
  label: string;
  icon?: IconName;
  size?: 'xs' | 'sm';
  style?: StyleProp<ViewStyle>;
}

const TONE: Record<BadgeTone, { bg: PaletteKey; fg: PaletteKey }> = {
  brand: { bg: 'brandTint', fg: 'brand' },
  breaking: { bg: 'breakingTint', fg: 'breaking' },
  exclusive: { bg: 'exclusiveTint', fg: 'exclusive' },
  ai: { bg: 'aiTint', fg: 'ai' },
  success: { bg: 'successTint', fg: 'success' },
  info: { bg: 'infoTint', fg: 'info' },
  partial: { bg: 'partialTint', fg: 'partial' },
  muted: { bg: 'paperSub', fg: 'muted' },
  district: { bg: 'ruleSoft', fg: 'inkSoft' },
};

const useStyles = makeStyles(() => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    borderRadius: radius.pill,
  },
  xs: { paddingHorizontal: space.sm },
  sm: { paddingHorizontal: space.md, paddingVertical: space.xs },
}));

export function Badge({ tone = 'muted', label, icon, size = 'sm', style }: BadgeProps) {
  const styles = useStyles();
  const color = useColors();
  const { bg, fg } = TONE[tone];

  return (
    <View style={[styles.base, styles[size], { backgroundColor: color[bg] }, style]} accessible accessibilityLabel={label}>
      {icon ? <Icon name={icon} size={16} color={color[fg]} /> : null}
      <T variant={size === 'xs' ? 'meta' : 'ui'} weight="semibold" color={fg} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}
