import {
  BarChart3,
  Bell,
  ClipboardCheck,
  Clock,
  FileText,
  Image,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Megaphone,
  Mic,
  Newspaper,
  Pin,
  Radio,
  Rss,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  TrendingUp,
  UserCheck,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

import type { StringKey } from '@/i18n';
import type { PermissionKey } from '@/types/auth';

/**
 * CMS navigation registry — the one list the sidebar, the mobile drawer and
 * the breadcrumb read from.
 *
 * Entries are permission-gated so a stringer never sees an approval queue
 * they cannot use; `visibleAdminNav(can)` applies the gate and drops groups
 * that end up empty. Nothing here links to a screen that does not exist.
 */
export interface AdminNavItem {
  to: string;
  labelKey: StringKey;
  icon: LucideIcon;
  permission?: PermissionKey;
  /** Path prefix that counts as "this page" (active state, breadcrumb); defaults to `to`. */
  match?: string;
}

export interface AdminNavGroup {
  key: string;
  labelKey: StringKey;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    key: 'newsroom',
    labelKey: 'admin.group.newsroom',
    items: [
      { to: '/admin/dashboard', labelKey: 'admin.page.dashboard', icon: LayoutDashboard },
      { to: '/admin/articles', labelKey: 'admin.page.articles', icon: FileText, match: '/admin/articles' },
    ],
  },
  {
    key: 'review',
    labelKey: 'admin.group.review',
    items: [
      { to: '/admin/review', labelKey: 'admin.page.review', icon: ClipboardCheck, permission: 'article.review' },
      { to: '/admin/pending', labelKey: 'admin.page.pending', icon: Clock, permission: 'article.review' },
      { to: '/admin/ai', labelKey: 'admin.page.ai', icon: Sparkles, permission: 'ai.use' },
      { to: '/admin/moderation', labelKey: 'admin.page.moderation', icon: ShieldCheck, permission: 'comment.moderate' },
      { to: '/admin/kyc', labelKey: 'admin.page.kyc', icon: UserCheck, permission: 'kyc.review' },
    ],
  },
  {
    key: 'content',
    labelKey: 'admin.group.content',
    items: [
      { to: '/admin/sources', labelKey: 'admin.page.sources', icon: Rss, permission: 'article.review' },
      { to: '/admin/taxonomy', labelKey: 'admin.page.taxonomy', icon: Tags, permission: 'taxonomy.view' },
      { to: '/admin/media', labelKey: 'admin.page.media', icon: Image, permission: 'media.view' },
      { to: '/admin/videos', labelKey: 'admin.page.videos', icon: Video, permission: 'video.view' },
      { to: '/admin/bulletins', labelKey: 'admin.page.bulletins', icon: Radio, permission: 'voice.manage' },
      { to: '/admin/voice', labelKey: 'admin.page.voice', icon: Mic, permission: 'voice.manage' },
    ],
  },
  {
    key: 'audience',
    labelKey: 'admin.group.audience',
    items: [
      { to: '/admin/trending', labelKey: 'admin.page.trending', icon: TrendingUp, permission: 'dashboard.view' },
      { to: '/admin/pins', labelKey: 'admin.page.pins', icon: Pin, permission: 'article.publish' },
      { to: '/admin/notifications', labelKey: 'admin.page.notifications', icon: Bell, permission: 'push.create' },
      { to: '/admin/analytics', labelKey: 'admin.page.analytics', icon: BarChart3, permission: 'analytics.view' },
      { to: '/admin/polls', labelKey: 'admin.page.polls', icon: ListChecks, permission: 'article.view' },
    ],
  },
  {
    key: 'publishing',
    labelKey: 'admin.group.publishing',
    items: [
      { to: '/admin/epaper', labelKey: 'admin.page.epaper', icon: Newspaper, permission: 'epaper.view' },
      { to: '/admin/homepage', labelKey: 'admin.page.homepage', icon: LayoutGrid, permission: 'settings.manage' },
      { to: '/admin/ads', labelKey: 'admin.page.ads', icon: Megaphone, permission: 'ads.manage' },
    ],
  },
  {
    key: 'settings',
    labelKey: 'admin.group.settings',
    items: [
      { to: '/admin/users', labelKey: 'admin.page.users', icon: Users, permission: 'user.view' },
      { to: '/admin/roles', labelKey: 'admin.page.roles', icon: KeyRound, permission: 'role.view' },
      { to: '/admin/audit', labelKey: 'admin.page.audit', icon: ScrollText, permission: 'audit.view' },
      { to: '/admin/settings', labelKey: 'admin.page.settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

/**
 * The nav entry a pathname belongs to — longest matching prefix wins, so
 * `/admin/articles/new` and `/admin/articles/42/edit` both resolve to Articles.
 */
export function findAdminNav(pathname: string): { group: AdminNavGroup; item: AdminNavItem } | null {
  let best: { group: AdminNavGroup; item: AdminNavItem } | null = null;
  let bestLength = 0;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      const prefix = item.match ?? item.to;
      const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (hit && prefix.length > bestLength) {
        best = { group, item };
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** Groups filtered by permission; groups with no visible item are dropped. */
export function visibleAdminNav(can: (permission: PermissionKey) => boolean): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);
}
