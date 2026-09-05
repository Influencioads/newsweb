import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Clock3 } from 'lucide-react';

import { ApiError } from '@/api/client';
import { LeadCard, RowCard, SecondaryCard } from '@/components/article/ArticleCard';
import { FollowButton } from '@/features/engagement/components/FollowButton';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';

const DESCRIPTIONS: Record<string, { te: string; en: string }> = {
  'andhra-pradesh': { te: 'ఆంధ్రప్రదేశ్‌లోని తాజా రాజకీయాలు, పాలన మరియు జిల్లాల వార్తలు', en: 'Politics, governance and district news from Andhra Pradesh' },
  telangana: { te: 'తెలంగాణ రాష్ట్రం మరియు జిల్లాల నుంచి తాజా సమాచారం', en: 'Latest developments from Telangana and its districts' },
  national: { te: 'దేశవ్యాప్తంగా ముఖ్యమైన వార్తలు మరియు విశ్లేషణ', en: 'Essential news and analysis from across India' },
  cinema: { te: 'సినిమా, ఓటీటీ, ప్రముఖులు మరియు వినోద వార్తలు', en: 'Cinema, streaming, celebrity and entertainment news' },
  sports: { te: 'క్రికెట్ మరియు ఇతర క్రీడల తాజా అప్‌డేట్లు', en: 'Latest cricket and sports updates, scores and stories' },
  business: { te: 'మార్కెట్లు, వ్యాపారం, టెక్నాలజీ మరియు వ్యక్తిగత ఆర్థికం', en: 'Markets, business, technology and personal finance' },
};

export default function SectionPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t, pick, language } = useI18n();
  const te = language === 'te';
  const script = te ? 'te' : 'font-sans';
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['public', 'feed', 'category', slug],
    queryFn: () => publicApi.fetchFeed({ category: slug, limit: 30 }),
    enabled: Boolean(slug),
  });

  // Syndicated feeds can occasionally return the same story under a new ID.
  // Keep the section page visually clean by de-duplicating on its headline.
  const articles = data
    ? Array.from(
        new Map(
          data.articles.map((article) => [
            (article.title_en || article.title_te).trim().toLocaleLowerCase(),
            article,
          ]),
        ).values(),
      )
    : [];
  const [lead, ...rest] = articles;
  const topStories = rest.slice(0, 2);
  const latest = rest.slice(2);
  const title = data?.category ? pick(data.category.name_te, data.category.name_en) : '';
  const description = DESCRIPTIONS[slug]?.[language];

  return (
    <main className="mx-auto min-h-[60vh] max-w-[1200px] px-4 pb-10 pt-5 sm:pt-7">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 font-sans text-[11px] text-muted">
        <Link to="/" className="hover:text-brand">{te ? 'హోమ్' : 'Home'}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-semibold text-ink">{title || '…'}</span>
      </nav>

      <header className="mb-6 border-b-2 border-ink pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 font-sans text-[10px] font-extrabold uppercase tracking-[0.18em] text-brand">
              {te ? 'వార్తల విభాగం' : 'News section'}
            </p>
            <h1 className={`${te ? 'th' : 'font-sans'} text-[30px] font-extrabold leading-tight text-ink sm:text-[38px]`}>
              {title || '…'}
            </h1>
            {description ? <p className={`${script} mt-2 max-w-[680px] text-[13px] text-muted sm:text-[14px]`}>{description}</p> : null}
          </div>
          <div className="flex items-center gap-3">
            <FollowButton targetType="category" slug={slug} />
            {articles.length ? (
              <p className="flex items-center gap-1.5 font-sans text-[11px] font-medium text-muted-light">
                <Clock3 className="h-3.5 w-3.5" />
                {te ? `${articles.length} తాజా కథనాలు` : `${articles.length} latest stories`}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {isLoading ? (
        <div aria-busy="true" className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
          <div className="ph aspect-video animate-pulse rounded" />
          <div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded bg-placeholder" />)}</div>
          <p className="sr-only" role="status">{t('state.loading')}</p>
        </div>
      ) : isError ? (
        <div className="rounded border border-rule bg-paper px-5 py-12 text-center" role="alert">
          <p className={`${script} text-[14px] text-muted`}>
            {error instanceof ApiError ? (te ? error.messageTe : error.messageEn) : t('state.newsFailed')}
          </p>
        </div>
      ) : lead ? (
        <>
          <section aria-label={te ? 'ముఖ్య కథనాలు' : 'Top stories'} className="grid gap-6 border-b border-rule pb-7 lg:grid-cols-[1.45fr_1fr] lg:gap-8">
            <LeadCard article={lead} />
            <div className="flex flex-col gap-4 lg:border-l lg:border-rule lg:pl-8">
              <h2 className={`${te ? 'th' : 'font-sans'} border-b-2 border-brand pb-2 text-[17px] font-extrabold text-brand`}>
                {te ? 'ముఖ్య కథనాలు' : 'Top stories'}
              </h2>
              {topStories.map((article) => <SecondaryCard key={article.short_id} article={article} />)}
            </div>
          </section>

          {latest.length ? (
            <section className="pt-7">
              <div className="mb-4 flex items-center justify-between border-b-2 border-ink pb-2">
                <h2 className={`${te ? 'th' : 'font-sans'} text-[21px] font-extrabold text-ink`}>
                  {te ? 'తాజా వార్తలు' : 'Latest news'}
                </h2>
                <span className="font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-muted-light">{title}</span>
              </div>
              <div className="grid gap-x-8 lg:grid-cols-2">
                {latest.map((article) => <RowCard key={article.short_id} article={article} />)}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <div className="rounded border border-dashed border-rule bg-paper px-5 py-14 text-center">
          <p className={`${script} text-[14px] text-muted`}>{t('state.emptySection')}</p>
          <Link to="/" className={`${script} mt-3 inline-block font-semibold text-brand hover:underline`}>
            {te ? 'హోమ్‌కు వెళ్లండి' : 'Return home'}
          </Link>
        </div>
      )}
    </main>
  );
}
