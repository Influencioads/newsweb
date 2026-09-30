import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { useLanguage } from '@/i18n';
import { useReaderPrefs } from '@/stores/readerPrefs';
import type { ArticleCard, HomePayload } from '@/types/public';

import Home from './Home';

function article(short_id: string, title_te: string, is_exclusive = false): ArticleCard {
  return {
    short_id,
    slug: short_id,
    url: `/national/${short_id}`,
    title_te,
    title_en: null,
    summary_te: 'వార్త వివరాలు ఇక్కడ ఉన్నాయి.',
    category: { slug: 'national', name_te: 'జాతీయం', name_en: 'National' },
    district: null,
    hero: null,
    byline_te: null,
    is_breaking: false,
    is_exclusive,
    ai_generated: false,
    published_at: null,
    reading_time_sec: 90,
    like_count: 0,
    comment_count: 0,
  };
}

function homePayload(): HomePayload {
  const lead = article('lead', 'ముఖ్య కథనం');
  const exclusiveOne = article('exclusive-one', 'ప్రత్యేక కథనం ఒకటి', true);
  const exclusiveTwo = article('exclusive-two', 'ప్రత్యేక కథనం రెండు', true);
  return {
    edition: null,
    mandal_block: null,
    lead,
    secondary: [exclusiveOne],
    mid_column: [exclusiveTwo],
    briefs: [],
    latest: [exclusiveOne, exclusiveTwo],
    breaking: [],
    sections: [
      { key: 'national', title_te: 'జాతీయం', title_en: 'National', articles: [article('national', 'జాతీయ వార్త'), exclusiveOne] },
    ],
    epaper: null,
    generated_at: new Date().toISOString(),
  };
}

function renderHome(payload: HomePayload) {
  useReaderPrefs.setState({ edition: null, mandal: null });
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(['public', 'home', null, null], payload);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => useLanguage.setState({ language: 'te' }));

describe('Home editorial hierarchy', () => {
  it('puts the distinct featured lead before trending and other discovery shelves', () => {
    renderHome(homePayload());
    const lead = screen.getByRole('heading', { name: 'ముఖ్య కథనం' });
    const trending = screen.getByText('ట్రెండింగ్');
    expect(lead.closest('article')).toHaveClass('home-feature');
    expect(lead.compareDocumentPosition(trending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('slides the top stories: the lead first, then the secondary stories', () => {
    renderHome(homePayload());
    const slides = within(screen.getByRole('region', { name: 'ముఖ్య కథనాలు' })).getAllByRole('group');
    expect(slides).toHaveLength(2);
    expect(within(slides[0]!).getByRole('heading', { name: 'ముఖ్య కథనం' })).toBeInTheDocument();
    expect(within(slides[1]!).getByRole('heading', { name: 'ప్రత్యేక కథనం ఒకటి' })).toBeInTheDocument();
  });

  it('builds an exclusive shelf from distinct flagged stories and excludes the lead', () => {
    renderHome(homePayload());
    const shelf = screen.getByRole('heading', { name: 'ఎక్స్‌క్లూజివ్' }).closest('section');
    expect(shelf).toBeInTheDocument();
    expect(shelf).toHaveAttribute('data-section-key', 'exclusive');
    expect(shelf?.querySelectorAll('a[href="/national/exclusive-one"]')).toHaveLength(1);
    expect(shelf?.querySelectorAll('a[href="/national/exclusive-two"]')).toHaveLength(1);
    expect(shelf?.querySelector('a[href="/national/lead"]')).toBeNull();
  });

  it('does not show an empty exclusive shelf', () => {
    const payload = homePayload();
    renderHome({ ...payload, secondary: [], mid_column: [], latest: [], sections: [] });
    expect(screen.queryByRole('heading', { name: 'ఎక్స్‌క్లూజివ్' })).toBeNull();
  });
});
