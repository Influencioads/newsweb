import type { ComponentProps } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Headphones } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { usePlayer, type Track } from '@/stores/player';
import type { AudioState } from '@/types/cms';

import { AudioPlayer } from './AudioPlayer';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: { get: vi.fn() },
}));

/**
 * The inline listen control is a trigger for the global player. No <audio> is
 * bound here, so the store's actions move state only — enough to see which
 * track the control started.
 */

const DEVICE = { state: 'idle' as const, toggle: () => {}, stop: () => {} };
const bulletin = (slot: number) => `/public/bulletins/2026-09-23/${slot}`;
const DAY: Track[] = [9, 12].map((slot) => ({
  id: bulletin(slot),
  kind: 'bulletin',
  title: `బులెటిన్ ${slot}`,
  url: `/b${slot}.mp3`,
  durationSec: 180,
}));
const payload = (url: string): { data: AudioState } => ({
  data: { available: true, url, mime: 'audio/mpeg', duration_sec: 60, voice: null, provider: 'upload', fallback: null, voice_enabled: true },
});

function renderControl(props: Partial<ComponentProps<typeof AudioPlayer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AudioPlayer shortId="abc" readingLabel="3 ని" deviceTts={DEVICE} {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  act(() => usePlayer.getState().close());
  vi.clearAllMocks();
});

describe('AudioPlayer', () => {
  it('takes its file from a queue that carries it: no fetch, and play starts the running order there', async () => {
    renderControl({ endpoint: bulletin(12), queue: DAY });
    expect(api.get).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'వినండి' }));
    expect(usePlayer.getState().queue).toBe(DAY);
    expect(usePlayer.getState().index).toBe(1);
  });

  it('renders nothing until the server answers, not the device-voice fallback', async () => {
    let answer!: (value: { data: AudioState }) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { container } = renderControl({ deviceTts: { ...DEVICE, state: 'unavailable' } });
    expect(container).toBeEmptyDOMElement();

    await act(async () => answer(payload('/a.mp3')));
    expect(await screen.findByRole('button', { name: 'వినండి' })).toBeEnabled();
  });

  it('starts the new file when its route is on air with an old one (replaced or regenerated)', async () => {
    vi.mocked(api.get).mockResolvedValue(payload('/new.mp3'));
    act(() =>
      usePlayer.getState().playTrack({ id: '/public/articles/abc/audio', kind: 'article', title: 'పాత ఆడియో', url: '/old.mp3' }),
    );
    renderControl();

    // Not shown as on air (that would read "Pause" and resume the old file).
    await userEvent.click(await screen.findByRole('button', { name: 'వినండి' }));
    expect(usePlayer.getState().queue[0]?.url).toBe('/new.mp3');
    expect(usePlayer.getState().playing).toBe(true);
  });

  it("shows the caller's idle icon under the same name, and Play by default", async () => {
    vi.mocked(api.get).mockResolvedValue(payload('/a.mp3'));
    const { unmount } = renderControl({ idleIcon: Headphones });
    const listen = await screen.findByRole('button', { name: 'వినండి' });
    expect(listen.querySelector('.lucide-headphones')).not.toBeNull();
    unmount();

    renderControl();
    expect((await screen.findByRole('button', { name: 'వినండి' })).querySelector('.lucide-play')).not.toBeNull();
  });
});
