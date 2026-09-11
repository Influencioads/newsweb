import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import App from './App';

// Smoke test for the lazy route table: an unknown path must resolve through
// Suspense to the 404 page (inside the public layout), not to a redirect.
describe('App', () => {
  it('lazy-loads the 404 page for an unmatched route', async () => {
    // enabled:false — the public layout's nav/notification queries must not hit the network here.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={['/no/such/page/here']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'పేజీ కనిపించలేదు' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'హోమ్‌కు వెళ్లండి' })).toHaveAttribute('href', '/');
  });
});
