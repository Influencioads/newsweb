import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, Menu, Search } from 'lucide-react';

import { ButtonLink, IconButton, IconButtonLink } from '@/components/ui/Button';
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
 * Menu + Search on the left (labelled from md) · rail of NavLinks (Home,
 * shortcuts, DB categories) centred in the rest of the row while it fits, in
 * bold serif like a newspaper's section bar, with one sliding brand underline.
 * Under md the search is an icon at the right end. The nav measures its own height and
 * publishes it as `--header-h`, which every other sticky surface offsets by.
 * On route change the active link is scrolled into view inside the rail only —
 * the window never moves.
 */

const LINK =
  'relative flex min-h-tap shrink-0 snap-start items-center gap-1.5 whitespace-nowrap px-3 font-bold ' +
  'transition-[colors,transform,box-shadow] duration-base ease-standard';

/** Serif section names: Telugu at the 15.5px body size (the ticker's floor), Latin 14px, 15.5px from md. */
function linkClass(active: boolean, font: string, telugu: boolean): string {
  return cn(
    LINK,
    font,
    telugu ? 'text-te-body-xs' : 'text-ui md:text-headline-xs',
    active ? 'text-brand' : 'text-ink hover:text-brand',
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
    // The highlighted pills mark themselves active by filling; no underline.
    if (!root || !active || active.dataset.pill !== undefined) {
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
        />
        <ButtonLink to="/search" variant="ghost" size="sm" icon={Search} className={cn(s.body, 'hidden md:inline-flex')}>
          {t('nav.search')}
        </ButtonLink>

        {/* The enclosing <nav> already carries the "sections" name; the rail
            takes a distinct one so readers never hear it twice. */}
        <ChipRail ariaLabel={t('ui.explore')} snap fadeEdges center itemGap="gap-0" className="min-w-0 flex-1">
          {/* A real list ("list, N items" for screen readers); `contents` keeps
              each link a direct flex item so offsetLeft is measured from the
              positioned wrapper, which also hosts the underline. */}
          <div ref={rail} className="relative">
            <ul className="flex">
              <li className="contents">
                <NavLink to="/" end className={({ isActive }) => linkClass(isActive, s.head, s.te)}>
                  {t('nav.home')}
                </NavLink>
              </li>
              {SHORTCUTS.map((sc) => (
                <li key={sc.to} className="contents">
                  {sc.highlight ? (
                    // WOW Radio and Nominate Your Local Hero: two separate
                    // orange buttons, apart from the category links.
                    <NavLink
                      to={sc.to}
                      data-pill=""
                      className={({ isActive }) =>
                        cn(
                          'mx-1 my-1.5 flex min-h-[36px] shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 font-bold shadow-card',
                          'transition-[background-color,box-shadow] duration-base ease-standard',
                          s.body,
                          s.te ? 'text-te-body-xs' : 'text-ui',
                          sc.highlight === 'wow'
                            ? 'bg-wow-deep text-on-wow hover:bg-wow-deep/90'
                            : 'bg-hero text-on-ink hover:bg-hero/90',
                          isActive && 'ring-2 ring-ink/20 ring-offset-1',
                        )
                      }
                    >
                      <Icon icon={sc.icon} size="sm" />
                      {t(sc.key)}
                    </NavLink>
                  ) : (
                    <NavLink to={sc.to} className={({ isActive }) => linkClass(isActive, s.head, s.te)}>
                      {sc.live && <Icon icon={sc.icon} size="sm" className="text-breaking" />}
                      {t(sc.key)}
                    </NavLink>
                  )}
                </li>
              ))}
              {categories.map((c) => {
                const f = s.forText(c.name_te, c.name_en);
                return (
                  <li key={c.slug} className="contents">
                    <NavLink
                      to={`/section/${c.slug}`}
                      lang={f.lang}
                      className={({ isActive }) => linkClass(isActive, f.head, f.telugu)}
                    >
                      {pick(c.name_te, c.name_en)}
                    </NavLink>
                  </li>
                );
              })}
              <li className="contents">
                <NavLink to="/explore" className={({ isActive }) => linkClass(isActive, s.head, s.te)}>
                  <Icon icon={LayoutGrid} size="sm" />
                  {t('ui.allCategories')}
                </NavLink>
              </li>
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

        <IconButtonLink icon={Search} label={t('nav.search')} to="/search" className="md:hidden" />
      </PageContainer>

      <NavDrawer open={drawer} onClose={() => setDrawer(false)} />
    </nav>
  );
}
