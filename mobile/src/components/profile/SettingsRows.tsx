import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';

import { space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Card } from '@/ui/Card';
import { Divider } from '@/ui/Divider';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * The settings-list pieces the Profile tab is built from: a titled `Group`
 * (heading + optional hint over one Card) and the two rows that live inside
 * it — `NavRow` (label, current value, chevron) and `SwitchRow`.
 *
 * Both rows are whole-row PressableScales at TAP_LG, so the target is the
 * line the reader sees rather than the glyph at its end; the `Switch` inside
 * a SwitchRow is hidden from assistive tech because the row already announces
 * itself as a switch with its checked state.
 */
export interface GroupProps {
  title: string;
  hint?: string;
  /** `none` for stacked rows, `md` for chip blocks. */
  padding?: 'none' | 'sm' | 'md';
  children: ReactNode;
}

export function Group({ title, hint, padding = 'none', children }: GroupProps) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <T variant="headlineSm" weight="bold" accessibilityRole="header">
        {title}
      </T>
      {hint ? (
        <T variant="meta" color="muted" style={styles.hint}>
          {hint}
        </T>
      ) : null}
      <Card padding={padding} style={styles.card}>
        {children}
      </Card>
    </View>
  );
}

/** Hairline between two rows in the same Card, inset past the icon column. */
export function RowDivider() {
  return <Divider inset={space.lg} />;
}

export interface NavRowProps {
  label: string;
  icon?: IconName;
  /** Current value, shown muted before the chevron. */
  value?: string;
  onPress: () => void;
  /** Paints the label breaking-red (sign out, delete). */
  danger?: boolean;
  /** Trailing glyph; `externalLink` for a row that leaves the app. */
  chevron?: IconName;
}

export function NavRow({ label, icon, value, onPress, danger = false, chevron = 'chevronRight' }: NavRowProps) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale
      onPress={onPress}
      minHeight={TAP_LG}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={styles.row}
    >
      {icon ? <Icon name={icon} size={20} color={danger ? color.breaking : color.muted} /> : null}
      <T variant="body" color={danger ? 'breaking' : 'ink'} numberOfLines={1} style={styles.label}>
        {label}
      </T>
      {value ? (
        <T variant="ui" color="muted" numberOfLines={1}>
          {value}
        </T>
      ) : null}
      <Icon name={chevron} size={20} color={color.mutedLight} />
    </PressableScale>
  );
}

export interface SwitchRowProps {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  icon?: IconName;
}

export function SwitchRow({ label, value, onChange, icon }: SwitchRowProps) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale
      onPress={() => onChange(!value)}
      haptic="select"
      minHeight={TAP_LG}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={styles.row}
    >
      {icon ? <Icon name={icon} size={20} color={color.muted} /> : null}
      <T variant="body" numberOfLines={2} style={styles.label}>
        {label}
      </T>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: color.brand, false: color.ruleStrong }}
        thumbColor={color.surface}
        ios_backgroundColor={color.ruleStrong}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </PressableScale>
  );
}

const useStyles = makeStyles(() => ({
  group: { gap: space.xs, marginTop: space.xl },
  hint: { marginBottom: space.xs },
  card: { marginTop: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  label: { flex: 1 },
}));
