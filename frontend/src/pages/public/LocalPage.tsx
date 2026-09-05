import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { useReaderPrefs } from '@/stores/readerPrefs';
import type { ArticleCard as ArticleCardType } from '@/types/public';

/**
 * Local feed (updated doc §1.4/§4): the reader picks
 * state → district → mandal, and stories for the exact location rank above
 * parent-level stories. The choice persists in `readerPrefs`, shared with the
 * edition selector in the header and the reader's saved server preferences.
 */
export default function LocalPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';

  const { edition, mandal, setEdition, setLocalLevels } = useReaderPrefs();
  const [offset, setOffset] = useState(0);
  const [extra, setExtra] = useState<ArticleCardType[]>([]);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const [stateCode, setStateCode] = useState<string>(() => {
    const district = config.data?.districts.find((d) => d.slug === edition);
    return district?.state ?? '';
  });

  const effectiveState = useMemo(() => {
    if (stateCode) return stateCode;
    return config.data?.districts.find((d) => d.slug === edition)?.state ?? '';
  }, [stateCode, config.data, edition]);

  const districts = useMemo(
    () => (config.data?.districts ?? []).filter((d) => !effectiveState || d.state === effectiveState),
    [config.data, effectiveState],
  );

  const mandals = useQuery({
    queryKey: ['public', 'mandals', edition],
    queryFn: () => publicApi.fetchDistrictMandals(edition!),
    enabled: Boolean(edition),
    staleTime: 3_600_000,
  });

  const feed = useQuery({
    queryKey: ['public', 'local', edition, mandal],
    queryFn: () => publicApi.fetchLocalFeed({ district: edition!, mandal: mandal ?? undefined, limit: 20 }),
    enabled: Boolean(edition),
  });

  function selectDistrict(slug: string) {
    setEdition(slug || null);
    setOffset(0);
    setExtra([]);
  }

  function selectMandal(slug: string) {
    setLocalLevels(slug || null, null);
    setOffset(0);
    setExtra([]);
  }

  async function loadMore() {
    if (!edition || feed.data?.next_offset == null) return;
    const nextOffset = offset === 0 ? feed.data.next_offset : offset;
    const page = await publicApi.fetchLocalFeed({
      district: edition,
      mandal: mandal ?? undefined,
      offset: nextOffset,
      limit: 20,
    });
    setExtra((current) => [...current, ...page.articles]);
    setOffset(page.next_offset ?? -1);
  }

  const articles = [...(feed.data?.articles ?? []), ...extra];
  const hasMore = offset !== -1 && (offset > 0 || feed.data?.next_offset != null);

  return (
    <main className="mx-auto min-h-[55vh] max-w-[900px] px-4 py-7 sm:py-10">
      <div className="mb-6 border-b-2 border-ink pb-4">
        <p className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {te ? 'లోకల్ వార్తలు' : 'LOCAL NEWS'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[27px] font-extrabold text-ink sm:text-[32px]`}>
          {feed.data?.district
            ? pick(feed.data.district.name_te, feed.data.district.name_en)
            : te ? 'మీ ప్రాంతం వార్తలు' : 'News from your area'}
          {feed.data?.mandal ? (
            <span className="text-muted"> · {pick(feed.data.mandal.name_te, feed.data.mandal.name_en)}</span>
          ) : null}
        </h1>
      </div>

      {/* ------------------------------------------ location selectors ------ */}
      <div className="mb-7 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
            {te ? 'రాష్ట్రం' : 'State'}
          </span>
          <select
            value={effectiveState}
            onChange={(e) => { setStateCode(e.target.value); selectDistrict(''); }}
            className={`${teCls} w-full rounded-control border border-rule-input bg-white px-2 py-2.5 text-[14px]`}
          >
            <option value="">{te ? '— ఎంచుకోండి —' : '— choose —'}</option>
            {config.data?.states.map((s) => (
              <option key={s.code} value={s.code}>{pick(s.name_te, s.name_en)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
            {te ? 'జిల్లా' : 'District'}
          </span>
          <select
            value={edition ?? ''}
            onChange={(e) => selectDistrict(e.target.value)}
            className={`${teCls} w-full rounded-control border border-rule-input bg-white px-2 py-2.5 text-[14px]`}
          >
            <option value="">{te ? '— ఎంచుకోండి —' : '— choose —'}</option>
            {districts.map((d) => (
              <option key={d.slug} value={d.slug}>{pick(d.name_te, d.name_en)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
            {te ? 'మండలం' : 'Mandal'}
          </span>
          <select
            value={mandal ?? ''}
            onChange={(e) => selectMandal(e.target.value)}
            disabled={!edition || !mandals.data?.length}
            className={`${teCls} w-full rounded-control border border-rule-input bg-white px-2 py-2.5 text-[14px] disabled:bg-paper-sub`}
          >
            <option value="">{te ? '— అన్నీ —' : '— all —'}</option>
            {mandals.data?.map((m) => (
              <option key={m.slug} value={m.slug}>{pick(m.name_te, m.name_en)}</option>
            ))}
          </select>
        </label>
      </div>

      {/* ------------------------------------------ feed -------------------- */}
      {!edition ? (
        <p className={`${teCls} rounded border border-rule bg-paper px-4 py-6 text-center text-[14.5px] text-muted`}>
          {te
            ? 'మీ జిల్లాను ఎంచుకోండి — మీ ప్రాంత వార్తలు ఇక్కడ కనిపిస్తాయి.'
            : 'Choose your district to see news from your area.'}
        </p>
      ) : feed.isLoading ? (
        <p className={`${teCls} text-muted`}>{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : feed.isError ? (
        <p className={`${teCls} text-brand`}>
          {te ? 'ఫీడ్ లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.' : 'Could not load the feed. Try again.'}
        </p>
      ) : articles.length === 0 ? (
        <p className={`${teCls} rounded border border-rule bg-paper px-4 py-6 text-center text-[14.5px] text-muted`}>
          {te ? 'ఈ ప్రాంతానికి ఇంకా వార్తలు లేవు.' : 'No stories for this area yet.'}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-4" aria-live="polite">
            {articles.map((article) => (
              <RowCard key={article.short_id} article={article} />
            ))}
          </div>
          {hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              className={`${teCls} mt-6 w-full border border-rule bg-paper py-3 text-[13.5px] font-bold text-ink hover:border-brand hover:text-brand`}
            >
              {te ? 'మరిన్ని వార్తలు' : 'Load more'}
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}
