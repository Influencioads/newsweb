import { Image } from 'expo-image';
import { View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { absoluteMediaUrl } from '@/api/client';
import type { MediaOut } from '@/api/types';
import { useMotion } from '@/lib/motion';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { T } from '@/ui/Text';

/**
 * The hero, with the parallax the reading surface is built around: the frame
 * keeps a 16:9 slot in the flow while the picture inside drifts at a third of
 * the scroll speed and swells slightly on an overscroll pull. The image is
 * overscanned top and bottom by `OVERSCAN`, so the drift never exposes an
 * edge, and the whole thing collapses to a plain still under reduce-motion.
 */
export interface ArticleHeroProps {
  media: MediaOut;
  scrollY: SharedValue<number>;
}

/** The scroll window the parallax plays over. */
const RANGE = 240;
/** Hidden image bleed above and below the frame — must cover the drift. */
const OVERSCAN = 60;
const DRIFT = OVERSCAN;

export function ArticleHero({ media, scrollY }: ArticleHeroProps) {
  const styles = useStyles();
  const m = useMotion();
  const reduce = m.reduce;
  const uri = absoluteMediaUrl(media.url);

  const parallax = useAnimatedStyle(() => {
    if (reduce) return {};
    return {
      transform: [
        { translateY: interpolate(scrollY.value, [0, RANGE], [0, DRIFT], Extrapolation.CLAMP) },
        { scale: interpolate(scrollY.value, [-120, 0, RANGE], [1.22, 1, 1.06], Extrapolation.CLAMP) },
      ],
    };
  });

  if (!uri) return null;
  const caption = [media.caption_te, media.credit].filter(Boolean).join(' · ');

  return (
    <View>
      <View style={styles.frame}>
        <Animated.View style={[styles.layer, parallax]}>
          <Image
            source={{ uri }}
            style={styles.image}
            contentFit="cover"
            placeholder={media.blurhash ?? undefined}
            transition={m.imageTransition}
            // expo-image is not accessible by default, so the label alone would
            // never reach the tree; an image with no alt stays decorative.
            accessible={Boolean(media.alt_te)}
            accessibilityLabel={media.alt_te ?? undefined}
          />
        </Animated.View>
      </View>
      {caption ? (
        <T variant="meta" scaled color="muted" style={styles.caption}>
          {caption}
        </T>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: color.placeholder,
  },
  layer: { position: 'absolute', left: 0, right: 0, top: -OVERSCAN, bottom: -OVERSCAN },
  image: { flex: 1, backgroundColor: color.placeholder },
  caption: { paddingHorizontal: space.lg, paddingTop: space.sm },
}));
