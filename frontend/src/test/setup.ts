import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * jsdom has no layout engine and no observers. These stubs let the primitives
 * (ChipRail, Tabs, useReveal, Dialog focus trap, ScrollToTop) mount without
 * branching on `typeof X === 'undefined'` in production code.
 */

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): never[] {
    return [];
  }
}

vi.stubGlobal('ResizeObserver', NoopObserver);
vi.stubGlobal('IntersectionObserver', NoopObserver);
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
}));

window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
Element.prototype.scrollBy = () => {};
Element.prototype.scrollTo = () => {};

// The focus trap treats `offsetParent === null` as hidden; in jsdom that is
// every element. Attached elements count as visible here.
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement;
  },
});
