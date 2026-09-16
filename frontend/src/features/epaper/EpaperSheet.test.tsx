import type { ReactElement, ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLanguage } from '@/i18n';
import type { EpaperArticle, EpaperPage, EpaperSlot } from '@/types/epaper';

import { EpaperSheet, slotArea } from './EpaperSheet';

const slot = (index: number, x: number, y: number, w: number, h: number, size: EpaperSlot['size']): EpaperSlot => ({ index, x, y, w, h, size });

const article = (id: number, slot: number, size: EpaperArticle['size'], summary: string): EpaperArticle => ({
  id,
  short_id: `s${id}`,
  url: `/news/story-${id}`,
  title_te: `శీర్షిక ${id}`,
  title_en: null,
  summary_te: summary,
  hero_url: null,
  category_slug: 'news',
  category_name_te: 'వార్తలు',
  is_breaking: false,
  audio_url: null,
  position: slot + 1,
  display_type: size,
  slot,
  size,
  word_count: 120,
});

const LEAD_SUMMARY = 'ప్రధాన కథనం సారాంశం';
const BRIEF_SUMMARY = 'సంక్షిప్త కథనం సారాంశం';

const page: EpaperPage = {
  id: 11,
  page_number: 1,
  title: 'మొదటి పేజీ',
  layout_type: 'lead_grid',
  template_id: null,
  share_url: '/epaper/2026-09-15/page/1',
  grid: { cols: 6, rows: 6 },
  slots: [slot(0, 0, 0, 4, 3, 'lead'), slot(1, 4, 0, 2, 2, 'standard'), slot(2, 4, 2, 2, 1, 'brief')],
  articles: [article(101, 0, 'lead', LEAD_SUMMARY), article(103, 2, 'brief', BRIEF_SUMMARY)],
  poll_id: null,
};

const draw = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('EpaperSheet', () => {
  beforeEach(() => act(() => useLanguage.setState({ language: 'en' })));
  afterEach(() => act(() => useLanguage.setState({ language: 'te' })));

  it('places each story on the slot grid through --slot', () => {
    const { container } = draw(<EpaperSheet page={page} />);
    const cells = Array.from(container.querySelector('.md\\:grid-cols-6')!.children) as HTMLElement[];
    // The empty standard slot renders nothing publicly.
    expect(cells).toHaveLength(2);
    expect(slotArea(page.slots[0]!)).toBe('1 / 1 / span 3 / span 4');
    expect(cells[0]!.style.getPropertyValue('--slot')).toBe('1 / 1 / span 3 / span 4');
    expect(cells[1]!.style.getPropertyValue('--slot')).toBe('3 / 5 / span 1 / span 2');
    expect(cells[0]!.className).toContain('md:[grid-area:var(--slot)]');
  });

  it('draws the lead with a five-line summary and the brief with none', () => {
    draw(<EpaperSheet page={page} />);
    expect(screen.getByText(LEAD_SUMMARY)).toHaveClass('te-clamp-5');
    expect(screen.queryByText(BRIEF_SUMMARY)).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'No stories on this page.' })).toBeNull();
  });

  it('shows the empty state only when the page has no stories', () => {
    draw(<EpaperSheet page={{ ...page, articles: [] }} />);
    expect(screen.getByRole('heading', { name: 'No stories on this page.' })).toBeInTheDocument();
  });

  it('editable: renderSlot sees every slot, empties as null, and headlines are not links', () => {
    const renderSlot = vi.fn((_slot: EpaperSlot, _article: EpaperArticle | null, story: ReactNode) => <div>{story}</div>);
    draw(<EpaperSheet page={page} editable renderSlot={renderSlot} />);
    expect(renderSlot).toHaveBeenCalledTimes(3);
    const [, emptyArticle, emptyStory] = renderSlot.mock.calls[1]!;
    expect(emptyArticle).toBeNull();
    expect(emptyStory).toBeNull();
    expect(renderSlot.mock.calls[0]![1]?.id).toBe(101);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('శీర్షిక 101')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No stories on this page.' })).toBeNull();
  });
});
