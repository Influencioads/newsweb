import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArticleCard } from '@/types/public';

vi.mock('@/features/public/api', () => ({
  fetchFeed: vi.fn(async () => ({
    category: null,
    district: null,
    next_cursor: null,
    articles: [{ short_id: 'a1', title_te: 'స్ఫూర్తి కథ', summary_te: 'వివరాలు' } as ArticleCard],
  })),
}));

import { WowRadio } from './WowRadio';

const speak = vi.fn();

beforeEach(() => {
  speak.mockReset();
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [{ lang: 'te-IN' }],
      speak,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('WowRadio home card', () => {
  it('plays a segment right on the card when its play button is pressed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <WowRadio />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ప్లే · స్ఫూర్తి' }));
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    expect((speak.mock.calls[0]![0] as { text: string }).text).toContain('స్ఫూర్తి కథ');
    expect(await screen.findByRole('button', { name: 'ఆపు · స్ఫూర్తి' })).toBeInTheDocument();
    // The name still opens the segment's own page.
    expect(screen.getByRole('link', { name: /స్ఫూర్తి/ })).toHaveAttribute('href', '/radio/spoorthi');
  });
});
