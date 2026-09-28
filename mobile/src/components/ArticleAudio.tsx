import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';

import { absoluteMediaUrl, api } from '@/api/client';
import { Equalizer } from '@/components/player/PlayerVisuals';
import { useI18n } from '@/lib/i18n';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { formatTime, usePlayer, useTrackStatus, type Track } from '@/stores/player';
import { Button, IconButton } from '@/ui/Button';
import { T } from '@/ui/Text';

/**
 * §19–21 listen control — the app twin of the web AudioPlayer.
 *
 * Same three outcomes, decided by the server:
 *   * a generated file exists → the global player plays it
 *   * voice on, no file       → the device voice (expo-speech), unchanged
 *   * voice off (§20)         → nothing renders
 *
 * The control owns no audio. It is a trigger and a live status for the app's
 * one player (stores/player.ts): idle, a "Listen · 3:10" pill that loads its
 * track (or, with a `queue`, starts that queue at itself); while its track is
 * the current one, an equalizer, elapsed / length, pause and a way into Now
 * Playing. Seek, skips and speeds live there and on the lock screen, so the
 * story keeps playing after the reader leaves it.
 *
 * A caller that already holds the file (the e-paper playlist ships an
 * `AudioTrack.url`) passes `url` and the lookup is skipped entirely. The
 * device-voice fallback only renders for a caller that supplies a real
 * `onToggleDevice` — an empty handler would be a button that does nothing.
 * The track's id is `shortId`, which is how every surface recognises it.
 *
 * An article's own route renders the file on first request, so an article
 * reads `/formats` (which never renders) and asks `/audio` only on the
 * reader's tap — never on page view (§21: most stories are never listened
 * to), exactly as on the web.
 */

interface AudioState {
  available: boolean;
  url: string | null;
  duration_sec: number;
  fallback: 'device' | null;
  voice_enabled: boolean;
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
  middle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: color.rule, overflow: 'hidden' },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: color.brand },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill },
}));

export function ArticleAudio({
  shortId,
  deviceSpeaking = false,
  onToggleDevice,
  listenLabel,
  stopLabel,
  endpoint,
  url,
  meta,
  queue,
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
  /** How the track reads in the dock / Now Playing (defaults: an audio story titled by `listenLabel`). */
  meta?: Pick<Track, 'title'> & Partial<Pick<Track, 'kind' | 'subtitle' | 'href' | 'artwork'>>;
  /** A running order this control belongs to (the day's bulletins, the edition's radio): play starts it here. */
  queue?: Track[];
}) {
  const styles = useStyles();
  const color = useColors();
  const { t } = useI18n();
  const source = endpoint ?? `/public/articles/${shortId}/audio`;
  const status = useTrackStatus(shortId);
  const { toggle, playTrack, playQueue } = usePlayer.getState();
  const queryClient = useQueryClient();
  const onDemand = !url && !endpoint;

  // Same key and payload as the article screen's own formats query: one request.
  const formats = useQuery({
    queryKey: ['formats', shortId],
    queryFn: async () => (await api.get<{ audio: AudioState }>(`/public/articles/${shortId}/formats`)).data,
    enabled: onDemand,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const audio = useQuery({
    queryKey: ['audio', source],
    queryFn: async () => (await api.get<AudioState>(source)).data,
    enabled: !url && !onDemand,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const state = audio.data ?? (onDemand ? formats.data?.audio : undefined);

  if (!url && state && !state.voice_enabled) return null;

  const file = absoluteMediaUrl(url ?? (state?.available ? state.url : null) ?? null);
  // Voice on, no file yet and not asked for one: the pill asks on the tap.
  const renderable = onDemand && state?.voice_enabled === true && !audio.data && !audio.isError;

  // The story that is playing keeps its live control even when this route has
  // no file of its own (still looking, or the lookup came back empty).
  if (!file && !status.current && !renderable) {
    // Nothing until the server answers: the device voice would flash for a
    // story that has a file.
    if (onDemand ? formats.isLoading : audio.isLoading) return null;
    return onToggleDevice ? (
      <Button
        variant={deviceSpeaking ? 'primary' : 'secondary'}
        icon={deviceSpeaking ? 'pause' : 'headphones'}
        label={deviceSpeaking ? stopLabel : listenLabel}
        onPress={onToggleDevice}
        style={styles.pill}
      />
    ) : null;
  }

  const length = status.duration || state?.duration_sec || queue?.find((q) => q.id === shortId)?.durationSec || 0;

  const play = (src: string, durationSec: number) => {
    const at = queue ? queue.findIndex((q) => q.id === shortId) : -1;
    if (queue && at >= 0) return playQueue(queue, at);
    playTrack({
      id: shortId,
      kind: meta?.kind ?? 'article',
      title: meta?.title ?? listenLabel,
      subtitle: meta?.subtitle ?? t('player.kindArticle'),
      url: src,
      durationSec: durationSec || undefined,
      href: meta?.href,
      artwork: meta?.artwork ?? null,
    });
  };

  // Renders the story once server-side; every later reader gets the cached
  // file. No file back, or no answer, and the device voice takes over.
  const prepare = async () => {
    const got = await queryClient
      .fetchQuery({
        queryKey: ['audio', source],
        // Rendering a long story can outlast the client's 20 s default.
        queryFn: async () => (await api.get<AudioState>(source, { timeout: 90_000 })).data,
      })
      .catch(() => null);
    const src = absoluteMediaUrl(got?.available ? got.url : null);
    if (src) play(src, got?.duration_sec ?? 0);
    else if (got?.voice_enabled !== false) onToggleDevice?.();
  };

  const start = () => {
    if (status.current) return toggle();
    if (!file) return void prepare();
    play(file, length);
  };

  const percent = length ? Math.min(100, (status.elapsed / length) * 100) : 0;
  const idleLabel = length ? `${listenLabel} · ${formatTime(length)}` : listenLabel;

  // One Button in both states, at the same place in one tree: the control a
  // screen reader just pressed is still the one it is on when the track goes
  // live (a swapped element takes the focus with it). The outer view never
  // collapses, so the button keeps its native parent too.
  return (
    <View collapsable={false} style={status.current ? styles.player : undefined}>
      <View style={styles.top}>
        <Button
          variant={status.current ? 'primary' : 'secondary'}
          icon={!status.current ? 'headphones' : status.playing ? 'pause' : 'play'}
          label={!status.current ? idleLabel : status.playing ? t('ui.pause') : listenLabel}
          accessibilityLabel={!status.current && length ? `${listenLabel}, ${formatTime(length)}` : undefined}
          haptic={status.current ? 'medium' : undefined}
          pending={renderable && audio.isFetching}
          onPress={start}
          style={styles.pill}
        />
        {status.current ? (
          <>
            <View style={styles.middle}>
              <Equalizer playing={status.playing && !status.buffering} color={color.brand} />
              <T variant="meta" color="muted" lang="en">
                {`${formatTime(status.elapsed)} / ${formatTime(length)}`}
              </T>
            </View>
            <IconButton name="maximize2" label={t('player.open')} onPress={() => router.push('/player')} />
          </>
        ) : null}
      </View>
      {status.current ? (
        <View style={styles.track} aria-hidden>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
      ) : null}
    </View>
  );
}
