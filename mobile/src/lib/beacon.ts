import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { api } from '@/api/client';

/**
 * Reader-behaviour beacon (§3.1) — RN edition. Events queue locally and flush
 * in small batches; the app-state listener flushes when the app backgrounds,
 * which is the mobile equivalent of the web's pagehide.
 */

type BeaconType = 'view' | 'read' | 'scroll' | 'share' | 'not_interested';

interface BeaconEvent {
  short_id: string;
  type: BeaconType;
  value?: number;
}

const ANON_KEY = 'tn.anon_id';
let cachedAnonId: string | null = null;

async function anonId(): Promise<string> {
  if (cachedAnonId) return cachedAnonId;
  try {
    let id = await AsyncStorage.getItem(ANON_KEY);
    if (!id) {
      id = `rn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(ANON_KEY, id);
    }
    cachedAnonId = id;
    return id;
  } catch {
    cachedAnonId = 'rn-no-storage';
    return cachedAnonId;
  }
}

let queue: BeaconEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function doFlush(): Promise<void> {
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  try {
    await api.post('/public/events', { anon_id: await anonId(), events });
  } catch {
    /* analytics loss is acceptable; reading is not */
  }
}

export function track(event: BeaconEvent, immediate = false): void {
  queue.push(event);
  if (immediate) {
    void doFlush();
    return;
  }
  if (flushTimer == null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void doFlush();
    }, 5000);
  }
}

export function trackShare(shortId: string): void {
  track({ short_id: shortId, type: 'share' }, true);
}

const viewedThisLaunch = new Set<string>();

/**
 * Article-screen hook. Pass scroll progress via the returned `onScrollPct` from
 * the screen's ScrollView; the deepest value reports on unmount/background.
 */
export function useReadingBeacon(shortId: string | undefined): (pct: number) => void {
  const maxScroll = useRef(0);

  useEffect(() => {
    if (!shortId) return;

    if (!viewedThisLaunch.has(shortId)) {
      viewedThisLaunch.add(shortId);
      track({ short_id: shortId, type: 'view' }, true);
    }

    const heartbeat = setInterval(() => {
      if (AppState.currentState === 'active') {
        track({ short_id: shortId, type: 'read', value: 15 });
      }
    }, 15_000);

    const flushProgress = () => {
      if (maxScroll.current > 0) {
        track({ short_id: shortId, type: 'scroll', value: maxScroll.current });
      }
      void doFlush();
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushProgress();
    });

    return () => {
      clearInterval(heartbeat);
      sub.remove();
      flushProgress();
    };
  }, [shortId]);

  return (pct: number) => {
    maxScroll.current = Math.max(maxScroll.current, Math.min(Math.round(pct), 100));
  };
}
