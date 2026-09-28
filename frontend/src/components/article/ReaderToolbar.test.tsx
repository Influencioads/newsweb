import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReaderToolbar } from './ReaderToolbar';

/**
 * The bottom bar publishes the height it really occupies as `--bottom-bar-h`,
 * which the audio player dock rides on — so while focus keeps the bar up
 * (a tap on listen focuses it too), the dock must not drop under it.
 */

function scrollTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

afterEach(() => {
  scrollTo(0);
  vi.restoreAllMocks();
});

describe('ReaderToolbar', () => {
  it('keeps its height published while focus is inside, even scrolled away', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(56);
    render(<ReaderToolbar article={{ short_id: 'abc' }} onShare={() => {}} onListen={() => {}} />);
    const bar = () => document.documentElement.style.getPropertyValue('--bottom-bar-h');
    expect(bar()).toBe('56px');

    scrollTo(400);
    expect(bar()).toBe('0px');

    // The bottom bar comes first in the DOM; the md+ inline row repeats the actions.
    const listen = screen.getAllByRole('button', { name: 'వినండి' })[0]!;
    act(() => listen.focus());
    expect(bar()).toBe('56px');
    expect(listen.closest('.fixed')).not.toHaveClass('translate-y-full');

    act(() => listen.blur());
    expect(bar()).toBe('0px');
  });
});
