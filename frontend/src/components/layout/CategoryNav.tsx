import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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

/** The shortcuts shown in the section rails (Nominate lives in the masthead). */
const RAIL_SHORTCUTS = SHORTCUTS.filter((sc) => !sc.drawerOnly);

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
        // Phones get MobileSectionsBar above the wordmark instead of this row.
        'sticky top-0 z-header hidden border-b transition-[colors,box-shadow] duration-base ease-standard md:block',
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
              {RAIL_SHORTCUTS.map((sc) => (
                <li key={sc.to} className="contents">
                  {sc.highlight ? (
                    // WOW Radio and My Village Story: compact orange buttons, apart
                    // from the category links (Nominate is in the masthead).
                    <NavLink
                      to={sc.to}
                      data-pill=""
                      className={({ isActive }) =>
                        cn(
                          'mx-0.5 my-2 flex min-h-[30px] shrink-0 snap-start items-center gap-1 whitespace-nowrap rounded-pill px-2.5 text-ui-sm font-bold leading-tight shadow-card',
                          'transition-[background-color,box-shadow] duration-base ease-standard',
                          s.body,
                          sc.highlight === 'wow'
                            ? 'bg-wow-deep text-on-wow hover:bg-wow-deep/90'
                            : 'bg-hero text-on-ink hover:bg-hero/90',
                          isActive && 'ring-2 ring-ink/20 ring-offset-1',
                        )
                      }
                    >
                      <Icon icon={sc.icon} size="xs" />
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

      </PageContainer>

      <NavDrawer open={drawer} onClose={() => setDrawer(false)} />
    </nav>
  );
}

/**
 * Phones only (under md): a plain top strip above the WOW INDIAN wordmark —
 * menu, every section scrolling past as a marquee, search. It replaces the
 * sticky section row with its arrow buttons on small screens. Hover, touch
 * focus and keyboard focus pause it; reduced motion turns it into a plain
 * sideways-scrolling row (the shared `.animate-marquee` rules in index.css).
 */
export function MobileSectionsBar() {
  const { t, pick } = useI18n();
  const s = useScript();
  const { data: config } = useSiteConfig();
  const [drawer, setDrawer] = useState(false);
  const categories = config?.categories.filter((c) => c.show_in_nav) ?? [];

  const plain = (telugu: boolean, font: string) =>
    cn(
      font,
      'flex min-h-tap shrink-0 items-center gap-1 whitespace-nowrap px-2.5 font-semibold text-ink hover:text-brand',
      telugu ? 'text-te-body-xs' : 'text-ui-sm',
    );
  const pill = cn(
    s.body,
    'mx-1 flex min-h-tap shrink-0 items-center whitespace-nowrap',
  );

  const items = (copy: boolean) => (
    <>
      <NavLink to="/" end tabIndex={copy ? -1 : undefined} className={plain(s.te, s.head)}>
        {t('nav.home')}
      </NavLink>
      {RAIL_SHORTCUTS.map((sc) =>
        sc.highlight ? (
          <NavLink key={sc.to} to={sc.to} tabIndex={copy ? -1 : undefined} className={pill}>
            <span className="inline-flex h-7 items-center gap-1 rounded-pill bg-wow-deep px-2.5 text-ui-sm font-bold text-on-wow">
              <Icon icon={sc.icon} size="xs" />
              {t(sc.key)}
            </span>
          </NavLink>
        ) : (
          <NavLink key={sc.to} to={sc.to} tabIndex={copy ? -1 : undefined} className={plain(s.te, s.head)}>
            {t(sc.key)}
          </NavLink>
        ),
      )}
      {categories.map((c) => {
        const f = s.forText(c.name_te, c.name_en);
        return (
          <NavLink
            key={c.slug}
            to={`/section/${c.slug}`}
            lang={f.lang}
            tabIndex={copy ? -1 : undefined}
            className={plain(f.telugu, f.head)}
          >
            {pick(c.name_te, c.name_en)}
          </NavLink>
        );
      })}
      <NavLink to="/explore" tabIndex={copy ? -1 : undefined} className={plain(s.te, s.head)}>
        <Icon icon={LayoutGrid} size="xs" />
        {t('ui.allCategories')}
      </NavLink>
    </>
  );

  // About three seconds a link, so the strip reads at the same pace however many sections there are.
  const duration = Math.max(24, (categories.length + RAIL_SHORTCUTS.length + 2) * 3);

  return (
    <nav aria-label={t('ui.explore')} className="border-b border-rule md:hidden">
      <div className="flex items-center gap-1 px-1">
        <IconButton
          icon={Menu}
          label={t('ui.openMenu')}
          aria-haspopup="dialog"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
        />
        <div className="marquee-clip no-scrollbar scroll-touch min-w-0 flex-1">
          <div className="animate-marquee items-center" style={{ '--marquee-duration': `${duration}s` } as CSSProperties}>
            <div className="flex items-center">{items(false)}</div>
            <div aria-hidden className="flex items-center">
              {items(true)}
            </div>
          </div>
        </div>
        <IconButtonLink icon={Search} label={t('nav.search')} to="/search" />
      </div>
      <NavDrawer open={drawer} onClose={() => setDrawer(false)} />
    </nav>
  );
}
