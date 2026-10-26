import { Link } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { WOW_FEATURES } from './categories';

/**
 * Explore WOW — the 15 content features as a card grid (pitch §2, §3).
 * Two columns on a phone, five on a desktop, so the set reads as one shelf of
 * three rows rather than a long list.
 */
export function ExploreWow() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';

  return (
    <section aria-labelledby="explore-wow">
      <SectionHeader
        title={
          <span id="explore-wow">
            {te ? 'ఎక్స్‌ప్లోర్ ' : 'Explore '}
            <span className="text-wow-deep">WOW</span>
          </span>
        }
      />
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {WOW_FEATURES.map((feature) => (
          <li key={feature.slug} className="min-w-0">
            <Link
              to={feature.to}
              className={cn(
                'group flex h-full flex-col gap-2 rounded-xl border border-rule bg-surface p-3.5',
                'transition-[border-color,transform,box-shadow] duration-base ease-standard',
                'hover:-translate-y-0.5 hover:border-wow hover:shadow-raised motion-reduce:transform-none',
              )}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-wow-tint text-wow-deep transition-colors duration-base group-hover:bg-wow-deep group-hover:text-on-wow">
                <Icon icon={feature.icon} size="md" />
              </span>
              <span lang="te" className="th text-headline-xs font-bold text-ink">
                {feature.te}
              </span>
              <span className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm', 'te-clamp-2 text-muted')}>
                {te ? feature.focusTe : feature.focusEn}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
