import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { BreakingTicker } from './BreakingTicker';

describe('BreakingTicker', () => {
  it('uses a red gradient band when breaking news is present', () => {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
    client.setQueryData(['public', 'breaking'], [{
      short_id: 'one', title_te: 'తాజా వార్త', title_en: null, url: '/news/one', published_at: null,
    }]);
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter><BreakingTicker /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.firstElementChild).toHaveClass('breaking-gradient-band');
    expect(screen.getByRole('link', { name: 'తాజా వార్త' })).toHaveAttribute('href', '/news/one');
  });
});
