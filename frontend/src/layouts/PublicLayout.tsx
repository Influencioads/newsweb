import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, MapPin, Menu, Moon, Radio, Search, Sun, UserRound, X, Zap } from 'lucide-react';

import { LanguageToggle } from '@/components/layout/LanguageToggle';
import * as notificationsApi from '@/features/engagement/notificationsApi';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { FONT_STEPS, useReaderPrefs } from '@/stores/readerPrefs';
import { formatFullDate } from '@/utils/time';

/**
 * Public reader shell.
 *
 * Bilingual (§16 open item 3, decided in favour of both): chrome switches
 * between Telugu and English, while article headlines fall back to Telugu when
 * no English version exists. `useI18n().pick` applies that rule so no surface
 * has to reimplement it.
 *
 * Category names come from the database in both languages (`name_te` /
 * `name_en`), so the nav translates without a hardcoded mapping.
 */

function useSiteConfig() {
  return useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 5 * 60_000,
  });
}

function TopStrip() {
  const { fontStep, setFontStep, edition, setEdition, theme, toggleTheme } = useReaderPrefs();
  const { t, pick, language } = useI18n();
  const { data: config } = useSiteConfig();
  const authStatus = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);

  // Districts grouped by state (updated doc §1.1 location selector).
  const grouped = useMemo(() => {
    const states = config?.states ?? [];
    const districts = config?.districts ?? [];
    if (!states.length) return [{ code: '', label_te: '', label_en: '', districts }];
    return states.map((s) => ({
      code: s.code,
      label_te: s.name_te,
      label_en: s.name_en,
      districts: districts.filter((d) => d.state === s.code),
    }));
  }, [config]);

  return (
    <div className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-2 overflow-hidden px-3 py-1 md:justify-end md:px-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <label className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0 text-muted" aria-hidden />
            <span className="sr-only">{t('nav.chooseEdition')}</span>
            <select
              value={edition ?? ''}
              onChange={(e) => setEdition(e.target.value || null)}
              className={[
                'max-w-[126px] cursor-pointer border-none bg-transparent text-[11.5px] text-muted outline-none md:max-w-[220px]',
                language === 'te' ? 'te' : 'font-sans',
              ].join(' ')}
            >
              <option value="">{t('nav.editionAll')}</option>
              {grouped.map((group) =>
                group.code ? (
                  <optgroup key={group.code} label={pick(group.label_te, group.label_en)}>
                    {group.districts.map((d) => (
                      <option key={d.slug} value={d.slug}>
                        {pick(d.name_te, d.name_en)}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  group.districts.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {pick(d.name_te, d.name_en)}
                    </option>
                  ))
                ),
              )}
            </select>
          </label>

          {/* §4.1 — the A-/A/A+/A++ switcher is a required feature. */}
          <div className="hidden items-center gap-0.5 md:flex" role="group" aria-label={t('reader.fontSize')}>
            {FONT_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setFontStep(step)}
                aria-pressed={fontStep === step}
                title={`${t('reader.fontSize')} ${step}`}
                className={[
                  'min-h-[28px] min-w-[28px] rounded px-1 font-sans text-[11px] font-semibold transition-colors',
                  fontStep === step ? 'bg-brand-tint text-brand' : 'text-muted hover:text-ink',
                ].join(' ')}
              >
                {step}
              </button>
            ))}
          </div>

          <LanguageToggle compact />

          {/* §1.1 dark mode toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'dark'}
            aria-label={language === 'te' ? 'డార్క్ మోడ్' : 'Dark mode'}
            title={language === 'te' ? 'డార్క్ మోడ్' : 'Dark mode'}
            className="flex h-[28px] w-[28px] items-center justify-center rounded text-muted hover:text-brand"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden />
            ) : (
              <Moon className="h-4 w-4" aria-hidden />
            )}
          </button>

          {authStatus === 'authenticated' ? <NotificationBell /> : null}

          {authStatus === 'authenticated' && me ? (
            <Link
              to="/profile"
              className={[
                'flex items-center gap-1 text-[11.5px] font-semibold text-brand hover:text-brand-dark',
                language === 'te' ? 'te' : 'font-sans',
              ].join(' ')}
            >
              <UserRound className="h-3.5 w-3.5" aria-hidden />
              <span className="max-w-[110px] truncate">
                {pick(me.user.name_te, me.user.name_en)}
              </span>
            </Link>
          ) : (
            <Link
              to="/login"
              className={[
                'flex items-center gap-1 text-[11.5px] font-semibold text-brand hover:text-brand-dark',
                language === 'te' ? 'te' : 'font-sans',
              ].join(' ')}
            >
              <UserRound className="h-3.5 w-3.5" aria-hidden />
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { language } = useI18n();
  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.fetchInbox(0),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <Link
      to="/notifications"
      aria-label={language === 'te' ? 'నోటిఫికేషన్లు' : 'Notifications'}
      className="relative flex h-[28px] w-[28px] items-center justify-center text-muted hover:text-brand"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-breaking px-0.5 font-sans text-[9px] font-bold leading-none text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

function Masthead() {
  const { t, language } = useI18n();
  return (
    <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-1 px-4 py-3 md:grid-cols-3">
      <span className="hidden font-sans text-[11.5px] leading-[1.4] text-muted md:block">
        <span className={language === 'te' ? 'te' : undefined}>
          {formatFullDate(new Date(), language)}
        </span>
      </span>

      <Link to="/" className="text-center">
        {/* The masthead is the brand and stays Telugu in both modes — a
            publication does not rename itself when a reader switches language. */}
        <span
          lang="te"
          className="th block text-[27px] font-extrabold leading-[1.3] text-brand sm:text-[34px]"
        >
          టాప్ తెలుగు న్యూస్
        </span>
        <span className="mt-0.5 block font-sans text-[9px] font-semibold uppercase tracking-[0.34em] text-muted-light">
          Top Telugu News
        </span>
      </Link>

      <div className="hidden justify-end md:flex">
        <Link
          to="/epaper"
          className={[
            'border border-rule px-3 py-1.5 text-[11.5px] font-semibold text-ink hover:border-brand hover:text-brand',
            language === 'te' ? 'te' : 'font-sans',
          ].join(' ')}
        >
          {t('nav.epaper')}
        </Link>
      </div>
    </div>
  );
}

function CategoryNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { t, pick, language } = useI18n();
  const { data: config } = useSiteConfig();

  useEffect(() => setOpen(false), [location.pathname]);

  const items = config?.categories.filter((c) => c.show_in_nav) ?? [];
  const linkClass = (isActive: boolean) =>
    [
      'block whitespace-nowrap px-[13px] py-2 text-[14px] leading-[1.4] transition-colors',
      language === 'te' ? 'te' : 'font-sans',
      isActive
        ? 'font-bold text-brand md:border-b-[3px] md:border-brand'
        : 'text-ink hover:text-brand',
    ].join(' ');

  return (
    <nav
      aria-label={t('nav.sections')}
      className="sticky top-0 z-40 border-b-2 border-t border-b-ink border-t-rule bg-white/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t('nav.menu')}
          className="flex h-tap w-tap items-center justify-center md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <ul
          className={[
            // The §1.2 nav carries 18+ sections — on desktop it scrolls
            // horizontally instead of clipping (the scrollbar stays subtle).
            'w-full md:flex md:w-auto md:min-w-0 md:flex-1 md:flex-nowrap md:overflow-x-auto md:[scrollbar-width:thin]',
            open ? 'block' : 'hidden md:flex',
          ].join(' ')}
        >
          <li>
            <NavLink to="/" end className={({ isActive }) => linkClass(isActive)}>
              {t('nav.home')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/live" className={({ isActive }) => linkClass(isActive)}>
              <span className="flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-breaking" aria-hidden />
                {language === 'te' ? 'లైవ్' : 'Live'}
              </span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/trending" className={({ isActive }) => linkClass(isActive)}>
              {language === 'te' ? 'ట్రెండింగ్' : 'Trending'}
            </NavLink>
          </li>
          <li>
            <NavLink to="/local" className={({ isActive }) => linkClass(isActive)}>
              {language === 'te' ? 'లోకల్' : 'Local'}
            </NavLink>
          </li>
          <li>
            <NavLink to="/videos" className={({ isActive }) => linkClass(isActive)}>
              {language === 'te' ? 'వీడియో' : 'Video'}
            </NavLink>
          </li>
          <li>
            <NavLink to="/short-news" className={({ isActive }) => linkClass(isActive)}>
              {language === 'te' ? 'షార్ట్స్' : 'Shorts'}
            </NavLink>
          </li>
          {items.map((c) => (
            <li key={c.slug}>
              <NavLink
                to={`/section/${c.slug}`}
                className={({ isActive }) => linkClass(isActive)}
              >
                {pick(c.name_te, c.name_en)}
              </NavLink>
            </li>
          ))}
        </ul>

        <Link
          to="/search"
          aria-label={t('nav.search')}
          className="flex h-tap w-tap items-center justify-center text-muted hover:text-brand"
        >
          <Search className="h-4 w-4" />
        </Link>
      </div>
    </nav>
  );
}

