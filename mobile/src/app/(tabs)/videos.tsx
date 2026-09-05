import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as publicApi from '@/api/public';
import type { VideoOut } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/Feedback';
import { timeAgo, useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';

/**
 * Video hub (§15, YouTube links only). Cards carry the YouTube thumbnail;
 * nothing plays until the reader taps — the player screen embeds it.
 */
export default function VideosScreen() {
  const { t, pick, language } = useI18n();

  const feed = useInfiniteQuery({
    queryKey: ['videos'],
    queryFn: ({ pageParam }) => publicApi.fetchVideos({ offset: pageParam, limit: 12 }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });

  const videos = feed.data?.pages.flatMap((page) => page.videos) ?? [];

  function open(video: VideoOut) {
    router.push({
      pathname: '/video/[youtubeId]',
      params: { youtubeId: video.youtube_id, title: video.title_te },
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>▶ {t('videos.title')}</Text>
      </View>

      {feed.isLoading ? <LoadingState /> : null}
      {feed.isError ? <ErrorState onRetry={() => feed.refetch()} /> : null}
      {feed.data ? (
        videos.length === 0 ? (
          <EmptyState message={t('videos.empty')} />
        ) : (
          <FlatList
            data={videos}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => open(item)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
              >
                <View style={styles.thumbWrap}>
                  <Image
                    source={{ uri: item.thumbnail_url }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={150}
                  />
                  <View style={styles.playBadge}>
                    <Text style={styles.playGlyph}>▶</Text>
                  </View>
                </View>
                <View style={styles.cardBody}>
                  {item.category ? (
                    <Text style={styles.kicker}>
                      {pick(item.category.name_te, item.category.name_en)}
                    </Text>
                  ) : null}
                  <Text style={styles.cardTitle}>{item.title_te}</Text>
                  <Text style={styles.cardTime}>{timeAgo(item.published_at, language)}</Text>
                </View>
              </Pressable>
            )}
            onEndReached={() => {
              if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
            }}
            onEndReachedThreshold={0.6}
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => feed.refetch()}
          />
        )
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  header: {
    backgroundColor: color.paper,
    borderBottomWidth: 2,
    borderBottomColor: color.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  title: { fontFamily: font.headline, fontSize: 20, lineHeight: 30, color: color.brand },
  list: { padding: 12, gap: 12 },
  card: {
    backgroundColor: color.paper,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.rule,
  },
  thumbWrap: { position: 'relative' },
  thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.placeholder },
  playBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -24,
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: color.white, fontSize: 18, marginLeft: 3 },
  cardBody: { padding: 12 },
  kicker: {
    fontFamily: font.teluguSemiBold,
    fontSize: 11,
    lineHeight: 17,
    color: color.brand,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontFamily: font.teluguBold,
    fontSize: 16,
    lineHeight: 26,
    color: color.ink,
    marginTop: 2,
  },
  cardTime: {
    fontFamily: font.telugu,
    fontSize: 11.5,
    lineHeight: 17,
    color: color.mutedLight,
    marginTop: 4,
  },
});
