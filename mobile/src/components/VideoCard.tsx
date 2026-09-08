import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { font } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import type { VideoOut } from '@/api/types';

/**
 * One video in a rail or list (§15).
 *
 * Thumbnail, title, publisher, age — what a reader needs to decide whether to
 * tap. Nothing plays here: playback lives on the video screen, where the view
 * is counted and the channel is credited.
 */

export function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(value: number, te: boolean): string {
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}${te ? 'కో' : 'Cr'}`;
  if (value >= 100_000) return `${(value / 100_000).toFixed(1)}${te ? 'ల' : 'L'}`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}${te ? 'వే' : 'K'}`;
  return String(value);
}

export function openVideo(video: { id: number }) {
  router.push({ pathname: '/video/[id]', params: { id: String(video.id) } });
}

export function VideoCard({ video, wide = false }: { video: VideoOut; wide?: boolean }) {
  const styles = useStyles();
  const { pick, isTelugu } = useI18n();
  const duration = formatDuration(video.duration_sec);

  return (
    <Pressable
      onPress={() => openVideo(video)}
      accessibilityRole="button"
      style={({ pressed }) => [wide ? styles.wide : styles.card, pressed && styles.pressed]}
    >
      <View style={styles.thumbWrap}>
        <Image source={{ uri: video.thumbnail_url }} style={styles.thumb}
               contentFit="cover" transition={150} />
        <View style={styles.playBadge}><Text style={styles.playGlyph}>▶</Text></View>
        {duration ? (
          <View style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View>
        ) : null}
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {pick(video.title_te, video.title_en)}
      </Text>

      <Text style={styles.meta} numberOfLines={1}>
        {[
          video.channel?.name,
          video.view_count > 0
            ? `${formatCount(video.view_count, isTelugu)} ${isTelugu ? 'వ్యూస్' : 'views'}`
            : null,
        ].filter(Boolean).join(' · ')}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((color) => ({
  card: { width: 232, marginRight: 12 },
  wide: { flex: 1, marginBottom: 18 },
  pressed: { opacity: 0.8 },
  thumbWrap: { position: 'relative', borderRadius: 6, overflow: 'hidden', backgroundColor: color.placeholder },
  thumb: { width: '100%', aspectRatio: 16 / 9 },
  playBadge: {
    position: 'absolute', left: 8, bottom: 8,
    backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  playGlyph: { color: '#FFFFFF', fontSize: 11 },
  duration: {
    position: 'absolute', right: 6, bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: 3,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  durationText: { color: '#FFFFFF', fontFamily: font.telugu, fontSize: 11 },
  title: {
    fontFamily: font.teluguSemiBold, fontSize: 13.5, lineHeight: 21,
    color: color.ink, marginTop: 7,
  },
  meta: { fontFamily: font.telugu, fontSize: 11.5, lineHeight: 17, color: color.mutedLight, marginTop: 3 },
}));
