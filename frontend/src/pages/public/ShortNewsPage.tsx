import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
 * the card links into the full story.
 *
 * The deck is exactly `100dvh - var(--header-h)` tall — the shell publishes that
 * variable, so the deck never has to guess a header height — and each slide is
 * `min-h-full`, never `h-full`: a long Telugu standfirst clamps by lines
 * (te-clamp-4) and the card grows rather than hiding text behind overflow.
 */

/** How many progress dots can sit on a phone without becoming a grey smear. */
const DOT_WINDOW = 7;

/** One quick-read card; the last slide drops the "scroll on" chevron. */
function QuickCard({
  article,
  index,
  total,
}: {
  article: ArticleCard;
  /** 0-based position in the deck — the feed's posinset and the chevron cue. */
  index: number;
  total: number;
}) {
  const { pick, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const title = s.forText(article.title_te, article.title_en);
  const category = article.category && s.forText(article.category.name_te, article.category.name_en);
  return (
    // role="feed" children have to state their position and be focusable, so a
    // screen reader can step the deck article by article.
    <article
      aria-posinset={index + 1}
      aria-setsize={total}
      tabIndex={-1}
      className="flex min-h-full snap-start snap-always p-3"
    >
      <Card as="div" padding="none" className="flex w-full flex-col overflow-hidden rounded-2xl">
        {article.hero && <NewsImage media={article.hero} ratio="16/9" sizes="560px" />}
        <div className="flex flex-1 flex-col p-5">
          <div className="flex flex-wrap items-center gap-2">
            {article.category && category && (
              <Badge tone="brand" size="xs" lang={category.lang}>
                {pick(article.category.name_te, article.category.name_en)}
              </Badge>
            )}
            <span lang={language} className={cn(s.body, 'text-meta text-muted')}>
              {relativeTime(article.published_at, language)}
            </span>
          </div>
          <h2 lang={title.lang} className={cn(title.head, 'te-clamp-4 mt-2 text-headline-md font-extrabold text-ink')}>
            {pick(article.title_te, article.title_en)}
          </h2>
          {article.summary_te && (
            <p lang="te" className="te te-clamp-4 mt-3 text-te-body-xs text-ink-soft">
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
        {index < total - 1 && (
          <p aria-hidden className="pb-2 text-center text-muted">
            <Icon icon={ChevronDown} size="sm" className="mx-auto animate-bounce" />
          </p>
        )}
      </Card>
    </article>
  );
}

/** Which slide fills the deck right now, from the container's scroll position. */
function useDeckProgress(total: number) {
  const deck = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);

  const measure = useCallback(() => {
    const el = deck.current;
    if (!el) return;
    // Slides are elastic, so the index is the first slide whose bottom edge is
    // still below the fold rather than scrollTop / slideHeight.
    const slides = Array.from(el.children) as HTMLElement[];
    const at = slides.findIndex((slide) => slide.offsetTop + slide.offsetHeight > el.scrollTop + 4);
    setIndex(at < 0 ? Math.max(0, slides.length - 1) : at);
  }, []);

  useEffect(() => {
    const el = deck.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    return () => el.removeEventListener('scroll', measure);
  }, [measure, total]);

  return { deck, index: Math.min(index, Math.max(0, total - 1)) };
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

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];
  const { deck, index } = useDeckProgress(articles.length);

  // Fetch the next batch as the reader approaches the bottom of the deck.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // A long deck would otherwise grow an unreadable rail of dots; window it.
  const first = Math.max(0, Math.min(index - Math.floor(DOT_WINDOW / 2), articles.length - DOT_WINDOW));
  const dots = articles.slice(first, first + DOT_WINDOW);

  return (
    // dvh, not vh: mobile browser chrome would otherwise push the progress dots
    // below the fold. Sticky under the nav so the window itself does not scroll.
    <PageContainer width="form" className="sticky top-header flex h-[calc(100dvh-var(--header-h))] flex-col">
      {/* Sub-header bleeds across the container gutters so nothing scrolls past its edges. */}
      <div className="glass sticky top-header z-30 -mx-4 flex shrink-0 items-center justify-between gap-3 border-b border-rule px-4 py-2 md:-mx-6 md:px-6">
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
        {() => (
          <div className="relative min-h-0 flex-1">
            <div
              ref={deck}
              role="feed"
              aria-label={t('page.shortNews')}
              aria-busy={isFetchingNextPage || undefined}
              className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
            >
              {articles.map((article, i) => (
                <QuickCard key={article.short_id} article={article} index={i} total={articles.length} />
              ))}
              {isFetchingNextPage && (
                <div className="p-5">
                  <SkeletonCard variant="row" />
                </div>
              )}
              <div ref={sentinelRef} className="h-2" />
            </div>

            <p role="status" lang={language} className={cn(s.body, 'sr-only')}>
              {L(`కథనం ${index + 1} / ${articles.length}`, `Story ${index + 1} of ${articles.length}`)}
            </p>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5"
            >
              {dots.map((article, i) => (
                <span
                  key={article.short_id}
                  className={cn(
                    'block rounded-pill transition-[colors,transform,box-shadow] duration-base ease-standard',
                    first + i === index ? 'h-2 w-5 bg-brand' : 'h-2 w-2 bg-rule-strong',
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </QueryState>
    </PageContainer>
  );
}
