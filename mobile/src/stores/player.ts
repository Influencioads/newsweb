import type { AudioPlayer, AudioStatus } from 'expo-audio';
import type { Href } from 'expo-router';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

/**
 * The app's one audio player — every server-generated voice (an article's
 * listen, a daily audio bulletin, the e-paper radio) plays through here, so
 * playback outlives the screen that started it and only one voice ever talks.
 *
 * The store is the queue and the transport; the engine is the single
 * expo-audio player `PlayerHost` owns in the root layout, attached with
 * `attachEngine()`. Actions drive the engine directly (a play has to happen
 * inside the tap on web), and the engine's status events are mirrored back —
 * `playing` / `elapsed` / `duration` describe what is actually coming out of
 * the speaker, not what was last asked for.
 *
 * One voice at a time: starting a track stops the device voice
 * (expo-speech), and `useTts` pauses this player before it speaks. Rate is
 * session memory: it carries from track to track but is not persisted.
 */
export type TrackKind = 'article' | 'bulletin' | 'epaper';

export interface Track {
  /** Stable per story/bulletin: an inline control finds itself by it. */
  id: string;
  kind: TrackKind;
  /** Telugu. */
  title: string;
  /** Names the kind: "ఆడియో బులెటిన్ · 09:00", "ఈ-పేపర్ రేడియో · పేజీ 3". */
  subtitle: string;
  /** The resolved (absolute) audio file. */
  url: string;
  durationSec?: number;
  /** The story behind the track — "Read the story" in Now Playing. */
  href?: Href;
  artwork?: string | null;
}

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  buffering: boolean;
  elapsed: number;
  duration: number;
  rate: number;
  error: string | null;
  /** The last track ran out; play starts it again from the top. */
  ended: boolean;
  /** The dock has made its entrance for this session of listening. */
  docked: boolean;
  playQueue: (tracks: Track[], start?: number) => void;
  playTrack: (track: Track) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  /** Restart the track when more than 3s in, else go to the previous one. */
  prev: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
  retry: () => void;
  /** Stop and forget the queue — the dock goes away. */
  close: () => void;
}

export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export const SKIP_SECONDS = 15;
const RESTART_AFTER = 3;

const IDLE = {
  queue: [] as Track[],
  index: 0,
  playing: false,
  buffering: false,
  elapsed: 0,
  duration: 0,
  error: null,
  ended: false,
  docked: false,
};

let engine: AudioPlayer | null = null;
let onLockScreen = false;
/** didJustFinish can arrive twice for one ending (web emits it on timeupdate and pause). */
let finished = false;
/** What the engine itself last reported — the lock screen and a headset can start it without the store. */
let enginePlaying = false;
/** The current track was started by an auto-advance, not a tap, and has not played yet. */
let autoAdvanced = false;

export const usePlayer = create<PlayerState>()((set, get) => {
  function load(index: number) {
    const track = get().queue[index];
    if (!track) return;
    finished = false;
    autoAdvanced = false;
    void Speech.stop();
    set({
      index,
      playing: true,
      buffering: true,
      elapsed: 0,
      duration: track.durationSec ?? 0,
      error: null,
      ended: false,
    });
    if (!engine) return;
    engine.replace(track.url);
    // A replaced source starts at 1x on web; re-apply the reader's rate.
    engine.setPlaybackRate(get().rate, 'high');
    engine.play();
    const metadata = { title: track.title, artist: track.subtitle, artworkUrl: track.artwork ?? undefined };
    if (onLockScreen) {
      engine.updateLockScreenMetadata(metadata);
    } else {
      engine.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true });
      onLockScreen = true;
    }
  }

  function seek(seconds: number) {
    const { duration } = get();
    const to = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    // A scrub or a replay from the end: the next ending is a new one.
    finished = false;
    void engine?.seekTo(to);
    set({ elapsed: to, ended: false });
  }

  return {
    ...IDLE,
    rate: 1,
    playQueue: (tracks, start = 0) => {
      if (!tracks.length) return;
      set({ queue: tracks });
      load(Math.min(Math.max(0, start), tracks.length - 1));
    },
    playTrack: (track) => get().playQueue([track], 0),
    toggle: () => {
      const s = get();
      if (!engine || !s.queue.length) return;
      if (s.error) return s.retry();
      if (s.playing) return s.pause();
      void Speech.stop();
      if (s.ended) seek(0);
      engine.play();
      set({ playing: true });
    },
    pause: () => {
      if (!get().playing) return;
      engine?.pause();
      set({ playing: false });
    },
    next: () => {
      const { index, queue } = get();
      if (index < queue.length - 1) load(index + 1);
    },
    prev: () => {
      const { index, elapsed } = get();
      if (elapsed > RESTART_AFTER || index === 0) seek(0);
      else load(index - 1);
    },
    seek,
    skip: (delta) => seek(get().elapsed + delta),
    setRate: (rate) => {
      engine?.setPlaybackRate(rate, 'high');
      set({ rate });
    },
    retry: () => {
      const { index, elapsed } = get();
      load(index);
      if (elapsed > 0) seek(elapsed);
    },
    close: () => {
      engine?.pause();
      engine?.clearLockScreenControls();
      onLockScreen = false;
      set(IDLE);
    },
  };
});

