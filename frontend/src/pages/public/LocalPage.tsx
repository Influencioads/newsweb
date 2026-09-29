import { useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';

import { RowCard } from '@/components/article/ArticleCard';
import { LocationPicker, useReaderPlace } from '@/components/location/LocationPicker';
import { Button } from '@/components/ui/Button';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useReaderPrefs } from '@/stores/readerPrefs';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Local feed (updated doc §1.4/§4): the reader picks state → district → mandal
 * → village, and stories for the exact location rank above parent-level
 * stories. The choice persists in `readerPrefs` (via `useReaderPlace`), shared
 * with the masthead's location button and the reader's saved server
 * preferences.
 */
export default function LocalPage() {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);

  const { edition, mandal, locality } = useReaderPrefs();
  const place = useReaderPlace();
  const reveal = useReveal<HTMLLIElement>();
  const sentinel = useRef<HTMLDivElement | null>(null);

  const feed = useInfiniteQuery({
    queryKey: ['public', 'local', edition, mandal, locality],
    queryFn: ({ pageParam }) =>
      publicApi.fetchLocalFeed({
        district: edition as string,
        mandal: mandal ?? undefined,
        locality: locality ?? undefined,
        offset: pageParam,
        limit: 20,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: Boolean(edition),
  });

  const head = feed.data?.pages[0];
  const districtName = head?.district ? s.text(head.district.name_te, head.district.name_en) : null;
  const mandalName = head?.mandal ? s.text(head.mandal.name_te, head.mandal.name_en) : null;
  useDocumentTitle(districtName?.text ?? t('page.local'));

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
        eyebrow={t('ui.local')}
        icon={MapPin}
        title={districtName?.text ?? L('మీ ప్రాంతం వార్తలు', 'News from your area')}
        titleLang={districtName?.lang}
        subtitle={mandalName?.text}
      />

      <div className="space-y-7 md:space-y-10">
        <LocationPicker levels="locality" {...place} />

        {!edition ? (
          <EmptyState
            icon={MapPin}
            title={L('మీ జిల్లాను ఎంచుకోండి', 'Choose your district')}
            body={L(
              'మీ ప్రాంత వార్తలు ఇక్కడ కనిపిస్తాయి — మండలం ఎంచుకుంటే ఆ వార్తలు ముందుగా.',
              'News from your area appears here — pick a mandal and those stories rank first.',
            )}
          />
        ) : (
          <section>
            <QueryState
              query={feed}
              isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
              empty={
                <EmptyState
                  icon={MapPin}
                  title={t('state.empty')}
                  body={L(
                    'ఈ ప్రాంతానికి ఇంకా వార్తలు లేవు. వేరే మండలం ప్రయత్నించండి.',
                    'No stories for this area yet. Try another mandal.',
                  )}
                />
              }
            >
              {(data) => (
                <>
                  <ul className="flex flex-col gap-4">
                    {data.pages
                      .flatMap((page) => page.articles)
                      .map((article) => (
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
              )}
            </QueryState>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
