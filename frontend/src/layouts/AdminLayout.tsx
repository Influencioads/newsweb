import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react';

import { RouteFallback, SkipLink } from '@/components/app';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { useReaderPrefs } from '@/stores/readerPrefs';
import { cn } from '@/utils/cn';
import { useScrolled, withViewTransition } from '@/utils/motion';

import { findAdminNav, visibleAdminNav, type AdminNavGroup } from './adminNav';

/**
 * Newsroom CMS shell — collapsible ink sidebar (lg+), glass topbar with
 * breadcrumb / search / language / theme / user chip / sign-out, and a left
 * Sheet carrying the same grouped nav under lg. The shell owns the one
 * `<main id="main">` landmark; pages render as PageContainer roots inside it.
 */

const COLLAPSED_KEY = 'tn.admin-nav-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // Private mode / quota: the choice simply does not persist.
  }
}

const ITEM =
  'relative flex min-h-tap items-center gap-3 rounded-xl px-3 text-ui-sm font-medium ' +
  'transition-[colors,transform,box-shadow,opacity] duration-base ease-standard active:scale-[.98]';

/** Item / group-label classes per surface: the ink sidebar or the light drawer. */
const TONE = {
  ink: {
    idle: 'text-muted-inverse hover:bg-ink-panel hover:text-on-ink',
    active: 'bg-brand-tint/20 text-on-ink',
    label: 'text-muted-inverse',
  },
  surface: {
    idle: 'text-ink-soft hover:bg-paper-sub hover:text-ink',
    active: 'bg-brand-tint text-brand',
    label: 'text-muted',
  },
} as const;

interface NavGroupsProps {
  groups: AdminNavGroup[];
  tone: keyof typeof TONE;
  collapsed?: boolean;
}

