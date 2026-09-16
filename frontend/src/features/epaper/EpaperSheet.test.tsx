import type { ReactElement, ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLanguage } from '@/i18n';
import type { EpaperArticle, EpaperPage, EpaperSlot } from '@/types/epaper';

import { EpaperSheet, slotArea } from './EpaperSheet';
import { slotRect } from './print';

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
  byline_te: 'ప్రత్యేక ప్రతినిధి',
  dateline_te: 'హైదరాబాద్',
  body: [`మొదటి పేరా ${id}`, `రెండో పేరా ${id}`],
  hero_caption_te: null,
  hero_credit: null,
});

const LEAD_SUMMARY = 'ప్రధాన కథనం సారాంశం';
const BRIEF_SUMMARY = 'సంక్షిప్త కథనం సారాంశం';
const WORDMARK = 'టాప్ తెలుగు న్యూస్';

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
const edition = { edition_date: '2026-09-15', page_count: 8 };

const draw = (ui: ReactElement) => render(<MemoryRouter initialEntries={['/epaper/2026-09-15/page/1']}>{ui}</MemoryRouter>);

describe('EpaperSheet', () => {
  beforeEach(() => act(() => useLanguage.setState({ language: 'en' })));
  afterEach(() => act(() => useLanguage.setState({ language: 'te' })));

  it('places each story at its canvas rectangle and keeps slotArea', () => {
    const { container } = draw(<EpaperSheet page={page} edition={edition} />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.ep-cell'));
    // The empty standard slot renders nothing publicly.
    expect(cells).toHaveLength(2);
    const lead = slotRect(page.slots[0]!, 1);
    expect(lead).toEqual({ left: 36, top: 252, width: 746, height: 777 });
    expect(cells[0]!.style.left).toBe('36px');
    expect(cells[0]!.style.width).toBe('746px');
    // Page 2 starts under the folio alone.
    expect(slotRect(page.slots[0]!, 2).top).toBe(82);
    expect(slotArea(page.slots[0]!)).toBe('1 / 1 / span 3 / span 4');
  });

  it('typesets the story: kicker, byline, deck for the lead only, body in one column per grid column', () => {
    const { container } = draw(<EpaperSheet page={page} edition={edition} />);
    expect(screen.getAllByText('వార్తలు')[0]).toHaveClass('ep-kicker');
    expect(screen.getAllByText('ప్రత్యేక ప్రతినిధి · హైదరాబాద్')).toHaveLength(2);
    expect(screen.getByText(LEAD_SUMMARY)).toHaveClass('ep-deck');
    expect(screen.queryByText(BRIEF_SUMMARY)).toBeNull();
    const body = container.querySelector<HTMLElement>('.ep-body')!;
    expect(body.style.columnCount).toBe('4');
    expect(screen.getByText('మొదటి పేరా 101')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No stories on this page.' })).toBeNull();
  });

  it('draws the masthead on page 1 only and the folio on every page', () => {
    const first = draw(<EpaperSheet page={page} edition={edition} />);
    expect(screen.getByText(WORDMARK)).toHaveClass('ep-wordmark');
    expect(screen.getByText('మొదటి పేజీ')).toBeInTheDocument();
    expect(screen.getByText('1')).toHaveClass('ep-folio-num');
    first.unmount();

    draw(<EpaperSheet page={{ ...page, page_number: 2, title: 'రాష్ట్రం' }} edition={edition} />);
    expect(screen.queryByText(WORDMARK)).toBeNull();
    expect(screen.getByText('రాష్ట్రం')).toBeInTheDocument();
    expect(screen.getByText('2')).toHaveClass('ep-folio-num');
  });

  it('reader: every story is a hotspot into its clip; headlines are not links', () => {
    draw(<EpaperSheet page={page} edition={edition} showClips />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    const lead = screen.getByRole('link', { name: 'శీర్షిక 101 · క్లిప్ తెరవండి' });
    expect(lead).toHaveAttribute('href', expect.stringContaining('?clip=s101'));
    expect(lead).toHaveClass('ep-hotspot', 'ep-hotspot-rest');
    expect(screen.getByRole('heading', { name: 'శీర్షిక 101' }).closest('a')).toBeNull();
  });

  it('reader: clipHref shapes the hotspot and showClips=false drops the rest outline', () => {
    draw(<EpaperSheet page={page} edition={edition} showClips={false} clipHref={(a) => `/my-epaper/edition/4/page/1?clip=${a.short_id}`} />);
    const lead = screen.getByRole('link', { name: 'శీర్షిక 101 · క్లిప్ తెరవండి' });
    expect(lead).toHaveAttribute('href', '/my-epaper/edition/4/page/1?clip=s101');
    expect(lead).not.toHaveClass('ep-hotspot-rest');
  });

  it('thumbnail: no links, aria-hidden, a line texture instead of body text', () => {
    const { container } = draw(<EpaperSheet page={page} edition={edition} mode="thumbnail" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('.ep-sheet')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.ep-lines')).toHaveLength(2);
    expect(container.querySelector('.ep-body')).toBeNull();
  });

  it('print: the reader layout without hotspots or the fade', () => {
    const { container } = draw(<EpaperSheet page={page} edition={edition} mode="print" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('.ep-body')).not.toBeNull();
    expect(container.querySelector('.ep-fade')).toBeNull();
  });

  it('puts the big question in the free last row as a link', () => {
    draw(<EpaperSheet page={{ ...page, poll_id: 5 }} edition={edition} />);
    expect(screen.getByRole('link', { name: /బిగ్ క్వశ్చన్/ })).toHaveAttribute('href', '/polls/5');
  });

  it('shows the empty state only when the page has no stories', () => {
    draw(<EpaperSheet page={{ ...page, articles: [] }} edition={edition} />);
    expect(screen.getByRole('heading', { name: 'No stories on this page.' })).toBeInTheDocument();
  });

  it('legacy pages without slots become full-width rows, first = lead', () => {
    const { container } = draw(<EpaperSheet page={{ ...page, slots: [] }} edition={edition} mode="print" />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.ep-cell'));
    expect(cells).toHaveLength(2);
    expect(cells[0]!.style.width).toBe('1128px');
    expect(screen.getByRole('heading', { name: 'శీర్షిక 101' })).toHaveClass('ep-head-lead');
    expect(screen.getByRole('heading', { name: 'శీర్షిక 103' })).toHaveClass('ep-head-standard');
  });

  it('editable: renderSlot sees every slot, empties as null, and headlines are not links', () => {
    const renderSlot = vi.fn((_slot: EpaperSlot, _article: EpaperArticle | null, story: ReactNode) => <div>{story}</div>);
    draw(<EpaperSheet page={page} edition={edition} editable renderSlot={renderSlot} />);
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
