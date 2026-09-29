import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { SkipForward, X } from 'lucide-react';

import { IconButton } from '@/components/ui/Button';
import { translate, useI18n, useScript } from '@/i18n';
import { bindAudio, selectTrack, SKIP_SEC, usePlayer, type Track } from '@/stores/player';
import { cn } from '@/utils/cn';

import { Disc, Equalizer, PlayButton, trackSubtitle } from './parts';

/**
 * The global audio player's always-mounted half. Rendered once at the App
 * root, so it outlives every route and serves the public site and the CMS
 * previews alike:
 *
 * - the one `<audio>` element, bound to `stores/player`;
 * - the MINI-PLAYER DOCK — while a track is loaded and Now Playing is closed:
 *   turning disc, equalizer, Telugu title, kind line, a thin progress line,
 *   play/pause, next, stop. Tapping its body opens Now Playing;
 * - the Media Session (lock screen / hardware keys / OS media hub), guarded
 *   for browsers without it;
 * - a polite live region that announces each new track;
 * - Now Playing itself, lazy — the entry chunk carries only this file, the
 *   store and the parts. A chunk that fails to load falls back to the dock
 *   (`PlayerBoundary`), never a blank app.
 *
 * Space: the dock publishes its height as `--player-dock-h` on <html>; body
 * padding (assets/index.css) and `bottom-dock` sticky bars clear it. It rides
 * on `--bottom-bar-h`, which a fixed bottom bar (the article ReaderToolbar)
 * publishes, so it sits above that bar rather than on it, and drops down when
 * the bar slides away.
 */

const NowPlaying = lazy(() => import('./NowPlaying'));

/** Lock-screen art when the track has no photo of its own. */
const FALLBACK_ARTWORK = '/og-default.png';

/**
 * PlayerHost sits outside the route error boundary, so a crash in its UI —
 * most likely the Now Playing chunk failing to load, offline or after a
 * deploy — would otherwise unmount the whole app. The part renders nothing
 * instead and Now Playing closes, so the dock comes back; the `<audio>`
 * element is outside this and plays on. A new `resetKey` tries again.
 */
class PlayerBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error('[PlayerHost]', error);
    usePlayer.getState().setExpanded(false);
  }

  componentDidUpdate(prev: { resetKey?: unknown }): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function DockProgress() {
  const elapsed = usePlayer((p) => p.elapsed);
  const duration = usePlayer((p) => p.duration);
  const fraction = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  return (
    <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-on-ink/10">
      <span
        className="block h-full origin-left bg-exclusive transition-transform duration-base ease-standard"
        style={{ transform: `scaleX(${fraction})` }}
      />
    </span>
  );
}

function Dock({ track, hidden }: { track: Track; hidden: boolean }) {
  const { t } = useI18n();
  const s = useScript();
  const playing = usePlayer((p) => p.playing);
  const buffering = usePlayer((p) => p.buffering);
  const hasNext = usePlayer((p) => p.index < p.queue.length - 1);
  const { toggle, next, close, setExpanded } = usePlayer.getState();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const publish = () => root.setProperty('--player-dock-h', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeProperty('--player-dock-h');
    };
  }, []);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('player.label')}
      // Invisible, not unmounted, under Now Playing: it keeps its height (no
      // layout jump beneath the overlay) and stays the element focus returns to.
      className={cn(
        'fixed inset-x-0 z-header px-2 transition-[bottom] duration-base ease-standard print:hidden md:px-4',
        hidden && 'invisible',
      )}
      style={{
        bottom: 'var(--bottom-bar-h, 0px)',
        // A bottom bar underneath already pays the safe-area inset.
        paddingBottom: 'max(0.5rem, calc(env(safe-area-inset-bottom) - var(--bottom-bar-h, 0px)))',
      }}
    >
      <div className="relative mx-auto flex max-w-page items-center gap-1 overflow-hidden rounded-2xl bg-ink py-1.5 pl-1.5 pr-1 text-on-ink shadow-raised ring-1 ring-on-ink/10 animate-slide-up">
        <DockProgress />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-tap min-w-0 flex-1 items-center gap-3 rounded-xl pr-1 text-left"
        >
          <Disc artwork={track.artwork} spinning={playing} buffering={buffering} glyph="sm" className="h-11 w-11" />
          <span className="min-w-0 flex-1">
            <span className="sr-only">{t('player.open')}: </span>
            <span lang="te" className="th te-clamp-1 text-headline-xs font-bold text-on-ink">
              {track.title}
            </span>
            <span className={cn(s.body, 'flex min-w-0 items-center gap-1.5 text-meta text-muted-inverse')}>
              <Equalizer playing={playing} className="text-exclusive" />
              <span className="te-clamp-1 min-w-0">{trackSubtitle(track, t)}</span>
            </span>
          </span>
        </button>
        <PlayButton playing={playing} buffering={buffering} onClick={toggle} />
        {hasNext ? <IconButton icon={SkipForward} label={t('ui.next')} variant="inverse" round onClick={next} /> : null}
        <IconButton icon={X} label={t('player.stop')} variant="inverse" round onClick={close} />
      </div>
    </div>
  );
}

