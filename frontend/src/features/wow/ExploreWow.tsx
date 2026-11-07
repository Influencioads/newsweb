import { Link } from 'react-router-dom';
import { ArrowRight, LayoutGrid } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import type { WowFeature } from './categories';
import { useWowFeatures } from './siteContent';

/**
 * Explore WOW — category cards: each in its own accent colour, with a
 * gradient icon tile and the title on one line, the tagline, a "Read stories"
 * line, and a soft glow and large faint icon that come alive on hover.
 * The cards come from the Taxonomy page ("WOW category", tagline, icon).
 * The home page shows the main categories and a link to /explore, which
 * lists every category on its own page.
 */

/** Each category's own accent, from the theme tokens (no literal colours). */
interface Tone {
  tile: string;
  glow: string;
  bar: string;
  text: string;
  mark: string;
}
const TONE = {
  wow: { tile: 'from-wow to-wow-deep', glow: 'bg-wow/20', bar: 'bg-wow', text: 'text-wow-deep', mark: 'text-wow/10' },
  brand: { tile: 'from-brand to-brand-dark', glow: 'bg-brand/15', bar: 'bg-brand', text: 'text-brand', mark: 'text-brand/10' },
  hero: { tile: 'from-hero/80 to-hero', glow: 'bg-hero/15', bar: 'bg-hero', text: 'text-hero-text', mark: 'text-hero/10' },
  ai: { tile: 'from-ai to-ai-text', glow: 'bg-ai/15', bar: 'bg-ai', text: 'text-ai-text', mark: 'text-ai/10' },
  red: { tile: 'from-exclusive to-exclusive-text', glow: 'bg-exclusive/15', bar: 'bg-exclusive', text: 'text-exclusive-text', mark: 'text-exclusive/10' },
  info: { tile: 'from-info/80 to-info', glow: 'bg-info/15', bar: 'bg-info', text: 'text-info', mark: 'text-info/10' },
  gold: { tile: 'from-partial/80 to-partial', glow: 'bg-partial/15', bar: 'bg-partial', text: 'text-partial', mark: 'text-partial/10' },
} satisfies Record<string, Tone>;

const CATEGORY_TONE: Record<string, Tone> = {
  'real-heroes': TONE.red,
  'jai-telugoda': TONE.brand,
  'morning-mantra': TONE.wow,
  'startup-stories': TONE.ai,
  'wow-tech': TONE.info,
  'business-guru': TONE.hero,
  'local-hero': TONE.hero,
  'story-shots': TONE.wow,
  'zero-to-hero': TONE.red,
  'wow-idea': TONE.ai,
  mystery: TONE.brand,
  'wow-puranam': TONE.gold,
};

function FeatureCard({ feature, n }: { feature: WowFeature; n: number }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const tone = CATEGORY_TONE[feature.slug] ?? TONE.wow;
  const Mark = feature.icon;
  return (
    <Link
      to={feature.to}
      className={cn(
        'group relative isolate flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-rule bg-surface p-4 shadow-card md:p-5',
        'transition-[border-color,transform,box-shadow] duration-base ease-standard',
        'hover:-translate-y-1 hover:border-transparent hover:shadow-raised motion-reduce:transform-none',
      )}
    >
      {/* Accent bar that draws in along the top on hover. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-1 origin-left scale-x-0 transition-transform duration-slow ease-standard group-hover:scale-x-100',
          tone.bar,
        )}
      />
      {/* Soft glow and a large faint icon in the corner. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-10 -top-10 -z-10 h-32 w-32 rounded-full blur-2xl transition-opacity duration-base',
          'opacity-70 group-hover:opacity-100',
          tone.glow,
        )}
      />
      <Mark
        aria-hidden
        size={96}
        strokeWidth={1.25}
        className={cn(
          'pointer-events-none absolute -bottom-5 -right-4 -z-10 transition-transform duration-slow ease-standard group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transform-none',
          tone.mark,
        )}
      />

      {/* Icon and title on one line; the number sits in the corner. */}
      <span className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-on-ink shadow-raised',
            'transition-transform duration-base ease-standard group-hover:scale-105 motion-reduce:transform-none',
            tone.tile,
          )}
        >
          <Icon icon={feature.icon} size="md" />
        </span>
        <span lang="te" className="th min-w-0 flex-1 text-headline-sm font-bold leading-snug text-ink">
          {feature.te}
        </span>
        <span aria-hidden className="self-start font-sans text-meta font-bold tabular-nums text-muted-light">
          {String(n).padStart(2, '0')}
        </span>
      </span>

      <span className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm', 'te-clamp-2 text-ink-soft')}>
        {te ? feature.focusTe : feature.focusEn}
      </span>

      <span
        className={cn(
          s.body,
          'mt-auto inline-flex items-center gap-1.5 pt-1 text-ui-sm font-bold',
          tone.text,
        )}
      >
        {te ? 'కథలు చదవండి' : 'Read stories'}
        <Icon
          icon={ArrowRight}
          size="sm"
          className="transition-transform duration-base ease-standard group-hover:translate-x-1 motion-reduce:transform-none"
        />
      </span>
    </Link>
  );
}

function FeatureGrid({ features }: { features: readonly WowFeature[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 md:gap-4">
      {features.map((f, i) => (
        <li key={f.slug} className="min-w-0">
          <FeatureCard feature={f} n={i + 1} />
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
  const { main, more } = useWowFeatures();

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
      <FeatureGrid features={main} />
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
          {te ? `మరిన్ని కేటగిరీలు చూడండి (${more.length})` : `Explore more categories (${more.length})`}
          <Icon icon={ArrowRight} size="sm" />
        </Link>
      </div>
    </section>
  );
}

/** /explore — every WOW category on one page, the main six first. */
export default function ExplorePage() {
  const { language } = useI18n();
  const te = language === 'te';
  const { all } = useWowFeatures();
  useDocumentTitle(te ? 'అన్ని కేటగిరీలు' : 'All categories');
  return (
    <PageContainer width="site" className="space-y-6 py-7 md:py-10">
      <PageHeader
        icon={LayoutGrid}
        title={te ? 'అన్ని కేటగిరీలు' : 'All categories'}
        subtitle={te ? 'ప్రతి కథలో ఒక WOW! మీకు నచ్చిన విభాగం ఎంచుకోండి.' : 'Every story has a WOW! Pick a section.'}
        spacing="none"
      />
      <FeatureGrid features={all} />
    </PageContainer>
  );
}
