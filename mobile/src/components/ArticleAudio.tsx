import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, Text, View } from 'react-native';

import { api } from '@/api/client';
import { useI18n } from '@/lib/i18n';
import { font } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';

/**
 * §19–21 listen control — the app twin of the web AudioPlayer.
 *
 * Same three outcomes, decided by the server:
 *   * a generated file exists → real playback with seek and speed
 *   * voice on, no file       → the device voice (expo-speech), unchanged
 *   * voice off (§20)         → nothing renders
 */

interface AudioState {
  available: boolean;
  url: string | null;
  duration_sec: number;
  fallback: 'device' | null;
  voice_enabled: boolean;
}

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ArticleAudio({
  shortId, deviceSpeaking, onToggleDevice, listenLabel, stopLabel, endpoint,
}: {
  shortId: string;
  deviceSpeaking: boolean;
  onToggleDevice: () => void;
  listenLabel: string;
  stopLabel: string;
  /** Defaults to this article's audio route; the bulletin passes its own,
   *  which returns the same payload shape. */
  endpoint?: string;
}) {
  const styles = useStyles();
  const color = useColors();
  const { isTelugu } = useI18n();
  const source = endpoint ?? `/public/articles/${shortId}/audio`;

  const audio = useQuery({
    queryKey: ['audio', source],
    queryFn: async () => (await api.get<AudioState>(source)).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  // The hook has to run unconditionally, so it is created with a null source
  // and only given one when the server says a file exists.
  const player = useAudioPlayer(audio.data?.url ?? null);
  const status = useAudioPlayerStatus(player);

  if (audio.data && !audio.data.voice_enabled) return null;

  const hasFile = Boolean(audio.data?.available && audio.data.url);

  if (!hasFile) {
    return (
      <Pressable
        onPress={onToggleDevice}
        accessibilityRole="button"
        accessibilityState={{ selected: deviceSpeaking }}
        style={[styles.button, deviceSpeaking && styles.buttonActive]}
      >
        <Text style={styles.buttonText}>
          {deviceSpeaking ? `■ ${stopLabel}` : `🔊 ${listenLabel}`}
        </Text>
      </Pressable>
    );
  }

  const total = status.duration || audio.data!.duration_sec;
  const elapsed = status.currentTime ?? 0;

  return (
    <View style={styles.player}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? stopLabel : listenLabel}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={styles.playButton}
      >
        <Text style={styles.playGlyph}>{status.playing ? '❚❚' : '▶'}</Text>
      </Pressable>

      <View style={styles.middle}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${total ? Math.min(100, (elapsed / total) * 100) : 0}%` },
            ]}
          />
        </View>
        <Text style={styles.time}>
          {format(elapsed)} / {format(total)}
        </Text>
      </View>

      <View style={styles.skipRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isTelugu ? '15 సెకన్లు వెనక్కి' : 'Back 15 seconds'}
          onPress={() => player.seekTo(Math.max(0, elapsed - 15))}
          style={styles.skip}
        >
          <Text style={styles.skipText}>−15</Text>
        </Pressable>
        {SPEEDS.map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityState={{ selected: status.playbackRate === s }}
            onPress={() => player.setPlaybackRate(s)}
            style={[styles.skip, status.playbackRate === s && styles.skipActive]}
          >
            <Text
              style={[styles.skipText, status.playbackRate === s && styles.skipTextActive]}
            >
              {s}×
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  button: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  buttonActive: { borderColor: color.brand, backgroundColor: color.brandTint },
  buttonText: { fontFamily: font.teluguSemiBold, fontSize: 12.5, color: color.brand },
  player: {
    borderWidth: 1,
    borderColor: color.brand,
    backgroundColor: color.brandTint,
    borderRadius: 6,
    padding: 8,
    gap: 8,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: color.white, fontSize: 13 },
  middle: { gap: 4 },
  track: { height: 4, borderRadius: 2, backgroundColor: color.rule, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: color.brand },
  time: { fontFamily: font.telugu, fontSize: 11, color: color.brand },
  skipRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  skip: {
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  skipActive: { backgroundColor: color.brand, borderColor: color.brand },
  skipText: { fontFamily: font.telugu, fontSize: 11, color: color.brand },
  skipTextActive: { color: color.white },
}));
