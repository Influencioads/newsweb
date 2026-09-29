import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as cmsApi from '@/features/cms/api';
import { useLanguage } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { CmsArticle } from '@/types/cms';

import CreativeStudio from './CreativeStudio';

vi.mock('@/features/cms/api', () => ({
  fetchArticles: vi.fn(),
  fetchCreativeRefs: vi.fn(),
  uploadCreativeRef: vi.fn(),
  deleteCreativeRef: vi.fn(),
  socialCardText: vi.fn(),
  makeSocialCard: vi.fn(),
}));

const story = {
  id: 7,
  short_id: 'AbC123',
  title_te: 'అసెంబ్లీలో బడ్జెట్',
  summary_te: 'రాష్ట్ర బడ్జెట్ ప్రవేశపెట్టారు.',
  workflow_state: 'published',
  hero_media_id: null,
  hero_media: null,
} as unknown as CmsArticle;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreativeStudio />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreativeStudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => useLanguage.setState({ language: 'en' }));
    act(() => useAuth.setState({ can: () => true }));
    vi.mocked(cmsApi.fetchArticles).mockResolvedValue({ articles: [story], total: 1 });
  });

  it('opens on step 1 with the article search, and warns about a story without a photo', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Article/, current: 'step' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
    // Later steps wait for an article.
    expect(screen.getByRole('button', { name: /Generate/ })).toBeDisabled();

    await userEvent.click(await screen.findByRole('button', { name: /అసెంబ్లీలో బడ్జెట్/ }));

    expect(screen.getByRole('note')).toHaveTextContent(/no main photo/);
    expect(cmsApi.makeSocialCard).not.toHaveBeenCalled();
  });

  it('will not generate until a dimension is chosen', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /అసెంబ్లీలో బడ్జెట్/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    // Copy is prefilled from the story, never from the AI.
    expect(screen.getByRole('textbox', { name: /^Headline/ })).toHaveValue('అసెంబ్లీలో బడ్జెట్');
    expect(cmsApi.socialCardText).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Dimensions: nothing preselected, so neither Next nor Generate is open.
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Generate/ })).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /1080 × 1350/ }));

    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Generate/ })).toBeEnabled();
    expect(cmsApi.makeSocialCard).not.toHaveBeenCalled();
  });

  it('draws no design under a full-photo card of a story with a photo', async () => {
    const withPhoto = { ...story, hero_media_id: 9, hero_media: { url: 'https://cdn.example/p.webp' } } as unknown as CmsArticle;
    vi.mocked(cmsApi.fetchArticles).mockResolvedValue({ articles: [withPhoto], total: 1 });
    vi.mocked(cmsApi.fetchCreativeRefs).mockResolvedValue([]);
    vi.mocked(cmsApi.makeSocialCard).mockResolvedValue({ available: false, reason: 'off', card: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /అసెంబ్లీలో బడ్జెట్/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('radio', { name: /1080 × 1350/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('switch', { name: /AI design backdrop/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Full photo' }));
    expect(screen.getByRole('switch', { name: /AI design backdrop/ })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /AI design backdrop/ })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: /Generate creative/ }));
    expect(cmsApi.makeSocialCard).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ template: 'overlay', use_ai_backdrop: false, reference_media_ids: [], backdrop_media_id: null }),
    );
  });

  it('never lets AI copy for a story left behind land on the one picked since', async () => {
    const other = { ...story, id: 8, title_te: 'వర్షాలకు పంట నష్టం' } as unknown as CmsArticle;
    vi.mocked(cmsApi.fetchArticles).mockResolvedValue({ articles: [story, other], total: 2 });
    let answer: (v: Awaited<ReturnType<typeof cmsApi.socialCardText>>) => void = () => {};
    vi.mocked(cmsApi.socialCardText).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /అసెంబ్లీలో బడ్జెట్/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: /Write with AI/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: /వర్షాలకు పంట నష్టం/ }));

    await act(async () => answer({ headline: 'బడ్జెట్ హెడ్‌లైన్', summary: 'స', tag: 'ట', engine: 'ai', warnings: [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('textbox', { name: /^Headline/ })).toHaveValue('వర్షాలకు పంట నష్టం');
  });
});
