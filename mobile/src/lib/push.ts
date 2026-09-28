import { useQueryClient } from '@tanstack/react-query';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import * as notificationsApi from '@/api/notifications';
import { useAuth } from '@/stores/auth';
import { usePrefs } from '@/stores/prefs';

/**
 * Push notifications (§13) through Expo's push service.
 *
 * Every install registers its token — signed in or not, because most readers
 * never sign in — with the district chosen on the phone, which is how district
 * and local pushes find it. The server does the sending; this file registers
 * and routes taps.
 *
 * Remote push needs a real build (the EAS APK, with google-services.json).
 * Expo Go on Android dropped it in SDK 53 and warns on import, so the module
 * is only loaded where it can work.
 */
type NotificationsModule = typeof import('expo-notifications');
const Notifications: NotificationsModule | null =
  Platform.OS === 'web' || isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-notifications');

let tokenPromise: Promise<string | null> | null = null;

/** Permission and token, once per app run. A refusal is not asked again until the next launch. */
function expoToken(): Promise<string | null> {
  const N = Notifications;
  if (!N) return Promise.resolve(null);
  tokenPromise ??= (async () => {
    if (Platform.OS === 'android') {
      // Android 13+ only shows the permission prompt once a channel exists.
      await N.setNotificationChannelAsync('default', {
        name: 'వార్తా అలర్ట్‌లు',
        importance: N.AndroidImportance.HIGH,
      });
    }
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await N.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    return (await N.getExpoPushTokenAsync({ projectId })).data;
  })().catch(() => {
    // Offline or no Play services: let the next trigger try again.
    tokenPromise = null;
    return null;
  });
  return tokenPromise;
}

/** Tell the server this install exists, and which district it reads. Never throws. */
export async function registerForPush(districtSlug: string | null): Promise<void> {
  try {
    const token = await expoToken();
    if (token) await notificationsApi.registerDevice(token, Platform.OS, districtSlug);
  } catch {
    // Best effort: the inbox works without push, and the next launch retries.
  }
}

type PushData = { short_id?: string | null; campaign_id?: number | null };
let lastHandled: string | null = null;

function openFromPush(response: NotificationResponse, refreshInbox: () => void): void {
  // A cold-start tap is reported both as the last response and to the listener.
  const id = response.notification.request.identifier;
  if (id === lastHandled) return;
  lastHandled = id;
  const data = (response.notification.request.content.data ?? {}) as PushData;
  if (data.campaign_id) notificationsApi.pushOpened(data.campaign_id).catch(() => undefined);
  refreshInbox();
  if (data.short_id) router.push({ pathname: '/article/[shortId]', params: { shortId: data.short_id } });
}

/**
 * Rendered once inside the query provider, after the navigator: registers on
 * sign-in, sign-out and a district change, shows pushes that arrive while the
 * app is open, and opens the story a tapped push points at.
 */
export function PushBridge(): null {
  const status = useAuth((s) => s.status);
  const edition = usePrefs((s) => s.edition);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Re-registering on sign-out hands the token back to anonymous.
    if (status === 'authenticated' || status === 'anonymous') void registerForPush(edition);
  }, [status, edition]);

  useEffect(() => {
    const N = Notifications;
    if (!N) return;
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    const refreshInbox = () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    };
    // A tap that launched the app happened before this listener existed.
    const launch = N.getLastNotificationResponse();
    if (launch) openFromPush(launch, refreshInbox);
    const tapped = N.addNotificationResponseReceivedListener((r) => openFromPush(r, refreshInbox));
    const received = N.addNotificationReceivedListener(refreshInbox);
    return () => {
      tapped.remove();
      received.remove();
    };
  }, [queryClient]);

  return null;
}
