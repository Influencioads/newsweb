import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { View } from 'react-native';

import type { VideoOut } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { useMotion } from '@/lib/motion';
import { alpha, radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { T } from '@/ui/Text';

/**
 * One video in a rail or list (§15): a Card (surface, rule, card shadow) with
 * the thumbnail bleeding to the top corners, the same way LeadCard does.
 *
 * Thumbnail, title, publisher, age — what a reader needs to decide whether to
 * tap. Nothing plays here: playback lives on the video screen, where the view
 * is counted and the channel is credited.
 */

/** Rail card width; VideoStrip snaps by this plus the trailing gap. */
export const VIDEO_CARD_WIDTH = 232;

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

export const VideoCard = memo(function VideoCard({ video, wide = false }: { video: VideoOut; wide?: boolean }) {
  const styles = useStyles();
  const color = useColors();
  const m = useMotion();
  const { pick, isTelugu } = useI18n();
  const L = (te: string, en: string) => (isTelugu ? te : en);
  const title = pick(video.title_te, video.title_en);
  const duration = formatDuration(video.duration_sec);
  const meta = [
    video.channel?.name,
    video.view_count > 0 ? `${formatCount(video.view_count, isTelugu)} ${L('వ్యూస్', 'views')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card
      padding="none"
      elevated
      onPress={() => openVideo(video)}
      accessibilityLabel={[title, duration, meta].filter(Boolean).join(', ')}
      style={wide ? styles.wide : styles.card}
    >
      <View style={styles.thumbWrap}>
        <Image
          source={{ uri: video.thumbnail_url }}
          style={styles.thumb}
          contentFit="cover"
          transition={m.imageTransition}
          recyclingKey={String(video.id)}
        />
        <View style={styles.playWrap} pointerEvents="none">
          <View style={styles.playDisc}>
            <Icon name="playCircle" size={28} color={color.onOverlay} />
          </View>
        </View>
        {duration ? (
          <View style={styles.duration}>
            <T variant="meta" weight="medium" color="onOverlay" lang="en">
              {duration}
            </T>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <T variant="headlineSm" weight="semibold" numberOfLines={2}>
          {title}
        </T>
        {meta ? (
          <T variant="meta" color="muted" numberOfLines={1}>
            {meta}
          </T>
        ) : null}
      </View>
    </Card>
  );
});

const useStyles = makeStyles((color) => ({
  card: { width: VIDEO_CARD_WIDTH, marginRight: space.md },
  wide: { marginBottom: space.lg },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.placeholder,
  },
  body: { padding: space.md, gap: space.xs },
  thumb: { width: '100%', height: '100%' },
  playWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisc: {
    width: TAP,
    height: TAP,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(color.overlay, 0.55),
  },
  duration: {
    position: 'absolute',
    right: space.sm,
    bottom: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: alpha(color.overlay, 0.75),
  },
}));
