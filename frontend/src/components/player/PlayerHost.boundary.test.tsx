import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayer } from '@/stores/player';

import { PlayerHost } from './PlayerHost';

/** Now Playing failing (a chunk that will not load) falls back to the dock, not a blank app. */

vi.mock('./NowPlaying', () => ({
  default: () => {
    throw new Error('Failed to fetch dynamically imported module');
  },
}));

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  // React reports the caught error; the boundary logs it too.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => usePlayer.getState().close());
  vi.restoreAllMocks();
});

describe('PlayerHost boundary', () => {
  it('closes Now Playing back to the dock and keeps the page', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <p>the page</p>
        <PlayerHost />
      </MemoryRouter>,
    );
    act(() =>
      usePlayer.getState().playTrack({ id: '/public/articles/abc/audio', kind: 'article', title: 'వార్త', url: '/a.mp3' }),
    );

    await userEvent.click(screen.getByRole('button', { name: /ప్లేయర్ తెరవండి/ }));
    await waitFor(() => expect(usePlayer.getState().expanded).toBe(false));
    expect(screen.getByText('the page')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'ఆడియో ప్లేయర్' })).not.toHaveClass('invisible');
    expect(usePlayer.getState().index).toBe(0);
  });
});
