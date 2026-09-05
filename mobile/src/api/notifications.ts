import { api } from './client';

/** Reader notifications API (§13). */

export type NotificationKind = 'breaking' | 'local' | 'topic' | 'system';

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  title_te: string;
  body_te: string | null;
  article_url: string | null;
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
