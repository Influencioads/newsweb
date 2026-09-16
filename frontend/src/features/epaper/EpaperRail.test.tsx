import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useLanguage } from '@/i18n';
import type { EpaperArticle, EpaperEdition, EpaperPage } from '@/types/epaper';

import { EpaperRail } from './EpaperRail';

const article = (id: number, slot: number): EpaperArticle => ({
  id,
  short_id: `s${id}`,
  url: `/news/story-${id}`,
  title_te: `శీర్షిక ${id}`,
  title_en: null,
  summary_te: null,
  hero_url: null,
  category_slug: 'news',
  category_name_te: 'వార్తలు',
  is_breaking: false,
  audio_url: null,
  position: slot + 1,
  display_type: 'standard',
  slot,
  size: 'standard',
  word_count: 100,
  byline_te: null,
  dateline_te: null,
  body: [],
  hero_caption_te: null,
  hero_credit: null,
});

const page = (id: number, page_number: number, articles: EpaperArticle[]): EpaperPage => ({
  id,
  page_number,
  title: `పేజీ ${page_number}`,
  layout_type: 'lead_grid',
  template_id: null,
  share_url: `/epaper/2026-09-15/page/${page_number}`,
  grid: { cols: 6, rows: 6 },
  slots: [
    { index: 0, x: 0, y: 0, w: 6, h: 2, size: 'lead' },
    { index: 1, x: 0, y: 2, w: 3, h: 1, size: 'standard' },
  ],
  articles,
  poll_id: null,
});

const edition: EpaperEdition = {
  id: 7,
  title: 'నేటి ఎడిషన్',
  edition_date: '2026-09-15',
  edition_type: 'DAILY',
  status: 'PUBLISHED',
  revision: 1,
  page_count: 2,
  pdf_url: null,
  pdf_status: null,
  pdf_error: null,
  audio_enabled: false,
  published_at: null,
  pages: [page(11, 1, [article(101, 0)]), page(12, 2, [article(201, 0), article(202, 1)])],
};

describe('EpaperRail', () => {
  beforeEach(() => act(() => useLanguage.setState({ language: 'en' })));
  afterEach(() => act(() => useLanguage.setState({ language: 'te' })));

  it('lists every page as a thumbnail link with aria-current on the open one, and switches to the clips', async () => {
    render(
      <MemoryRouter>
        <EpaperRail
          edition={edition}
          open={[2]}
          page={edition.pages[1]!}
          href={(n) => `/epaper/2026-09-15/page/${n}`}
          clipHref={(a) => `/epaper/2026-09-15/page/2?clip=${a.short_id}`}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '1' })).not.toHaveAttribute('aria-current');
    // Thumbnails are texture, not content: nothing inside them is exposed to assistive tech.
    expect(screen.queryByRole('heading', { name: 'శీర్షిక 201' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /Page clips/ }));
    expect(screen.getByRole('tab', { name: /Page clips/ })).toHaveAttribute('aria-selected', 'true');
    const clip = screen.getByRole('link', { name: /శీర్షిక 201/ });
    expect(clip).toHaveAttribute('href', '/epaper/2026-09-15/page/2?clip=s201');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: '1' })).toBeNull();
  });
});
