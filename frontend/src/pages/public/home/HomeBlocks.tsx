import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, Zap } from 'lucide-react';

import { CompactCard, SecondaryCard } from '@/components/article/ArticleCard';
import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import * as engagementApi from '@/features/engagement/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { TrendingTopic } from '@/types/epaper';
import type { ArticleCard, EpaperTeaser, HomeSection, MediaOut } from '@/types/public';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

/**
 * Home page blocks that are not the front grid: the trending chip rail, the
 * top-topics grid, "For you", the section blocks (also used for the mandal
 * block) and the e-paper rail card.
 *
 * Every block is headed by the one `SectionHeader`, lays its items out on a
 * grid whose cells carry a `useReveal` ref (40ms stagger, capped at 6), and
 * renders nothing at all when it has no content — an empty shelf on a front
 * page reads as a layout bug.
 */

/** Trending headlines as a chip rail, led by a non-interactive "trending" chip. */
export function TrendingRail({ articles }: { articles: ArticleCard[] }) {
  const { t } = useI18n();
  const s = useScript();
  if (articles.length === 0) return null;
  return (
    <ChipRail ariaLabel={t('ui.trending')}>
      <Chip as="span" size="sm" icon={Zap}>
        {t('ui.trending')}
      </Chip>
      {articles.map((article) => {
        const title = s.text(article.title_te, article.title_en);
        return (
          <Chip
            key={article.short_id}
            as="link"
            to={article.url}
            lang={title.lang}
            // A headline is DB content, not chrome — it never renders at 13px.
            textClass={title.telugu ? 'text-te-body-xs' : 'text-ui-sm'}
          >
            {title.text}
          </Chip>
        );
      })}
    </ChipRail>
  );
}

