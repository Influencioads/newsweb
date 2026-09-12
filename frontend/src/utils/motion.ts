import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Motion helpers.
 *
 * CSS owns the keyframes and the reduced-motion override (assets/index.css);
 * this file only gates the JS-driven pieces (IntersectionObserver reveals,
 * smooth scrolling, View Transitions) behind the same OS preference.
 *
 *     const reveal = useReveal<HTMLLIElement>();
 *     <li ref={reveal}>…</li>            // adds .reveal, then .is-visible on entry
 *     const scrolled = useScrolled();    // header shadow after 8px
 *     const hidden = useHideOnScroll();  // bottom bar hides on scroll-down
 */

const SITE_TITLE = 'టాప్ తెలుగు న్యూస్';
const DEFAULT_TITLE = 'టాప్ తెలుగు న్యూస్ · Top Telugu News';

/** True when the OS asks for reduced motion (or there is no window). */
export function prefersReducedMotion(): boolean {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface RevealOptions {
  /** ms between consecutive elements that enter the viewport together. */
  stagger?: number;
  /** Highest stagger slot; later elements in a batch share this delay. */
  max?: number;
  rootMargin?: string;
}

/* ---------------------------------------------------------------------------
 * Reveal-on-scroll.
 *
 * ONE module-level observer for the whole app rather than one per component.
 * A per-component observer is fragile: it is created inside a ref callback, so
 * a StrictMode remount (or any unmount that races the callback) can leave the
 * live DOM nodes observed by an instance nobody holds any more — and because
 * arming an element sets `opacity: 0`, a missed callback does not degrade the
 * animation, it hides the content. That is exactly what happened: 57 of 62
 * cards on the home page stayed invisible.
 *
 * So this is built to fail safe:
 *   1. one shared observer, independent of any component lifetime;
 *   2. anything already at or above the fold when it is attached reveals
 *      immediately, with no delay and no animation;
 *   3. a passive scroll/resize backstop flushes anything in view that the
 *      observer did not report, and stops listening once nothing is armed.
 * Content can therefore never be left stuck at opacity 0.
 * ------------------------------------------------------------------------- */

const REVEAL_ROOT_MARGIN = '0px 0px -10% 0px';

/** Elements armed (class `reveal`, opacity 0) and still waiting to be shown. */
const armed = new Set<Element>();
let revealObserver: IntersectionObserver | null = null;
let backstopBound = false;
let backstopFrame = 0;
let backstopTimer = 0;

function show(el: Element, delayMs = 0): void {
  if (!armed.delete(el)) return;
  (el as HTMLElement).style.setProperty('--reveal-delay', `${delayMs}ms`);
  el.classList.add('is-visible');
  revealObserver?.unobserve(el);
}

/** Reveal everything currently inside the viewport. Cheap: only armed nodes. */
function flushVisible(): void {
  if (!armed.size) return;
  const limit = window.innerHeight || 0;
  for (const el of [...armed]) {
    const rect = el.getBoundingClientRect();
    if (rect.top < limit && rect.bottom > 0) show(el);
  }
  if (!armed.size) unbindBackstop();
}

function onBackstop(): void {
  if (backstopFrame) return;
  // rAF coalesces the common case to one flush per frame; the timer is the
  // guarantee, because a backgrounded or throttled tab may never run rAF at
  // all and armed content must not stay invisible waiting for it.
  const done = () => {
    if (!backstopFrame) return;
    window.cancelAnimationFrame(backstopFrame);
    window.clearTimeout(backstopTimer);
    backstopFrame = 0;
    flushVisible();
  };
  backstopFrame = window.requestAnimationFrame(done);
  backstopTimer = window.setTimeout(done, 120);
}

function bindBackstop(): void {
  if (backstopBound) return;
  backstopBound = true;
  window.addEventListener('scroll', onBackstop, { passive: true });
  window.addEventListener('resize', onBackstop, { passive: true });
  // A hidden tab throttles rAF, so a scroll that happened while the page was in
  // the background can leave content armed. Flush directly when it comes back.
  document.addEventListener('visibilitychange', flushVisible);
  window.addEventListener('pageshow', flushVisible);
}

function unbindBackstop(): void {
  if (!backstopBound) return;
  backstopBound = false;
  window.removeEventListener('scroll', onBackstop);
  window.removeEventListener('resize', onBackstop);
  document.removeEventListener('visibilitychange', flushVisible);
  window.removeEventListener('pageshow', flushVisible);
}

function getObserver(stagger: number, max: number): IntersectionObserver {
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      let slot = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target, Math.min(slot++, max) * stagger);
      }
      if (!armed.size) unbindBackstop();
    },
    { rootMargin: REVEAL_ROOT_MARGIN },
  );
  return revealObserver;
}

/**
 * Reveal-on-scroll. Returns a ref callback; attach it to any element and it
 * fades and rises in the first time it enters the viewport. Elements delivered
 * in one observer callback share a batch and stagger. Reduced motion (or a
 * browser without IntersectionObserver) leaves the element plainly visible.
 */
export function useReveal<T extends HTMLElement>(opts: RevealOptions = {}): (el: T | null) => void {
  const { stagger = 40, max = 6 } = opts;

  return useCallback(
    (el: T | null) => {
      if (!el) return;
      if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
      if (el.classList.contains('is-visible') || armed.has(el)) return;

      el.classList.add('reveal');
      armed.add(el);

      // Already on screen (first paint, a restored scroll position, a short
      // page): show it straight away rather than waiting for a scroll that may
      // never come.
      const rect = el.getBoundingClientRect();
      if (rect.top < (window.innerHeight || 0) && rect.bottom > 0) {
        show(el);
        return;
      }

      getObserver(stagger, max).observe(el);
      bindBackstop();
    },
    [stagger, max],
  );
}

/** True once the page is scrolled past `threshold` px. */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > threshold);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

export interface HideOnScrollOptions {
  /** Minimum scroll delta before the state flips (debounces jitter). */
  threshold?: number;
  /** Never hide while scrollY is below this (keeps the bar while the top is in view). */
  disabledBelow?: number;
}

/**
 * True while the reader is scrolling down (past `disabledBelow`); false again
 * as soon as they scroll up or return near the top. Drives hide-on-scroll
 * headers and bottom bars.
 */
export function useHideOnScroll(opts: HideOnScrollOptions = {}): boolean {
  const { threshold = 8, disabledBelow = 64 } = opts;
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < threshold) return;
      setHidden(delta > 0 && y > disabledBelow);
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold, disabledBelow]);
  return hidden;
}

/** Run `fn` inside a View Transition when the browser and the reader allow it. */
export function withViewTransition(fn: () => void): void {
  if (typeof document !== 'undefined' && 'startViewTransition' in document && !prefersReducedMotion()) {
    document.startViewTransition(fn);
    return;
  }
  fn();
}

/** `document.title` = "<title> · టాప్ తెలుగు న్యూస్", or the site default when empty. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_TITLE}` : DEFAULT_TITLE;
  }, [title]);
}

/** Scroll to the top; smooth unless the reader prefers reduced motion. */
export function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}
