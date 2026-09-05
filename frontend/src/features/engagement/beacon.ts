import { useEffect } from 'react';

import { API_BASE, getAccessToken } from '@/api/client';

/**
 * Reader-behaviour beacon (§3.1) — the client half of `POST /public/events`.
 *
 * Analytics must never block reading (§31): events queue locally and flush
 * with `fetch(..., { keepalive: true })`, which survives navigation the way
 * `sendBeacon` does while still carrying the Authorization header so a
 * signed-in reader's history attributes correctly.
 */

type BeaconType = 'view' | 'read' | 'scroll' | 'share' | 'not_interested';

interface BeaconEvent {
  short_id: string;
  type: BeaconType;
  value?: number;
}

const ANON_KEY = 'tn.anon_id';

export function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

let queue: BeaconEvent[] = [];
let flushTimer: number | null = null;

function doFlush(): void {
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  const token = getAccessToken();
  void fetch(`${API_BASE}/public/events`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ anon_id: anonId(), events }),
  }).catch(() => {
    /* analytics loss is acceptable; reader experience is not */
  });
}

export function track(event: BeaconEvent, immediate = false): void {
  queue.push(event);
  if (immediate) {
    doFlush();
    return;
  }
  if (flushTimer == null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      doFlush();
    }, 5000);
  }
}

export function trackShare(shortId: string): void {
  track({ short_id: shortId, type: 'share' }, true);
}

// StrictMode double-mounts effects in development; one VIEW per article per
// page load keeps the dev numbers honest (the server dedupes per day anyway).
const viewedThisLoad = new Set<string>();

/**
 * Article-page hook: logs the view, heartbeats reading time every 15 s while
 * the tab is visible, and reports the deepest scroll on exit.
 */
export function useReadingBeacon(shortId: string | undefined): void {
  useEffect(() => {
    if (!shortId) return;

    if (!viewedThisLoad.has(shortId)) {
      viewedThisLoad.add(shortId);
      track({ short_id: shortId, type: 'view' }, true);
    }

    let maxScroll = 0;
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const pct = Math.round(((window.scrollY + 0.5) / scrollable) * 100);
      maxScroll = Math.max(maxScroll, Math.min(pct, 100));
    };

    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        track({ short_id: shortId, type: 'read', value: 15 });
      }
    }, 15_000);

    const onLeave = () => {
      if (maxScroll > 0) track({ short_id: shortId, type: 'scroll', value: maxScroll });
      doFlush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onLeave();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      onLeave();
    };
  }, [shortId]);
}
