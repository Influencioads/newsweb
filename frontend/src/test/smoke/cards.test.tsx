import { act, render, renderHook, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BriefCard,
  CompactCard,
  GridCard,
  KickerCard,
  LatestCard,
  LeadCard,
  RowCard,
  SecondaryCard,
} from '@/components/article/ArticleCard';
import { useLanguage, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';

const TITLE_TE = 'గుంటూరులో భారీ వర్షాలు';

const article: ArticleCard = {
  short_id: 'abc123',
  slug: 'guntur-rains',
  url: '/politics/guntur-rains-abc123',
  title_te: TITLE_TE,
  title_en: null,
  summary_te: 'జిల్లా అంతటా వర్షాలు కురుస్తున్నాయి.',
  category: { slug: 'politics', name_te: 'రాజకీయాలు', name_en: 'Politics' },
  district: { slug: 'guntur', name_te: 'గుంటూరు', name_en: 'Guntur', state: 'AP' },
  hero: null,
  byline_te: 'మా ప్రతినిధి',
  is_breaking: false,
  is_exclusive: true,
  ai_generated: false,
  published_at: new Date().toISOString(),
  reading_time_sec: 90,
};

const VARIANTS: Array<[string, ComponentType<{ article: ArticleCard }>]> = [
  ['LeadCard', LeadCard],
  ['GridCard', GridCard],
  ['RowCard', RowCard],
  ['KickerCard', KickerCard],
  ['LatestCard', LatestCard],
  ['CompactCard', CompactCard],
  ['SecondaryCard', SecondaryCard],
  ['BriefCard', BriefCard],
];

function renderCard(Card: ComponentType<{ article: ArticleCard }>, a: ArticleCard = article) {
  return render(
    <MemoryRouter>
      {Card === BriefCard ? (
        <ul>
          <Card article={a} />
        </ul>
      ) : (
        <Card article={a} />
      )}
    </MemoryRouter>,
  );
}

// Wrapped in act: RTL's auto-cleanup runs after this hook, so components are still mounted.
afterEach(() => act(() => useLanguage.setState({ language: 'te' })));

describe('ArticleCard variants', () => {
  it.each(VARIANTS)('%s renders a Telugu headline with lang="te" and elastic clamping', (_name, Card) => {
    renderCard(Card);
    const headline = screen.getByText(TITLE_TE);
    expect(headline).toHaveAttribute('lang', 'te');
    expect(headline.className).toMatch(/(^|\s)(th|te)(\s|$)/);
    expect(headline.className).not.toMatch(/truncate|line-clamp/);
    expect(headline.closest('a')).toHaveAttribute('href', article.url);
  });

  it('falls back to Telugu in English mode when no English headline exists', () => {
    useLanguage.setState({ language: 'en' });
    renderCard(LeadCard);
    expect(screen.getByText(TITLE_TE)).toHaveAttribute('lang', 'te');
  });

  it('renders the English headline with lang="en" when present', () => {
    useLanguage.setState({ language: 'en' });
    renderCard(LeadCard, { ...article, title_en: 'Heavy rain in Guntur' });
    const headline = screen.getByText('Heavy rain in Guntur');
    expect(headline).toHaveAttribute('lang', 'en');
    expect(headline.className).not.toMatch(/(^|\s)th(\s|$)/);
  });
});

describe('useScript().forText', () => {
  it('tags Telugu-only content as Telugu even on an English page', () => {
    useLanguage.setState({ language: 'en' });
    const { result } = renderHook(() => useScript());
    expect(result.current.forText('తెలుగు', null)).toEqual({ lang: 'te', cls: 'te', head: 'th', telugu: true });
    expect(result.current.forText('తెలుగు', 'English')).toEqual({
      lang: 'en',
      cls: 'font-sans',
      head: 'font-sans',
      telugu: false,
    });
    expect(result.current.text('తెలుగు', null).text).toBe('తెలుగు');
  });

  it('is Telugu throughout on a Telugu page', () => {
    const { result } = renderHook(() => useScript());
    expect(result.current.body).toBe('te');
    expect(result.current.head).toBe('th');
    expect(result.current.forText('తెలుగు', 'English').lang).toBe('te');
  });
});
