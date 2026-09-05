import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Search, X } from 'lucide-react';

import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { useI18n } from '@/i18n';

/**
 * Newsroom CMS shell — the dark topbar from mockup `1h`.
 *
 *   [టాప్ తెలుగు · NEWSROOM CMS]        [⌕ వెతకండి…]  [name · role · district]
 *
 * Nav entries are permission-gated so a stringer never sees an approval queue
 * they cannot use. Entries are added as each phase lands — nothing here links to
 * a screen that does not exist (brief §40).
 */

interface NavItem {
  to: string;
  labelTe: string;
  labelEn: string;
  permission?: PermissionKey;
}

const NAV: NavItem[] = [
  { to: '/admin/dashboard', labelTe: 'డాష్‌బోర్డ్', labelEn: 'Dashboard' },
  { to: '/admin/articles', labelTe: 'కథనాలు', labelEn: 'Articles' },
  { to: '/admin/review', labelTe: 'రివ్యూ క్యూ', labelEn: 'Review queue', permission: 'article.review' },
  { to: '/admin/moderation', labelTe: 'మోడరేషన్', labelEn: 'Moderation', permission: 'comment.moderate' },
  { to: '/admin/trending', labelTe: 'ట్రెండింగ్', labelEn: 'Trending', permission: 'dashboard.view' },
  { to: '/admin/pins', labelTe: 'పిన్‌లు', labelEn: 'Pins', permission: 'article.publish' },
  { to: '/admin/notifications', labelTe: 'నోటిఫికేషన్లు', labelEn: 'Notifications', permission: 'push.create' },
  { to: '/admin/videos', labelTe: 'వీడియోలు', labelEn: 'Videos', permission: 'video.view' },
  { to: '/admin/ads', labelTe: 'ప్రకటనలు', labelEn: 'Ads', permission: 'ads.manage' },
  { to: '/admin/homepage', labelTe: 'హోమ్ విభాగాలు', labelEn: 'Homepage', permission: 'settings.manage' },
  { to: '/admin/analytics', labelTe: 'విశ్లేషణలు', labelEn: 'Analytics', permission: 'analytics.view' },
  { to: '/admin/taxonomy', labelTe: 'వర్గీకరణ', labelEn: 'Taxonomy', permission: 'taxonomy.view' },
  { to: '/admin/media', labelTe: 'మీడియా', labelEn: 'Media', permission: 'media.view' },
  { to: '/admin/users', labelTe: 'వినియోగదారులు', labelEn: 'Users', permission: 'user.view' },
  { to: '/admin/roles', labelTe: 'పాత్రలు', labelEn: 'Roles', permission: 'role.view' },
  { to: '/admin/audit', labelTe: 'ఆడిట్', labelEn: 'Audit', permission: 'audit.view' },
  { to: '/admin/settings', labelTe: 'సెట్టింగ్స్', labelEn: 'Settings', permission: 'settings.view' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const me = useAuth((s) => s.me);
  const can = useAuth((s) => s.can);
  const signOut = useAuth((s) => s.signOut);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { language } = useI18n();

  const visibleNav = NAV.filter((item) => !item.permission || can(item.permission));

  // The mockup shows "name · role · district" in the user chip.
  const primaryRole = me?.roles[0];
  const chip = [
    language === 'en' ? me?.user.name_en : me?.user.name_te,
    primaryRole?.role_key,
    me?.is_global_scope ? 'global' : primaryRole?.scope_type,
  ]
    .filter(Boolean)
    .join(' · ');

  async function handleSignOut() {
    await signOut();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-canvas-cms">
      <header className="bg-ink text-white">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-[18px]">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Toggle navigation"
              aria-expanded={mobileNavOpen}
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded md:hidden"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link to="/admin/dashboard" className="flex items-baseline gap-2.5">
              <span className="th text-[16px] font-extrabold text-[#FF9A9A]">{language === 'en' ? 'Top Telugu' : 'టాప్ తెలుగు'}</span>
              <span className="hidden font-sans text-[10px] font-semibold tracking-[0.14em] text-muted-inverse sm:inline">
                NEWSROOM CMS
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3.5">
            <div className="rounded-md bg-white"><LanguageToggle compact /></div>
            <button
              type="button"
              className="te hidden items-center gap-1.5 text-[11px] text-[#D8D2C8] hover:text-white md:flex"
              aria-label={language === 'en' ? 'Search' : 'వెతకండి'}
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              {language === 'en' ? 'Search…' : 'వెతకండి…'}
            </button>

            {me ? (
              <span
                className="te max-w-[220px] truncate rounded-chip bg-[#3A342C] px-2.5 py-[3px] font-sans text-[11px] text-[#D8D2C8]"
                title={chip}
              >
                {chip}
              </span>
            ) : null}

            <button
              type="button"
              onClick={handleSignOut}
              className="flex h-9 w-9 items-center justify-center rounded text-[#D8D2C8] hover:text-white"
              aria-label={language === 'en' ? 'Sign out' : 'లాగ్ అవుట్'}
              title={language === 'en' ? 'Sign out' : 'లాగ్ అవుట్'}
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {visibleNav.length > 0 ? (
          <nav
            aria-label="CMS sections"
            className={[
              'border-t border-white/10 px-4 md:block md:px-[18px]',
              mobileNavOpen ? 'block' : 'hidden',
            ].join(' ')}
          >
            <ul className="flex flex-col gap-1 py-2 md:flex-row md:gap-1 md:py-0">
              {visibleNav.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      [
                      `${language === 'te' ? 'te leading-telugu' : 'font-sans'} block min-h-tap px-3 py-2.5 text-[13px] font-medium transition-colors`,
                        isActive
                          ? 'text-white md:border-b-2 md:border-[#FF9A9A]'
                          : 'text-[#B7AFA4] hover:text-white',
                      ].join(' ')
                    }
                  >
                    {language === 'te' ? item.labelTe : item.labelEn}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <Outlet />
    </div>
  );
}
