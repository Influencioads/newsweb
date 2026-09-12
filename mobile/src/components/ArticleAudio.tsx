import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { View } from 'react-native';

import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { radius, space, TAP_LG } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { Button, IconButton } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { T } from '@/ui/Text';

/**
 * §19–21 listen control — the app twin of the web AudioPlayer.
 *
 * Same three outcomes, decided by the server:
 *   * a generated file exists → real playback with seek and speed
 *   * voice on, no file       → the device voice (expo-speech), unchanged
 *   * voice off (§20)         → nothing renders
 *
 * A caller that already holds the file (the e-paper playlist ships an
 * `AudioTrack.url`) passes `url` and the lookup is skipped entirely. The
 * device-voice fallback only renders for a caller that supplies a real
 * `onToggleDevice` — an empty handler would be a button that does nothing.
 */

interface AudioState {
  available: boolean;
  url: string | null;
  duration_sec: number;
  fallback: 'device' | null;
  voice_enabled: boolean;
}

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
const SKIP = 15;

// ponytail: no i18n keys yet for these — see neededStrings.
const L = (te: string, en: string, telugu: boolean) => (telugu ? te : en);

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const useStyles = makeStyles((color) => ({
  player: {
    borderWidth: 1,
    borderColor: color.rule,
    backgroundColor: color.paperSub,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  middle: { flex: 1, minWidth: 120, gap: space.xs },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: color.rule, overflow: 'hidden' },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: color.brand },
  speeds: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  speed: { paddingHorizontal: space.md },
}));

export function ArticleAudio({
  shortId,
  deviceSpeaking = false,
  onToggleDevice,
  listenLabel,
  stopLabel,
  endpoint,
  url,
}: {
  shortId: string;
  deviceSpeaking?: boolean;
  /** Omit when there is no device-voice fallback to offer. */
  onToggleDevice?: () => void;
  listenLabel: string;
  stopLabel: string;
  /** Defaults to this article's audio route; the bulletin passes its own,
   *  which returns the same payload shape. */
  endpoint?: string;
  /** A file the caller already holds — skips the lookup entirely. */
  url?: string;
}) {
  const styles = useStyles();
  const { t, isTelugu } = useI18n();
  const source = endpoint ?? `/public/articles/${shortId}/audio`;

  const audio = useQuery({
    queryKey: ['audio', source],
    queryFn: async () => (await api.get<AudioState>(source)).data,
    enabled: !url,
    retry: false,
    staleTime: 5 * 60_000,
  });

  // The hook has to run unconditionally, so it is created with a null source
  // and only given one when a file is known to exist.
  const player = useAudioPlayer(url ?? audio.data?.url ?? null);
  const status = useAudioPlayerStatus(player);

  if (!url && audio.data && !audio.data.voice_enabled) return null;

  const hasFile = Boolean(url) || Boolean(audio.data?.available && audio.data.url);

  if (!hasFile) {
    return onToggleDevice ? (
      <Button
        variant={deviceSpeaking ? 'primary' : 'secondary'}
        icon={deviceSpeaking ? 'pause' : 'volume2'}
        label={deviceSpeaking ? stopLabel : listenLabel}
        onPress={onToggleDevice}
      />
    ) : null;
  }

  const total = status.duration || audio.data?.duration_sec || 0;
  const elapsed = status.currentTime ?? 0;
  const percent = total ? Math.min(100, (elapsed / total) * 100) : 0;
  const back = L(`${SKIP} సెకన్లు వెనక్కి`, `Back ${SKIP} seconds`, isTelugu);

  return (
    <View style={styles.player}>
      <View style={styles.top}>
        <IconButton
          name={status.playing ? 'pause' : 'play'}
          label={status.playing ? stopLabel : listenLabel}
          size={TAP_LG}
          variant="primary"
          haptic="medium"
          onPress={() => (status.playing ? player.pause() : player.play())}
        />
        <View style={styles.middle}>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityLabel={listenLabel}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
          >
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
          <T variant="meta" color="muted" lang="en">
            {`${format(elapsed)} / ${format(total)}`}
          </T>
        </View>
        <IconButton
          name="history"
          label={back}
          onPress={() => player.seekTo(Math.max(0, elapsed - SKIP))}
        />
      </View>

      <View style={styles.speeds} accessibilityRole="radiogroup" accessibilityLabel={t('ui.speed')}>
        {SPEEDS.map((s) => (
          <Chip
            key={s}
            role="radio"
            label={`${s}x`}
            lang="en"
            selected={status.playbackRate === s}
            accessibilityLabel={`${t('ui.speed')} ${s}x`}
            onPress={() => player.setPlaybackRate(s)}
            style={styles.speed}
          />
        ))}
      </View>
    </View>
  );
}
