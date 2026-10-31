import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useId } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { absoluteMediaUrl } from '@/api/client';
import { fetchHeroes } from '@/components/wow/FeaturedHeroes';
import { useI18n } from '@/lib/i18n';
import { useSiteContent } from '@/lib/siteContent';
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
 *
 * Behind it, as on the website: the picture uploaded in CMS → Site content →
 * Nominate form, else the newest Local Hero story's photo, under an orange-to-
 * deep-blue wash so the white type reads on any photo.
 */
export function NominateCta({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();
  const uploaded = useSiteContent().nominate.image_url;
  const heroes = useQuery({ queryKey: ['wow', 'featured-heroes'], queryFn: fetchHeroes, staleTime: 120_000 });
  const storyPhoto = heroes.data?.articles.find((a) => a.hero?.url)?.hero?.url ?? null;
  const photo = absoluteMediaUrl(uploaded || storyPhoto);
  const onPhoto = photo ? 'onOverlay' : undefined;

  return (
    <View style={[styles.card, photo ? styles.onPhoto : null, compact ? styles.compact : styles.roomy]}>
      {photo ? (
        <>
          <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
          <Wash />
        </>
      ) : null}
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
          color={onPhoto}
          accessibilityRole="header"
        >
          మీ ఊరి హీరోను ప్రపంచానికి పరిచయం చేయండి!
        </T>
        <T variant="bodySmall" color={onPhoto ?? 'inkSoft'} numberOfLines={compact ? 3 : undefined}>
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

/**
 * The website's photo wash: a colour at the top (WOW orange by default) fading
 * into the deep WOW blue, so white type reads on any photo.
 */
export function Wash({ top = 'wow', strength = 0.55, middle = 0.75 }: { top?: 'wow' | 'success'; strength?: number; middle?: number }) {
  const color = useColors();
  const id = `wash${useId().replace(/:/g, '')}`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color[top]} stopOpacity={strength} />
            <Stop offset="0.5" stopColor={color.brandDeep} stopOpacity={middle} />
            <Stop offset="1" stopColor={color.brandDeep} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
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
  onPhoto: { overflow: 'hidden', minHeight: 320, justifyContent: 'flex-end', backgroundColor: color.brandDeep },
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
