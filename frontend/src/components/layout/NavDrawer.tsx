import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AudioLines, Award, GalleryVerticalEnd, LogIn, Newspaper, UserRound } from 'lucide-react';

import { Sheet } from '@/components/ui/Dialog';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { EPAPER_PUBLIC } from '@/features/epaper/api';
import * as publicApi from '@/features/public/api';
import { featuresFrom } from '@/features/wow/siteContent';
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
  /** Drawn as a filled button in the rail: `wow` orange (WOW Radio), `hero` green (Nominate). */
  highlight?: 'wow' | 'hero';
}

/**
 * Reader destinations that are not categories, in nav order. WOW Radio and
 * Nominate Your Local Hero lead as two separate orange buttons, then Story
 * Shots; the main categories that follow come from the
 * site config (the WOW categories, show_in_nav).
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { to: '/radio', key: 'ui.wowRadio', icon: AudioLines, highlight: 'wow' },
  { to: '/nominate', key: 'ui.nominate', icon: Award, highlight: 'wow' },
  { to: '/story-shots', key: 'ui.storyShots', icon: GalleryVerticalEnd },
];

/** §12.5 — Grievance Officer, correction policy and AI disclosure, live at launch. */
/** Footer "Company" column: the first five of FOOTER_LINKS. The rest are policies. */
export const ABOUT_LINK_COUNT = 5;

export const FOOTER_LINKS = [
  ['/about', 'footer.about'],
  ['/contact', 'footer.contact'],
  ['/editorial-policy', 'footer.editorial'],
  ['/corrections', 'footer.corrections'],
  ['/grievance', 'footer.grievance'],
  ['/privacy', 'footer.privacy'],
  ['/terms', 'footer.terms'],
  ['/ai-disclosure', 'footer.aiDisclosure'],
  ['/ugc-terms', 'footer.ugcTerms'],
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
  const moreFeatures = featuresFrom(config?.categories).filter((f) => !f.main);
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
          {EPAPER_PUBLIC && (
          <li>
            <NavLink to="/epaper" className={({ isActive }) => rowClass(isActive, s.body)}>
              <Icon icon={Newspaper} size="md" />
              {t('nav.epaper')}
            </NavLink>
          </li>
          )}
          {SHORTCUTS.map((sc) => (
            <li key={sc.to}>
              <NavLink
                to={sc.to}
                className={({ isActive }) =>
                  cn(
                    rowClass(isActive, s.body),
                    sc.highlight === 'wow' && !isActive && 'bg-wow-tint text-wow-deep hover:bg-wow-tint',
                    sc.highlight === 'hero' && !isActive && 'bg-hero-tint text-hero-text hover:bg-hero-tint',
                  )
                }
              >
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

        <Group title={t('ui.moreCategories')}>
          {moreFeatures.map((f) => {
            const label = s.forText(f.te, f.en);
            return (
              <li key={f.slug}>
                <NavLink to={f.to} lang={label.lang} className={({ isActive }) => rowClass(isActive, label.cls)}>
                  <Icon icon={f.icon} size="md" />
                  {pick(f.te, f.en)}
                </NavLink>
              </li>
            );
          })}
        </Group>

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
