import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { WowRadioCard } from '@/components/wow/WowRadioCard';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { useRadioArt } from '@/lib/siteContent';
import { Screen } from '@/ui/Screen';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * `/radio` — WOW Radio (website: features/wow/WowRadio.tsx `RadioPage`):
 * the station's artwork over the full player — four segments, the device's
 * Telugu voice and the whole running order of the chosen segment.
 */

export default function RadioScreen() {
  const styles = useStyles();
  const m = useMotion();
  const { pick } = useI18n();
  const title = pick('వావ్ రేడియో', 'WOW Radio');
  const art = useRadioArt();

  return (
    <Screen edges={['top']} scroll bottomInset contentContainerStyle={styles.content}>
      <Stack.Screen options={{ headerShown: false, title }} />
      <ScreenHeader title={title} />
      <Image
        source={art}
        style={styles.art}
        contentFit="cover"
        transition={m.imageTransition}
        accessible
        accessibilityLabel={title}
      />
      <View style={styles.gutter}>
        <WowRadioCard variant="page" />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: { gap: space.lg, paddingBottom: space.xl },
  gutter: { paddingHorizontal: space.lg },
  /** wow-radio.webp is 960×540. */
  art: {
    marginHorizontal: space.lg,
    aspectRatio: 960 / 540,
    borderRadius: radius.lg,
  },
}));
