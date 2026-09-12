import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Film, LogIn, MapPin, Newspaper, Radio, TrendingUp, UserRound, Video } from 'lucide-react';

import { Sheet } from '@/components/ui/Dialog';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript, type StringKey } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';

import { LanguageToggle } from './LanguageToggle';

/**
 * NavDrawer — the left sheet behind the Menu button (under md): the language
 * switch (the masthead hides its copy under md), reader shortcuts, every nav
 * category, the account row and the compliance links.
 * Closes itself on route change; focus trap / Esc / scroll lock come from Sheet.
 *
 * This file also owns the shell's shared nav data (`useSiteConfig`,
 * `SHORTCUTS`, `FOOTER_LINKS`) — it is the one layout module nothing else in
 * the shell depends on, so keeping the data here avoids an import cycle.
 *
 *     <NavDrawer open={open} onClose={() => setOpen(false)} />
 */

export function useSiteConfig() {
  return useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 5 * 60_000,
  });
}

export interface Shortcut {
  to: string;
  key: StringKey;
  icon: LucideIcon;
  /** Marks the live destination (amber Radio icon in the rail). */
  live?: boolean;
}

/** Reader destinations that are not categories, in nav order. */
export const SHORTCUTS: readonly Shortcut[] = [
  { to: '/live', key: 'ui.live', icon: Radio, live: true },
  { to: '/trending', key: 'ui.trending', icon: TrendingUp },
  { to: '/local', key: 'ui.local', icon: MapPin },
  { to: '/videos', key: 'ui.video', icon: Video },
  { to: '/short-news', key: 'ui.shorts', icon: Film },
];

/** §12.5 — Grievance Officer, correction policy and AI disclosure, live at launch. */
export const FOOTER_LINKS = [
  ['/about', 'footer.about'],
  ['/contact', 'footer.contact'],
  ['/editorial-policy', 'footer.editorial'],
  ['/corrections', 'footer.corrections'],
  ['/grievance', 'footer.grievance'],
  ['/privacy', 'footer.privacy'],
  ['/terms', 'footer.terms'],
  ['/ai-disclosure', 'footer.aiDisclosure'],
] as const;

const ROW =
  'flex min-h-tap items-center gap-3 rounded-xl px-3 font-semibold ' +
  'transition-[colors,transform,box-shadow] duration-base ease-standard active:scale-[.98]';

function rowClass(active: boolean, font: string, size = 'text-ui'): string {
  return cn(ROW, font, size, active ? 'bg-brand-tint text-brand' : 'text-ink hover:bg-rule-soft');
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const s = useScript();
  return (
    <div>
      <h3 className={cn(s.body, 'mb-1 px-3 text-meta font-semibold text-muted')}>{title}</h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

export interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function NavDrawer({ open, onClose }: NavDrawerProps) {
  const { t, pick } = useI18n();
  const s = useScript();
  const { pathname } = useLocation();
  const { data: config } = useSiteConfig();
  const authStatus = useAuth((a) => a.status);
  const me = useAuth((a) => a.me);

  // Close on navigation only — not on mount, and not when the parent re-renders.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    onClose();
  }, [pathname, onClose]);

  const categories = config?.categories.filter((c) => c.show_in_nav) ?? [];
  const authed = authStatus === 'authenticated' && me;
  // DB content: the reader's name follows its own script, not the UI language.
  const name = authed ? s.forText(me.user.name_te, me.user.name_en) : null;

  return (
    <Sheet open={open} onClose={onClose} side="left" title={t('nav.sections')}>
      <div className="space-y-6">
        <Group title={t('ui.explore')}>
          <li className="px-3 pb-2">
            <LanguageToggle />
          </li>
          <li>
            <NavLink to="/epaper" className={({ isActive }) => rowClass(isActive, s.body)}>
              <Icon icon={Newspaper} size="md" />
              {t('nav.epaper')}
            </NavLink>
          </li>
          {SHORTCUTS.map((sc) => (
            <li key={sc.to}>
              <NavLink to={sc.to} className={({ isActive }) => rowClass(isActive, s.body)}>
                <Icon icon={sc.icon} size="md" className={sc.live ? 'text-breaking' : undefined} />
                {t(sc.key)}
              </NavLink>
            </li>
          ))}
        </Group>

        {categories.length > 0 && (
          <Group title={t('ui.sections')}>
            {categories.map((c) => {
              const f = s.forText(c.name_te, c.name_en);
              return (
                <li key={c.slug}>
                  <NavLink to={`/section/${c.slug}`} lang={f.lang} className={({ isActive }) => rowClass(isActive, f.cls)}>
                    {pick(c.name_te, c.name_en)}
                  </NavLink>
                </li>
              );
            })}
          </Group>
        )}

        <ul className="border-t border-rule pt-4">
          <li>
            {authed && name ? (
              <NavLink to="/profile" lang={name.lang} className={({ isActive }) => rowClass(isActive, name.cls)}>
                <Icon icon={UserRound} size="md" />
                {pick(me.user.name_te, me.user.name_en)}
              </NavLink>
            ) : (
              <NavLink to="/login" className={({ isActive }) => rowClass(isActive, s.body)}>
                <Icon icon={LogIn} size="md" />
                {t('nav.signIn')}
              </NavLink>
            )}
          </li>
        </ul>

        <ul className="border-t border-rule pt-4">
          {FOOTER_LINKS.map(([to, key]) => (
            <li key={to}>
              <NavLink to={to} className={({ isActive }) => rowClass(isActive, s.body, 'text-ui-sm')}>
                {t(key)}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
