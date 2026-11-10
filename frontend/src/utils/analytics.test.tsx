import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePageViews } from './analytics';

type DL = Window & { dataLayer?: Record<string, unknown>[] };

let go: (to: string) => void = () => undefined;
function Probe() {
  usePageViews();
  go = useNavigate();
  return null;
}

afterEach(() => {
  delete (window as DL).dataLayer;
  vi.useRealTimers();
});

describe('usePageViews', () => {
  it('pushes a virtual page view on route changes, not on the first load or in the CMS', () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={['/']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Probe />
      </MemoryRouter>,
    );
    act(() => vi.advanceTimersByTime(500));
    expect((window as DL).dataLayer ?? []).toHaveLength(0);

    act(() => go('/radio/morning-mantra'));
    act(() => vi.advanceTimersByTime(500));
    expect((window as DL).dataLayer).toEqual([
      expect.objectContaining({ event: 'virtual_pageview', page_path: '/radio/morning-mantra' }),
    ]);

    act(() => go('/admin/dashboard'));
    act(() => vi.advanceTimersByTime(500));
    expect((window as DL).dataLayer).toHaveLength(1);
  });
});
