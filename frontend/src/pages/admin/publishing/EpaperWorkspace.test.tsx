import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '@/features/epaper/adminApi';
import { useLanguage } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { Me } from '@/types/auth';
import type { EpaperCandidate, EpaperEdition } from '@/types/epaper';

import { EpaperWorkspace } from './EpaperWorkspace';

vi.mock('@/features/epaper/adminApi', () => ({
  fetchAdminEdition: vi.fn(),
  fetchCandidates: vi.fn(),
  updatePage: vi.fn(),
  fetchAdminPolls: vi.fn(),
  fetchTemplates: vi.fn(),
  fetchPlan: vi.fn(),
  editionAction: vi.fn(),
  fillEdition: vi.fn(),
  fillPage: vi.fn(),
  renderPdf: vi.fn(),
  addPage: vi.fn(),
  deletePage: vi.fn(),
  orderPages: vi.fn(),
  generateEdition: vi.fn(),
  regenerateEdition: vi.fn(),
}));

const CANDIDATE_TITLE = 'కొత్త కథనం శీర్షిక';

const edition = (status: string): EpaperEdition => ({
  id: 7,
  title: 'నేటి ఎడిషన్',
  edition_date: '2026-09-15',
  edition_type: 'DAILY',
  status,
  revision: 2,
  page_count: 1,
  pdf_url: null,
  pdf_status: null,
  pdf_error: null,
  audio_enabled: false,
  published_at: null,
  pages: [
    {
      id: 11,
      page_number: 1,
      title: 'మొదటి పేజీ',
      layout_type: 'lead_grid',
      template_id: null,
      share_url: '/epaper/2026-09-15/page/1',
      grid: { cols: 6, rows: 6 },
      slots: [
        { index: 0, x: 0, y: 0, w: 4, h: 3, size: 'lead' },
        { index: 1, x: 4, y: 0, w: 2, h: 2, size: 'standard' },
        { index: 2, x: 4, y: 2, w: 2, h: 1, size: 'brief' },
      ],
      articles: [
        {
          id: 101,
          short_id: 'abc101',
          url: '/news/story-101',
          title_te: 'ఉంచిన కథనం',
          title_en: null,
          summary_te: null,
          hero_url: null,
          category_slug: 'news',
          category_name_te: 'వార్తలు',
          is_breaking: false,
          audio_url: null,
          position: 1,
          display_type: 'lead',
          slot: 0,
          size: 'lead',
          word_count: 200,
        },
      ],
      poll_id: null,
    },
  ],
});

const candidate: EpaperCandidate = {
  id: 202,
  short_id: 'abc202',
  title_te: CANDIDATE_TITLE,
  title_en: null,
  category_slug: 'politics',
  category_name_te: 'రాజకీయాలు',
  word_count: 90,
  has_hero: false,
  hero_url: null,
  size: 'standard',
  is_breaking: false,
  is_featured: false,
  published_at: null,
  in_section: true,
};

const me = (permissions: string[]): Me => ({
  user: {} as Me['user'],
  roles: [],
  permissions,
  level: 50,
  is_global_scope: true,
  district_ids: [],
  mandal_ids: [],
});

function renderWorkspace(status = 'GENERATED') {
  vi.mocked(api.fetchAdminEdition).mockResolvedValue(edition(status));
  vi.mocked(api.fetchCandidates).mockResolvedValue({ items: [candidate] });
  vi.mocked(api.fetchAdminPolls).mockResolvedValue({ items: [] });
  vi.mocked(api.updatePage).mockResolvedValue(edition(status).pages[0]!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/epaper/2026-09-15']}>
        <Routes>
          <Route path="/admin/epaper/:date" element={<EpaperWorkspace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EpaperWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
  });
  afterEach(() => {
    act(() => {
      useLanguage.setState({ language: 'te' });
      useAuth.setState({ me: null, status: 'anonymous' });
    });
  });

  it('lists candidates and places one in the first slot it fits', async () => {
    useAuth.setState({ me: me(['epaper.view', 'epaper.hotspot']), status: 'authenticated' });
    renderWorkspace();
    expect(await screen.findByText(CANDIDATE_TITLE)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: `Add: ${CANDIDATE_TITLE}` }));
    await waitFor(() => expect(api.updatePage).toHaveBeenCalledWith(7, 11, { article_ids: [101, 202, null] }));
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('offers Publish only with epaper.publish on an approved edition', async () => {
    useAuth.setState({ me: me(['epaper.view', 'epaper.hotspot']), status: 'authenticated' });
    const view = renderWorkspace('APPROVED');
    expect(await screen.findByRole('heading', { name: 'నేటి ఎడిషన్' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    view.unmount();

    useAuth.setState({ me: me(['epaper.view', 'epaper.hotspot', 'epaper.publish']), status: 'authenticated' });
    renderWorkspace('APPROVED');
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('hides the candidates panel without epaper.hotspot', async () => {
    useAuth.setState({ me: me(['epaper.view']), status: 'authenticated' });
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: 'నేటి ఎడిషన్' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Stories that fit')).toBeNull();
    expect(api.fetchCandidates).not.toHaveBeenCalled();
    // View-only: the sheet keeps its public look.
    expect(screen.getByRole('link', { name: 'ఉంచిన కథనం' })).toBeInTheDocument();
  });
});
