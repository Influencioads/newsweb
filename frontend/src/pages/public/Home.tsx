import { useQuery } from '@tanstack/react-query';

import { AdSlot } from '@/components/ads/AdSlot';
import { BriefCard, KickerCard, LatestCard } from '@/components/article/ArticleCard';
import { BulletinBanner } from '@/components/bulletin/BulletinBanner';
import { PageContainer, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState } from '@/components/ui/State';
import { VideoStrip } from '@/components/video/VideoStrip';
import * as epaperApi from '@/features/epaper/api';
import { PollCard } from '@/features/epaper/PollCard';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useReaderPrefs } from '@/stores/readerPrefs';
import type { ArticleCard, HomePayload } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import { EpaperPromo } from './home/EpaperPromo';
import { EpaperRail, ForYouBlock, SectionBlock, TopTopics, TrendingRail } from './home/HomeBlocks';
import { HomeSkeleton } from './home/HomeSkeleton';
import { LeadSlider } from './home/LeadSlider';

/**
 * Reader home page.
 *
 * Layout follows standard broadsheet front-page structure — the same
 * information architecture major Indian dailies use, because it is what a
 * reader scanning for news expects:
 *
 *   ┌── top-stories slider (lead, then secondary) ─┬── mid column ──┬── rail ──┐
 *   │                                              │   kicker +     │  తాజా    │
 *   │   + briefs                                   │   headline     │  వార్తలు │
 *   └──────────────────────────────────────────────┴────────────────┴──────────┘
 *   then For You, the mandal block, videos and the section blocks.
 *
 * Density is the point: a news front page should put many stories above the
 * fold, not one hero. What is deliberately NOT copied from print-derived web
 * layouts is their type metric — those run ~16px at line-height 1.3, which
 * clips Telugu vattulu and matras. §4.1 requires >= 1.65, so headline sizes
 * come from the Telugu scale while the *structure* stays dense.
 *
 * The shell owns <main>; this page is a PageContainer.
 */

/** Lead + secondary + briefs · mid column · latest rail. */
function FrontGrid({ data }: { data: HomePayload }) {
  const { t } = useI18n();
  const s = useScript();

  return (
    <div className="grid gap-x-7 gap-y-7 lg:grid-cols-[1.5fr_1fr_0.8fr]">
      {/* --- left: lead + secondary + briefs --- */}
      <div className="min-w-0">
        {/* The top stories slide: the lead, then the secondary stories. */}
        {data.lead ? <LeadSlider articles={[data.lead, ...data.secondary]} /> : null}

        {data.briefs.length > 0 ? (
          <div className="mt-4 border-t border-rule pt-3">
            <p className={cn(s.body, 'mb-2 text-meta font-bold text-brand')}>{t('home.briefs')}</p>
            <ul className="flex flex-col gap-2">
              {data.briefs.map((article) => (
                <BriefCard key={article.short_id} article={article} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* --- middle: dense kicker column, divided from the lead by a rule --- */}
      <div className="min-w-0 lg:border-x lg:border-rule lg:px-7">
        {data.mid_column.map((article) => (
          <KickerCard key={article.short_id} article={article} />
        ))}
      </div>

      {/* --- right rail: latest + e-paper + house ad --- */}
      <aside className="min-w-0 space-y-6">
        <section>
          <SectionHeader title={t('home.latest')} to="/section/andhra-pradesh" />
          {data.latest.map((article) => (
            <LatestCard key={article.short_id} article={article} />
          ))}
        </section>

        <EpaperRail teaser={data.epaper} />

        {/* §26 house-ad slot; collapses when no campaign matches. */}
        <AdSlot placement="in_feed" />
      </aside>
    </div>
  );
}

/** A short, distinct shelf from the flags already present in the home payload. */
function exclusiveStories(data: HomePayload): ArticleCard[] {
  const candidates = [
    ...data.secondary,
    ...data.mid_column,
    ...data.briefs,
    ...data.latest,
    ...data.sections.flatMap((section) => section.articles),
  ];
  return candidates
    .filter((article, index) =>
      article.is_exclusive &&
      article.short_id !== data.lead?.short_id &&
      candidates.findIndex((candidate) => candidate.short_id === article.short_id) === index,
    )
    .slice(0, 4);
}

export default function Home() {
  const edition = useReaderPrefs((state) => state.edition);
  const mandal = useReaderPrefs((state) => state.mandal);
  const { t } = useI18n();
  useDocumentTitle(t('page.home'));

  const home = useQuery({
    queryKey: ['public', 'home', edition, mandal],
    queryFn: () => publicApi.fetchHome(edition, mandal),
  });
  const topics = useQuery({
    queryKey: ['topics', 'top'],
    queryFn: epaperApi.fetchTopTopics,
  });
  const polls = useQuery({
    queryKey: ['polls', 'big-question'],
    queryFn: () => epaperApi.fetchPolls({ big_question: true }),
  });

  return (
    <PageContainer width="site" className="space-y-7 py-6 md:space-y-10 md:py-8">
      {/* The latest audio bulletin leads the page, fetched on its own so it
          shows even when the news feed is empty or fails. */}
      <BulletinBanner />
      <QueryState
        query={home}
        skeleton={<HomeSkeleton />}
        isEmpty={(data) => !data.lead}
        empty={<EmptyState title={t('state.empty')} body={t('state.emptyEdition')} />}
        errorTitle={t('state.newsFailed')}
      >
        {(data) => {
          const exclusives = exclusiveStories(data);
          return <>
            <FrontGrid data={data} />

            <TrendingRail articles={[...data.latest, ...data.briefs].slice(0, 6)} />

            {!data.sections.some((section) => section.key === 'exclusive') && exclusives.length >= 2 ? (
              <SectionBlock
                section={{
                  key: 'exclusive',
                  title_te: 'ఎక్స్‌క్లూజివ్',
                  title_en: 'Exclusive',
                  articles: exclusives,
                }}
              />
            ) : null}

            {data.epaper ? <EpaperPromo epaper={data.epaper} /> : null}
            <TopTopics topics={topics.data?.items ?? []} />

            {/* §3.2 — signed-in readers only. */}
            <ForYouBlock />

            {polls.data?.[0] ? <PollCard poll={polls.data[0]} /> : null}

            {/* §3 — what's happening in your mandal. */}
            {data.mandal_block ? (
              <SectionBlock
                section={data.mandal_block}
                to={`/mandal/${data.mandal_block.key.replace(/^mandal-/, '')}`}
                columns={2}
              />
            ) : null}

            {/* §15 video news strip. */}
            <VideoStrip limit={4} />

            {data.sections.map((section) => (
              <SectionBlock
                key={section.key}
                section={section}
                // Engine-backed sections (trending) have their own page, not a
                // category route.
                to={section.key === 'trending' ? '/trending' : `/section/${section.key}`}
              />
            ))}
          </>;
        }}
      </QueryState>
    </PageContainer>
  );
}
