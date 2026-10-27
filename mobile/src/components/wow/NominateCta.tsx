import { router } from 'expo-router';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { radius, shadow, space, TAP_LG } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Icon, type IconName } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * "Nominate Your Local Hero" — the app's copy of the website's `NominateCta`
 * (frontend/src/features/wow/LocalHeroes.tsx): a WOW-orange card with the
 * pitch line, a short explainer and the way into the /nominate form.
 *
 * The headline stays Telugu in both languages, as it does on the website.
 * `compact` is the tighter version for rails and side slots.
 */
export function NominateCta({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();

  return (
    <View style={[styles.card, compact ? styles.compact : styles.roomy]}>
      <View style={styles.copy}>
        <View style={styles.pill}>
          <Icon name="heartHandshake" size={16} color={color.onWow} />
          <T variant="meta" weight="bold" color="onWow" numberOfLines={1}>
            {pick('లోకల్ హీరోను నామినేట్ చేయండి', 'Nominate Your Local Hero')}
          </T>
        </View>
        <T
          variant={compact ? 'headlineMd' : 'headlineLg'}
          weight="bold"
          lang="te"
          accessibilityRole="header"
        >
          మీ ఊరి హీరోను ప్రపంచానికి పరిచయం చేయండి!
        </T>
        <T variant="bodySmall" color="inkSoft" numberOfLines={compact ? 3 : undefined}>
          {pick(
            'ఉపాధ్యాయులు, రైతులు, ఆవిష్కర్తలు, సామాజిక సేవకులు, విద్యార్థులు, గ్రామ వాలంటీర్లు — మార్పు తెస్తున్న వారి గురించి మాకు చెప్పండి.',
            'Teachers, farmers, innovators, social workers, students, village volunteers — tell us about the people making a difference.',
          )}
        </T>
      </View>
      <WowButton
        icon="award"
        iconRight="arrowRight"
        label={pick('ఇప్పుడే నామినేట్ చేయండి', 'Nominate now')}
        onPress={() => router.push('/nominate')}
        style={styles.button}
      />
    </View>
  );
}

export interface WowButtonProps {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  iconRight?: IconName;
  /** Spinner in the icon slot; presses are ignored while set. */
  pending?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/**
 * The website's `variant="wow"` button: wowDeep fill, onWow label, 48 tall.
 * `ui/Button` has no WOW variant, so the nomination surfaces share this one.
 */
export function WowButton({
  label,
  onPress,
  icon,
  iconRight,
  pending = false,
  disabled = false,
  full = false,
  style,
  accessibilityHint,
}: WowButtonProps) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale
      onPress={pending ? undefined : onPress}
      disabled={disabled}
      haptic="medium"
      minHeight={TAP_LG}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: pending, disabled }}
      style={[styles.wowButton, full && styles.full, style]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={color.onWow} />
      ) : icon ? (
        <Icon name={icon} size={20} color={color.onWow} />
      ) : null}
      <T variant="ui" weight="semibold" color="onWow" numberOfLines={1}>
        {label}
      </T>
      {iconRight ? <Icon name={iconRight} size={20} color={color.onWow} /> : null}
    </PressableScale>
  );
}

const useStyles = makeStyles((color) => ({
  card: {
    gap: space.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: color.wow,
    backgroundColor: color.wowTint,
    ...shadow('raised', color),
  },
  roomy: { padding: space.xl },
  compact: { padding: space.lg },
  copy: { gap: space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.wowDeep,
  },
  button: { alignSelf: 'flex-start' },
  wowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    backgroundColor: color.wowDeep,
  },
  full: { alignSelf: 'stretch' },
}));
