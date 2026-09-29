import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '@/features/epaper/api';
import { useLanguage } from '@/i18n';
import type { EpaperEdition } from '@/types/epaper';

import { EpaperDatePicker } from './EpaperDatePicker';

vi.mock('@/features/epaper/api', () => ({ fetchEpaperArchive: vi.fn() }));

const issue = (edition_date: string): EpaperEdition => ({
  id: 1,
  title: 'ఎడిషన్',
  edition_date,
  edition_type: 'DAILY',
  status: 'PUBLISHED',
  revision: 1,
  page_count: 4,
  pdf_url: null,
  pdf_status: null,
  pdf_error: null,
  audio_enabled: false,
  published_at: null,
  pages: [],
});

describe('EpaperDatePicker', () => {
  beforeEach(() => {
    // Only the clock is faked, so userEvent's own timers keep running.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 16, 9));
    vi.mocked(api.fetchEpaperArchive).mockResolvedValue({ items: [issue('2026-09-15'), issue('2026-09-14'), issue('2026-08-30')] });
    act(() => useLanguage.setState({ language: 'en' }));
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => useLanguage.setState({ language: 'te' }));
  });

  it('marks the published days as links, dims the rest, and pages through months', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EpaperDatePicker current="2026-09-15" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: '15 September 2026' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Pick an edition');
    expect(api.fetchEpaperArchive).toHaveBeenCalledWith(365);

    // Quick list: no edition today (dimmed text), yesterday is a link, then the other days.
    expect(await screen.findByRole('link', { name: 'Yesterday' })).toHaveAttribute('href', '/epaper/2026-09-15');
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Monday · 14 September 2026' })).toHaveAttribute('href', '/epaper/2026-09-14');

    // The grid: Monday first, published days linked, today ringed but not linked, the open date current.
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('M');
    expect(screen.getByRole('link', { name: '14 September 2026' })).toHaveAttribute('href', '/epaper/2026-09-14');
    expect(screen.getByRole('link', { name: '15 September 2026' })).toHaveAttribute('aria-current', 'date');
    expect(screen.queryByRole('link', { name: /13 September 2026/ })).toBeNull();
    expect(screen.getByLabelText('16 September 2026 · Today')).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '30 August 2026' })).toHaveAttribute('href', '/epaper/2026-08-30');
    expect(screen.queryByRole('link', { name: '14 September 2026' })).toBeNull();
  });
});
