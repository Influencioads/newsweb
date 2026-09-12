import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search, SearchX, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { RowCard } from '@/components/article/ArticleCard';
import { Button, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageContainer, PageHeader, SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Reader search (updated doc §10): full-text with category/district filters,
 * popular/recent suggestion chips, and offset paging against `/public/search`.
 *
 * The query lives in the URL (`?q=&category=&district=`) so a result page is
 * shareable and the back button works; the input holds the draft until submit.
 * Paging is an infinite query pulled by an IntersectionObserver on the "more
 * results" button, which stays the accessible path to the same call.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const category = params.get('category') ?? '';
  const district = params.get('district') ?? '';
  const [value, setValue] = useState(query);
  const { t, pick, language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLLIElement>();
  const sentinel = useRef<HTMLDivElement | null>(null);

  useDocumentTitle(query || t('page.search'));

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

  const result = useInfiniteQuery({
    queryKey: ['public', 'search', query, category, district],
    queryFn: ({ pageParam }) =>
      publicApi.fetchSearch({
        q: query,
        category: category || undefined,
        district: district || undefined,
        offset: pageParam,
        limit: 20,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: query.length >= 2,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = result;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** A search term shorter than two characters is dropped, not searched. */
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

  function runSuggestion(term: string) {
    setValue(term);
    apply({ q: term });
  }

  const suggestions = meta.data?.recent.length ? meta.data.recent : meta.data?.popular ?? [];
  const suggestionTitle = meta.data?.recent.length
    ? L('మీ ఇటీవలి శోధనలు', 'Your recent searches')
    : L('ప్రజాదరణ పొందిన శోధనలు', 'Popular searches');

  return (
    <PageContainer width="page" className="py-7 md:py-10">
      <PageHeader
        eyebrow={L('వార్తల అన్వేషణ', 'News search')}
        icon={Search}
        title={L('మీకు కావాల్సిన వార్తను వెతకండి', 'Find the story you need')}
        subtitle={L(
          'శీర్షిక, అంశం లేదా పేరుతో వెతకండి — విభాగం, జిల్లా వారీగా వడపోయవచ్చు.',
          'Search by headline, topic or name — then narrow it by section and district.',
        )}
      />

      <div className="space-y-7 md:space-y-10">
        <form onSubmit={submit} role="search" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1">
              <label htmlFor="news-search" className="sr-only">
                {L('వార్తలు వెతకండి', 'Search news')}
              </label>
              <Input
                id="news-search"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                size="lg"
                leading={Search}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={L('శీర్షిక, అంశం లేదా పేరు…', 'Headline, topic or name…')}
                trailing={
                  value ? (
                    <IconButton
                      icon={X}
                      label={t('ui.clear')}
                      onClick={() => {
                        setValue('');
                        apply({ q: '' });
                      }}
                    />
                  ) : undefined
                }
              />
            </div>
            <Button type="submit" size="lg" icon={Search}>
              {t('ui.search')}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('విభాగం', 'Section')}>
              <Select value={category} onChange={(e) => apply({ category: e.target.value })}>
                <option value="">{L('అన్ని విభాగాలు', 'All sections')}</option>
                {config.data?.categories
                  .filter((c) => c.show_in_nav)
                  .map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {pick(c.name_te, c.name_en)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t('page.district')}>
              <Select value={district} onChange={(e) => apply({ district: e.target.value })}>
                <option value="">{L('అన్ని జిల్లాలు', 'All districts')}</option>
                {config.data?.districts.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {pick(d.name_te, d.name_en)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </form>

        {!query && suggestions.length ? (
          <section>
            <SectionHeader level={3} title={suggestionTitle} />
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 10).map((term) => (
                <Chip key={term} icon={Search} onClick={() => runSuggestion(term)}>
                  {term}
                </Chip>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          {query.length < 2 ? (
            <EmptyState
              icon={Search}
              title={L('వెతకడం మొదలుపెట్టండి', 'Start your search')}
              body={L(
                'కనీసం రెండు అక్షరాలు టైప్ చేసి ఎంటర్ నొక్కండి.',
                'Type at least two characters, then press enter.',
              )}
            />
          ) : (
            <QueryState
              query={result}
              isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
              empty={
                <EmptyState
                  icon={SearchX}
                  title={t('state.noResults')}
                  body={L(
                    'వేరే పదాలతో ప్రయత్నించండి, లేదా విభాగం/జిల్లా వడపోతను తీసేయండి.',
                    'Try different words, or clear the section and district filters.',
                  )}
                />
              }
            >
              {(data) => {
                const articles = data.pages.flatMap((page) => page.articles);
                const total = data.pages[0]?.total ?? articles.length;
                return (
                  <>
                    <SectionHeader level={2} tone="ink" title={L(`${total} ఫలితాలు`, `${total} results`)} />
                    {/* The count is what changes; the list itself is not a live region. */}
                    <p aria-live="polite" className="sr-only">
                      {L(`${total} ఫలితాలు`, `${total} results`)}
                    </p>
                    <ul className="flex flex-col gap-4">
                      {articles.map((article) => (
                        <li key={article.short_id} ref={reveal}>
                          <RowCard article={article} />
                        </li>
                      ))}
                    </ul>

                    {isFetchingNextPage ? (
                      <div className="mt-4">
                        <SkeletonCard variant="row" />
                      </div>
                    ) : null}

                    {hasNextPage ? (
                      <div ref={sentinel} className="mt-6">
                        <Button
                          variant="secondary"
                          full
                          pending={isFetchingNextPage}
                          onClick={() => void fetchNextPage()}
                        >
                          {t('ui.loadMore')}
                        </Button>
                      </div>
                    ) : null}
                  </>
                );
              }}
            </QueryState>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