function BreakingTicker() {
  const { t, language, pick, isFallback } = useI18n();
  // §10.1 — poll a Redis-cached endpoint every 25 s. Never SSR-per-request.
  const { data } = useQuery({
    queryKey: ['public', 'breaking'],
    queryFn: publicApi.fetchBreaking,
    refetchInterval: 25_000,
    staleTime: 20_000,
  });

  if (!data?.length) return null;

  return (
    <div className="bg-breaking text-white">
      <div className="mx-auto flex max-w-[1200px] items-stretch">
        <span
          className={[
            'flex shrink-0 items-center gap-1 whitespace-nowrap bg-brand-deep px-3.5 py-[7px] text-[12.5px] font-bold leading-[1.4]',
            language === 'te' ? 'te' : 'font-sans',
          ].join(' ')}
        >
          <Zap className="h-3.5 w-3.5" aria-hidden />
          {t('home.breaking')}
        </span>
        {/* No fixed height and no overflow:hidden on the text itself — §4.1. */}
        <div className="min-w-0 flex-1 overflow-hidden px-3.5 py-[7px]">
          <ul className="flex gap-6">
            {data.map((item) => (
              <li key={item.short_id} className="min-w-0 shrink-0">
                <Link
                  to={item.url}
                  lang={language === 'te' || isFallback(item.title_te, item.title_en) ? 'te' : 'en'}
                  className={`${language === 'te' || isFallback(item.title_te, item.title_en) ? 'te' : 'font-sans'} block truncate text-[13px] leading-[1.4] hover:underline`}
                >
                  {pick(item.title_te, item.title_en)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** §12.5 — Grievance Officer, correction policy and AI disclosure, live at launch. */
const FOOTER_LINKS = [
  ['/about', 'footer.about'],
  ['/contact', 'footer.contact'],
  ['/editorial-policy', 'footer.editorial'],
  ['/corrections', 'footer.corrections'],
  ['/grievance', 'footer.grievance'],
  ['/privacy', 'footer.privacy'],
  ['/terms', 'footer.terms'],
  ['/ai-disclosure', 'footer.aiDisclosure'],
] as const;

function PolicyFooter() {
  const { t, language } = useI18n();
  return (
    <footer className="mt-10 bg-ink text-muted-inverse">
      <div className="mx-auto max-w-[1200px] px-4 py-3">
        <nav aria-label={language === 'te' ? 'ఇంకా చూడండి' : 'Explore'} className="mb-2 border-b border-white/15 pb-2">
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {([
              ['/live-blog', language === 'te' ? 'లైవ్ బ్లాగ్' : 'Live blog'],
              ['/photos', language === 'te' ? 'ఫోటోలు' : 'Photos'],
              ['/videos', language === 'te' ? 'వీడియోలు' : 'Videos'],
              ['/web-stories', language === 'te' ? 'వెబ్ స్టోరీస్' : 'Web Stories'],
              ['/epaper', 'E-Paper'],
            ] as const).map(([to, label]) => <li key={to}><Link to={to} className={`${language === 'te' ? 'te' : 'font-sans'} text-[11px] font-semibold text-white hover:underline`}>{label}</Link></li>)}
          </ul>
        </nav>
        <ul className="flex flex-wrap gap-x-[18px] gap-y-1">
          {FOOTER_LINKS.map(([to, key]) => (
            <li key={to}>
              <Link
                to={to}
                className={[
                  'text-[10.5px] leading-[1.8] hover:text-white hover:underline',
                  language === 'te' ? 'te' : 'font-sans',
                ].join(' ')}
              >
                {t(key)}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-sans text-[10.5px] leading-[1.8] text-muted-inverse/70">
          © {new Date().getFullYear()} <span lang="te" className="te">టాప్ తెలుగు న్యూస్</span>
        </p>
      </div>
    </footer>
  );
}

export default function PublicLayout() {
  const { language } = useI18n();
  const authStatus = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  // Keep <html lang> correct on first paint as well as after a switch.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Resolve the reader's session so the header shows profile vs sign-in.
  useEffect(() => {
    if (authStatus === 'idle') void bootstrap();
  }, [authStatus, bootstrap]);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-white">
        <TopStrip />
        <Masthead />
        <CategoryNav />
        <BreakingTicker />
      </header>

      <Outlet />

      <PolicyFooter />
    </div>
  );
}
