import { useEffect, useId } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';

import { api } from '@/api/client';
import { clock, Equalizer } from '@/components/player/parts';
import { IconButton } from '@/components/ui/Button';
import type { GlyphIcon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { type TtsState } from '@/features/reader/tts';
import { selectTrack, usePlayer, type Track } from '@/stores/player';
import type { AudioState } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §19–21 listen control — one brand-tinted pill in every state.
 *
 * Three states, and the component picks between them rather than the caller:
 *
 *   * a server-generated file exists → a trigger and live status for the one
 *     global player (`stores/player`, rendered by `components/player`). Idle it
 *     reads "Listen · 3:05"; while its own track is on air it shows the
 *     equalizer, elapsed / length and pause, and tapping the status opens Now
 *     Playing, where seek, speed and the queue live. Playback carries on when
 *     the reader leaves the page — the dock takes over.
 *   * voice is on but there is no file → the device voice, unchanged from
 *     before this feature existed (it pauses the global player when it starts)
 *   * voice is off site-wide or for this article (§20) → nothing renders
 *
 * The server decides which case applies; this only renders it. A track is
 * identified by its audio route, so the same story started from the e-paper
 * radio shows as on air on its article page too.
 *
 * `queue` starts a running order at this control's own track (the day's
 * bulletins, the edition); without it the track plays alone. When the queue
 * already carries this track's file, that is the payload and nothing is
 * fetched. `track` names it in the dock, in Now Playing and on the lock screen.
 *
 *     <AudioPlayer shortId={a.short_id} readingLabel={readingTime(…)} deviceTts={tts}
 *                  track={{ kind: 'article', title: a.title_te, href: a.url }} />
 */

export const PILL =
  'flex w-fit max-w-full min-h-tap flex-wrap items-center gap-2 rounded-pill border border-brand/20 bg-brand-tint px-2 py-1';

/** The pill's text: the label alone, or the tagline over a quieter label. */
export const LABEL = 'text-ui-sm font-semibold text-brand';
export const TAGLINE = 'text-ui-sm font-bold text-brand';
export const SUBLABEL = 'text-meta font-semibold text-ink-soft';

/** What the caller knows about the track; the file and length come from the server. */
export type TrackMeta = Pick<Track, 'kind' | 'title'> & Partial<Pick<Track, 'subtitle' | 'href' | 'artwork'>>;

/**
 * The audio payload for a route. Shared so every control on a page reads the
 * one deduped, §20-gated answer (the article toolbar's headphones use it too).
 * Generation happens server-side on first request and can take a moment; a
 * failed fetch must not remove the device-voice fallback, so errors resolve to
 * "no file" rather than propagating.
 */
