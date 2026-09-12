import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, Search } from 'lucide-react';

import { IconButton, IconButtonLink } from '@/components/ui/Button';
import { ChipRail } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { prefersReducedMotion, useScrolled } from '@/utils/motion';

import { NavDrawer, SHORTCUTS, useSiteConfig } from './NavDrawer';

/**
 * CategoryNav — row 2 of the reader shell and its only sticky part.
 *
 * Menu (under md) · rail of NavLinks (Home, shortcuts, DB categories) with one
 * sliding brand underline · Search. The nav measures its own height and
 * publishes it as `--header-h`, which every other sticky surface offsets by.
 * On route change the active link is scrolled into view inside the rail only —
 * the window never moves.
 */

const LINK =
  'relative flex min-h-tap shrink-0 snap-start items-center gap-1.5 whitespace-nowrap px-3 font-semibold ' +
  'transition-[colors,transform,box-shadow] duration-base ease-standard';

/** Telugu labels get the 15.5px body size (the ticker's floor), Latin the 14px UI size. */
function linkClass(active: boolean, font: string, telugu: boolean): string {
  return cn(
    LINK,
    font,
    telugu ? 'text-te-body-xs' : 'text-ui',
    active ? 'font-bold text-brand' : 'text-ink hover:text-brand',
  );
}

interface Bar {
  left: number;
  width: number;
}

export function CategoryNav() {
  const { t, pick } = useI18n();
  const s = useScript();
  const { pathname } = useLocation();
  const { data: config } = useSiteConfig();
  const scrolled = useScrolled(8);
  const [drawer, setDrawer] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<Bar | null>(null);
  // First measurement snaps; later ones glide. Also gates the smooth scroll.
  const first = useRef(true);

  const categories = config?.categories.filter((c) => c.show_in_nav) ?? [];

  // Publish the sticky height for anything that sticks below the header.
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = useCallback(() => {
    const root = rail.current;
    const active = root?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!root || !active) {
      setBar(null);
      return;
    }
    setBar({ left: active.offsetLeft, width: active.offsetWidth });
  }, []);

  // Font loads and late categories move the links; keep the underline on them.
  useEffect(() => {
    const root = rail.current;
    if (!root) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    measure();
    const root = rail.current;
    const active = root?.querySelector<HTMLElement>('a[aria-current="page"]');
    // ChipRail's scroll container is its role="group" track.
    const track = root?.closest<HTMLElement>('[role="group"]');
    if (root && active && track) {
      track.scrollTo({
        left: root.offsetLeft + active.offsetLeft - (track.clientWidth - active.offsetWidth) / 2,
        behavior: first.current || prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    first.current = false;
  }, [measure, pathname, categories.length]);

  return (
    <nav
      ref={nav}
      aria-label={t('nav.sections')}
      className={cn(
        'sticky top-0 z-header border-b transition-[colors,box-shadow] duration-base ease-standard',
        // Opaque paper at rest; glass once content scrolls under it. The border
        // stays in the box (no 1px height jump) and goes transparent while
        // shadow-header draws its own rule line.
        scrolled ? 'glass border-transparent shadow-header' : 'border-rule bg-paper',
      )}
    >
      <PageContainer width="site" className="flex items-center gap-1">
        <IconButton
          icon={Menu}
          label={t('ui.openMenu')}
          aria-haspopup="dialog"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
          className="md:hidden"
        />

        {/* The enclosing <nav> already carries the "sections" name; the rail
            takes a distinct one so readers never hear it twice. */}
        <ChipRail ariaLabel={t('ui.explore')} snap fadeEdges itemGap="gap-0" className="min-w-0 flex-1">
          {/* A real list ("list, N items" for screen readers); `contents` keeps
              each link a direct flex item so offsetLeft is measured from the
              positioned wrapper, which also hosts the underline. */}
          <div ref={rail} className="relative">
            <ul className="flex">
              <li className="contents">
                <NavLink to="/" end className={({ isActive }) => linkClass(isActive, s.body, s.te)}>
                  {t('nav.home')}
                </NavLink>
              </li>
              {SHORTCUTS.map((sc) => (
                <li key={sc.to} className="contents">
                  <NavLink to={sc.to} className={({ isActive }) => linkClass(isActive, s.body, s.te)}>
                    {sc.live && <Icon icon={sc.icon} size="sm" className="text-breaking" />}
                    {t(sc.key)}
                  </NavLink>
                </li>
              ))}
              {categories.map((c) => {
                const f = s.forText(c.name_te, c.name_en);
                return (
                  <li key={c.slug} className="contents">
                    <NavLink
                      to={`/section/${c.slug}`}
                      lang={f.lang}
                      className={({ isActive }) => linkClass(isActive, f.cls, f.telugu)}
                    >
                      {pick(c.name_te, c.name_en)}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
            {/* The one active underline. Mounted only once measured, so it never slides in from zero. */}
            {bar && (
              <span
                aria-hidden
                style={{ left: bar.left, width: bar.width }}
                className="absolute -bottom-1 h-[3px] rounded-pill bg-brand transition-[left,width] duration-base ease-emphasized"
              />
            )}
          </div>
        </ChipRail>

        <IconButtonLink icon={Search} label={t('nav.search')} to="/search" />
      </PageContainer>

      <NavDrawer open={drawer} onClose={() => setDrawer(false)} />
    </nav>
  );
}
