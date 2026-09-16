import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '@/features/epaper/api';
import { useLanguage } from '@/i18n';
import type { EpaperArticle, EpaperEdition, EpaperPage } from '@/types/epaper';

import { EditionReader } from './EditionReader';

vi.mock('@/features/epaper/api', () => ({
  fetchEpaperArchive: vi.fn(),
  fetchEpaperAudio: vi.fn(),
  recordPageShare: vi.fn(),
  downloadMyEditionPdf: vi.fn(),
}));

const article = (id: number, slot: number, body: string[]): EpaperArticle => ({
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
  body,
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
  pages: [page(11, 1, [article(101, 0, ['మొదటి పేరా']), article(102, 1, [])]), page(12, 2, [article(201, 0, ['రెండో పేజీ పేరా'])])],
};

function Probe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function renderReader(url: string) {
  vi.mocked(api.fetchEpaperArchive).mockResolvedValue({ items: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/epaper/:date/page/:page" element={<Reader />} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** What EpaperPage does around the reader: the `:page` param in, the loaded edition down. */
function Reader() {
  const { page } = useParams();
  return <EditionReader edition={edition} personalId={null} requestedPage={page} />;
}

describe('EditionReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });
  afterEach(() => act(() => useLanguage.setState({ language: 'te' })));

  it('opens the clip named by ?clip= and closing it drops the param with a replace', async () => {
    renderReader('/epaper/2026-09-15/page/1?clip=s101');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('శీర్షిక 101');
    // The paragraph is on the sheet too; the clip is the one inside the dialog.
    expect(within(dialog).getByText('మొదటి పేరా')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/epaper/2026-09-15/page/1');
    expect(screen.getByTestId('location')).not.toHaveTextContent('clip=');
  });

  it('ignores a clip that is not on the open page, and hotspots point at the canonical page URL', () => {
    renderReader('/epaper/2026-09-15/page/1?clip=s201');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'శీర్షిక 101 · క్లిప్ తెరవండి' })).toHaveAttribute(
      'href',
      '/epaper/2026-09-15/page/1?clip=s101',
    );
  });

  it('hides the public PDF download and toggles the clip outlines', async () => {
    renderReader('/epaper/2026-09-15/page/1');
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download PDF' })).toBeNull();
    const hotspot = screen.getByRole('link', { name: 'శీర్షిక 101 · క్లిప్ తెరవండి' });
    expect(hotspot).toHaveClass('ep-hotspot-rest');
    // The toolbar and the "more" sheet both carry the toggle; the toolbar one comes first.
    await userEvent.click(screen.getAllByRole('button', { name: 'Hide clips' })[0]!);
    expect(hotspot).not.toHaveClass('ep-hotspot-rest');
    expect(screen.getAllByRole('button', { name: 'Show clips' })[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('page box: a typed number navigates, out-of-range clamps, and first / last jump', async () => {
    renderReader('/epaper/2026-09-15/page/1');
    const box = screen.getByRole('spinbutton', { name: 'Page' });
    expect(box).toHaveValue(1);
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, '9{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/epaper/2026-09-15/page/2');
    expect(box).toHaveValue(2);
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, '0');
    await userEvent.tab();
    expect(screen.getByTestId('location')).toHaveTextContent('/epaper/2026-09-15/page/1');
    expect(box).toHaveValue(1);

    await userEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/epaper/2026-09-15/page/2');
    await userEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/epaper/2026-09-15/page/1');
  });

  it('search finds a story by its body text and opens that clip on its page', async () => {
    renderReader('/epaper/2026-09-15/page/1');
    await userEvent.type(screen.getAllByRole('searchbox', { name: 'Search this edition' })[0]!, 'రెండో పేజీ');
    const hit = await screen.findByRole('button', { name: /శీర్షిక 201/ });
    expect(hit).toHaveTextContent('Page 2');
    await userEvent.click(hit);
    expect(screen.getByTestId('location')).toHaveTextContent('/epaper/2026-09-15/page/2?clip=s201');
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('శీర్షిక 201');

    await userEvent.type(screen.getAllByRole('searchbox', { name: 'Search this edition' })[0]!, 'లేని పదం');
    expect(await screen.findByText('No results')).toBeInTheDocument();
  });

  describe('two-page spread', () => {
    const sheetsOnView = () => document.querySelectorAll('.ep-sheet:not([aria-hidden])').length;
    const stubViewport = (lg: boolean) =>
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: lg && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }));
    afterEach(() => {
      stubViewport(false);
      localStorage.removeItem('tn.epaper.spread');
    });

    it('from lg shows two pages side by side, moves by two, and remembers the choice', async () => {
      stubViewport(true);
      renderReader('/epaper/2026-09-15/page/1');
      expect(sheetsOnView()).toBe(1);
      await userEvent.click(screen.getByRole('button', { name: 'Two pages' }));
      expect(sheetsOnView()).toBe(2);
      expect(localStorage.getItem('tn.epaper.spread')).toBe('1');
      expect(screen.getByRole('button', { name: 'Single page' })).toHaveAttribute('aria-pressed', 'true');
      // Both open pages are current in the rail; the pair holds the last page, so next is off.
      expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: '2' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });

    it('below lg the view is always single even when the choice is stored', () => {
      localStorage.setItem('tn.epaper.spread', '1');
      stubViewport(false);
      renderReader('/epaper/2026-09-15/page/2');
      expect(sheetsOnView()).toBe(1);
      expect(screen.getByRole('link', { name: '1' })).not.toHaveAttribute('aria-current');
    });
  });
});
