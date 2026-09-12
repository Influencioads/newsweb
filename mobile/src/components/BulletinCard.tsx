import { useQuery } from '@tanstack/react-query';
import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { View } from 'react-native';

import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { radius, space, type } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { Badge } from '@/ui/Badge';
import { IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * The latest three-hourly audio bulletin, in the home feed.
 *
 * Not a sixth tab — the bar is already at five, which is as many as a bottom
 * bar carries, and six items a day does not earn a permanent slot.
 *
 * The card is a virtualised FlatList row, so it does not own the player: the
 * screen calls `useBulletin()` + `useAudioPlayer` (released only when the
 * screen unmounts) and hands both down, and audio keeps playing while the row
 * is scrolled out of the render window. The screen renders no row at all when
 * nothing is on air — the ordinary between-slots case and the kill switch
 * (an admin turned bulletins off) both arrive as `available: false`.
 */

export interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  slot_label_te: string | null;
  items: { position: number; headline_te: string }[];
}

export function useBulletin() {
  return useQuery({
    queryKey: ['bulletin', 'latest'],
    queryFn: async () => (await api.get<BulletinSummary>('/public/bulletins/latest')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

// ponytail: no i18n key yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DOT = 6;

const useStyles = makeStyles((color) => ({
  card: { marginHorizontal: space.lg, marginTop: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
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

export function BulletinCard({ bulletin, player }: { bulletin: BulletinSummary; player: AudioPlayer }) {
  const styles = useStyles();
  const color = useColors();
  const { t, isTelugu } = useI18n();
  const status = useAudioPlayerStatus(player);

  const playing = status?.playing ?? false;
  const total = status?.duration || bulletin.duration_sec;

  return (
    <Card tone="ink" style={styles.card}>
      <View style={styles.head}>
        <Badge tone="breaking" icon="radio" size="xs" label={L('ప్రసారంలో', 'On air', isTelugu)} />
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
          onPress={() => (playing ? player.pause() : player.play())}
        />
        <T variant="meta" weight="medium" color="onOverlay" lang="en" style={styles.soft}>
          {clock(status?.currentTime ?? 0)} / {clock(total)}
        </T>
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
