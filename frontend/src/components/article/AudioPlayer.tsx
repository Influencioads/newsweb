import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';

import { api } from '@/api/client';
import { IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useI18n, useScript } from '@/i18n';
import { type TtsState } from '@/features/reader/tts';
import type { AudioState } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §19–21 listen control — one brand-tinted pill in every state.
 *
 * Three states, and the component picks between them rather than the caller:
 *
 *   * a server-generated file exists → a real `<audio>` element, so §19's seek
 *     and playback speed work and every listener hears the same voice
 *   * voice is on but there is no file → the device voice, unchanged from
 *     before this feature existed
 *   * voice is off site-wide or for this article (§20) → nothing renders
 *
 * The server decides which case applies; this only renders it.
 *
 *     <AudioPlayer shortId={a.short_id} readingLabel={readingTime(…)} deviceTts={tts} />
 */

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

const PILL = 'flex min-h-tap flex-wrap items-center gap-2 rounded-pill border border-brand/20 bg-brand-tint px-2 py-1';

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface AudioPlayerProps {
  shortId: string;
  readingLabel: string;
  /** The existing Web Speech hook, used when there is no server file. */
  deviceTts: { state: TtsState; toggle: () => void; stop: () => void };
  /**
   * Where to fetch the audio payload from. Defaults to this article's own
   * route; the three-hourly bulletin passes its own, which returns the same
   * shape. Everything else in this component — the scrubber, the speeds, the
   * `voice_enabled` short-circuit — works unchanged.
   */
  endpoint?: string;
}

export function AudioPlayer({ shortId, readingLabel, deviceTts, endpoint }: AudioPlayerProps) {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const labelId = useId();
  const source = endpoint ?? `/public/articles/${shortId}/audio`;

  const audioState = useQuery({
    queryKey: ['audio', source],
    queryFn: async () => (await api.get<AudioState>(source)).data,
    // Generation happens server-side on first request and can take a moment;
    // a failed fetch must not remove the device-voice fallback, so errors
    // resolve to "no file" rather than propagating.
    retry: false,
    staleTime: 5 * 60_000,
  });

  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState<number>(1);

  useEffect(() => {
    const el = ref.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  // Leaving the article must stop both players; the device voice in
  // particular keeps talking across a route change otherwise. Depend on the
  // stable callback, not the object — useTts returns a fresh literal every
  // render, and running this cleanup on each render would cancel the voice
  // the moment it started.
  const stopDevice = deviceTts.stop;
  useEffect(() => () => stopDevice(), [stopDevice]);

  const data = audioState.data;

  // §20 — switched off means no control at all, not a disabled one.
  if (data && !data.voice_enabled) return null;

  const hasFile = Boolean(data?.available && data.url);

  if (!hasFile) {
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
          icon={speaking ? Pause : Play}
          label={speaking ? t('ui.pause') : t('reader.listen')}
          variant="primary"
          round
          disabled={unavailable}
          aria-describedby={labelId}
          onClick={deviceTts.toggle}
        />
        <span
          id={labelId}
          className={cn(s.body, 'pr-2 text-ui-sm font-semibold text-brand', unavailable && 'opacity-60')}
        >
          {label}
        </span>
      </div>
    );
  }

  const duration = total || data!.duration_sec;

  return (
    <div className={PILL}>
      <audio
        ref={ref}
        src={data!.url!}
        preload="metadata"
        onLoadedMetadata={(e) => setTotal(e.currentTarget.duration || data!.duration_sec)}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setElapsed(0); }}
      />
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? t('ui.pause') : t('reader.listen')}
        variant="primary"
        round
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (playing) el.pause();
          else void el.play();
        }}
      />

      {/* The floor sits on the control itself: a range input takes pointer
          events across its whole box while the browser keeps the track thin. */}
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={1}
        value={elapsed}
        aria-label={L('ఆడియో స్థానం', 'Audio position')}
        aria-valuetext={`${format(elapsed)} / ${format(duration)}`}
        onChange={(e) => {
          const el = ref.current;
          if (el) { el.currentTime = Number(e.target.value); setElapsed(Number(e.target.value)); }
        }}
        className="min-h-tap min-w-28 flex-1 cursor-pointer accent-brand"
      />

      <span className="font-sans text-meta tabular-nums text-brand">
        {format(elapsed)} / {format(duration)}
      </span>

      <div role="group" aria-label={t('ui.speed')} className="flex items-center gap-1">
        {SPEEDS.map((rate) => (
          <Chip
            key={rate}
            as="button"
            lang="en"
            selected={speed === rate}
            onClick={() => setSpeed(rate)}
            className="tabular-nums"
          >
            {rate}×
          </Chip>
        ))}
      </div>
    </div>
  );
}
