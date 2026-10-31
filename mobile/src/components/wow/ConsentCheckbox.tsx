import { View } from 'react-native';

import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/** A WOW-orange tick box with its sentence, for the Nominate and Share Your Village forms. */
export function ConsentCheckbox({
  checked,
  onChange,
  label,
  invalid = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  invalid?: boolean;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale
      onPress={() => onChange(!checked)}
      haptic="select"
      scaleTo={0.99}
      minHeight={TAP}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={styles.check}
    >
      <View style={[styles.box, checked ? styles.boxOn : invalid ? { borderColor: color.breaking } : null]}>
        {checked ? <Icon name="check" size={16} color={color.onWow} strokeWidth={2.5} /> : null}
      </View>
      <T variant="bodySmall" color="ink" style={styles.text}>
        {label}
      </T>
    </PressableScale>
  );
}

const useStyles = makeStyles((color) => ({
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  box: {
    width: 24,
    height: 24,
    marginTop: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm - 2,
    borderWidth: 2,
    borderColor: color.ruleStrong,
    backgroundColor: color.field,
  },
  boxOn: { backgroundColor: color.wowDeep, borderColor: color.wowDeep },
  text: { flex: 1, minWidth: 0 },
}));
