import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Sparkles, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ShortNewsItem } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * Short news (§14): one picture card per viewport, scroll-snap giving the
 * swipe feel on touch. The desk adds 4:5 and 9:16 news cards each day; the
 * words are in the picture, so it is shown whole (`object-contain`, never
 * cropped) on a blurred copy of itself. A card whose story is published links
 * to it.
 *
 * The deck ends at the bottom of the screen as the page opens: its height is
 * measured from where it starts (under the masthead and the section nav), so a
 * 9:16 card's last line is never below the fold. The deck scrolls itself and
 * holds the scroll (`overscroll-contain`), so the window would never move to
 * reveal it.
 */

/** How many progress dots can sit on a phone without becoming a grey smear. */
const DOT_WINDOW = 7;

function ShortSlide({ item, index, total }: { item: ShortNewsItem; index: number; total: number }) {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const img = item.image;
  // The backdrop is blurred to mush: the smallest rendition is plenty.
  const backdrop = img.srcset?.split(',')[0]?.trim().split(' ')[0] || img.url;
  return (
    // role="feed" children have to state their position and be focusable, so a
    // screen reader can step the deck card by card.
    <article
      aria-posinset={index + 1}
      aria-setsize={total}
      tabIndex={-1}
      className="relative flex h-full snap-start snap-always flex-col items-center justify-center gap-3 overflow-hidden bg-overlay p-3 pb-6"
    >
      {img.url ? (
        <>
          <img
            aria-hidden
            src={backdrop ?? undefined}
            alt=""
            loading={index < 2 ? 'eager' : 'lazy'}
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
          />
          <img
            src={img.url}
            {...(img.srcset ? { srcSet: img.srcset } : {})}
            sizes="(min-width: 640px) 560px, 100vw"
            // The words are in the picture: the alt is what a screen reader has.
            alt={img.alt_te || `${t('page.shortNews')} ${index + 1}`}
            width={img.width ?? undefined}
            height={img.height ?? undefined}
            loading={index < 2 ? 'eager' : 'lazy'}
            decoding="async"
            className="relative min-h-0 max-h-full max-w-full rounded-xl object-contain"
          />
        </>
      ) : null}
      {/* §7.4 — an AI-made picture is labelled wherever it shows. */}
      {img.ai_generated ? (
        <Badge tone="ai" size="xs" icon={Sparkles} className="absolute left-5 top-5">
          {t('article.aiImage')}
        </Badge>
      ) : null}
      {/* Below the picture, never over it: a card's last line is often its source. */}
      {item.article_url ? (
        <ButtonLink to={item.article_url} size="sm" iconRight={ChevronRight} className="shrink-0">
          {L('పూర్తి కథనం చదవండి', 'Read the full story')}
        </ButtonLink>
      ) : null}
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

  // Where the deck starts in the document. A static zero-height anchor, so a
  // sticky offset or a scroll still in flight from the last page cannot skew it.
  const anchor = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (anchor.current) setTop(Math.round(anchor.current.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    // The masthead reflows when the Telugu font lands or the width changes.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const feed = useInfiniteQuery({
    queryKey: ['public', 'short-news'],
    queryFn: ({ pageParam }) => publicApi.fetchShortNews({ offset: pageParam, limit: 10 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next_cursor ? Number(last.next_cursor) : undefined),
  });

  // Offset pages over a newest-first feed: cards added while the reader scrolls
  // push older ones into the next page, so a card can come back. Show it once.
  const seen = new Set<number>();
  const items = (feed.data?.pages.flatMap((page) => page.items) ?? []).filter((i) => !seen.has(i.id) && !!seen.add(i.id));
  const { deck, index } = useDeckProgress(items.length);

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
  const first = Math.max(0, Math.min(index - Math.floor(DOT_WINDOW / 2), items.length - DOT_WINDOW));
  const dots = items.slice(first, first + DOT_WINDOW);

  return (
    // dvh, not vh: mobile browser chrome would otherwise push the progress dots
    // below the fold. Stops short of the audio player dock, which body padding
    // cannot clear here.
    <>
      <div ref={anchor} aria-hidden />
      <PageContainer width="form" className="sticky top-header">
        <div
          className="flex flex-col"
          style={{ height: `calc(100dvh - ${top === null ? 'var(--header-h)' : `${top}px`} - var(--player-dock-h, 0px))` }}
        >
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
            isEmpty={(data) => !data.pages.some((page) => page.items.length)}
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
                  {items.map((item, i) => (
                    <ShortSlide key={item.id} item={item} index={i} total={items.length} />
                  ))}
                  {isFetchingNextPage && (
                    <div className="p-5">
                      <SkeletonCard variant="row" />
                    </div>
                  )}
                  <div ref={sentinelRef} className="h-2" />
                </div>

                <p role="status" lang={language} className={cn(s.body, 'sr-only')}>
                  {L(`కార్డ్ ${index + 1} / ${items.length}`, `Card ${index + 1} of ${items.length}`)}
                </p>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5"
                >
                  {dots.map((item, i) => (
                    <span
                      key={item.id}
                      className={cn(
                        'block rounded-pill transition-[colors,transform,box-shadow] duration-base ease-standard',
                        first + i === index ? 'h-2 w-5 bg-brand' : 'h-2 w-2 bg-on-ink/50',
                      )}
                    />
                  ))}
                </div>
              </div>
            )}
          </QueryState>
        </div>
      </PageContainer>
    </>
  );
}
