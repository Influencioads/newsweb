import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, useWindowDimensions, View, type ListRenderItem } from 'react-native';

import { absoluteMediaUrl } from '@/api/client';
import type { MediaOut } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { radius, space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { T } from '@/ui/Text';

/**
 * The story's other photographs.
 *
 * `ArticleDetail.gallery` has been fetched, typed and served since galleries
 * shipped, and no component ever read it — every extra picture an editor
 * attached was invisible in the app. This renders it. No API work was needed.
 *
 * A swipe rail, not a lightbox. The phone viewport already *is* the full frame,
 * so a fullscreen viewer buys a zoom gesture for 100–400 KB of dependency on a
 * bundle that is already 6.9 MB.
 *
 * ponytail: swipe rail only, no pinch-zoom. Add a Modal + pinch gesture if
 * readers actually ask — not a new dependency.
 *
 * Caption and credit sit under the frame and are always visible. The web
 * shows the credit on hover; a phone has no hover, and an unattributed
 * photograph is the one thing §12.5 will not have.
 */
export interface ArticleGalleryProps {
  images: MediaOut[];
}

export function ArticleGallery({ images }: ArticleGalleryProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const m = useMotion();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  // Returns nothing rather than an empty shell, so the screen can mount it
  // unconditionally and never has to ask whether there are pictures.
  if (!images.length) return null;

  const frameWidth = width - space.lg * 2;

  const renderItem: ListRenderItem<MediaOut> = ({ item }) => {
    const uri = absoluteMediaUrl(item.url);
    return (
      <View style={{ width: frameWidth }}>
        <View style={[styles.frame, { width: frameWidth }]}>
          {uri ? (
            <Image
              source={{ uri }}
              style={styles.image}
              contentFit="cover"
              placeholder={item.blurhash ? { blurhash: item.blurhash } : undefined}
              transition={m.imageTransition}
              recyclingKey={String(item.id)}
              accessibilityLabel={item.alt_te ?? undefined}
            />
          ) : (
            <View style={[styles.image, styles.fallback]} />
          )}
          {item.ai_generated ? (
            <View style={styles.badge} aria-hidden>
              <Badge tone="ai" size="xs" label={t('article.aiImage')} />
            </View>
          ) : null}
        </View>
        {item.caption_te ? (
          <T variant="bodySmall" scaled color="muted" style={styles.caption}>
            {item.caption_te}
          </T>
        ) : null}
        {item.credit ? (
          <T variant="meta" color="muted" style={styles.caption}>
            {item.credit}
          </T>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <T variant="headlineSm" weight="bold" style={styles.heading}>
        {t('article.gallery')}
      </T>
      <FlatList
        data={images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={frameWidth + space.md}
        decelerationRate="fast"
        contentContainerStyle={styles.rail}
        ItemSeparatorComponent={() => <View style={{ width: space.md }} />}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        onMomentumScrollEnd={(event) =>
          setIndex(
            Math.round(event.nativeEvent.contentOffset.x / (frameWidth + space.md)),
          )
        }
      />
      {images.length > 1 ? (
        <T variant="meta" color="muted" style={styles.counter}>
          {`${index + 1} / ${images.length}`}
        </T>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  root: { marginTop: space.xl, gap: space.sm },
  heading: { paddingHorizontal: space.lg },
  rail: { paddingHorizontal: space.lg },
  frame: {
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.placeholder,
  },
  image: { width: '100%', height: '100%' },
  fallback: { backgroundColor: color.placeholder },
  badge: { position: 'absolute', top: space.sm, left: space.sm },
  caption: { paddingTop: space.xs },
  counter: { paddingHorizontal: space.lg },
}));
