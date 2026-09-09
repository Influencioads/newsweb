import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ApiError } from '@/api/client';
import {
  BriefCard,
  CompactCard,
  KickerCard,
  LatestCard,
  LeadCard,
  SecondaryCard,
} from '@/components/article/ArticleCard';
import { AdSlot } from '@/components/ads/AdSlot';
import { VideoStrip } from '@/components/video/VideoStrip';
import * as engagementApi from '@/features/engagement/api';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { useReaderPrefs } from '@/stores/readerPrefs';

/**
 * Reader home page.
 *
 * Layout follows standard broadsheet front-page structure — the same
 * information architecture major Indian dailies use, because it is what a
 * reader scanning for news expects:
 *
 *   ┌── lead (image + big headline + standfirst) ──┬── mid column ──┬── rail ──┐
 *   │   + secondary thumb rows                     │   kicker +     │  తాజా    │
 *   │   + briefs                                   │   headline     │  వార్తలు │
 *   └──────────────────────────────────────────────┴────────────────┴──────────┘
 *   then section blocks, each with a lead item and a compact list
 *
 * Density is the point: a news front page should put many stories above the
 * fold, not one hero. What is deliberately NOT copied from print-derived web
 * layouts is their type metric — those run ~16px at line-height 1.3, which
 * clips Telugu vattulu and matras. §4.1 requires >= 1.65, so headline sizes
 * here are set from the Telugu scale while the *structure* stays dense.
 */

function SectionRule({ title, to }: { title: string; to?: string }) {
  const { t, language } = useI18n();
  const script = language === 'te' ? 'th' : 'font-sans';
  return (
    <div className="mb-3 flex items-baseline justify-between border-b-2 border-ink pb-1.5">
      <h2 className={`${script} text-[19px] font-extrabold text-brand`}>{title}</h2>
      {to ? (
        <Link
          to={to}
          className={`${language === 'te' ? 'te' : 'font-sans'} text-[11px] font-semibold text-info hover:underline`}
        >
          {t('home.seeAll')} →
        </Link>
      ) : null}
    </div>
  );
}

function RailHeading({ title }: { title: string }) {
  const { language } = useI18n();
  return (
    <h2
      className={`${language === 'te' ? 'th' : 'font-sans'} mb-2 border-b-2 border-brand pb-1.5 text-[16px] font-extrabold text-brand`}
    >
      {title}
    </h2>
  );
}

/**
 * "మీ కోసం" — the §3.2 personalized rail. Fetched client-side because the
 * home payload is shared and edge-cached; anonymous readers simply never see
 * the block (their sensible default is the page itself, §31).
 */
