import { create } from 'zustand';

/**
 * The one audio player — radio mode.
 *
 * Every server rendition (an article's reading, a daily audio bulletin, the
 * e-paper read out page by page) plays through this store and the single
 * `<audio>` element that `components/player/PlayerHost` renders at the app
 * root. Nothing is owned by a page, so playback carries on across navigation;
 * the inline listen controls are triggers and live status for this, not
 * players of their own.
 *
 * Queue semantics:
 *   - `playQueue(tracks, start)` replaces the queue and starts at `start`
 *     (the day's bulletins, the whole edition); `playTrack` is a queue of one.
 *   - `prev` restarts the track once it is more than 3 s in, otherwise steps
 *     back — the convention every radio and music app has taught readers.
 *   - a track that ends advances to the next; the last one stops, paused at 0.
 *   - the speed is the listener's, not the track's: it carries across tracks
 *     for the session (loading a source resets an element's rate, so `load`
 *     re-applies it).
 *
 * One voice at a time: starting this cancels the device voice
 * (`speechSynthesis`), and `features/reader/tts` pauses this when the device
 * voice starts and resets itself when this cancels it.
 *
 * `playing` is optimistic on a user action and then corrected by the element's
 * own events, so the button answers at once and never lies for long. Without a
 * bound element (tests, the first paint) the actions still move the state.
 *
 *     usePlayer.getState().playQueue(dayTracks, 2);
 *     const playing = usePlayer((p) => p.playing);
 */

export type TrackKind = 'article' | 'bulletin' | 'epaper';

export interface Track {
  /**
   * The track's audio route (`/public/articles/{shortId}/audio`,
   * `/public/bulletins/{date}/{slot}`), so one story has one id wherever it
   * is started from and every inline control can tell whether it is on air.
   */
  id: string;
  kind: TrackKind;
  /** Telugu headline or slot label. */
  title: string;
  /** The detail after the kind label: a slot time, "పేజీ 3", a section name. */
  subtitle?: string | null;
  /** The resolved audio file. */
  url: string;
  durationSec?: number | null;
  /** Route to the story, for "Read the story". */
  href?: string | null;
  artwork?: string | null;
}

export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** Past this many seconds, "previous" restarts the track instead. */
export const RESTART_AFTER_SEC = 3;
export const SKIP_SEC = 15;

export interface PlayerState {
  queue: Track[];
  /** -1 when nothing is loaded. */
  index: number;
  playing: boolean;
  buffering: boolean;
  elapsed: number;
  duration: number;
  rate: number;
  /** The current file failed to load or decode. */
  error: boolean;
  /** Now Playing is open; the dock steps aside while it is. */
  expanded: boolean;
  playQueue: (tracks: Track[], start?: number) => void;
  playTrack: (track: Track) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  skip: (deltaSec: number) => void;
  setRate: (rate: number) => void;
  /** Reload the current track after an error. */
  retry: () => void;
  /** Stop and clear everything. */
  close: () => void;
  setExpanded: (open: boolean) => void;
}

let audio: HTMLAudioElement | null = null;

function stopDeviceVoice(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  // Chrome keeps a cancelled-while-paused engine paused, silencing the next utterance.
  if (synth.paused) synth.resume();
}

const IDLE = {
  queue: [] as Track[],
  index: -1,
  playing: false,
  buffering: false,
  elapsed: 0,
  duration: 0,
  error: false,
  expanded: false,
};

export const usePlayer = create<PlayerState>()((set, get) => {
  function start(): void {
    stopDeviceVoice();
    set({ playing: true, error: false });
    // A rejected play() is the autoplay policy or a newer load interrupting
    // this one (AbortError) — neither is a broken file, which arrives as the
    // element's `error` event instead.
    audio?.play()?.catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name !== 'AbortError') set({ playing: false, buffering: false });
    });
  }

  function load(index: number): void {
    const track = get().queue[index];
    if (!track) return;
    set({ index, elapsed: 0, duration: track.durationSec ?? 0, buffering: true, error: false });
    if (audio) {
      audio.src = track.url;
      audio.defaultPlaybackRate = get().rate;
      audio.playbackRate = get().rate;
    }
    start();
  }

  return {
    ...IDLE,
    rate: 1,

    playQueue: (tracks, startAt = 0) => {
      if (!tracks.length) return;
      set({ queue: tracks });
      load(Math.min(Math.max(0, startAt), tracks.length - 1));
    },
    playTrack: (track) => get().playQueue([track], 0),

    toggle: () => {
      const { index, playing, error } = get();
      if (index < 0) return;
      if (playing) get().pause();
      else if (error) load(index);
      else start();
    },
    pause: () => {
      audio?.pause();
      set({ playing: false, buffering: false });
    },

    next: () => {
      const { index, queue } = get();
      if (index >= 0 && index < queue.length - 1) load(index + 1);
    },
    prev: () => {
      const { index, elapsed } = get();
      if (index < 0) return;
      if (elapsed > RESTART_AFTER_SEC || index === 0) get().seek(0);
      else load(index - 1);
    },

    seek: (seconds) => {
      const { duration, index } = get();
      if (index < 0) return;
      const to = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
      if (audio) audio.currentTime = to;
      set({ elapsed: to });
    },
    skip: (deltaSec) => get().seek(get().elapsed + deltaSec),

    setRate: (rate) => {
      if (audio) {
        audio.defaultPlaybackRate = rate;
        audio.playbackRate = rate;
      }
      set({ rate });
    },

    retry: () => {
      if (get().index >= 0) load(get().index);
    },

    close: () => {
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      set(IDLE);
    },

    setExpanded: (expanded) => set({ expanded: expanded && get().index >= 0 }),
  };
});

/** The track on air, or undefined. */
export const selectTrack = (p: PlayerState): Track | undefined => p.queue[p.index];

/**
 * Hand the store its one `<audio>` element and wire the element's events back
 * into state. PlayerHost calls this on mount; returns the unbind.
 */
export function bindAudio(el: HTMLAudioElement): () => void {
  audio = el;
  const set = usePlayer.setState;
  const get = usePlayer.getState;
  const handlers: Record<string, () => void> = {
    play: () => set({ playing: true }),
    playing: () => set({ playing: true, buffering: false }),
    pause: () => set({ playing: false }),
    waiting: () => set({ buffering: true }),
    canplay: () => set({ buffering: false }),
    timeupdate: () => set({ elapsed: el.currentTime }),
    durationchange: () => {
      // Streams report Infinity; keep the server's figure until a real one arrives.
      if (Number.isFinite(el.duration) && el.duration > 0) set({ duration: el.duration });
    },
    ended: () => {
      const { index, queue } = get();
      if (index < queue.length - 1) get().next();
      else set({ playing: false, buffering: false, elapsed: 0 });
    },
    error: () => {
      // `close` empties the source, which some engines report as an error.
      if (get().index >= 0 && el.getAttribute('src')) set({ error: true, playing: false, buffering: false });
    },
  };
  for (const [type, fn] of Object.entries(handlers)) el.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of Object.entries(handlers)) el.removeEventListener(type, fn);
    if (audio === el) audio = null;
  };
}
