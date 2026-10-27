import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LayoutGrid } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import { MAIN_FEATURES, MORE_FEATURES, type WowFeature } from './categories';

/**
 * Explore WOW — the six main categories as cards, then an
 * "Explore more categories" button that opens the remaining ones in place.
 * Two columns on a phone, three from a tablet up, so six cards fill whole rows.
 */

function FeatureCard({ feature, compact }: { feature: WowFeature; compact?: boolean }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  return (
    <Link
      to={feature.to}
      className={cn(
        'group flex h-full gap-3 rounded-xl border bg-surface',
        compact ? 'flex-row items-center border-rule p-3' : 'flex-col border-rule p-4',
        'transition-[border-color,transform,box-shadow] duration-base ease-standard',
        'hover:-translate-y-0.5 hover:border-wow hover:shadow-raised motion-reduce:transform-none',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-pill transition-colors duration-base',
          compact
            ? 'h-10 w-10 bg-paper-sub text-ink-soft group-hover:bg-wow-tint group-hover:text-wow-deep'
            : 'h-11 w-11 bg-wow-tint text-wow-deep group-hover:bg-wow-deep group-hover:text-on-wow',
        )}
      >
        <Icon icon={feature.icon} size="md" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span lang="te" className={cn('th font-bold text-ink', compact ? 'text-te-body-sm' : 'text-headline-xs')}>
          {feature.te}
        </span>
        <span className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm', 'te-clamp-2 text-muted')}>
          {te ? feature.focusTe : feature.focusEn}
        </span>
      </span>
    </Link>
  );
}

export function ExploreWow({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const [open, setOpen] = useState(defaultOpen);
  const moreId = useId();

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
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {MAIN_FEATURES.map((f) => (
          <li key={f.slug} className="min-w-0">
            <FeatureCard feature={f} />
          </li>
        ))}
      </ul>

      <div className="flex justify-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={moreId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            s.body,
            s.te ? 'text-te-body-sm' : 'text-ui',
            'inline-flex min-h-tap items-center gap-2 rounded-pill border-2 border-wow px-5 font-bold text-wow-deep',
            'transition-colors duration-base ease-standard hover:bg-wow-tint',
          )}
        >
          <Icon icon={LayoutGrid} size="sm" />
          {open
            ? te ? 'తక్కువ చూపించు' : 'Show less'
            : te ? `మరిన్ని కేటగిరీలు చూడండి (${MORE_FEATURES.length})` : `Explore more categories (${MORE_FEATURES.length})`}
          <Icon icon={ChevronDown} size="sm" className={cn('transition-transform duration-base', open && 'rotate-180')} />
        </button>
      </div>

      <ul id={moreId} hidden={!open} className="grid animate-fade-up grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
        {MORE_FEATURES.map((f) => (
          <li key={f.slug} className="min-w-0">
            <FeatureCard feature={f} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /explore — every WOW category on one page (linked from the top nav "More"). */
export default function ExplorePage() {
  const { language } = useI18n();
  const te = language === 'te';
  useDocumentTitle(te ? 'అన్ని కేటగిరీలు' : 'All categories');
  return (
    <PageContainer width="site" className="space-y-6 py-7 md:py-10">
      <PageHeader
        icon={LayoutGrid}
        title={te ? 'అన్ని కేటగిరీలు' : 'All categories'}
        subtitle={te ? 'ప్రతి కథలో ఒక WOW! మీకు నచ్చిన విభాగం ఎంచుకోండి.' : 'Every story has a WOW! Pick a section.'}
        spacing="none"
      />
      <ExploreWow defaultOpen />
    </PageContainer>
  );
}
