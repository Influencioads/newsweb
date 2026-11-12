import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowRight, Flame, TrendingUp } from 'lucide-react';

import { ShareButton } from '@/components/article/ShareSheet';
import { NewsImage } from '@/components/media/NewsImage';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
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
 * Trending (§8): time-decayed engagement with unique-reader dedup, computed
 * from the behaviour event stream.
 *
 * Layout, top to bottom:
 *   - a deep-blue banner that says what the list is and how it is ranked;
 *   - section chips (All + the nav sections);
 *   - the podium: #1 as a large story with its photo, #2 and #3 beside it;
 *   - #4 onward as a numbered two-column list with thumbnails;
 *   - load more (also pulled automatically as it scrolls into view).
 *
 * The rank is the point of the page, so it is drawn big and in the WOW
 * orange on the podium, outlined on the rest.
 */

function useCategoryName() {
  const s = useScript();
  return (a: ArticleCard) => (a.category ? s.pick(a.category.name_te, a.category.name_en) : null);
}

function Rank({ n, size = 'md' }: { n: number; size?: 'lg' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep font-sans font-extrabold tabular-nums text-on-wow shadow-raised',
        size === 'lg' ? 'h-12 w-12 text-headline-md' : 'h-9 w-9 text-ui',
      )}
    >
      {n}
    </span>
  );
}

