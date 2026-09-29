import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLanguage } from '@/i18n';
import type { EpaperArticle } from '@/types/epaper';

import { EpaperClipDialog } from './EpaperClipDialog';

const article: EpaperArticle = {
  id: 1,
  short_id: 'ab12cd',
  url: '/politics/story-ab12cd',
  title_te: 'క్లిప్ శీర్షిక',
  title_en: null,
  summary_te: 'సారాంశం',
  hero_url: null,
  category_slug: 'politics',
  category_name_te: 'రాజకీయాలు',
  is_breaking: false,
  audio_url: null,
  position: 1,
  display_type: 'lead',
  slot: 0,
  size: 'lead',
  word_count: 300,
  byline_te: 'ప్రత్యేక ప్రతినిధి',
  dateline_te: 'విజయవాడ',
  body: ['మొదటి పేరా', 'రెండో పేరా'],
  hero_caption_te: null,
  hero_credit: null,
};

describe('EpaperClipDialog', () => {
  beforeEach(() => act(() => useLanguage.setState({ language: 'en' })));
  afterEach(() => act(() => useLanguage.setState({ language: 'te' })));

  it('shows the story alone with its paragraphs, the full-story link and a share button', () => {
    render(
      <MemoryRouter>
        <EpaperClipDialog open onClose={vi.fn()} article={article} pageNumber={3} url="/epaper/2026-09-15/page/3?clip=ab12cd" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('క్లిప్ శీర్షిక');
    expect(screen.getByText('రాజకీయాలు')).toBeInTheDocument();
    expect(screen.getByText('ప్రత్యేక ప్రతినిధి · విజయవాడ')).toBeInTheDocument();
    expect(screen.getByText('మొదటి పేరా')).toBeInTheDocument();
    expect(screen.getByText('రెండో పేరా')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the full story' })).toHaveAttribute('href', '/politics/story-ab12cd');
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders nothing without a story', () => {
    render(
      <MemoryRouter>
        <EpaperClipDialog open onClose={vi.fn()} article={null} pageNumber={1} url="" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
