import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { ArticleCard, HomeSection } from '@/types/public';

import { SectionBlock } from './HomeBlocks';

const story: ArticleCard = {
  short_id: 'story', slug: 'story', url: '/national/story', title_te: 'వార్త', title_en: null,
  summary_te: null, category: null, district: null, hero: null, byline_te: null,
  is_breaking: false, is_exclusive: false, ai_generated: false, published_at: null,
  reading_time_sec: 90, like_count: 0, comment_count: 0,
};

function renderSection(key: string) {
  const section: HomeSection = { key, title_te: key, title_en: key, articles: [story] };
  return render(<MemoryRouter><SectionBlock section={section} to={`/section/${key}`} /></MemoryRouter>);
}

describe('Home section bands', () => {
  it.each([
    ['breaking', 'breaking'],
    ['national', 'national'],
    ['world', 'international'],
    ['business', 'business'],
    ['exclusive', 'exclusive'],
  ])('uses the %s section key for a distinctive %s gradient band', (key, tone) => {
    renderSection(key);
    const section = screen.getByRole('heading', { name: key }).closest('section');
    expect(section).toHaveAttribute('data-section-key', key);
    expect(section?.querySelector('.home-section-band')).toHaveAttribute('data-band-tone', tone);
  });
});
