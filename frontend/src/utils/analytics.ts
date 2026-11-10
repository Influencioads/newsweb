import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Google Tag Manager (index.html loads the containers) sees the first page
 * load as `gtm.js`. Moving between pages inside the app does not reload, so
 * each later route change is pushed to the same dataLayer as
 * `virtual_pageview` — a trigger in GTM can send it on as a page view. The
 * CMS (/admin) is staff-only and is not reported.
 */
type DataLayerWindow = Window & { dataLayer?: Record<string, unknown>[] };

export function trackPageView(path: string, title: string): void {
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({
    event: 'virtual_pageview',
    page_path: path,
    page_location: window.location.href,
    page_title: title,
  });
}

/** Push a page view on every in-app route change after the first load. */
export function usePageViews(): void {
  const { pathname, search } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      // The first load is already counted by the containers' own gtm.js event.
      first.current = false;
      return undefined;
    }
    if (pathname.startsWith('/admin')) return undefined;
    // Wait for the new page to set its <title> (useDocumentTitle runs in an effect).
    const id = window.setTimeout(() => trackPageView(pathname + search, document.title), 300);
    return () => window.clearTimeout(id);
  }, [pathname, search]);
}