function mirror(status: AudioStatus) {
  // The lock screen, a headset or the browser's media keys start the engine
  // without going through the store; one voice at a time holds for them too.
  // Keyed on the engine's own edge, not the store's `playing`: a status still
  // marked playing can land just after useTts paused us, and must not cut the
  // device voice it is starting.
  if (status.playing && !enginePlaying) void Speech.stop();
  enginePlaying = status.playing;
  const s = usePlayer.getState();
  if (!s.queue.length) return;
  // Playing again (a replay, the lock screen): the next ending is a new one.
  // No engine reports `playing` on an ending status.
  if (status.playing) {
    finished = false;
    autoAdvanced = false;
  }
  if (status.didJustFinish) {
    if (finished) return;
    finished = true;
    if (s.index < s.queue.length - 1) {
      s.next();
      autoAdvanced = true;
      return;
    }
    usePlayer.setState({ playing: false, buffering: false, ended: true, elapsed: status.duration || s.duration });
    return;
  }
  // An engine reports an error once; the statuses after it say `error: null`
  // (Android's idle player reports not-loaded too). Keep it until load() or
  // retry() clears it, or the button spins forever and Retry never shows.
  const error = status.error ?? (status.playing ? null : s.error);
  // WebKit refuses play() on the fresh element an auto-advance makes (no tap
  // behind it) and the refusal is swallowed: a loaded file that never played
  // is waiting for a tap, not still loading.
  const refused = Platform.OS === 'web' && autoAdvanced && status.isLoaded && !status.playing;
  // Asked to play but the clock has not moved yet: still starting. (The web
  // engine reports a freshly loaded file as loaded-but-not-playing.)
  const starting = !refused && s.playing && !status.playing && status.currentTime === 0;
  const buffering = !error && (status.isBuffering || !status.isLoaded || starting);
  usePlayer.setState({
    // While loading, the engine reports "not playing" even though a play is
    // queued; keep the intent so the button does not flicker play/pause.
    playing: buffering ? s.playing : status.playing,
    buffering,
    elapsed: status.currentTime,
    duration: status.duration > 0 ? status.duration : s.duration,
    error,
    ...(status.playing ? { ended: false } : null),
  });
}

/** Called once by PlayerHost; returns the detach. */
export function attachEngine(player: AudioPlayer): () => void {
  engine = player;
  const sub = player.addListener('playbackStatusUpdate', mirror);
  return () => {
    sub.remove();
    if (engine !== player) return;
    // The player is released with its host (an error-boundary reset mounts a
    // fresh one): forget the queue with it, or the dock shows a track playing
    // over silence and the new player never gets the lock screen.
    engine = null;
    onLockScreen = false;
    finished = false;
    enginePlaying = false;
    usePlayer.setState(IDLE);
  };
}

/** Live status for one track — all zeros unless it is the current one, so idle controls never re-render on the clock. */
export function useTrackStatus(id: string) {
  return usePlayer(
    useShallow((s) => {
      const current = s.queue[s.index]?.id === id;
      return {
        current,
        playing: current && s.playing,
        buffering: current && s.buffering,
        elapsed: current ? s.elapsed : 0,
        duration: current ? s.duration : 0,
      };
    }),
  );
}

/**
 * The home-indicator inset a stack route should still pad. While a track is
 * loaded the dock sits under the stack and pads the inset itself, so the
 * route pads nothing (tab routes never ask — the tab bar owns their inset).
 */
export function useBottomInset(): number {
  const docked = usePlayer((s) => s.queue.length > 0);
  const insets = useSafeAreaInsets();
  return docked ? 0 : insets.bottom;
}

/** 0:00 — elapsed / remaining in every player surface. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
