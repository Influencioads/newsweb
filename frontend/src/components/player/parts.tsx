import { Loader2, Pause, Play, Radio } from 'lucide-react';

import { Icon, type IconSize } from '@/components/ui/Icon';
import { useI18n, type StringKey } from '@/i18n';
import type { Track, TrackKind } from '@/stores/player';
import { cn } from '@/utils/cn';

/**
 * Audio player parts shared by the dock, Now Playing and the inline listen
 * controls — the radio look in one place.
 *
 * - `Equalizer`   3-4 bouncing bars in `currentColor` while playing.
 * - `Disc`        the record: artwork when the story has a photo, otherwise the
 *                 house radio glyph on deep teal. The record turns slowly while
 *                 playing and pulses while buffering.
 * - `PlayButton`  the filled white play/pause disc (44px, or 80px `lg`); its
 *                 name says when it is loading.
 * - `clock` / `trackSubtitle`  "3:05" and "ఆడియో బులెటిన్ · 09:00".
 *
 * Every animation is decoration (aria-hidden). Paused = `PAUSED`, which freezes
 * the motion where it is rather than removing it; reduced motion stops it
 * outright (assets/index.css).
 */

/** Freezes an animation mid-motion — the paused look. */
export const PAUSED = '[animation-play-state:paused]';

const KIND_LABEL: Record<TrackKind, StringKey> = {
  article: 'player.kind.article',
  bulletin: 'player.kind.bulletin',
  epaper: 'player.kind.epaper',
};

/** m:ss; 0:00 for anything that is not a finite, positive number. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The kind in the interface language, then the track's own detail. */
export function trackSubtitle(track: Track, t: (key: StringKey) => string): string {
  return [t(KIND_LABEL[track.kind]), track.subtitle].filter(Boolean).join(' · ');
}

/** Rest height (%), cycle (ms) and phase (ms) per bar — out of step on purpose. */
const EQ_BARS = [
  { h: 60, d: 820, phase: 0 },
  { h: 100, d: 640, phase: 260 },
  { h: 75, d: 940, phase: 480 },
  { h: 90, d: 720, phase: 120 },
];

export function Equalizer({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex h-3.5 shrink-0 items-end gap-0.5', className)}>
      {EQ_BARS.map((bar, i) => (
        <span
          key={i}
          className={cn('w-1 origin-bottom rounded-pill bg-current animate-eq', !playing && PAUSED)}
          style={{ height: `${bar.h}%`, animationDuration: `${bar.d}ms`, animationDelay: `-${bar.phase}ms` }}
        />
      ))}
    </span>
  );
}

export interface DiscProps {
  artwork?: string | null;
  spinning: boolean;
  buffering?: boolean;
  /** Size classes (the disc fills them). */
  className?: string;
  glyph?: IconSize;
}

export function Disc({ artwork, spinning, buffering, className, glyph = 'md' }: DiscProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-pill bg-gradient-to-br from-brand-deep to-ink-deep text-exclusive ring-1 ring-on-ink/15',
        buffering && 'animate-pulse',
        className,
      )}
    >
      {/* The turning layer: the photo, or a sheen across the grooves, so the
          motion reads on a plain disc too. The glyph sits still on top like a label. */}
      <span className={cn('absolute inset-0 animate-spin-slow', !spinning && PAUSED)}>
        {artwork ? (
          <img src={artwork} alt="" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 bg-gradient-to-tr from-transparent via-on-ink/15 to-transparent" />
        )}
        <span className="absolute inset-[14%] rounded-pill border border-on-ink/15" />
        <span className="absolute inset-[28%] rounded-pill border border-on-ink/10" />
      </span>
      {artwork ? (
        <span className="relative h-[14%] w-[14%] rounded-pill bg-ink-deep ring-2 ring-on-ink/40" />
      ) : (
        <Icon icon={Radio} size={glyph} className="relative" />
      )}
    </span>
  );
}

export interface PlayButtonProps {
  playing: boolean;
  buffering?: boolean;
  onClick: () => void;
  size?: 'md' | 'lg';
  className?: string;
}

/** White disc, ink glyph — constant in both themes, for the dark player surfaces. */
export function PlayButton({ playing, buffering, onClick, size = 'md', className }: PlayButtonProps) {
  const { t } = useI18n();
  // aria-busy is not announced on a button, so the name carries the loading state.
  const action = playing ? t('ui.pause') : t('ui.play');
  const label = buffering ? `${action}, ${t('player.buffering')}` : action;
  const lg = size === 'lg';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-busy={buffering || undefined}
      className={cn(
        'grid shrink-0 place-items-center rounded-pill bg-on-ink text-ink-deep shadow-raised',
        'transition-[colors,transform] duration-base ease-standard hover:bg-on-ink/90 active:scale-[.96]',
        lg ? 'h-20 w-20' : 'h-tap w-tap',
        className,
      )}
    >
      <Icon
        icon={buffering ? Loader2 : playing ? Pause : Play}
        size={lg ? 'lg' : 'md'}
        className={cn(lg && 'h-8 w-8', buffering && 'animate-spin', !playing && !buffering && 'translate-x-px')}
      />
    </button>
  );
}
