import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as publicApi from '@/api/public';
import { useI18n } from '@/lib/i18n';
import { color, font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';

/** Horizontal YouTube strip (§15); hidden when the category has no videos. */
export function VideoStrip({ category }: { category?: string }) {
  const styles = useStyles();
  const { t, pick } = useI18n();
  const videos = useQuery({
    queryKey: ['videos-strip', category ?? 'all'],
    queryFn: () => publicApi.fetchVideos({ category, limit: 6 }),
    staleTime: 120_000,
  });
  const items = videos.data?.videos ?? [];
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>▶ {t('tab.videos')}</Text>
        <Pressable onPress={() => router.push('/videos')} accessibilityRole="button">
          <Text style={styles.seeAll}>{t('home.seeAll')} →</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((video) => (
          <Pressable
            key={video.id}
            onPress={() =>
              router.push({ pathname: '/video/[youtubeId]', params: { youtubeId: video.youtube_id } })
            }
            accessibilityRole="button"
            style={styles.card}
          >
            <View style={styles.thumbWrap}>
              <Image source={{ uri: video.thumbnail_url }} style={styles.thumb} contentFit="cover" transition={150} />
              <View style={styles.playBadge}>
                <Text style={styles.playGlyph}>▶</Text>
              </View>
            </View>
            <Text style={styles.videoTitle} numberOfLines={2}>
              {pick(video.title_te, video.title_en)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  wrap: {
    backgroundColor: color.paper,
    borderTopWidth: 2,
    borderTopColor: color.ink,
    paddingBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  title: { fontFamily: font.headline, fontSize: 18, lineHeight: 28, color: color.brand },
  seeAll: { fontFamily: font.teluguSemiBold, fontSize: 12, lineHeight: 18, color: color.info },
  row: { paddingHorizontal: 14, gap: 12 },
  card: { width: 200 },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: 200,
    height: 112,
    borderRadius: 6,
    backgroundColor: color.placeholder,
  },
  playBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    fontSize: 15,
    color: color.white,
    backgroundColor: 'rgba(0,0,0,0.55))',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    overflow: 'hidden',
  },
  videoTitle: {
    fontFamily: font.teluguSemiBold,
    fontSize: 12.5,
    lineHeight: 20,
    color: color.ink,
    marginTop: 6,
  },
}));
