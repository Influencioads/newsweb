import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayer, type Track } from '@/stores/player';

import { PlayerHost } from './PlayerHost';

/** The dock appears with a track, opens the lazy Now Playing, and closes away. */

const TRACKS: Track[] = [
  { id: '/public/bulletins/2026-09-23/9', kind: 'bulletin', title: 'ఉదయం 9 గంటల బులెటిన్', subtitle: '09:00', url: '/a.mp3', durationSec: 180 },
  { id: '/public/bulletins/2026-09-23/12', kind: 'bulletin', title: 'మధ్యాహ్నం 12 గంటల బులెటిన్', subtitle: '12:00', url: '/b.mp3', durationSec: 170 },
];

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  act(() => usePlayer.getState().close());
  vi.restoreAllMocks();
});

describe('PlayerHost', () => {
  it('shows the dock for a loaded queue and opens Now Playing', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <PlayerHost />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: 'ఆడియో ప్లేయర్' })).toBeNull();

    act(() => usePlayer.getState().playQueue(TRACKS, 0));
    const dock = screen.getByRole('region', { name: 'ఆడియో ప్లేయర్' });
    expect(within(dock).getByText('ఉదయం 9 గంటల బులెటిన్')).toBeInTheDocument();
    expect(within(dock).getByText('ఆడియో బులెటిన్ · 09:00')).toBeInTheDocument();
    // Loading until the element reports it can play — and the name says so.
    expect(within(dock).getByRole('button', { name: 'పాజ్, లోడ్ అవుతోంది…' })).toBeInTheDocument();

    const open = within(dock).getByRole('button', { name: /ప్లేయర్ తెరవండి/ });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'ఉదయం 9 గంటల బులెటిన్' }, { timeout: 15_000 });
    // The dock steps aside only once Now Playing is up (its effects, just after the commit).
    await waitFor(() => expect(dock).toHaveClass('invisible'));
    expect(within(dialog).getByRole('slider', { name: 'ఆడియో స్థానం' })).toHaveAttribute('aria-valuetext', '0:00 / 3:00');
    expect(within(dialog).getByText('ప్రసారంలో')).toBeInTheDocument();

    // Tapping the next item in the queue jumps there.
    await userEvent.click(within(dialog).getByRole('button', { name: /మధ్యాహ్నం 12 గంటల బులెటిన్/ }));
    expect(usePlayer.getState().index).toBe(1);

    await userEvent.click(within(dialog).getByRole('button', { name: 'ప్లేయర్ చిన్నదిగా చేయండి' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(usePlayer.getState().expanded).toBe(false);
    // Focus goes back to the dock it was opened from.
    expect(dock).not.toHaveClass('invisible');
    expect(open).toHaveFocus();
    // The lazy Now Playing chunk alone can take seconds to transform under a full, parallel run.
  }, 20_000);
});
