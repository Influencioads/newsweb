import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { usePlayer } from '@/stores/player';
import type { ArticleDetail } from '@/types/public';

import ArticlePage from './ArticlePage';

const never = () => new Promise<never>(() => {});

// A real nanoid can carry a '-': the page must still ask for this story.
const ID = 'ab-cd1';
const AUDIO = `/public/articles/${ID}/audio`;
const article = {
  short_id: ID,
  slug: 'story',
  url: `/news/story-${ID}`,
  title_te: 'వార్త',
  title_en: null,
  category: null,
  district: null,
  hero: null,
  body: null,
  tags: [],
  gallery: [],
  related: [],
  reading_time_sec: 60,
  comment_count: 0,
} as unknown as ArticleDetail;
const off = { available: false, url: null, mime: null, duration_sec: 0, voice: null, provider: null };
const routes: Record<string, unknown> = {
  [`/public/articles/${ID}`]: article,
  [`/public/articles/${ID}/formats`]: {
    audio: { ...off, fallback: 'device', voice_enabled: true },
    card: { available: false, url: null },
  },
  [AUDIO]: { ...off, available: true, url: '/a.mp3', duration_sec: 90, fallback: null, voice_enabled: true },
};

// Holds /audio back while a test looks at the page mid-render.
let audioGate: Promise<void> = Promise.resolve();

beforeEach(() => {
  audioGate = Promise.resolve();
  // Anything else stays pending instead of hitting the network.
  vi.spyOn(api, 'get').mockImplementation(((url: string) =>
    url in routes
      ? (url === AUDIO ? audioGate : Promise.resolve()).then(() => ({ data: routes[url] }))
      : never()) as typeof api.get);
  vi.spyOn(api, 'post').mockImplementation(never);
});

afterEach(() => {
  act(() => usePlayer.getState().close());
  vi.restoreAllMocks();
});

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/news/story-${ID}`]}>
        <Routes>
          <Route path="/:category/:slugAndId" element={<ArticlePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ArticlePage listen', () => {
  it('offers listen under the story before a file exists, and renders it only on the tap', async () => {
    renderPage();

    // The pill, not the toolbar's two headphones: it is described by its label.
    const pill = await screen.findByRole('button', { name: 'వినండి', description: /^వినండి ·/ });
    // Viewing the page never renders audio (§21).
    expect(api.get).not.toHaveBeenCalledWith(AUDIO, expect.anything());
    expect(api.get).not.toHaveBeenCalledWith(AUDIO);

    await userEvent.click(pill);
    await waitFor(() => expect(usePlayer.getState().queue[0]?.url).toBe('/a.mp3'));
    expect(api.get).toHaveBeenCalledWith(AUDIO, { timeout: 90_000 });
    expect(usePlayer.getState().queue[0]?.id).toBe(AUDIO);
  });

  it('stays busy, not disabled, while the file renders, then hands the focus to the player', async () => {
    let release!: () => void;
    audioGate = new Promise<void>((resolve) => (release = resolve));
    renderPage();

    const pill = await screen.findByRole('button', { name: 'వినండి', description: /^వినండి ·/ });
    act(() => pill.focus());
    await userEvent.keyboard('{Enter}');

    // A disabled button would drop the focus it just took.
    expect(pill).toHaveAttribute('aria-busy', 'true');
    expect(pill).toBeEnabled();
    expect(pill).toHaveFocus();
    // The toolbar's headphones (the phone's bottom bar) show the wait too.
    const toolbar = screen.getAllByRole('button', { name: 'వినండి' }).filter((b) => b !== pill);
    expect(toolbar).toHaveLength(2);
    for (const button of toolbar) expect(button).toHaveAttribute('aria-busy', 'true');

    await act(async () => release());
    await waitFor(() => expect(usePlayer.getState().queue[0]?.url).toBe('/a.mp3'));
    // The pill became the player: its play/pause button has the focus, not <body>.
    await waitFor(() => expect(pill).not.toBeInTheDocument());
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe('BUTTON');
    expect(['వినండి', 'పాజ్']).toContain(focused.getAttribute('aria-label'));
    for (const button of toolbar) expect(button).not.toHaveAttribute('aria-busy');
  });
});