/** #1 — the big one. */
function TopStory({ article }: { article: ArticleCard }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const head = s.text(article.title_te, article.title_en);
  const category = useCategoryName()(article);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-rule bg-surface">
      {/* The photo grows to match the #2/#3 column on a desktop, so the card has no empty tail. */}
      <Link to={article.url} className="block min-h-0 flex-1">
        <div className="relative h-full">
          <NewsImage
            media={article.hero}
            ratio="16/9"
            radius="none"
            priority
            className="lg:h-full"
            sizes="(max-width: 1024px) 100vw, 720px"
          />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-overlay/85 via-overlay/20 to-transparent" />
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <Rank n={1} size="lg" />
            <span className={cn(s.body, 'rounded-pill bg-overlay/60 px-3 py-1 text-meta font-bold text-on-ink backdrop-blur')}>
              {te ? 'నంబర్ 1 ట్రెండింగ్' : 'No. 1 trending'}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 space-y-2 p-5 md:p-6">
            {category ? (
              <span className={cn(s.body, 'inline-block rounded-pill bg-on-ink/15 px-3 py-0.5 text-meta font-semibold text-on-ink backdrop-blur')}>
                {category}
              </span>
            ) : null}
            <h2 lang={head.lang} className={cn(head.head, 'text-headline-md font-bold text-on-ink md:text-headline-xl')}>
              {head.text}
            </h2>
          </div>
        </div>
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 md:px-6">
        {article.summary_te ? (
          <p lang="te" className="te te-clamp-2 min-w-0 flex-1 basis-72 text-te-body-xs text-ink-soft">
            {article.summary_te}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <ButtonLink to={article.url} variant="wow" size="sm" iconRight={ArrowRight}>
            {te ? 'చదవండి' : 'Read'}
          </ButtonLink>
          <ShareButton shortId={article.short_id} url={article.url} title={head.text} cardAvailable={false} />
        </div>
      </div>
    </article>
  );
}

/** #2 and #3 — photo on top, headline below. */
function PodiumCard({ article, rank }: { article: ArticleCard; rank: number }) {
  const { language } = useI18n();
  const s = useScript();
  const head = s.text(article.title_te, article.title_en);
  const category = useCategoryName()(article);
  return (
    <Link
      to={article.url}
      className="group flex h-full flex-row overflow-hidden rounded-2xl border border-rule bg-surface transition-[border-color,box-shadow] duration-base hover:border-wow hover:shadow-raised md:flex-col"
    >
      {/* Phones: thumbnail beside the headline so #2 and #3 do not each take a screen. */}
      <div className="relative w-36 shrink-0 self-stretch overflow-hidden md:w-auto md:self-auto">
        <NewsImage
          media={article.hero}
          ratio="16/9"
          radius="none"
          className="h-full w-full md:h-auto"
          sizes="(max-width: 768px) 144px, 420px"
        />
        <div className="absolute left-2 top-2 md:left-3 md:top-3">
          <Rank n={rank} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5 md:p-4">
        {category ? <span className={cn(s.body, 'text-meta font-bold text-wow-deep')}>{category}</span> : null}
        <h3 lang={head.lang} className={cn(head.head, 'te-clamp-3 text-headline-xs font-bold text-ink group-hover:text-brand')}>
          {head.text}
        </h3>
        <p className="mt-auto font-sans text-meta text-muted">{relativeTime(article.published_at, language)}</p>
      </div>
    </Link>
  );
}

/** #4 onward — numbered row with a square thumbnail. */
function RankRow({ article, rank }: { article: ArticleCard; rank: number }) {
  const { language } = useI18n();
  const s = useScript();
  const head = s.text(article.title_te, article.title_en);
  const category = useCategoryName()(article);
  return (
    <li>
      <Link
        to={article.url}
        className="group flex items-center gap-4 rounded-xl border border-transparent p-2.5 transition-colors duration-base hover:border-rule hover:bg-surface"
      >
        <span
          aria-hidden
          className="w-10 shrink-0 text-center font-sans text-display font-extrabold !leading-none tabular-nums text-transparent [-webkit-text-stroke:1.5px_rgb(var(--tn-wow-deep))]"
        >
          {rank}
        </span>
        <div className="w-20 shrink-0 md:w-24">
          <NewsImage media={article.hero} ratio="1/1" radius="xl" sizes="96px" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 lang={head.lang} className={cn(head.head, 'te-clamp-2 text-headline-xs font-bold text-ink group-hover:text-brand')}>
            {head.text}
          </h3>
          <p className={cn(s.body, 'text-meta text-muted')}>
            {category ? <span className="font-semibold text-wow-deep">{category}</span> : null}
            {category ? ' · ' : null}
            <span className="font-sans">{relativeTime(article.published_at, language)}</span>
          </p>
        </div>
      </Link>
    </li>
  );
}

export default function TrendingPage() {
  const { t, pick, language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const [category, setCategory] = useState('');
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

  const tabs = config.data?.categories.filter((c) => c.show_in_nav).slice(0, 12) ?? [];
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
    <PageContainer width="site" className="space-y-6 py-6 md:space-y-8 md:py-8">
      {/* Banner */}
      <header className="relative overflow-hidden rounded-2xl bg-brand-deep px-5 py-6 text-on-ink md:px-8 md:py-8">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-wow/30 blur-3xl" />
        <Flame aria-hidden size={160} strokeWidth={1} className="pointer-events-none absolute -bottom-8 right-4 text-on-ink/10 md:right-10" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep text-on-wow">
            <Icon icon={Flame} size="lg" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className={cn(s.body, 'inline-flex items-center gap-1.5 text-meta font-bold text-wow')}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-wow opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-wow" />
              </span>
              {t('ui.trendingNow')}
            </p>
            <h1 className={cn(s.head, 'text-headline-lg font-bold md:text-headline-xl')}>
              {active ? pick(active.name_te, active.name_en) + (te ? ' · ట్రెండింగ్' : ' · Trending') : t('page.trending')}
            </h1>
            <p className={cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui', 'max-w-2xl text-on-ink/80')}>
              {te
                ? 'పాఠకులు ఎక్కువగా చదువుతున్న, షేర్ చేస్తున్న, ఇష్టపడుతున్న కథనాలు — తాజా ఆసక్తికి ఎక్కువ ప్రాధాన్యం.'
                : 'The stories readers are reading, sharing and liking most — recent interest weighs most.'}
            </p>
          </div>
        </div>
      </header>

      {/* Section filter */}
      <ChipRail ariaLabel={t('ui.sections')}>
        <Chip selected={!category} onClick={() => setCategory('')} icon={TrendingUp}>
          {te ? 'అన్నీ' : 'All'}
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
        skeleton={
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <SkeletonCard variant="lead" />
            <div className="grid gap-4">
              <SkeletonCard variant="row" />
              <SkeletonCard variant="row" />
            </div>
          </div>
        }
        isEmpty={(data) => !data.pages.some((page) => page.articles.length)}
        empty={
          <EmptyState
            icon={Flame}
            title={te ? 'ఈ విభాగంలో ఇంకా ట్రెండింగ్ కథనాలు లేవు' : 'Nothing trending in this section yet'}
            body={te ? 'అన్ని విభాగాలు చూడండి.' : 'Try all sections.'}
          />
        }
      >
        {(data) => {
          const articles = data.pages.flatMap((page) => page.articles);
          const [first, second, third, ...rest] = articles;
          return (
            <div className="space-y-8">
              {first ? (
                <section aria-label={te ? 'టాప్ 3' : 'Top 3'} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                  <TopStory article={first} />
                  {second || third ? (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
                      {second ? <PodiumCard article={second} rank={2} /> : null}
                      {third ? <PodiumCard article={third} rank={3} /> : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {rest.length ? (
                <section aria-labelledby="more-trending">
                  <h2 id="more-trending" className={cn(s.head, 'mb-3 text-headline-sm font-bold text-ink')}>
                    {te ? 'మరిన్ని ట్రెండింగ్ కథనాలు' : 'More trending stories'}
                  </h2>
                  <ol className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                    {rest.map((article, i) => (
                      <RankRow key={article.short_id} article={article} rank={i + 4} />
                    ))}
                  </ol>
                </section>
              ) : null}

              {feed.isFetchingNextPage ? <SkeletonCard variant="row" /> : null}

              {hasNextPage ? (
                <div ref={sentinel} className="flex justify-center">
                  <Button variant="secondary" pending={feed.isFetchingNextPage} onClick={() => void fetchNextPage()}>
                    {t('ui.loadMore')}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </PageContainer>
  );
}
