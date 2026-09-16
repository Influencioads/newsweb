import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import { useAuth } from '@/stores/auth';

import App from './App';

function renderApp(path: string) {
  // enabled:false — the public layout's nav/notification queries must not hit the network here.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Smoke test for the lazy route table: an unknown path must resolve through
// Suspense to the 404 page (inside the public layout), not to a redirect.
describe('App', () => {
  afterEach(() => act(() => useAuth.setState({ me: null, status: 'idle' })));

  it('lazy-loads the 404 page for an unmatched route', async () => {
    renderApp('/no/such/page/here');
    expect(await screen.findByRole('heading', { name: 'పేజీ కనిపించలేదు' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'హోమ్‌కు వెళ్లండి' })).toHaveAttribute('href', '/');
  });

  it('keeps the staff print page behind the CMS sign-in', async () => {
    // The printable sheets must never be reachable publicly: readers may see the paper, not download it.
    useAuth.setState({ me: null, status: 'anonymous' });
    renderApp('/admin/epaper/2026-09-15/print');
    expect(await screen.findByRole('heading', { name: 'CMS లాగిన్' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save as PDF|PDFగా/ })).toBeNull();
  });
});
