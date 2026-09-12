import { useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';
import { relativeTime } from '@/utils/time';

/**
 * Short news (§14): one quick-read card per viewport, scroll-snap giving the
 * swipe feel on touch. Headline + image + the 2–5 line editorial standfirst;
 * the card links into the full story. Cards are `min-h-full`, never `h-full`:
 * a long Telugu standfirst clamps by lines (te-clamp-4) and the card grows
 * rather than hiding text behind overflow.
 */

/** One quick-read card; `last` drops the "scroll on" chevron. */
function QuickCard({ article, last }: { article: ArticleCard; last: boolean }) {
  const { pick, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const title = s.forText(article.title_te, article.title_en);
  const category = article.category && s.forText(article.category.name_te, article.category.name_en);
  return (
    <article className="flex min-h-full snap-start flex-col border-b border-rule bg-surface">
      {article.hero && <NewsImage media={article.hero} sizes="560px" />}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2">
          {article.category && category && (
            <Badge tone="brand" size="xs" lang={category.lang}>
              {pick(article.category.name_te, article.category.name_en)}
            </Badge>
          )}
          <span className="font-sans text-meta text-muted-light">{relativeTime(article.published_at, language)}</span>
        </div>
        <h2 lang={title.lang} className={cn(title.head, 'mt-2 text-headline-md font-extrabold text-ink')}>
          {pick(article.title_te, article.title_en)}
        </h2>
        {article.summary_te && (
          <p lang="te" className="te mt-3 text-te-body-xs text-ink-soft te-clamp-4">
            {article.summary_te}
          </p>
        )}
        <ButtonLink
          to={article.url}
          variant="secondary"
          size="sm"
          iconRight={ChevronRight}
          className="mt-4 self-start"
        >
          {L('పూర్తి కథనం చదవండి', 'Read the full story')}
        </ButtonLink>
      </div>
      {!last && (
        <p aria-hidden className="pb-2 text-center text-muted-light">
          <Icon icon={ChevronDown} size="sm" className="mx-auto animate-bounce" />
        </p>
      )}
    </article>
  );
}

export default function ShortNewsPage() {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useDocumentTitle(t('page.shortNews'));

  const feed = useInfiniteQuery({
    queryKey: ['public', 'short-news'],
    queryFn: ({ pageParam }) => publicApi.fetchShortNews({ offset: pageParam, limit: 10 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });

  // Fetch the next batch as the reader approaches the bottom of the deck.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && feed.hasNextPage && !feed.isFetchingNextPage) {
        void feed.fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [feed]);

  return (
    <PageContainer width="form">
      {/* Sub-header bleeds across the container gutters so nothing scrolls past its edges. */}
      <div className="glass sticky top-header z-30 -mx-4 flex items-center justify-between gap-3 border-b border-rule px-4 py-2 md:-mx-6 md:px-6">
        <h1 className={cn(s.head, 'flex items-center gap-1.5 text-headline-xs font-extrabold text-brand')}>
          <Icon icon={Zap} size="sm" />
          {t('page.shortNews')}
        </h1>
        <p className={cn(s.body, 'text-meta text-muted')}>{L('స్క్రోల్ చేసి చదవండి', 'Scroll to read')}</p>
      </div>

      <QueryState
        query={feed}
        skeleton={
          <div className="py-4">
            <SkeletonCard variant="lead" />
          </div>
        }
        isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
        empty={<EmptyState icon={Zap} title={L('ఇంకా షార్ట్ న్యూస్ లేవు.', 'No short news yet.')} />}
      >
        {(data) => {
          const articles = data.pages.flatMap((page) => page.articles);
          return (
            <div
              role="feed"
              aria-label={t('page.shortNews')}
              aria-busy={feed.isFetchingNextPage || undefined}
              className="h-[calc(100dvh-140px)] snap-y snap-mandatory overflow-y-auto overscroll-contain"
            >
              {articles.map((article, index) => (
                <QuickCard key={article.short_id} article={article} last={index === articles.length - 1} />
              ))}
              {feed.isFetchingNextPage && (
                <div className="p-5">
                  <SkeletonCard variant="row" />
                </div>
              )}
              <div ref={sentinelRef} className="h-2" />
            </div>
          );
        }}
      </QueryState>
    </PageContainer>
  );
}
