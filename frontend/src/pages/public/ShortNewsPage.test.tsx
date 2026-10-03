import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import type { ShortNewsFeed } from '@/types/public';

import ShortNewsPage from './ShortNewsPage';

const image = (id: number, w: number, h: number) => ({
  id,
  url: `/media/card${id}.webp`,
  srcset: `/media/card${id}-400.webp 400w, /media/card${id}.webp 800w`,
  alt_te: `కార్డ్ ${id}`,
  caption_te: null,
  width: w,
  height: h,
  blurhash: null,
  ai_generated: id === 2,
});
const feed: ShortNewsFeed = {
  items: [
    { id: 1, image: image(1, 1080, 1350), article_short_id: 'abc123', article_url: '/news/story-abc123', created_at: '2026-10-02T05:00:00Z' },
    { id: 2, image: image(2, 1080, 1920), article_short_id: null, article_url: null, created_at: '2026-10-02T04:00:00Z' },
  ],
  next_cursor: null,
} as unknown as ShortNewsFeed;

afterEach(() => vi.restoreAllMocks());

describe('ShortNewsPage', () => {
  it('shows each card as a whole picture, linking only a card with a story', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: feed });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ShortNewsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const slides = await screen.findAllByRole('article');
    expect(slides).toHaveLength(2);
    const [one, two] = slides as [HTMLElement, HTMLElement];

    const first = within(one);
    const pic = first.getByAltText('కార్డ్ 1');
    expect(pic.className).toContain('object-contain');
    // The blurred backdrop takes the smallest rendition.
    expect(one.querySelector('img[aria-hidden]')?.getAttribute('src')).toBe('/media/card1-400.webp');
    expect(first.getByRole('link').getAttribute('href')).toBe('/news/story-abc123');

    const second = within(two);
    expect(second.queryByRole('link')).toBeNull();
    expect(second.getByText(/AI/)).toBeTruthy();
  });
});