/** The three issues people are talking about, as numbered cards. */
export function TopTopics({ topics }: { topics: TrendingTopic[] }) {
  const { t } = useI18n();
  const s = useScript();
  const reveal = useReveal<HTMLDivElement>();
  if (topics.length === 0) return null;
  return (
    <section>
      <SectionHeader title={t('ui.topTopics')} />
      <div className="grid gap-3 sm:grid-cols-3">
        {topics.map((topic, index) => {
          const title = s.text(topic.title_te, topic.title_en);
          return (
            <div key={topic.slug} ref={reveal} className="min-w-0">
              <Card as="article" interactive padding="md" className="h-full">
                <Link to={`/topic/${topic.slug}`} className="block">
                  {/* Decoration: the grid says nothing by order, so the rank
                      must not be read out as part of the link's name. */}
                  <span aria-hidden className="font-sans text-display font-black tabular-nums text-brand">
                    {index + 1}
                  </span>
                  <h3 lang={title.lang} className={cn(title.head, 'mt-1 text-headline-sm font-extrabold text-ink')}>
                    {title.text}
                  </h3>
                  <p
                    className={cn(
                      s.body,
                      'mt-2 inline-flex items-center gap-0.5 text-meta font-semibold text-muted',
                    )}
                  >
                    {topic.is_override ? t('ui.editorSelected') : t('ui.trendingNow')}
                    <Icon icon={ChevronRight} size="xs" />
                  </p>
                </Link>
              </Card>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * "మీ కోసం" — the §3.2 personalized rail. Fetched client-side because the home
 * payload is shared and edge-cached; anonymous readers simply never see the
 * block (their sensible default is the page itself, §31).
 */
export function ForYouBlock() {
  const { t } = useI18n();
  const s = useScript();
  const authed = useAuth((state) => state.status === 'authenticated');
  const reveal = useReveal<HTMLDivElement>();
  const { data } = useQuery({
    queryKey: ['reader', 'for-you'],
    queryFn: () => engagementApi.fetchForYou(0, 7),
    enabled: authed,
    staleTime: 120_000,
  });

  if (!authed || !data || data.articles.length < 3) return null;
  const [first, ...rest] = data.articles;
  if (!first) return null;
  const half = Math.ceil(rest.length / 2);

  return (
    <section>
      <SectionHeader title={t('ui.forYou')} />
      <div className="grid gap-x-7 gap-y-4 md:grid-cols-[1.5fr_1fr_0.8fr]">
        <div ref={reveal} className="min-w-0">
          <SecondaryCard article={first} />
        </div>
        <div ref={reveal} className="flex min-w-0 flex-col gap-3">
          {rest.slice(0, half).map((article) => (
            <CompactCard key={article.short_id} article={article} />
          ))}
        </div>
        <div ref={reveal} className="flex min-w-0 flex-col gap-3">
          {rest.slice(half).map((article) => (
            <CompactCard key={article.short_id} article={article} />
          ))}
        </div>
      </div>
      <p className={cn(s.body, 'mt-3 text-muted', s.te ? 'text-te-body-xs' : 'text-ui-sm')}>{t('ui.forYouHint')}</p>
    </section>
  );
}

/**
 * One section block: a lead story with its image, then the rest as compact
 * headlines split across one or two list columns. `columns={2}` is the mandal
 * block's narrower shape.
 */
export function SectionBlock({
  section,
  to,
  columns = 3,
}: {
  section: HomeSection;
  to: string;
  columns?: 2 | 3;
}) {
  const s = useScript();
  const reveal = useReveal<HTMLDivElement>();
  const [first, ...rest] = section.articles;
  if (!first) return null;

  const title = s.text(section.title_te, section.title_en);
  // With two columns every remaining headline goes in the single list column.
  const half = columns === 2 ? rest.length : Math.ceil(rest.length / 2);
  const listCls = 'min-w-0 md:border-l md:border-rule md:pl-7';

  return (
    <section>
      <SectionHeader title={title.text} titleLang={title.lang} to={to} />
      <div
        className={cn(
          'grid gap-x-7 gap-y-4',
          columns === 2 ? 'md:grid-cols-[1.5fr_1fr]' : 'md:grid-cols-[1.5fr_1fr_0.8fr]',
        )}
      >
        <div ref={reveal} className="min-w-0">
          <SecondaryCard article={first} />
        </div>
        <div ref={reveal} className={listCls}>
          {rest.slice(0, half).map((article) => (
            <CompactCard key={article.short_id} article={article} />
          ))}
        </div>
        {/* The third column only renders when there is copy for it — an empty
            bordered column looks like a layout bug. */}
        {rest.length > half ? (
          <div ref={reveal} className={cn('hidden md:block', listCls)}>
            {rest.slice(half).map((article) => (
              <CompactCard key={article.short_id} article={article} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The front-page thumb is a bare URL, not a MediaOut row; wrap it for NewsImage. */
function frontPage(teaser: EpaperTeaser | null): MediaOut | null {
  if (!teaser?.thumb_url) return null;
  return {
    id: 0,
    url: teaser.thumb_url,
    srcset: null,
    alt_te: null,
    caption_te: null,
    credit: null,
    license_label: null,
    source_url: null,
    width: null,
    height: null,
    blurhash: null,
    ai_generated: false,
  };
}

/** Right-rail e-paper teaser: today's front page and the way into the reader. */
export function EpaperRail({ teaser }: { teaser: EpaperTeaser | null }) {
  const { t, language } = useI18n();
  const s = useScript();
  const label = language === 'te' ? 'ఈ-పేపర్' : 'E-Paper';
  return (
    <Card as="section" tone="paper" padding="sm">
      <p
        className={cn(
          'mb-2 text-center font-semibold text-muted',
          s.te ? 'te text-meta' : 'font-sans text-eyebrow uppercase',
        )}
      >
        {label}
      </p>
      {/* Through NewsImage like every other image on the site: reserved box,
          placeholder and broken-URL fallback rather than a bare <img>. */}
      <NewsImage
        media={frontPage(teaser)}
        ratio="3/4"
        sizes="200px"
        className="border border-rule"
        placeholderLabel={t('home.todaysPage')}
      />
      <ButtonLink to="/epaper" size="sm" full className="mt-3">
        {t('home.readEpaper')}
      </ButtonLink>
    </Card>
  );
}
