import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import type { ArticleCard as ArticleCardType } from '@/types/public';

/**
 * Trending (§8): time-decayed engagement with unique-reader dedup, computed
 * from the behaviour event stream. Rank numbers make the order legible.
 */
export default function TrendingPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const [category, setCategory] = useState('');
  const [extra, setExtra] = useState<ArticleCardType[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const feed = useQuery({
    queryKey: ['public', 'trending', category],
    queryFn: async () => {
      const data = await publicApi.fetchTrending({ category: category || undefined, limit: 20 });
      setExtra([]);
      setNextOffset(data.next_cursor ? Number(data.next_cursor) : null);
      return data;
    },
  });

  const articles = [...(feed.data?.articles ?? []), ...extra];

  return (
    <main className="mx-auto min-h-[55vh] max-w-[900px] px-4 py-7 sm:py-10">
      <div className="mb-6 border-b-2 border-ink pb-4">
        <p className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          <Flame className="h-3.5 w-3.5" aria-hidden />
          {te ? 'ఇప్పుడు చర్చలో' : 'TRENDING NOW'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[27px] font-extrabold text-ink sm:text-[32px]`}>
          {te ? 'ట్రెండింగ్ వార్తలు' : 'Trending stories'}
        </h1>
        <p className={`${teCls} mt-1 text-[12.5px] text-muted`}>
          {te
            ? 'పాఠకుల చదువు, షేర్లు, ఇష్టాల ఆధారంగా — తాజా ఆసక్తికి ఎక్కువ ప్రాధాన్యం.'
            : 'Ranked by reads, shares and likes — recent interest weighs most.'}
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory('')}
          aria-pressed={!category}
          className={`${teCls} rounded-chip border px-3 py-1.5 text-[12.5px] font-semibold ${!category ? 'border-brand bg-brand-tint text-brand' : 'border-rule bg-paper text-muted hover:border-brand'}`}
        >
          {te ? 'అన్నీ' : 'All'}
        </button>
        {config.data?.categories.filter((c) => c.show_in_nav).slice(0, 10).map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => setCategory(category === c.slug ? '' : c.slug)}
            aria-pressed={category === c.slug}
            className={`${teCls} rounded-chip border px-3 py-1.5 text-[12.5px] font-semibold ${category === c.slug ? 'border-brand bg-brand-tint text-brand' : 'border-rule bg-paper text-muted hover:border-brand'}`}
          >
            {pick(c.name_te, c.name_en)}
          </button>
        ))}
      </div>

      {feed.isLoading ? (
        <p className={`${teCls} text-muted`}>{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : feed.isError ? (
        <p className={`${teCls} text-brand`}>{te ? 'లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.' : 'Could not load. Try again.'}</p>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {articles.map((article, index) => (
              <div key={article.short_id} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-2 w-8 shrink-0 text-right font-sans text-[24px] font-extrabold leading-none ${index < 3 ? 'text-brand' : 'text-rule-strong'}`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <RowCard article={article} />
                </div>
              </div>
            ))}
          </div>
          {nextOffset != null ? (
            <button
              type="button"
              onClick={async () => {
                const page = await publicApi.fetchTrending({
                  category: category || undefined,
                  offset: nextOffset,
                  limit: 20,
                });
                setExtra((cur) => [...cur, ...page.articles]);
                setNextOffset(page.next_cursor ? Number(page.next_cursor) : null);
              }}
              className={`${teCls} mt-6 w-full border border-rule bg-paper py-3 text-[13.5px] font-bold text-ink hover:border-brand hover:text-brand`}
            >
              {te ? 'మరిన్ని' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}