function ForYouBlock() {
  const { language } = useI18n();
  const authed = useAuth((s) => s.status === 'authenticated');
  const { data } = useQuery({
    queryKey: ['reader', 'for-you'],
    queryFn: () => engagementApi.fetchForYou(0, 7),
    enabled: authed,
    staleTime: 120_000,
  });

  if (!authed || !data || data.articles.length < 3) return null;
  const [first, ...rest] = data.articles;
  if (!first) return null;
  const half = Math.ceil(rest.length / 2);

  return (
    <section className="mt-8">
      <SectionRule title={language === 'te' ? 'మీ కోసం' : 'For you'} />
      <div className="grid gap-x-7 gap-y-4 md:grid-cols-[1.5fr_1fr_0.8fr]">
        <div className="min-w-0">
          <SecondaryCard article={first} />
        </div>
        <div className="flex flex-col gap-3">
          {rest.slice(0, half).map((article) => (
            <CompactCard key={article.short_id} article={article} />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {rest.slice(half).map((article) => (
            <CompactCard key={article.short_id} article={article} />
          ))}
        </div>
      </div>
      <p className={`${language === 'te' ? 'te' : 'font-sans'} mt-2 text-[11px] text-muted-light`}>
        {language === 'te'
          ? 'మీ పఠనం, ఆసక్తులు, ప్రాంతం ఆధారంగా ఎంపిక.'
          : 'Picked from your reading, interests and location.'}
      </p>
    </section>
  );
}

function HomeSkeleton() {
  const loadingLabel = useI18n().t('state.loadingNews');
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-4" aria-busy="true">
      <p className="sr-only" role="status">
        {loadingLabel}
      </p>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr_0.8fr]">
        <div>
          <div className="ph animate-pulse rounded-[4px]" style={{ aspectRatio: '16/9' }} />
          <div className="mt-3 h-7 w-11/12 animate-pulse rounded bg-placeholder" />
          <div className="mt-2 h-7 w-8/12 animate-pulse rounded bg-placeholder" />
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-3 w-20 animate-pulse rounded bg-placeholder" />
              <div className="mt-2 h-4 w-full animate-pulse rounded bg-placeholder" />
              <div className="mt-1.5 h-4 w-3/4 animate-pulse rounded bg-placeholder" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-placeholder" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';
  // ApiError already carries both languages from the §13 error envelope.
  const detail =
    error instanceof ApiError
      ? language === 'en'
        ? error.messageEn
        : error.messageTe
      : t('state.newsFailedBody');
  return (
    <div className="mx-auto max-w-[680px] px-4 py-16 text-center">
      <h2 className={`${language === 'te' ? 'th' : 'font-sans'} text-[20px] font-bold text-ink`}>
        {t('state.newsFailed')}
      </h2>
      <p className={`${script} mt-2 text-[14px] text-muted`}>{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className={`${script} mt-4 min-h-tap rounded-control bg-brand px-6 font-bold text-white hover:bg-brand-dark`}
      >
        {t('state.retry')}
      </button>
    </div>
  );
}

export default function Home() {
  const edition = useReaderPrefs((s) => s.edition);
  const mandal = useReaderPrefs((s) => s.mandal);
  const { t, pick, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public', 'home', edition, mandal],
    queryFn: () => publicApi.fetchHome(edition, mandal),
  });

  if (isLoading) return <HomeSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data?.lead) {
    return (
      <div className="mx-auto max-w-[680px] px-4 py-16 text-center">
        <h2 className={`${language === 'te' ? 'th' : 'font-sans'} text-[20px] font-bold text-ink`}>
          {t('state.empty')}
        </h2>
        <p className={`${script} mt-2 text-[14px] text-muted`}>{t('state.emptyEdition')}</p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-8 pt-4">
      <section aria-label={language === 'te' ? 'ట్రెండింగ్ వార్తలు' : 'Trending news'} className="mb-4 flex items-center gap-3 overflow-x-auto border-b border-rule pb-3">
        <span className={`${script} sticky left-0 shrink-0 bg-white pr-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-breaking`}>
          {language === 'te' ? 'ట్రెండింగ్' : 'Trending'}
        </span>
        {[...data.latest, ...data.briefs].slice(0, 6).map((article) => (
          <Link
            key={article.short_id}
            to={article.url}
            className={`${script} shrink-0 rounded-full border border-rule bg-paper px-3 py-1.5 text-[11.5px] font-semibold text-ink hover:border-brand hover:text-brand`}
          >
            {pick(article.title_te, article.title_en)}
          </Link>
        ))}
      </section>
      {/* ============ Front-page grid: lead | mid column | latest rail ============ */}
      <div className="grid gap-x-7 gap-y-6 lg:grid-cols-[1.5fr_1fr_0.8fr]">
        {/* --- left: lead + secondary + briefs --- */}
        <div className="min-w-0">
          <LeadCard article={data.lead} />

          {data.secondary.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3.5 border-t border-rule pt-3.5">
              {data.secondary.map((a) => (
                <SecondaryCard key={a.short_id} article={a} />
              ))}
            </div>
          ) : null}

          {data.briefs.length > 0 ? (
            <div className="mt-4 border-t border-rule pt-3">
              <p className={`${script} mb-2 text-[11px] font-bold text-brand`}>{t('home.briefs')}</p>
              <ul className="flex flex-col gap-2">
                {data.briefs.map((a) => (
                  <BriefCard key={a.short_id} article={a} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* --- middle: dense kicker column, divided from the lead by a rule --- */}
        <div className="min-w-0 lg:border-x lg:border-rule lg:px-7">
          {data.mid_column.map((a) => (
            <KickerCard key={a.short_id} article={a} />
          ))}
        </div>

        {/* --- right rail: latest + e-paper + ad --- */}
        <aside className="min-w-0">
          <section>
            <RailHeading title={t('home.latest')} />
            {data.latest.map((a) => (
              <LatestCard key={a.short_id} article={a} />
            ))}
            <Link
              to="/section/andhra-pradesh"
              className={`${script} mt-2 inline-block text-[11.5px] font-semibold text-info hover:underline`}
            >
              {t('home.moreStories')} →
            </Link>
          </section>

          <section className="mt-6 border border-rule bg-paper p-3 text-center">
            <p className="mb-2 font-sans text-eyebrow font-bold uppercase tracking-[0.1em] text-muted-light">
              E-Paper
            </p>
            <div className="ph border border-rule" style={{ height: 160 }}>
              <span className={`${script} text-[11px]`}>{t('home.todaysPage')}</span>
            </div>
            <Link
              to="/epaper"
              className={`${script} mt-2.5 block bg-brand py-2 text-[13px] font-bold leading-[1.5] text-white hover:bg-brand-dark`}
            >
              {t('home.readEpaper')} →
            </Link>
          </section>

          {/* §26 house-ad slot; collapses when no campaign matches. */}
          <AdSlot placement="in_feed" className="mt-4" />
        </aside>
      </div>

      {/* ============ For You (§3.2, signed-in readers) ============ */}
      <ForYouBlock />

      {/* ============ §3 What's happening in your mandal? ============ */}
      {data.mandal_block && data.mandal_block.articles.length ? (
        <section className="mt-8">
          <SectionRule
            title={pick(data.mandal_block.title_te, data.mandal_block.title_en)}
            to={`/mandal/${data.mandal_block.key.replace(/^mandal-/, '')}`}
          />
          <div className="grid gap-x-7 gap-y-4 md:grid-cols-[1.5fr_1fr]">
            <div className="min-w-0">
              <SecondaryCard article={data.mandal_block.articles[0]!} />
            </div>
            <div className="min-w-0 md:border-l md:border-rule md:pl-7">
              {data.mandal_block.articles.slice(1).map((a) => (
                <CompactCard key={a.short_id} article={a} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ============ Video news strip (§15) ============ */}
      <VideoStrip className="mt-8" limit={4} />

      {/* ============ Section blocks ============ */}
      {data.sections.map((section) => {
        const [first, ...rest] = section.articles;
        if (!first) return null;
        // Split the remainder evenly across the two list columns.
        const half = Math.ceil(rest.length / 2);
        return (
          <section key={section.key} className="mt-8">
            <SectionRule
              title={pick(section.title_te, section.title_en)}
              // Engine-backed sections (trending) have their own page, not a
              // category route.
              to={section.key === 'trending' ? '/trending' : `/section/${section.key}`}
            />
            <div className="grid gap-x-7 gap-y-4 md:grid-cols-[1.5fr_1fr_0.8fr]">
              {/* Section lead keeps its image; the rest go compact so more
                  headlines fit in the same vertical space. */}
              <div className="min-w-0">
                <SecondaryCard article={first} />
              </div>
              <div className="min-w-0 md:border-l md:border-rule md:pl-7">
                {rest.slice(0, half).map((a) => (
                  <CompactCard key={a.short_id} article={a} />
                ))}
              </div>
              {/* The third column only renders when there is copy for it —
                  an empty bordered column looks like a layout bug. */}
              {rest.length > half ? (
                <div className="hidden min-w-0 md:block md:border-l md:border-rule md:pl-7">
                  {rest.slice(half).map((a) => (
                    <CompactCard key={a.short_id} article={a} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </main>
  );
}
