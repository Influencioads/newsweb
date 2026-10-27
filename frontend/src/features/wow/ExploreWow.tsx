import { Link } from 'react-router-dom';
import { ArrowRight, LayoutGrid } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import { MAIN_FEATURES, MORE_FEATURES, type WowFeature } from './categories';

/**
 * Explore WOW — category cards (icon and title on one line, tagline below).
 * The home page shows the six main categories and a link to /explore, which
 * lists every category on its own page.
 */

function FeatureCard({ feature }: { feature: WowFeature }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  return (
    <Link
      to={feature.to}
      className={cn(
        'group flex h-full flex-col gap-2 rounded-xl border border-rule bg-surface p-4',
        'transition-[border-color,transform,box-shadow] duration-base ease-standard',
        'hover:-translate-y-0.5 hover:border-wow hover:shadow-raised motion-reduce:transform-none',
      )}
    >
      {/* Icon and title on one line; the tagline sits under them. */}
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-wow-tint text-wow-deep',
            'transition-colors duration-base group-hover:bg-wow-deep group-hover:text-on-wow',
          )}
        >
          <Icon icon={feature.icon} size="md" />
        </span>
        <span lang="te" className="th min-w-0 text-headline-xs font-bold leading-snug text-ink">
          {feature.te}
        </span>
      </span>
      <span className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm', 'te-clamp-2 text-muted')}>
        {te ? feature.focusTe : feature.focusEn}
      </span>
    </Link>
  );
}

function FeatureGrid({ features }: { features: readonly WowFeature[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
      {features.map((f) => (
        <li key={f.slug} className="min-w-0">
          <FeatureCard feature={f} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Home: the six main categories, then "Explore more categories", which opens
 * the /explore page with the rest.
 */
export function ExploreWow() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';

  return (
    <section aria-labelledby="explore-wow" className="space-y-4">
      <SectionHeader
        title={
          <span id="explore-wow">
            {te ? 'ఎక్స్‌ప్లోర్ ' : 'Explore '}
            <span className="text-wow-deep">WOW</span>
          </span>
        }
      />
      <FeatureGrid features={MAIN_FEATURES} />
      <div className="flex justify-center">
        <Link
          to="/explore"
          className={cn(
            s.body,
            s.te ? 'text-te-body-sm' : 'text-ui',
            'inline-flex min-h-tap items-center gap-2 rounded-pill border-2 border-wow px-5 font-bold text-wow-deep',
            'transition-colors duration-base ease-standard hover:bg-wow-tint',
          )}
        >
          <Icon icon={LayoutGrid} size="sm" />
          {te ? `మరిన్ని కేటగిరీలు చూడండి (${MORE_FEATURES.length})` : `Explore more categories (${MORE_FEATURES.length})`}
          <Icon icon={ArrowRight} size="sm" />
        </Link>
      </div>
    </section>
  );
}

/** /explore — every WOW category on its own page: the main six, then the rest. */
export default function ExplorePage() {
  const { language } = useI18n();
  const te = language === 'te';
  useDocumentTitle(te ? 'అన్ని కేటగిరీలు' : 'All categories');
  return (
    <PageContainer width="site" className="space-y-8 py-7 md:py-10">
      <PageHeader
        icon={LayoutGrid}
        title={te ? 'అన్ని కేటగిరీలు' : 'All categories'}
        subtitle={te ? 'ప్రతి కథలో ఒక WOW! మీకు నచ్చిన విభాగం ఎంచుకోండి.' : 'Every story has a WOW! Pick a section.'}
        spacing="none"
      />
      <section aria-labelledby="explore-main" className="space-y-4">
        <SectionHeader title={<span id="explore-main">{te ? 'ప్రధాన కేటగిరీలు' : 'Main categories'}</span>} />
        <FeatureGrid features={MAIN_FEATURES} />
      </section>
      <section aria-labelledby="explore-more" className="space-y-4">
        <SectionHeader title={<span id="explore-more">{te ? 'మరిన్ని కేటగిరీలు' : 'More categories'}</span>} />
        <FeatureGrid features={MORE_FEATURES} />
      </section>
    </PageContainer>
  );
}
