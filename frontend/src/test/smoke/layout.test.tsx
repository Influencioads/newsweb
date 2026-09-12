import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import * as publicApi from '@/features/public/api';
import PublicLayout from '@/layouts/PublicLayout';
import Home from '@/pages/public/Home';

// Hoisted so the vi.mock factories (which run before module body) can see it.
const { never } = vi.hoisted(() => ({ never: () => new Promise<never>(() => {}) }));

vi.mock('@/features/public/api', () => ({
  fetchSiteConfig: vi.fn(async () => ({
    site_name_te: 'టాప్ తెలుగు న్యూస్',
    site_name_en: 'Top Telugu News',
    categories: [
      { slug: 'politics', name_te: 'రాజకీయాలు', name_en: 'Politics', show_in_nav: true },
      { slug: 'hidden', name_te: 'దాచినది', name_en: 'Hidden', show_in_nav: false },
    ],
    states: [{ code: 'AP', slug: 'andhra-pradesh', name_te: 'ఆంధ్రప్రదేశ్', name_en: 'Andhra Pradesh' }],
    districts: [{ slug: 'guntur', name_te: 'గుంటూరు', name_en: 'Guntur', state: 'AP' }],
  })),
  fetchBreaking: vi.fn(async () => []),
  fetchHome: vi.fn(never),
  fetchVideos: vi.fn(never),
}));

vi.mock('@/features/engagement/notificationsApi', () => ({
  fetchInbox: vi.fn(async () => ({ unread: 0, items: [], next_offset: null })),
  markRead: vi.fn(async () => {}),
}));

function Providers({ children, path = '/' }: { children: ReactNode; path?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Anything that bypasses the mocked feature modules stays pending instead of hitting the network.
  vi.spyOn(api, 'get').mockImplementation(never);
  vi.spyOn(api, 'post').mockImplementation(never);
});

describe('PublicLayout', () => {
  it('renders the shell: skip link, sections nav fed by the site config, one main landmark', async () => {
    render(
      <Providers>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<p>page body</p>} />
          </Route>
        </Routes>
      </Providers>,
    );
    expect(screen.getByRole('link', { name: 'ప్రధాన కంటెంట్‌కు వెళ్లండి' })).toHaveAttribute('href', '#main');

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(within(main).getByText('page body')).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'విభాగాలు' });
    expect(within(nav).getByRole('link', { name: 'హోమ్' })).toHaveAttribute('aria-current', 'page');
    expect(publicApi.fetchSiteConfig).toHaveBeenCalled();
    expect(await within(nav).findByRole('link', { name: 'రాజకీయాలు' })).toHaveAttribute('href', '/section/politics');
    expect(screen.queryByText('దాచినది')).toBeNull();
  });
});

describe('Home', () => {
  it('announces a loading status while the home query is pending', () => {
    render(
      <Providers>
        <Home />
      </Providers>,
    );
    expect(publicApi.fetchHome).toHaveBeenCalled();
    expect(screen.getAllByRole('status').some((el) => /లోడ్/.test(el.textContent ?? ''))).toBe(true);
  });
});
