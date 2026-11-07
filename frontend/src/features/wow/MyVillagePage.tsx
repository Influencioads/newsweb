import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Compass, Home as HomeIcon, PenLine } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import {
  MY_VILLAGE_IMAGE,
  MY_VILLAGE_INTRO,
  MY_VILLAGE_SLUG,
  MY_VILLAGE_TITLE,
  MY_VILLAGE_WELCOME,
  PUBLISH_STAGES,
  SHARE_VILLAGE_PATH,
  SPECIALITIES,
} from './myVillage';
import { fetchVillageStories, TINTS, VillageCard } from './MyVillageStory';

/**
 * `/my-village` — the My Village main screen (process document, Step 1): the
 * welcome message and the two ways in — Explore Villages (the published
 * village stories, further down this page) and Share Your Village (the
 * step-by-step form at /my-village/share). Below them: what a village story
 * can be about, and how a shared story gets published.
 */
export default function MyVillagePage() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const L = (teText: string, enText: string) => (te ? teText : enText);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');
  useDocumentTitle(L('మై విలేజ్', 'My Village'));

  const stories = useQuery({
    queryKey: ['wow', 'my-village-stories', 8],
    queryFn: () => fetchVillageStories(8),
    staleTime: 120_000,
  });
  const data = stories.data;

  return (
    <PageContainer width="site" className="space-y-10 py-6 md:space-y-14 md:py-10">
      {/* Welcome */}
      <section
        aria-labelledby="my-village-title"
        className="relative isolate overflow-hidden rounded-2xl bg-brand-deep p-6 text-on-ink shadow-raised ring-2 ring-wow/60 md:p-10"
      >
        {/* The village-at-sunset picture under a deep-blue wash, with the orange glow. */}
        <img
          src={MY_VILLAGE_IMAGE}
          alt=""
          width={1024}
          height={1536}
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_40%]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-deep via-brand-deep/85 to-brand-deep/40 md:bg-gradient-to-r md:from-brand-deep md:via-brand-deep/80 md:to-brand-deep/10"
        />
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 -z-10 h-64 w-64 rounded-full bg-wow/25 blur-3xl" />
        <div className="max-w-3xl space-y-4">
          <span className={cn(s.body, 'inline-flex items-center gap-1.5 rounded-pill bg-gradient-to-br from-wow to-wow-deep px-3 py-1 text-meta font-bold text-on-wow')}>
            <Icon icon={HomeIcon} size="xs" />
            {L('మై విలేజ్', 'My Village')}
          </span>
          <h1 id="my-village-title" lang={s.language} className={cn(s.head, 'text-headline-md font-bold md:text-headline-lg')}>
            {te ? MY_VILLAGE_TITLE.te : MY_VILLAGE_TITLE.en}
          </h1>
          <div className="space-y-1">
            {(te ? MY_VILLAGE_WELCOME.te : MY_VILLAGE_WELCOME.en).map((line) => (
              <p key={line} className={cn(s.body, s.te ? 'text-te-body-sm' : 'text-headline-xs', 'font-semibold text-on-ink')}>
                {line}
              </p>
            ))}
          </div>
          <p className={cn(bodyCls, 'text-on-ink/80')}>{te ? MY_VILLAGE_INTRO.te[0] : MY_VILLAGE_INTRO.en[0]}</p>
        </div>

        {/* The two ways in */}
        <div className="mt-7 grid gap-3 md:max-w-3xl md:grid-cols-2">
          <button
            type="button"
            onClick={() => document.getElementById('explore-villages')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="group flex items-start gap-3 rounded-xl text-left border border-on-ink/20 bg-on-ink/10 p-4 transition-colors duration-base hover:border-wow hover:bg-on-ink/15"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-on-ink shadow-raised">
              <Icon icon={Compass} size="md" />
            </span>
            <span className="min-w-0">
              <span className={cn(s.head, 'block text-headline-xs font-bold')}>{L('గ్రామాలను చూడండి', 'Explore Villages')}</span>
              <span className={cn(s.body, 'block text-ui-sm text-on-ink/75')}>
                {L('ఇతర గ్రామాల కథలను తెలుసుకోండి.', 'Read the stories of other villages.')}
              </span>
            </span>
          </button>
          <ShareCard />
        </div>
      </section>

      {/* What a village story can be about */}
      <section aria-labelledby="village-specialities">
        <SectionHeader title={<span id="village-specialities">{L('మీ ఊరి ప్రత్యేకత ఏమిటి?', 'What makes your village special?')}</span>} />
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {SPECIALITIES.map((sp) => (
            <li key={sp.value} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-rule bg-surface p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wow-tint text-wow-deep">
                <Icon icon={sp.icon} size="sm" />
              </span>
              <span className={cn(bodyCls, 'min-w-0 font-semibold text-ink')}>{te ? sp.te : sp.en}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* How a shared story is published */}
      <section aria-labelledby="village-process" className="rounded-2xl border border-rule bg-surface p-5 md:p-7">
        <SectionHeader title={<span id="village-process">{L('ప్రచురణ ప్రక్రియ', 'How your story gets published')}</span>} />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PUBLISH_STAGES.map((stage, i) => (
            <li key={stage.en} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep text-on-wow">
                <Icon icon={stage.icon} size="sm" />
              </span>
              <span className="min-w-0">
                <span className="block font-sans text-eyebrow font-bold uppercase text-muted">{i + 1}</span>
                <span className={cn(bodyCls, 'block font-semibold text-ink')}>{te ? stage.te : stage.en}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-6">
          <ButtonLink to={SHARE_VILLAGE_PATH} variant="wow" size="lg" icon={PenLine} iconRight={ArrowRight}>
            {L('మీ ఊరి కథ పంపండి', 'Share Your Village')}
          </ButtonLink>
        </div>
      </section>

      {/* Explore Villages */}
      <section aria-labelledby="explore-villages-title" id="explore-villages" className="scroll-mt-24">
        <SectionHeader
          title={<span id="explore-villages-title">{L('గ్రామాల కథలు', 'Explore Villages')}</span>}
          to={data?.articles.length ? `/section/${data.slug || MY_VILLAGE_SLUG}` : undefined}
        />
        {data?.articles.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            {data.articles.map((article, i) => (
              <VillageCard key={article.short_id} article={article} tint={TINTS[i % TINTS.length]!} />
            ))}
          </div>
        ) : stories.isPending ? null : (
          <p className={cn(bodyCls, 'text-ink-soft')}>
            {L('త్వరలో గ్రామాల కథలు ఇక్కడ. మీ ఊరి కథతో మొదలుపెట్టండి!', 'Village stories are coming soon. Start with yours!')}
          </p>
        )}
      </section>
    </PageContainer>
  );
}

/** The "Share Your Village" way in: the same card as Explore Villages, in WOW orange. */
function ShareCard() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  return (
    <Link
      to={SHARE_VILLAGE_PATH}
      className="group flex items-start gap-3 rounded-xl bg-gradient-to-br from-wow to-wow-deep p-4 text-left text-on-wow shadow-raised transition-transform duration-base hover:-translate-y-0.5 motion-reduce:transform-none"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-on-ink/20">
        <Icon icon={PenLine} size="md" />
      </span>
      <span className="min-w-0">
        <span className={cn(s.head, 'block text-headline-xs font-bold')}>{te ? 'మీ ఊరి కథ పంపండి' : 'Share Your Village'}</span>
        <span className={cn(s.body, 'block text-ui-sm text-on-wow/85')}>
          {te ? 'మీ గ్రామం గురించి వివరాలు పంపండి.' : 'Send us the details of your village.'}
        </span>
      </span>
    </Link>
  );
}
