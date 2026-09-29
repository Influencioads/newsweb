import { api } from './client';

/** Reader notifications API (§13). */

export type NotificationKind = 'breaking' | 'local' | 'topic' | 'system';

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  title_te: string;
  body_te: string | null;
  article_url: string | null;
  /** The story to open. Never parse it out of article_url: ids may contain '-'. */
  short_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Inbox {
  unread: number;
  items: NotificationItem[];
  next_offset: number | null;
}

export async function fetchInbox(offset = 0): Promise<Inbox> {
  const { data } = await api.get<Inbox>('/users/me/notifications', {
    params: { offset, limit: 20 },
  });
  return data;
}

export async function markRead(): Promise<void> {
  await api.post('/users/me/notifications/read', { ids: null });
}

/** Signed in or not: the server ties the token to whoever is signed in now. */
export async function registerDevice(
  token: string,
  platform: string,
  districtSlug: string | null,
): Promise<void> {
  await api.post('/users/me/devices', { token, platform, district_slug: districtSlug });
}

/** A push was tapped — feeds the "opened" count in the admin log. */
export async function pushOpened(campaignId: number): Promise<void> {
  await api.post(`/notifications/${campaignId}/opened`);
}