/** Grouped NavLinks. Collapsed = icons only (title + sr-only label). */
function NavGroups({ groups, tone, collapsed = false }: NavGroupsProps) {
  const { t } = useI18n();
  const s = useScript();
  const c = TONE[tone];
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key}>
          {collapsed ? (
            <div aria-hidden className="mx-3 mb-2 border-t border-on-ink/10" />
          ) : (
            <p
              className={cn(
                'mb-1 px-3',
                c.label,
                s.te ? 'te text-meta font-semibold' : 'font-sans text-eyebrow font-semibold uppercase',
              )}
            >
              {t(group.labelKey)}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const label = t(item.labelKey);
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(ITEM, s.body, isActive ? c.active : c.idle, collapsed && 'justify-center px-0')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-pill bg-brand" />
                        ) : null}
                        <Icon icon={item.icon} size="md" />
                        <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>{label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Wordmark({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const s = useScript();
  return (
    <Link
      to="/admin/dashboard"
      className={cn(
        'flex min-h-tap-lg flex-col justify-center rounded-xl px-3 py-2 transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:bg-ink-panel',
        collapsed && 'items-center px-0',
      )}
    >
      <span lang="te" className="th text-headline-xs font-extrabold text-on-ink">
        {collapsed ? 'టా' : 'టాప్ తెలుగు'}
      </span>
      <span
        className={cn(
          'text-muted-inverse',
          s.te ? 'te text-meta' : 'font-sans text-eyebrow font-semibold uppercase',
          collapsed && 'sr-only',
        )}
      >
        {t('admin.cms')}
      </span>
    </Link>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t, language } = useI18n();
  const s = useScript();
  const me = useAuth((a) => a.me);
  const can = useAuth((a) => a.can);
  const signOut = useAuth((a) => a.signOut);
  const toast = useToast();
  const resolvedTheme = useReaderPrefs((p) => p.resolvedTheme);
  const toggleTheme = useReaderPrefs((p) => p.toggleTheme);
  const scrolled = useScrolled(8);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [q, setQ] = useState('');

  // Close the drawer on navigation.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const groups = visibleAdminNav(can);
  const current = findAdminNav(pathname);

  // "name · role · district" in the user chip.
  const primaryRole = me?.roles[0];
  const chip = [
    language === 'en' ? me?.user.name_en : me?.user.name_te,
    primaryRole?.role_key,
    me?.is_global_scope ? 'global' : primaryRole?.scope_type,
  ]
    .filter(Boolean)
    .join(' · ');

  function toggleCollapsed() {
    setCollapsed((v) => {
      writeCollapsed(!v);
      return !v;
    });
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    navigate(`/admin/articles?q=${encodeURIComponent(q.trim())}`);
  }

  const logout = useMutation({
    mutationFn: () => signOut(),
    onSuccess: () => navigate('/admin/login', { replace: true }),
    onError: (e) => toast.error(e),
  });

  const collapseLabel = t(collapsed ? 'admin.expandNav' : 'admin.collapseNav');
  // The group crumb points at the group's first visible page, so text and target agree.
  const groupTo = current ? (groups.find((g) => g.key === current.group.key)?.items[0]?.to ?? '/admin/dashboard') : '/admin/dashboard';

  return (
    <div className="flex min-h-screen bg-canvas-cms">
      <SkipLink />

      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col bg-ink text-on-ink transition-[width] duration-base ease-standard lg:flex',
          collapsed ? 'w-20' : 'w-72',
        )}
      >
        <div className="px-3 pt-3">
          <Wordmark collapsed={collapsed} />
        </div>
        <nav id="admin-nav" aria-label={t('admin.cms')} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <NavGroups groups={groups} tone="ink" collapsed={collapsed} />
        </nav>
        <div className="border-t border-on-ink/10 p-3">
          {/* One control across both states: swapping elements would drop focus to <body> on every toggle. */}
          <Button
            variant="inverse"
            full
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            aria-expanded={!collapsed}
            aria-controls="admin-nav"
            onClick={toggleCollapsed}
            className={collapsed ? undefined : '!justify-start'}
          >
            <span className={cn(collapsed && 'sr-only')}>{collapseLabel}</span>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn('glass sticky top-0 z-header border-b border-rule', scrolled && 'shadow-header')}
        >
          <div className="flex min-h-tap-lg items-center gap-2 px-4 py-2 md:px-6">
            <IconButton
              icon={Menu}
              label={t('ui.openMenu')}
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              className="-ml-2 lg:hidden"
            />

            <nav aria-label={t('ui.pages')} className="min-w-0 flex-1">
              <ol className={cn(s.body, 'flex min-w-0 items-center gap-1 text-ui-sm')}>
                {current ? (
                  <>
                    <li className="hidden shrink-0 sm:block">
                      <Link
                        to={groupTo}
                        className="inline-flex min-h-tap items-center text-muted transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand"
                      >
                        {t(current.group.labelKey)}
                      </Link>
                    </li>
                    <li aria-hidden className="hidden sm:block">
                      <Icon icon={ChevronRight} size="xs" className="text-muted-light" />
                    </li>
                    <li aria-current="page" className="min-w-0 font-semibold text-ink te-clamp-1">
                      {t(current.item.labelKey)}
                    </li>
                  </>
                ) : (
                  <li className="min-w-0 font-semibold text-ink te-clamp-1">{t('admin.cms')}</li>
                )}
              </ol>
            </nav>

            <form role="search" onSubmit={onSearch} className="hidden w-full max-w-xs md:block">
              <Input
                size="md"
                leading={Search}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('admin.searchPlaceholder')}
                aria-label={t('admin.searchPlaceholder')}
              />
            </form>

            <LanguageToggle />

            <IconButton
              icon={resolvedTheme === 'dark' ? Sun : Moon}
              label={t('ui.darkMode')}
              pressed={resolvedTheme === 'dark'}
              onClick={() => withViewTransition(toggleTheme)}
            />

            {me ? (
              <span title={chip} className="hidden min-w-0 xl:block">
                <Badge tone="muted" size="sm" lang={language} className="max-w-56">
                  <span className="min-w-0 whitespace-normal te-clamp-1">{chip}</span>
                </Badge>
              </span>
            ) : null}

            <IconButton icon={LogOut} label={t('admin.signOut')} disabled={logout.isPending} onClick={() => logout.mutate()} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <Sheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('admin.cms')} side="left">
        <nav aria-label={t('admin.cms')}>
          <NavGroups groups={groups} tone="surface" />
        </nav>
      </Sheet>
    </div>
  );
}
