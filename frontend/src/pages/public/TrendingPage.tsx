import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Trending (§8): time-decayed engagement with unique-reader dedup, computed
 * from the behaviour event stream. Rank numbers make the order legible.
 *
 * Paging is an infinite query: an IntersectionObserver on the "load more"
 * button pulls the next page as it comes into view, and the button itself
 * stays the accessible (and no-JS-observer) path to the same call.
 */
export default function TrendingPage() {
  const { t, pick, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [category, setCategory] = useState('');
  const reveal = useReveal<HTMLLIElement>();
  const sentinel = useRef<HTMLDivElement | null>(null);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['public', 'trending', category],
    queryFn: ({ pageParam }) =>
      publicApi.fetchTrending({ category: category || undefined, offset: pageParam, limit: 20 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });

  const tabs = config.data?.categories.filter((c) => c.show_in_nav).slice(0, 10) ?? [];
  const active = tabs.find((c) => c.slug === category);
  useDocumentTitle(active ? pick(active.name_te, active.name_en) : t('page.trending'));

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
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

  return (
    <PageContainer width="page" className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('ui.trendingNow')}
        icon={Flame}
        title={t('page.trending')}
        subtitle={L(
          'పాఠకుల చదువు, షేర్లు, ఇష్టాల ఆధారంగా — తాజా ఆసక్తికి ఎక్కువ ప్రాధాన్యం.',
          'Ranked by reads, shares and likes — recent interest weighs most.',
        )}
      />

      <div className="space-y-7 md:space-y-10">
        <ChipRail ariaLabel={t('ui.sections')}>
          <Chip selected={!category} onClick={() => setCategory('')}>
            {t('ui.showAll')}
          </Chip>
          {tabs.map((c) => (
            <Chip
              key={c.slug}
              selected={category === c.slug}
              onClick={() => setCategory(category === c.slug ? '' : c.slug)}
              lang={s.forText(c.name_te, c.name_en).lang}
            >
              {pick(c.name_te, c.name_en)}
            </Chip>
          ))}
        </ChipRail>

        <QueryState
          query={feed}
          isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
          empty={<EmptyState icon={Flame} title={t('state.empty')} />}
        >
          {(data) => {
            const articles = data.pages.flatMap((page) => page.articles);
            return (
              <>
                <ol className="flex flex-col gap-4">
                  {articles.map((article, index) => (
                    <li key={article.short_id} ref={reveal} className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={cn(
                          'mt-2 w-8 shrink-0 text-right font-sans text-headline-md font-extrabold tabular-nums',
                          // rule-strong is a hairline border colour (~1.2:1 on
                          // the surface) — never a text colour.
                          index < 3 ? 'text-brand' : 'text-muted',
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <RowCard article={article} />
                      </div>
                    </li>
                  ))}
                </ol>

                {feed.isFetchingNextPage ? (
                  <div className="mt-4">
                    <SkeletonCard variant="row" />
                  </div>
                ) : null}

                {hasNextPage ? (
                  <div ref={sentinel} className="mt-6">
                    <Button
                      variant="secondary"
                      full
                      pending={feed.isFetchingNextPage}
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
      </div>
    </PageContainer>
  );
}
