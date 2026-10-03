import { router } from 'expo-router';
import { View } from 'react-native';

import { bulletinId, bulletinTrack, type BulletinSummary } from '@/components/BulletinCard';
import { BroadcastRings, Equalizer } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { formatTime, usePlayer, useTrackStatus } from '@/stores/player';
import { IconButton } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * "వినండి: గరం చాయ్ న్యూస్" — the latest bulletin as the first row of the
 * home feed. Same mechanism as BulletinCard: play hands the bulletin to the
 * global player (the dock carries it from there); the rest of the strip opens
 * the bulletin screen. Two sibling targets, not nested, so a screen reader
 * reaches both. The rings are PlayerVisuals' — still under reduced motion.
 */
const DISC = 36;

const useStyles = makeStyles((color) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.brandTint,
  },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.exclusive,
  },
  text: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
}));

export function BulletinBanner({ bulletin }: { bulletin: BulletinSummary }) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const id = bulletin.date != null && bulletin.slot != null ? bulletinId(bulletin.date, bulletin.slot) : '';
  const status = useTrackStatus(id);
  const { toggle, playTrack } = usePlayer.getState();

  const name = bulletin.slot_label_te || t('player.kindBulletin');
  const total = status.duration || bulletin.duration_sec;
  const slot = bulletin.slot != null ? `${String(bulletin.slot).padStart(2, '0')}:00` : null;
  const time = status.current ? `${formatTime(status.elapsed)} / ${formatTime(total)}` : formatTime(total);
  const meta = slot ? `${slot} · ${time}` : time;

  function onPlay() {
    if (status.current) return toggle();
    const track = bulletinTrack(bulletin, t('player.kindBulletin'));
    if (track) playTrack(track);
  }

  return (
    <View style={styles.banner}>
      <PressableScale
        onPress={() => router.push('/bulletin')}
        haptic="select"
        accessibilityLabel={`${t('ui.listen')}: ${name}, ${meta}`}
        style={styles.open}
      >
        <View style={styles.disc}>
          <BroadcastRings size={DISC} active={!status.playing} />
          <Icon name="headphones" size={20} color={color.onOverlay} />
        </View>
        <View style={styles.text}>
          <T variant="headlineSm" weight="bold" numberOfLines={1}>
            <T variant="headlineSm" weight="bold" color="brand">{`${t('ui.listen')}: `}</T>
            {name}
          </T>
          <View style={styles.meta}>
            {status.current ? <Equalizer playing={status.playing && !status.buffering} color={color.exclusive} bars={3} height={12} /> : null}
            <T variant="meta" weight="medium" color="muted" lang="en">
              {meta}
            </T>
          </View>
        </View>
      </PressableScale>
      <IconButton
        name={status.playing ? 'pause' : 'play'}
        label={`${status.playing ? t('ui.pause') : t('ui.listen')}: ${name}`}
        variant="primary"
        onPress={onPlay}
      />
    </View>
  );
}
