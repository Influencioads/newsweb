import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { RowCard } from '@/components/article/ArticleCard';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const [value, setValue] = useState(query);
  const { language } = useI18n();
  const te = language === 'te';

  const result = useQuery({
    queryKey: ['public', 'search', query],
    queryFn: () => publicApi.fetchFeed({ q: query, limit: 30 }),
    enabled: query.length >= 2,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = value.trim();
    setParams(next.length >= 2 ? { q: next } : {});
  }

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
          placeholder={te ? 'శీర్షిక లేదా అంశం…' : 'Headline or topic…'}
          className={`${te ? 'te' : 'font-sans'} min-w-0 flex-1 bg-transparent px-3 py-3 text-[16px] text-ink outline-none`}
        />
        <button className={`${te ? 'te' : 'font-sans'} bg-brand px-5 font-bold text-white hover:bg-brand-dark`} type="submit">
          {te ? 'వెతకండి' : 'Search'}
        </button>
      </form>
      <p className={`${te ? 'te' : 'font-sans'} mt-2 text-[12px] text-muted`}>
        {te ? 'కనీసం రెండు అక్షరాలు నమోదు చేయండి.' : 'Enter at least two characters.'}
      </p>

      {query.length >= 2 ? (
        <section className="mt-8" aria-live="polite">
          {result.isLoading ? <p className={`${te ? 'te' : 'font-sans'} text-muted`}>{te ? 'వెతుకుతోంది…' : 'Searching…'}</p> : null}
          {result.isError ? <p className={`${te ? 'te' : 'font-sans'} text-brand`}>{te ? 'శోధన విఫలమైంది. మళ్లీ ప్రయత్నించండి.' : 'Search failed. Please try again.'}</p> : null}
          {result.data ? (
            <>
              <h2 className={`${te ? 'th' : 'font-sans'} mb-4 text-[18px] font-bold text-ink`}>
                {result.data.articles.length
                  ? te ? `“${query}” కోసం ${result.data.articles.length} ఫలితాలు` : `${result.data.articles.length} results for “${query}”`
                  : te ? `“${query}” కోసం వార్తలు దొరకలేదు` : `No stories found for “${query}”`}
              </h2>
              <div className="flex flex-col gap-4">
                {result.data.articles.map((article) => <RowCard key={article.short_id} article={article} />)}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
