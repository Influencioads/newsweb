import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import * as publicApi from '@/api/public';
import type { VideoOut } from '@/api/types';
import { SectionHeader } from '@/components/SectionHeader';
import { VIDEO_CARD_WIDTH, VideoCard } from '@/components/VideoCard';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { SkeletonCard } from '@/ui/Skeleton';

const keyOf = (video: VideoOut) => String(video.id);
const renderItem = ({ item }: { item: VideoOut }) => <VideoCard video={item} />;

/**
 * Horizontal YouTube strip (§15). Skeleton while loading so it does not pop
 * into the feed; hidden (not an error row — it is embedded) when the category
 * has no videos or the request fails.
 */
export function VideoStrip({ category }: { category?: string }) {
  const styles = useStyles();
  const { t } = useI18n();
  const videos = useQuery({
    queryKey: ['videos-strip', category ?? 'all'],
    queryFn: () => publicApi.fetchVideos({ category, limit: 6 }),
    staleTime: 120_000,
  });
  if (videos.isPending) {
    return (
      <View style={styles.wrap}>
        <SectionHeader title={t('tab.videos')} />
        <View style={[styles.track, styles.skeletonRow]}>
          <SkeletonCard variant="video" />
          <SkeletonCard variant="video" />
        </View>
      </View>
    );
  }
  const items = videos.data?.videos ?? [];
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <SectionHeader title={t('tab.videos')} onSeeAll={() => router.push('/videos')} />
      <FlatList
        horizontal
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        snapToInterval={VIDEO_CARD_WIDTH + space.md}
        snapToAlignment="start"
        decelerationRate="fast"
        contentContainerStyle={styles.track}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { paddingBottom: space.sm },
  track: { paddingHorizontal: space.lg },
  skeletonRow: { flexDirection: 'row', gap: space.md },
}));
