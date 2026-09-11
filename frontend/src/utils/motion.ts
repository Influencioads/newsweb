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

/**
 * Reveal-on-scroll. Returns a ref callback; attach it to any element and it
 * fades/rises in the first time it enters the viewport. Elements delivered in
 * one observer callback share a batch and stagger; one that scrolls in alone
 * later gets no delay. No-op (element simply visible) with reduced motion or
 * without IntersectionObserver.
 *
 * Deliberately no unmount `disconnect()`: React 18 StrictMode re-runs effects
 * without re-invoking ref callbacks, so a cleanup would leave every element
 * unobserved at opacity 0. Targets are unobserved as they reveal; the
 * observer is collected with the component.
 */
export function useReveal<T extends HTMLElement>(opts: RevealOptions = {}): (el: T | null) => void {
  const { stagger = 40, max = 6, rootMargin = '0px 0px -10% 0px' } = opts;
  const observer = useRef<IntersectionObserver | null>(null);

  return useCallback(
    (el: T | null) => {
      if (!el) return; // ponytail: unmounted nodes stay observed until they are collected; harmless.
      if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
      observer.current ??= new IntersectionObserver(
        (entries, io) => {
          let slot = 0;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).style.setProperty('--reveal-delay', `${Math.min(slot++, max) * stagger}ms`);
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        },
        { rootMargin },
      );
      el.classList.add('reveal');
      observer.current.observe(el);
    },
    [stagger, max, rootMargin],
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
