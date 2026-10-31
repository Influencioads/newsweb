import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { Award, GalleryVerticalEnd, Home, Radio, UserRound, type LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';

/**
 * Phone bottom navigation (pitch §2): Home · Stories · Radio · Nominate · Profile.
 *
 * Phones only (hidden from md up, where the masthead and category nav do the
 * job). It sits above the audio player dock, and publishes its own height as
 * `--bottom-nav-h` so the body padding (assets/index.css) keeps the end of
 * every page clear of it. Nominate wears the orange fill — it is the
 * platform's primary call to action.
 */

interface Item {
  to: string;
  te: string;
  en: string;
  icon: LucideIcon;
  primary?: boolean;
  end?: boolean;
}

export function BottomNav() {
  const { language } = useI18n();
  const s = useScript();
  const authed = useAuth((a) => a.status) === 'authenticated';
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    const publish = () => root.setProperty('--bottom-nav-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty('--bottom-nav-h');
    };
  }, []);

  const items: Item[] = [
    { to: '/', te: 'హోమ్', en: 'Home', icon: Home, end: true },
    { to: '/story-shots', te: 'స్టోరీస్', en: 'Stories', icon: GalleryVerticalEnd },
    { to: '/radio', te: 'రేడియో', en: 'Radio', icon: Radio, primary: true },
    { to: '/nominate', te: 'నామినేట్', en: 'Nominate', icon: Award, primary: true },
    { to: authed ? '/profile' : '/login', te: 'ప్రొఫైల్', en: 'Profile', icon: UserRound },
  ];

  return (
    <nav
      ref={ref}
      aria-label={language === 'te' ? 'ప్రధాన నావిగేషన్' : 'Main navigation'}
      className="fixed inset-x-0 z-header border-t border-rule bg-surface/95 backdrop-blur md:hidden print:hidden"
      style={{
        bottom: 'var(--player-dock-h, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => (
          <li key={item.en} className="flex justify-center">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  s.body,
                  'flex min-h-[58px] w-full flex-col items-center justify-center gap-0.5 text-meta font-semibold',
                  item.primary ? 'text-wow-deep' : isActive ? 'text-brand' : 'text-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {item.primary ? (
                    <span className="flex h-7 w-12 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep text-on-wow">
                      <Icon icon={item.icon} size="md" />
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'flex h-7 w-12 items-center justify-center rounded-pill transition-colors duration-base',
                        isActive ? 'bg-brand-tint' : '',
                      )}
                    >
                      <Icon icon={item.icon} size="md" />
                    </span>
                  )}
                  <span lang={language}>{language === 'te' ? item.te : item.en}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
