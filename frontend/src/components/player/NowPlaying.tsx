import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, BookOpen, ChevronDown, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { overlayRoot, useModal } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { SKIP_SEC, SPEEDS, usePlayer } from '@/stores/player';
import { cn } from '@/utils/cn';

import { clock, Disc, Equalizer, PAUSED, PlayButton, trackSubtitle } from './parts';

/**
 * NOW PLAYING — the full-screen player, a radio studio on the constant-dark
 * `bg-ink` surface (dark in both themes).
 *
 * Top to bottom: minimise · the record (artwork or radio glyph) turning inside
 * three broadcast rings · ON AIR for a bulletin · a waveform strip whose played
 * bars turn gold · Telugu title and kind line · scrubber with elapsed and
 * remaining · transport (previous, back 15 s, play, forward 15 s, next) ·
 * speeds · "Read the story" · the queue, current item marked by the equalizer.
 * From lg up it is two columns — the record, ON AIR and waveform on the left,
 * everything from the title down on the right — so the transport is on the
 * first screen of a laptop. The record is capped by viewport height as well as
 * width, so a short window still reaches the title and controls.
 *
 * All motion freezes when paused and stops under reduced motion; none of it is
 * exposed to assistive technology. Buffering pulses the record and spins the
 * play button; a file that fails offers a retry.
 *
 * Lazy (PlayerHost), and modal through the Dialog primitive's `useModal`:
 * focus trap, Esc to minimise, body scroll lock, focus back to the opener.
 */

/** Rest heights of the waveform strip (%) — a fixed, speech-like contour. */
const WAVE = [38, 62, 88, 54, 72, 100, 58, 80, 42, 70, 94, 60, 46, 84, 66, 98, 52, 76, 40, 90, 62, 82, 36, 70, 92, 56, 74, 48];

function SkipButton({ back }: { back?: boolean }) {
  const { t } = useI18n();
  const label = t(back ? 'player.back15' : 'player.forward15');
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => usePlayer.getState().skip(back ? -SKIP_SEC : SKIP_SEC)}
      className="relative grid h-tap-lg w-tap-lg shrink-0 place-items-center rounded-pill text-on-ink transition-colors duration-base ease-standard hover:bg-on-ink/10"
    >
      <Icon icon={back ? RotateCcw : RotateCw} size="lg" className="h-7 w-7" />
      <span aria-hidden className="absolute pt-0.5 font-sans text-eyebrow font-bold tracking-normal tabular-nums">
        {SKIP_SEC}
      </span>
    </button>
  );
}

