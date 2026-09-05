import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { RowCard } from '@/components/article/ArticleCard';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import type { ArticleCard as ArticleCardType } from '@/types/public';

/**
 * Reader search (updated doc §10): full-text with category/district filters,
 * popular-search chips, and offset paging against `/public/search`.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const category = params.get('category') ?? '';
  const district = params.get('district') ?? '';
  const [value, setValue] = useState(query);
  const [extra, setExtra] = useState<ArticleCardType[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const meta = useQuery({
    queryKey: ['public', 'search-meta'],
    queryFn: publicApi.fetchSearchMeta,
    staleTime: 300_000,
  });

  const result = useQuery({
    queryKey: ['public', 'search', query, category, district],
    queryFn: async () => {
      const data = await publicApi.fetchSearch({
        q: query,
        category: category || undefined,
        district: district || undefined,
        limit: 20,
      });
      setExtra([]);
      setNextOffset(data.next_offset);
      return data;
    },
    enabled: query.length >= 2,
  });

  function apply(next: { q?: string; category?: string; district?: string }) {
    const merged = {
      q: next.q ?? query,
      category: next.category ?? category,
      district: next.district ?? district,
    };
    const out: Record<string, string> = {};
    if (merged.q.length >= 2) out.q = merged.q;
    if (merged.category) out.category = merged.category;
    if (merged.district) out.district = merged.district;
    setParams(out);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply({ q: value.trim() });
  }

  async function loadMore() {
    if (nextOffset == null) return;
    const page = await publicApi.fetchSearch({
      q: query,
      category: category || undefined,
      district: district || undefined,
      offset: nextOffset,
      limit: 20,
    });
    setExtra((current) => [...current, ...page.articles]);
    setNextOffset(page.next_offset);
  }

  const articles = [...(result.data?.articles ?? []), ...extra];
  const suggestions = meta.data?.recent.length ? meta.data.recent : meta.data?.popular ?? [];

  return (
    <main className="mx-auto min-h-[55vh] max-w-[900px] px-4 py-7 sm:py-10">
      <div className="mb-7 border-b-2 border-ink pb-4">
        <p className="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          {te ? 'వార్తల అన్వేషణ' : 'NEWS SEARCH'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[27px] font-extrabold text-ink sm:text-[34px]`}>
          {te ? 'మీకు కావాల్సిన వార్తను వెతకండి' : 'Find the story you need'}
        </h1>
      </div>

      <form onSubmit={submit} role="search" className="flex overflow-hidden rounded-control border-2 border-ink bg-white focus-within:border-brand">
        <Search className="ml-3 mt-3.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
        <label htmlFor="news-search" className="sr-only">{te ? 'వార్తలు వెతకండి' : 'Search news'}</label>
        <input
          id="news-search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={te ? 'శీర్షిక, అంశం లేదా పేరు…' : 'Headline, topic or name…'}
          className={`${teCls} min-w-0 flex-1 bg-transparent px-3 py-3 text-[16px] text-ink outline-none`}
        />
        <button className={`${teCls} bg-brand px-5 font-bold text-white hover:bg-brand-dark`} type="submit">
          {te ? 'వెతకండి' : 'Search'}
        </button>
      </form>

      {/* -------------------------------- filters --------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => apply({ category: e.target.value })}
          aria-label={te ? 'విభాగం' : 'Category'}
          className={`${teCls} rounded-control border border-rule-input bg-white px-2 py-2 text-[13px] text-ink`}
        >
          <option value="">{te ? 'అన్ని విభాగాలు' : 'All sections'}</option>
          {config.data?.categories.filter((c) => c.show_in_nav).map((c) => (
            <option key={c.slug} value={c.slug}>{pick(c.name_te, c.name_en)}</option>
          ))}
        </select>
        <select
          value={district}
          onChange={(e) => apply({ district: e.target.value })}
          aria-label={te ? 'జిల్లా' : 'District'}
          className={`${teCls} rounded-control border border-rule-input bg-white px-2 py-2 text-[13px] text-ink`}
        >
          <option value="">{te ? 'అన్ని జిల్లాలు' : 'All districts'}</option>
          {config.data?.districts.map((d) => (
            <option key={d.slug} value={d.slug}>{pick(d.name_te, d.name_en)}</option>
          ))}
        </select>
      </div>

      {/* -------------------------------- popular/recent --------------------- */}
      {!query && suggestions.length ? (
        <div className="mt-6">
          <p className={`${teCls} mb-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-light`}>
            {meta.data?.recent.length
              ? te ? 'మీ ఇటీవలి శోధనలు' : 'Your recent searches'
              : te ? 'ప్రజాదరణ పొందిన శోధనలు' : 'Popular searches'}
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 10).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setValue(s); apply({ q: s }); }}
                className={`${teCls} rounded-chip border border-rule bg-paper px-3 py-1.5 text-[13px] text-ink hover:border-brand hover:text-brand`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {query.length >= 2 ? (
        <section className="mt-8" aria-live="polite">
          {result.isLoading ? <p className={`${teCls} text-muted`}>{te ? 'వెతుకుతోంది…' : 'Searching…'}</p> : null}
          {result.isError ? <p className={`${teCls} text-brand`}>{te ? 'శోధన విఫలమైంది. మళ్లీ ప్రయత్నించండి.' : 'Search failed. Please try again.'}</p> : null}
          {result.data ? (
            <>
              <h2 className={`${te ? 'th' : 'font-sans'} mb-4 text-[18px] font-bold text-ink`}>
                {result.data.total
                  ? te ? `“${query}” కోసం ${result.data.total} ఫలితాలు` : `${result.data.total} results for “${query}”`
                  : te ? `“${query}” కోసం వార్తలు దొరకలేదు` : `No stories found for “${query}”`}
              </h2>
              <div className="flex flex-col gap-4">
                {articles.map((article) => <RowCard key={article.short_id} article={article} />)}
              </div>
              {nextOffset != null ? (
                <button
                  type="button"
                  onClick={loadMore}
                  className={`${teCls} mt-6 w-full border border-rule bg-paper py-3 text-[13.5px] font-bold text-ink hover:border-brand hover:text-brand`}
                >
                  {te ? 'మరిన్ని ఫలితాలు' : 'More results'}
                </button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
