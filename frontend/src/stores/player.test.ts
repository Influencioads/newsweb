import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindAudio, usePlayer, type Track } from './player';

/**
 * Queue rules of the global player. jsdom has no media engine, so play/pause/
 * load are stubbed on a real <audio> element and its events are dispatched by
 * hand — the store is exercised exactly as PlayerHost wires it.
 */

const track = (n: number): Track => ({
  id: `/public/bulletins/2026-09-23/${n}`,
  kind: 'bulletin',
  title: `బులెటిన్ ${n}`,
  url: `https://cdn.example/b${n}.mp3`,
  durationSec: 180,
});
const DAY = [track(6), track(9), track(12)];

let el: HTMLAudioElement;
let unbind: () => void;

beforeEach(() => {
  el = document.createElement('audio');
  el.play = vi.fn(() => Promise.resolve());
  el.pause = vi.fn();
  el.load = vi.fn();
  unbind = bindAudio(el);
});

afterEach(() => {
  usePlayer.getState().close();
  usePlayer.setState({ rate: 1 });
  unbind();
});

const state = () => usePlayer.getState();

describe('player store', () => {
  it('playQueue loads the chosen track and starts it', () => {
    state().playQueue(DAY, 1);
    expect(state().index).toBe(1);
    expect(state().playing).toBe(true);
    expect(el.getAttribute('src')).toBe(DAY[1]!.url);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('next steps forward and stops at the end of the queue', () => {
    state().playQueue(DAY, 1);
    state().next();
    expect(state().index).toBe(2);
    state().next();
    expect(state().index).toBe(2);
  });

  it('prev restarts the track after 3 s, otherwise goes back', () => {
    state().playQueue(DAY, 2);
    usePlayer.setState({ elapsed: 42 });
    state().prev();
    expect(state().index).toBe(2);
    expect(state().elapsed).toBe(0);

    usePlayer.setState({ elapsed: 2 });
    state().prev();
    expect(state().index).toBe(1);
    expect(el.getAttribute('src')).toBe(DAY[1]!.url);
  });

  it('prev on the first track restarts it', () => {
    state().playQueue(DAY, 0);
    usePlayer.setState({ elapsed: 1 });
    state().prev();
    expect(state().index).toBe(0);
    expect(state().elapsed).toBe(0);
  });

  it('auto-advances on end and stops after the last track', () => {
    state().playQueue(DAY, 1);
    el.dispatchEvent(new Event('ended'));
    expect(state().index).toBe(2);
    expect(state().playing).toBe(true);

    el.dispatchEvent(new Event('ended'));
    expect(state().index).toBe(2);
    expect(state().playing).toBe(false);
    expect(state().elapsed).toBe(0);
  });

  it('keeps the listener speed across tracks', () => {
    state().playQueue(DAY, 0);
    state().setRate(1.5);
    state().next();
    expect(state().rate).toBe(1.5);
    expect(el.playbackRate).toBe(1.5);
  });

  it('toggle pauses and resumes the current track', () => {
    state().playQueue(DAY, 0);
    state().toggle();
    expect(state().playing).toBe(false);
    expect(el.pause).toHaveBeenCalled();
    state().toggle();
    expect(state().playing).toBe(true);
  });

  it('close stops and clears the queue', () => {
    state().playQueue(DAY, 1);
    state().setExpanded(true);
    state().close();
    expect(state()).toMatchObject({ queue: [], index: -1, playing: false, expanded: false });
    expect(el.getAttribute('src')).toBeNull();
    // Nothing loaded: toggle and Now Playing are inert.
    state().toggle();
    state().setExpanded(true);
    expect(state()).toMatchObject({ playing: false, expanded: false });
  });

  it('reports a broken file and retries it', () => {
    state().playQueue(DAY, 0);
    el.dispatchEvent(new Event('error'));
    expect(state()).toMatchObject({ error: true, playing: false });
    state().retry();
    expect(state()).toMatchObject({ error: false, playing: true, index: 0 });
  });
});
