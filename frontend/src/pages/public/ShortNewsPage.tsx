import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, Zap } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { relativeTime } from '@/utils/time';

/**
 * Short news (updated doc §14): one full-height quick-read card per viewport,
 * scroll-snap giving the swipe feel on touch. Headline + image + the 2–5 line
 * editorial standfirst; the card links into the full story.
 */
export default function ShortNewsPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const feed = useInfiniteQuery({
    queryKey: ['public', 'short-news'],
    queryFn: ({ pageParam }) =>
      publicApi.fetchShortNews({ offset: pageParam, limit: 10 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });

  const articles = feed.data?.pages.flatMap((page) => page.articles) ?? [];

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
    <main className="mx-auto max-w-[560px]">
      <div className="sticky top-[41px] z-30 flex items-center justify-between border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur-sm">
        <p className={`${te ? 'th' : 'font-sans'} flex items-center gap-1.5 text-[15px] font-extrabold text-brand`}>
          <Zap className="h-4 w-4" aria-hidden />
          {te ? 'షార్ట్ న్యూస్' : 'Short News'}
        </p>
        <p className={`${teCls} text-[11px] text-muted`}>
          {te ? 'స్క్రోల్ చేసి చదవండి' : 'Scroll to read'}
        </p>
      </div>

      {feed.isLoading ? (
        <p className={`${teCls} px-4 py-10 text-center text-muted`}>
          {te ? 'లోడ్ అవుతోంది…' : 'Loading…'}
        </p>
      ) : feed.isError ? (
        <p className={`${teCls} px-4 py-10 text-center text-brand`}>
          {te ? 'లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.' : 'Could not load. Try again.'}
        </p>
      ) : articles.length === 0 ? (
        <p className={`${teCls} px-4 py-10 text-center text-muted`}>
          {te ? 'ఇంకా షార్ట్ న్యూస్ లేవు.' : 'No short news yet.'}
        </p>
      ) : (
        <div
          className="h-[calc(100vh-140px)] snap-y snap-mandatory overflow-y-auto overscroll-contain"
          aria-label={te ? 'షార్ట్ న్యూస్ కార్డులు' : 'Short news cards'}
        >
          {articles.map((article, index) => (
            <article
              key={article.short_id}
              className="flex h-full snap-start flex-col border-b border-rule bg-white"
            >
              {article.hero ? (
                <div className="max-h-[42%] shrink-0 overflow-hidden">
                  <NewsImage media={article.hero} sizes="560px" className="h-full w-full object-cover" />
                </div>
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col p-5">
                <div className="flex items-center gap-2">
                  {article.category ? (
                    <span className={`${teCls} text-[10.5px] font-bold uppercase tracking-[0.08em] text-brand`}>
                      {pick(article.category.name_te, article.category.name_en)}
                    </span>
                  ) : null}
                  <span className="font-sans text-[10.5px] text-muted-light">
                    {relativeTime(article.published_at, language)}
                  </span>
                </div>
                <h2 lang="te" className="te mt-2 text-[20px] font-extrabold leading-telugu-headline text-ink">
                  {article.title_te}
                </h2>
                {article.summary_te ? (
                  <p lang="te" className="te mt-3 min-h-0 flex-1 overflow-hidden text-[15px] leading-telugu text-ink-soft">
                    {article.summary_te}
                  </p>
                ) : null}
                <Link
                  to={article.url}
                  className={`${teCls} mt-4 inline-flex w-fit items-center gap-1 rounded-control border border-brand px-4 py-2 text-[12.5px] font-bold text-brand hover:bg-brand-tint`}
                >
                  {te ? 'పూర్తి కథనం చదవండి →' : 'Read the full story →'}
                </Link>
              </div>
              {index < articles.length - 1 ? (
                <p className="pb-2 text-center text-muted-light" aria-hidden>
                  <ChevronDown className="mx-auto h-4 w-4 animate-bounce" />
                </p>
              ) : null}
            </article>
          ))}
          <div ref={sentinelRef} className="h-2" />
        </div>
      )}
    </main>
  );
}