/** Lock screen, notification shade, hardware media keys. */
function useMediaSession(track: Track | undefined, subtitle: string): void {
  const playing = usePlayer((p) => p.playing);
  const hasNext = usePlayer((p) => p.index < p.queue.length - 1);
  const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  useEffect(() => {
    if (!supported) return;
    const session = navigator.mediaSession;
    if (!track) {
      session.metadata = null;
      return;
    }
    if (typeof MediaMetadata === 'undefined') return;
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: subtitle,
      album: translate('site.name', 'te'),
      artwork: [{ src: track.artwork || FALLBACK_ARTWORK }],
    });
  }, [supported, track, subtitle]);

  useEffect(() => {
    if (supported) navigator.mediaSession.playbackState = track ? (playing ? 'playing' : 'paused') : 'none';
  }, [supported, track, playing]);

  // Only while something is loaded: registered handlers take the hardware keys
  // from every other media element on the page (the CMS `<audio controls>` previews).
  const loaded = Boolean(track);
  useEffect(() => {
    if (!supported || !loaded) return;
    const session = navigator.mediaSession;
    const p = usePlayer.getState;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      [
        'play',
        () => {
          if (!p().playing) p().toggle();
        },
      ],
      ['pause', () => p().pause()],
      ['stop', () => p().close()],
      ['previoustrack', () => p().prev()],
      // Offered only when there is somewhere to go, so the OS hides the button.
      ['nexttrack', hasNext ? () => p().next() : null],
      ['seekbackward', (d) => p().skip(-(d.seekOffset ?? SKIP_SEC))],
      ['seekforward', (d) => p().skip(d.seekOffset ?? SKIP_SEC)],
      [
        'seekto',
        (d) => {
          if (d.seekTime != null) p().seek(d.seekTime);
        },
      ],
    ];
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // This browser does not know the action; the rest still work.
      }
    };
    for (const [action, handler] of handlers) set(action, handler);
    return () => {
      for (const [action] of handlers) set(action, null);
    };
  }, [supported, loaded, hasNext]);

  // Position without re-rendering: straight from the store on every tick.
  useEffect(() => {
    if (!supported || typeof navigator.mediaSession.setPositionState !== 'function') return;
    return usePlayer.subscribe((s, prev) => {
      if (s.elapsed === prev.elapsed && s.duration === prev.duration && s.rate === prev.rate) return;
      if (!(s.duration > 0)) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: s.duration,
          position: Math.min(s.elapsed, s.duration),
          playbackRate: s.rate,
        });
      } catch {
        // Out-of-range mid-seek; the next tick corrects it.
      }
    });
  }, [supported]);
}

export function PlayerHost() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const track = usePlayer(selectTrack);
  const expanded = usePlayer((p) => p.expanded);
  // Now Playing has mounted (and taken the dock as the element to return focus to).
  const [shown, setShown] = useState(false);

  useEffect(() => bindAudio(audioRef.current!), []);
  // A route change (a "Read the story" tap, the back button) lands on the page, not under the overlay.
  useEffect(() => {
    usePlayer.getState().setExpanded(false);
  }, [pathname]);
  useMediaSession(track, track ? trackSubtitle(track, t) : '');

  return (
    <>
      <audio ref={audioRef} preload="auto" hidden />
      {/* Always mounted: a live region has to exist before its text changes. */}
      <p aria-live="polite" className="sr-only">
        {track ? (
          <>
            {t('player.nowPlaying')}: <span lang="te">{track.title}</span>
          </>
        ) : null}
      </p>
      {track ? (
        <PlayerBoundary resetKey={track.id}>
          {/* Steps aside only once Now Playing is up: while its chunk loads the
              dock is all there is, and hiding it sooner drops the focus the
              dialog must hand back on minimise. */}
          <Dock track={track} hidden={expanded && shown} />
        </PlayerBoundary>
      ) : null}
      {track && expanded ? (
        <PlayerBoundary>
          <Suspense fallback={null}>
            <NowPlaying onShown={setShown} />
          </Suspense>
        </PlayerBoundary>
      ) : null}
    </>
  );
}
