import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

/** The WOW home page (Pallavi's design): Featured Story, Explore WOW, Story
 *  Shots, WOW Radio beside the Nominate call, Trending, Featured Heroes. */
describe('Home (WOW layout)', () => {
  function follows(a: Element, b: Element) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  it('leads with the featured story, then the WOW shelves in order', () => {
    renderHome(homePayload());
    const lead = screen.getByRole('heading', { name: 'ముఖ్య కథనం' });
    const explore = document.getElementById('explore-wow')!;
    const radio = screen.getByRole('heading', { name: /WOW Radio/ });
    const nominate = document.getElementById('nominate-cta')!;
    expect(lead.closest('article')).toBeInTheDocument();
    expect(follows(lead, explore)).toBe(true);
    expect(follows(explore, radio)).toBe(true);
    expect(follows(radio, nominate)).toBe(true);
  });

  it('keeps the lead out of the trending list', () => {
    renderHome(homePayload());
    expect(screen.getAllByRole('heading', { name: 'ముఖ్య కథనం' })).toHaveLength(1);
    expect(document.querySelectorAll('a[href="/national/exclusive-one"]').length).toBeGreaterThan(0);
  });

  it('no longer renders the newspaper exclusive shelf', () => {
    const payload = homePayload();
    renderHome({ ...payload, secondary: [], mid_column: [], latest: [], sections: [] });
    expect(screen.queryByRole('heading', { name: 'ఎక్స్‌క్లూజివ్' })).toBeNull();
  });
});
