import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';

import { absoluteMediaUrl, api } from '@/api/client';
import { Equalizer } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { radius, space, type } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { formatTime, usePlayer, useTrackStatus, type Track } from '@/stores/player';
import { Badge } from '@/ui/Badge';
import { IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * The latest audio bulletin, in the home feed.
 *
 * Not a sixth tab — the bar is already at five, which is as many as a bottom
 * bar carries, and six items a day does not earn a permanent slot.
 *
 * The card owns no audio: play loads the bulletin into the app's global
 * player, so it keeps going when the row scrolls out of the render window or
 * the reader leaves home — the dock carries it from there. The card is only a
 * trigger plus live status (equalizer, elapsed / length) while its bulletin
 * is the one playing. The screen renders no row at all when nothing is on
 * air — the ordinary between-slots case and the kill switch (an admin turned
 * bulletins off) both arrive as `available: false`.
 */

export interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  date: string | null;
  slot: number | null;
  slot_label_te: string | null;
  items: { position: number; headline_te: string }[];
}

export function useBulletin() {
  return useQuery({
    queryKey: ['bulletin', 'latest'],
    queryFn: async () => (await api.get<BulletinSummary>('/public/bulletins/latest')).data,
    retry: false,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}

/** The player id every bulletin surface agrees on (the bulletin screen's controls use it too). */
export const bulletinId = (date: string, slot: number) => `bulletin-${date}-${slot}`;

/** Each slot's show banner (black background, "Click To Listen" drawn in), keyed by IST hour. */
const ART: Record<number, number> = {
  7: require('../../assets/bulletins/7.webp'),
  9: require('../../assets/bulletins/9.webp'),
  15: require('../../assets/bulletins/15.webp'),
  17: require('../../assets/bulletins/17.webp'),
  19: require('../../assets/bulletins/19.webp'),
  21: require('../../assets/bulletins/21.webp'),
};
export const bulletinArt = (slot: number | null | undefined): number | null => (slot != null ? ART[slot] ?? null : null);

/** A bulletin as a player track; null when it has no file to play. */
export function bulletinTrack(
  b: Pick<BulletinSummary, 'url' | 'duration_sec' | 'date' | 'slot' | 'slot_label_te'>,
  kindLabel: string,
): Track | null {
  const url = absoluteMediaUrl(b.url);
  if (!url || b.date == null || b.slot == null) return null;
  return {
    id: bulletinId(b.date, b.slot),
    kind: 'bulletin',
    title: b.slot_label_te || kindLabel,
    subtitle: `${kindLabel} · ${String(b.slot).padStart(2, '0')}:00`,
    url,
    durationSec: b.duration_sec || undefined,
    href: '/bulletin',
  };
}

// ponytail: no i18n key yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

const DOT = 6;

const useStyles = makeStyles((color) => ({
  card: { marginHorizontal: space.lg, marginTop: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  time: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  more: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
  },
  soft: { opacity: 0.75 },
  list: { gap: space.xs },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.pill,
    backgroundColor: color.onOverlay,
    // Centre the disc on the first line of a bodySmall row.
    marginTop: (type.bodySmall.lineHeight - DOT) / 2,
  },
  headline: { flex: 1 },
}));

export function BulletinCard({ bulletin }: { bulletin: BulletinSummary }) {
  const styles = useStyles();
  const color = useColors();
  const { t, isTelugu } = useI18n();
  const id = bulletin.date != null && bulletin.slot != null ? bulletinId(bulletin.date, bulletin.slot) : '';
  const status = useTrackStatus(id);
  const { toggle, playTrack } = usePlayer.getState();

  const playing = status.playing;
  const total = status.duration || bulletin.duration_sec;

  function onPlay() {
    if (status.current) return toggle();
    const track = bulletinTrack(bulletin, t('player.kindBulletin'));
    if (track) playTrack(track);
  }

  return (
    <Card tone="ink" style={styles.card}>
      <View style={styles.head}>
        <Badge tone="breaking" icon="radio" size="xs" label={L('ప్రసారంలో', 'On air', isTelugu)} />
        {bulletin.slot != null ? (
          <T variant="meta" weight="bold" color="onOverlay" lang="en">
            {`${String(bulletin.slot).padStart(2, '0')}:00`}
          </T>
        ) : null}
      </View>

      {bulletin.slot_label_te ? (
        <T variant="headlineSm" weight="bold" color="onOverlay" lang="te">
          {bulletin.slot_label_te}
        </T>
      ) : null}

      <View style={styles.controls}>
        <IconButton
          name={playing ? 'pause' : 'play'}
          label={playing ? t('ui.pause') : t('ui.listen')}
          size={48}
          variant="inverse"
          onPress={onPlay}
        />
        <View style={styles.time}>
          {status.current ? <Equalizer playing={playing && !status.buffering} color={color.exclusive} /> : null}
          <T variant="meta" weight="medium" color="onOverlay" lang="en" style={styles.soft}>
            {status.current ? `${formatTime(status.elapsed)} / ${formatTime(total)}` : formatTime(total)}
          </T>
        </View>
        <PressableScale
          onPress={() => router.push('/bulletin')}
          haptic="select"
          accessibilityLabel={t('home.seeAll')}
          style={styles.more}
        >
          <T variant="ui" weight="semibold" color="onOverlay">
            {t('home.seeAll')}
          </T>
          <Icon name="chevronRight" size={16} color={color.onOverlay} />
        </PressableScale>
      </View>

      <View style={styles.list}>
        {bulletin.items.slice(0, 3).map((item) => (
          <View key={item.position} style={styles.item}>
            <View style={styles.dot} />
            <T variant="bodySmall" color="onOverlay" lang="te" style={[styles.headline, styles.soft]}>
              {item.headline_te}
            </T>
          </View>
        ))}
      </View>
    </Card>
  );
}