export const audioQuery = (source: string) =>
  queryOptions({
    queryKey: ['audio', source],
    queryFn: async () => (await api.get<AudioState>(source)).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

export interface AudioPlayerProps {
  shortId: string;
  readingLabel: string;
  /** The existing Web Speech hook, used when there is no server file. */
  deviceTts: { state: TtsState; toggle: () => void; stop: () => void };
  /**
   * Where to fetch the audio payload from. Defaults to this article's own
   * route; the audio bulletin passes its own, which returns the same
   * shape. It is also the track's identity in the global player.
   */
  endpoint?: string;
  track?: TrackMeta;
  /** The running order this track belongs to; playback starts there at this track. */
  queue?: Track[];
  /** The play button's icon while not playing (the article page shows the house radio). */
  idleIcon?: GlyphIcon;
  /** A line over the label while idle — the article page's invitation to listen. */
  tagline?: string;
}

export function AudioPlayer({
  shortId,
  readingLabel,
  deviceTts,
  endpoint,
  track,
  queue,
  idleIcon = Play,
  tagline,
}: AudioPlayerProps) {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const labelId = useId();
  const source = endpoint ?? `/public/articles/${shortId}/audio`;
  // A running order that already holds this track's file (the day's bulletins,
  // the edition) is its payload: no fetch per card, and no failed fetch to drop
  // a card into the device-voice branch with nothing to speak.
  const queued = queue?.find((item) => item.id === source && item.url);

  const audioState = useQuery({ ...audioQuery(source), enabled: !queued });
  const data = audioState.data;
  const url = queued?.url ?? (data?.available ? data.url : null);

  // Live status, only while this control's own file is the one on air — a
  // replaced or regenerated file keeps the route but not the URL.
  const onAir = usePlayer((p) => {
    const current = selectTrack(p);
    return current?.id === source && current.url === url;
  });
  const playing = usePlayer((p) => onAir && p.playing);
  const elapsed = usePlayer((p) => (onAir ? p.elapsed : 0));
  const liveDuration = usePlayer((p) => (onAir ? p.duration : 0));
  const failed = usePlayer((p) => onAir && p.error);

  // Leaving the article must stop the device voice, which keeps talking across
  // a route change otherwise (the global player deliberately does not stop).
  // Depend on the stable callback, not the object — useTts returns a fresh
  // literal every render, and running this cleanup on each render would
  // cancel the voice the moment it started.
  const stopDevice = deviceTts.stop;
  useEffect(() => () => stopDevice(), [stopDevice]);

  if (!queued) {
    // Nothing until the server has answered: the device-voice branch would
    // flash "no voice" (or offer the wrong voice) for a story that has a file.
    if (audioState.isLoading) return null;
    // §20 — switched off means no control at all, not a disabled one.
    if (data && !data.voice_enabled) return null;
  }

  if (!url) {
    const { state } = deviceTts;
    const unavailable = state === 'unavailable';
    const speaking = state === 'speaking';
    // The "no voice" reason is the visible label itself: a disabled button
    // never shows a tooltip, and the span is already the button's description.
    const label = unavailable
      ? L('ఈ పరికరంలో తెలుగు వాయిస్ లేదు', 'No Telugu voice on this device')
      : speaking
        ? t('ui.pause')
        : state === 'paused'
          ? L('కొనసాగించండి', 'Resume')
          : `${t('reader.listen')} ${readingLabel}`;
    // The IconButton dims itself when disabled; only the text dims here.
    return (
      <div className={PILL}>
        <IconButton
          icon={speaking ? Pause : idleIcon}
          label={speaking ? t('ui.pause') : t('reader.listen')}
          variant="primary"
          round
          disabled={unavailable}
          aria-describedby={labelId}
          onClick={deviceTts.toggle}
        />
        <span className="flex flex-col pr-2">
          {tagline && state === 'idle' ? <span className={cn(s.body, TAGLINE)}>{tagline}</span> : null}
          <span
            id={labelId}
            className={cn(s.body, tagline && state === 'idle' ? SUBLABEL : LABEL, unavailable && 'opacity-60')}
          >
            {label}
          </span>
        </span>
      </div>
    );
  }

  const fileDuration = (queued ? queued.durationSec : data?.duration_sec) ?? 0;
  const duration = liveDuration || fileDuration;

  function listen(): void {
    const player = usePlayer.getState();
    if (onAir) {
      player.toggle();
      return;
    }
    const self: Track = {
      id: source,
      kind: track?.kind ?? (source.includes('/bulletins/') ? 'bulletin' : 'article'),
      title: track?.title || readingLabel || t('player.label'),
      subtitle: track?.subtitle,
      href: track?.href,
      artwork: track?.artwork,
      url: url!,
      durationSec: fileDuration,
    };
    const at = queue?.findIndex((item) => item.id === source) ?? -1;
    if (queue && at >= 0) player.playQueue(queue, at);
    else player.playTrack(self);
  }

  return (
    <div className={PILL}>
      <IconButton
        icon={playing ? Pause : idleIcon}
        label={playing ? t('ui.pause') : t('reader.listen')}
        variant="primary"
        round
        // Not while on air: the clock ticks every second, and a focused
        // button's changing description is re-read on every tick.
        aria-describedby={onAir ? undefined : labelId}
        onClick={listen}
      />
      {onAir ? (
        <button
          type="button"
          onClick={() => usePlayer.getState().setExpanded(true)}
          className="flex min-h-tap items-center gap-2 rounded-pill pr-2 text-brand"
        >
          <Equalizer playing={playing} />
          {/* The ticking clock is visual only (the Now Playing slider speaks
              the position); a failure is part of the button's name. */}
          <span
            aria-hidden={failed ? undefined : true}
            className={cn(failed ? `${s.body} text-ui-sm` : 'font-sans text-meta tabular-nums', 'font-semibold')}
          >
            {failed ? t('player.error') : `${clock(elapsed)} / ${clock(duration)}`}
          </span>
          <span className="sr-only">{t('player.open')}</span>
        </button>
      ) : (
        <span className="flex flex-col pr-2">
          {tagline ? <span className={cn(s.body, TAGLINE)}>{tagline}</span> : null}
          <span id={labelId} className={cn(s.body, tagline ? SUBLABEL : LABEL)}>
            {t('reader.listen')} · <span className="font-sans tabular-nums">{duration ? clock(duration) : readingLabel}</span>
          </span>
        </span>
      )}
    </div>
  );
}