export default function NowPlaying({ onShown }: { onShown?: (shown: boolean) => void }) {
  const { t } = useI18n();
  const s = useScript();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const p = usePlayer();
  const minimise = useCallback(() => usePlayer.getState().setExpanded(false), []);
  useModal(true, minimise, panel);
  // After useModal has taken the opener: only now may the dock step aside.
  useEffect(() => {
    onShown?.(true);
    return () => onShown?.(false);
  }, [onShown]);

  const track = p.queue[p.index];
  if (!track) return null;

  const { playing, buffering, elapsed, duration, index, queue } = p;
  const fraction = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const hasNext = index < queue.length - 1;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      className="fixed inset-0 z-overlay overflow-y-auto overflow-x-hidden overscroll-contain bg-ink text-on-ink outline-none animate-slide-up"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-10 pt-2 lg:max-w-page">
        <div className="flex items-center gap-2">
          <IconButton icon={ChevronDown} label={t('player.minimise')} variant="inverse" onClick={minimise} className="-ml-2" />
          <p className={cn(s.body, 'min-w-0 flex-1 text-center text-ui-sm font-semibold text-muted-inverse')}>
            {t('player.nowPlaying')}
          </p>
          <span aria-hidden className="w-tap shrink-0" />
        </div>

        <div className="lg:my-auto lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-12">
          <div className="flex flex-col">
            {/* The studio: the record inside its broadcast rings. */}
            <div className="relative mx-auto mt-6 grid aspect-square w-[min(16rem,36vh)] max-w-full place-items-center lg:w-[min(22rem,52vh)]">
              {[0, 1, 2].map((ring) => (
                <span
                  key={ring}
                  aria-hidden
                  className={cn('absolute inset-[12%] rounded-pill border-2 border-exclusive opacity-0 animate-ring', !playing && PAUSED)}
                  style={{ animationDelay: `${ring * 0.8}s` }}
                />
              ))}
              <Disc
                artwork={track.artwork}
                spinning={playing}
                buffering={buffering}
                glyph="lg"
                className="h-[76%] w-[76%] shadow-raised"
              />
            </div>

            <div className="mt-5 flex min-h-7 justify-center">
              {track.kind === 'bulletin' ? (
                <Badge tone="breaking" size="xs">
                  <span aria-hidden className={cn('h-2 w-2 rounded-pill bg-on-brand animate-pulse', !playing && PAUSED)} />
                  {t('player.onAir')}
                </Badge>
              ) : null}
            </div>

            <div aria-hidden className="mt-3 flex h-12 items-center justify-between">
              {WAVE.map((height, i) => (
                <span
                  key={i}
                  className={cn(
                    'w-1.5 rounded-pill transition-colors duration-slow ease-standard animate-eq',
                    i / WAVE.length < fraction ? 'bg-exclusive' : 'bg-on-ink/25',
                    !playing && PAUSED,
                  )}
                  style={{ height: `${height}%`, animationDuration: `${700 + (i % 5) * 140}ms`, animationDelay: `-${i * 70}ms` }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            <h2 id={`${id}-title`} lang="te" className="th te-clamp-3 mt-5 text-center text-headline-md font-bold text-on-ink">
              {track.title}
            </h2>
            <p className={cn(s.body, 'mt-1 text-center text-ui-sm text-muted-inverse')}>{trackSubtitle(track, t)}</p>

            {p.error ? (
              <div role="alert" className="mt-4 flex flex-col items-center gap-2 rounded-2xl bg-ink-panel p-4 text-center">
                <p className={cn(s.body, 'flex items-center gap-2 text-ui font-semibold text-on-ink')}>
                  <Icon icon={AlertCircle} size="sm" />
                  {t('player.error')}
                </p>
                <Button variant="inverse" icon={RotateCcw} onClick={p.retry}>
                  {t('state.retry')}
                </Button>
              </div>
            ) : null}

            <div className="mt-4">
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(duration))}
                step={1}
                value={Math.round(elapsed)}
                onChange={(e) => p.seek(Number(e.target.value))}
                aria-label={t('player.position')}
                aria-valuetext={`${clock(elapsed)} / ${clock(duration)}`}
                className="block min-h-tap w-full cursor-pointer accent-exclusive"
              />
              {/* The slider's valuetext already speaks these. */}
              <div aria-hidden className="flex justify-between font-sans text-meta tabular-nums text-muted-inverse">
                <span>{clock(elapsed)}</span>
                <span>-{clock(Math.max(0, duration - elapsed))}</span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <IconButton icon={SkipBack} label={t('ui.previous')} variant="inverse" size={48} round onClick={p.prev} />
              <SkipButton back />
              <PlayButton size="lg" playing={playing} buffering={buffering} onClick={p.toggle} />
              <SkipButton />
              <IconButton
                icon={SkipForward}
                label={t('ui.next')}
                variant="inverse"
                size={48}
                round
                disabled={!hasNext}
                onClick={p.next}
              />
            </div>

            <div role="group" aria-label={t('ui.speed')} className="mt-5 flex justify-center gap-2">
              {SPEEDS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  lang="en"
                  aria-pressed={p.rate === rate}
                  onClick={() => p.setRate(rate)}
                  className={cn(
                    'min-h-tap min-w-tap rounded-pill border px-3 font-sans text-ui-sm font-semibold tabular-nums',
                    'transition-colors duration-base ease-standard',
                    p.rate === rate ? 'border-on-ink bg-on-ink text-ink-deep' : 'border-on-ink/20 text-on-ink hover:border-on-ink/60',
                  )}
                >
                  {rate}×
                </button>
              ))}
            </div>

            {track.href ? (
              <ButtonLink to={track.href} variant="inverse" icon={BookOpen} onClick={minimise} className="mt-4 self-center">
                {t('player.readStory')}
              </ButtonLink>
            ) : null}

            {queue.length > 1 ? (
              <section aria-labelledby={`${id}-queue`} className="mt-8">
                <h3 id={`${id}-queue`} className={cn(s.body, 'text-ui-sm font-bold text-muted-inverse')}>
                  {t('player.upNext')}
                </h3>
                <ol className="mt-2 space-y-1">
                  {queue.map((item, i) => {
                    const current = i === index;
                    return (
                      <li key={`${item.id}-${i}`}>
                        <button
                          type="button"
                          aria-current={current || undefined}
                          onClick={() => (current ? p.toggle() : p.playQueue(queue, i))}
                          className={cn(
                            'flex min-h-tap w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-base ease-standard',
                            current ? 'bg-on-ink/10' : 'hover:bg-on-ink/5',
                          )}
                        >
                          <span className="grid w-5 shrink-0 place-items-center font-sans text-meta tabular-nums text-muted-inverse">
                            {current ? <Equalizer playing={playing} className="text-exclusive" /> : i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span lang="te" className={cn('te te-clamp-2 text-te-body-xs text-on-ink', current && 'font-bold')}>
                              {item.title}
                            </span>
                            {item.subtitle ? (
                              <span className={cn(s.body, 'block text-meta text-muted-inverse')}>{item.subtitle}</span>
                            ) : null}
                          </span>
                          {item.durationSec ? (
                            <span className="shrink-0 font-sans text-meta tabular-nums text-muted-inverse">{clock(item.durationSec)}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    overlayRoot(),
  );
}
