import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Radio, RefreshCw } from 'lucide-react';

import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { relativeTime } from '@/utils/time';

export default function LiveNewsPage() {
  const { language, pick, isFallback } = useI18n();
  const te = language === 'te';
  const { data = [], isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['public', 'breaking'],
    queryFn: publicApi.fetchBreaking,
    refetchInterval: 25_000,
  });

  return (
    <main className="mx-auto max-w-[860px] px-4 py-7">
      <div className="mb-6 flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-breaking">
            <Radio className="h-5 w-5 animate-pulse" aria-hidden />
            <span className="font-sans text-[11px] font-extrabold uppercase tracking-[0.16em]">Live</span>
          </div>
          <h1 className={`${te ? 'th' : 'font-sans'} text-[28px] font-extrabold text-ink`}>
            {te ? 'తాజా వార్తలు — ప్రత్యక్ష అప్‌డేట్లు' : 'Breaking news — live updates'}
          </h1>
          <p className={`${te ? 'te' : 'font-sans'} mt-1 text-[13px] text-muted`}>
            {te ? 'ముఖ్యమైన వార్తలు వచ్చిన వెంటనే ఇక్కడ అప్‌డేట్ అవుతాయి.' : 'Important developments, updated here as they happen.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="flex min-h-tap shrink-0 items-center gap-1.5 rounded-control border border-rule px-3 text-[12px] font-semibold text-muted hover:border-brand hover:text-brand"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {te ? 'రిఫ్రెష్' : 'Refresh'}
        </button>
      </div>

      {isLoading ? <p className={`${te ? 'te' : 'font-sans'} text-muted`}>{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p> : null}
      <ol className="relative ml-2 border-l border-rule pl-6">
        {data.map((item, index) => {
          const fallback = isFallback(item.title_te, item.title_en);
          return (
            <li key={item.short_id} className="relative border-b border-rule py-5 first:pt-1">
              <span className={`absolute -left-[31px] top-6 h-3 w-3 rounded-full border-2 border-white ${index === 0 ? 'bg-breaking ring-4 ring-red-50' : 'bg-muted-light'}`} />
              <p className="mb-1 font-sans text-[11px] font-semibold text-muted">
                {item.published_at ? relativeTime(item.published_at, language) : te ? 'ఇప్పుడే' : 'Just now'}
              </p>
              <Link
                to={item.url}
                lang={te || fallback ? 'te' : 'en'}
                className={`${te || fallback ? 'th' : 'font-sans'} text-[20px] font-bold leading-[1.55] text-ink hover:text-brand`}
              >
                {pick(item.title_te, item.title_en)}
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-5 font-sans text-[11px] text-muted-light">
        {te ? 'చివరిసారి నవీకరించబడింది' : 'Last refreshed'}: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
      </p>
    </main>
  );
}
