import { Image } from 'expo-image';
import { router } from 'expo-router';
import { View } from 'react-native';

import { bulletinArt, bulletinId, bulletinTrack, type BulletinSummary } from '@/components/BulletinCard';
import { Equalizer } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { formatTime, usePlayer, useTrackStatus } from '@/stores/player';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { T } from '@/ui/Text';

/**
 * The latest bulletin as the first row of the home feed: the show's own banner
 * art ("Click To Listen" drawn in) is the play button; the bar under it — name,
 * time, length — opens the bulletin screen. Two sibling targets, not nested,
 * so a screen reader reaches both. Play hands the bulletin to the global
 * player, which carries it from there.
 */
const ART_HEIGHT = 104;

const useStyles = makeStyles(() => ({
  banner: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  art: { width: '100%', height: ART_HEIGHT },
  fallback: { height: ART_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  text: { flex: 1 },
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
  const art = bulletinArt(bulletin.slot);

  function onPlay() {
    if (status.current) return toggle();
    const track = bulletinTrack(bulletin, t('player.kindBulletin'));
    if (track) playTrack(track);
  }

  return (
    <View style={styles.banner}>
      <PressableScale
        onPress={onPlay}
        haptic="select"
        accessibilityLabel={`${status.playing ? t('ui.pause') : t('ui.listen')}: ${name}`}
        accessibilityState={{ selected: status.playing }}
      >
        {art ? (
          <Image source={art} style={styles.art} contentFit="contain" accessible={false} />
        ) : (
          <View style={styles.fallback}>
            <Icon name="play" size={32} color={color.onOverlay} />
          </View>
        )}
      </PressableScale>
      <PressableScale
        onPress={() => router.push('/bulletin')}
        haptic="select"
        accessibilityLabel={`${name}, ${meta}`}
        style={styles.bar}
      >
        {status.current ? (
          <Equalizer playing={status.playing && !status.buffering} color={color.exclusive} bars={3} height={12} />
        ) : (
          <Icon name="radio" size={16} color={color.exclusive} />
        )}
        <T variant="bodySmall" weight="bold" color="onOverlay" lang="te" numberOfLines={1} style={styles.text}>
          {name}
          <T variant="meta" weight="medium" color="onOverlay" lang="en">{`  ${meta}`}</T>
        </T>
        <Icon name={status.playing ? 'pause' : 'chevronRight'} size={20} color={color.onOverlay} />
      </PressableScale>
    </View>
  );
}
