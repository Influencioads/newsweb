import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { usePlayer } from '@/stores/player';

import { BulletinBanner } from './BulletinBanner';

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: { get: vi.fn() },
}));

const LIVE = {
  available: true,
  url: '/media/bulletins/2026-10-03-7.mp3',
  duration_sec: 185,
  date: '2026-10-03',
  slot: 7,
  slot_label_te: 'గరం చాయ్ న్యూస్',
  items: [],
};

function renderBanner(payload: object) {
  vi.mocked(api.get).mockResolvedValue({ data: payload });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BulletinBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  act(() => usePlayer.getState().close());
  vi.clearAllMocks();
});

describe('BulletinBanner', () => {
  it('shows the show name, slot time and length when a bulletin is live', async () => {
    renderBanner(LIVE);
    expect(await screen.findByText('గరం చాయ్ న్యూస్')).toHaveAttribute('lang', 'te');
    expect(screen.getByText(/07:00/)).toBeInTheDocument();
    expect(screen.getByText('3 ని')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ఈ రోజు బులెటిన్లన్నీ' })).toHaveAttribute('href', '/bulletin');
  });

  it('renders nothing when no bulletin is available', async () => {
    const { container } = renderBanner({ ...LIVE, available: false, url: null });
    await act(async () => {});
    expect(api.get).toHaveBeenCalledWith('/public/bulletins/latest');
    expect(container).toBeEmptyDOMElement();
  });

  it('plays the bulletin in the global player and toggles it', async () => {
    renderBanner(LIVE);
    const play = await screen.findByRole('button', { name: 'వినండి: గరం చాయ్ న్యూస్' });
    expect(play).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(play);
    const track = usePlayer.getState().queue[0];
    expect(track).toMatchObject({ id: '/public/bulletins/2026-10-03/7', kind: 'bulletin', url: LIVE.url });
    expect(usePlayer.getState().playing).toBe(true);
    expect(play).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(play);
    expect(usePlayer.getState().playing).toBe(false);
  });
});
