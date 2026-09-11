import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pause, Volume2 } from 'lucide-react';

import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { type TtsState } from '@/features/reader/tts';
import type { AudioState } from '@/types/cms';

/**
 * §19–21 listen control.
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
 */

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioPlayer({
  shortId, readingLabel, deviceTts, endpoint,
}: {
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
}) {
  const { language } = useI18n();
  const te = language === 'te';
  const script = te ? 'te' : 'font-sans';
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
  // particular keeps talking across a route change otherwise.
  useEffect(() => () => deviceTts.stop(), [deviceTts]);

  const data = audioState.data;

  // §20 — switched off means no control at all, not a disabled one.
  if (data && !data.voice_enabled) return null;

  const hasFile = Boolean(data?.available && data.url);

  if (!hasFile) {
    const unavailable = deviceTts.state === 'unavailable';
    return (
      <button
        type="button"
        onClick={deviceTts.toggle}
        disabled={unavailable}
        aria-pressed={deviceTts.state === 'speaking'}
        title={unavailable
          ? (te ? 'ఈ పరికరంలో తెలుగు వాయిస్ లేదు' : 'No Telugu voice on this device')
          : (te ? 'వినండి' : 'Listen')}
        className={[
          script,
          'flex min-h-tap items-center gap-1.5 rounded-control border px-3 text-[11.5px] font-semibold leading-[1.4] disabled:opacity-50',
          deviceTts.state === 'speaking' || deviceTts.state === 'paused'
            ? 'border-brand bg-brand-tint text-brand'
            : 'border-rule text-brand',
        ].join(' ')}
      >
        {deviceTts.state === 'speaking'
          ? <Pause className="h-3.5 w-3.5" aria-hidden />
          : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
        {deviceTts.state === 'speaking'
          ? (te ? 'ఆపండి' : 'Pause')
          : deviceTts.state === 'paused'
            ? (te ? 'కొనసాగించండి' : 'Resume')
            : `${te ? 'వినండి' : 'Listen'} ${readingLabel}`}
      </button>
    );
  }

  return (
    <div className="flex min-h-tap flex-wrap items-center gap-2 rounded-control border border-brand bg-brand-tint px-2.5 py-1.5">
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
      <button
        type="button"
        aria-label={playing ? (te ? 'ఆపండి' : 'Pause') : (te ? 'వినండి' : 'Listen')}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (playing) el.pause();
          else void el.play();
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white"
      >
        {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
      </button>

      <input
        type="range"
        min={0}
        max={total || data!.duration_sec || 1}
        step={1}
        value={elapsed}
        aria-label={te ? 'ఆడియో స్థానం' : 'Audio position'}
        onChange={(e) => {
          const el = ref.current;
          if (el) { el.currentTime = Number(e.target.value); setElapsed(Number(e.target.value)); }
        }}
        className="h-1 w-28 accent-brand sm:w-40"
      />

      <span className="font-sans text-[11px] tabular-nums text-brand">
        {format(elapsed)} / {format(total || data!.duration_sec)}
      </span>

      <div className="flex items-center gap-0.5" role="group" aria-label={te ? 'వేగం' : 'Speed'}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={() => setSpeed(s)}
            className={`rounded px-1.5 font-sans text-[10.5px] font-bold ${
              speed === s ? 'bg-brand text-white' : 'text-brand hover:bg-white'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
