import { Sparkles, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

import { NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard as Item } from '@/types/public';
import { cn } from '@/utils/cn';
import { relativeTime } from '@/utils/time';

/**
 * Article cards — ONE system, eight shapes.
 *
 * Shared across every variant:
 *   * `<Badges>` — breaking / exclusive / AI / category / district, in that
 *     order, from the same component. A breaking or AI-written story is
 *     flagged wherever it appears, not only in the two variants that used to
 *     bother (§7.4, §14).
 *   * `<Meta>` — byline · relative time, on the 12.5px `text-meta` floor.
 *   * headline script + `lang` from `useScript().text`, clamped by *line count*
 *     (`te-clamp-N`) so a Telugu box grows with its text — never `truncate`,
 *     never a fixed height (§4.1).
 *   * Scroll reveal is the *list's* job: a card owning its own observer means
 *     one IntersectionObserver per card and a batch of one, so the 40ms
 *     stagger never fires. Lists wrap items in `<div ref={reveal}>` instead.
 *
 * Boxed variants (Lead / Secondary / Grid / Row) sit on `Card`; the list
 * variants (Kicker / Latest / Compact / Brief) stay hairline-separated rows
 * with a hover wash, because a column of boxes reads as noise.
 */

export interface ArticleCardProps {
  article: Item;
}

/** Headline weight + hover, shared so every variant hovers identically. */
const HEADLINE = 'font-bold text-ink transition-colors duration-base ease-standard group-hover:text-brand';

/** Hairline row shell for the imageless list variants. */
const ROW = 'border-b border-rule-soft last:border-0';
const ROW_LINK =
  'group -mx-2 block min-h-tap rounded-xl px-2 py-3 transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:bg-paper-sub';

/** Headline text with the `lang` + font class of whichever script renders. */
function useHeadline() {
  const s = useScript();
  return (article: Item) => s.text(article.title_te, article.title_en);
}

/**
 * Badge row. `flagsOnly` drops category/district for the one-line Brief, where
 * there is room for the flags but not for the taxonomy.
 */
function Badges({
  article,
  flagsOnly = false,
  className,
}: {
  article: Item;
  flagsOnly?: boolean;
  className?: string;
}) {
  const { t, language } = useI18n();
  const s = useScript();
  const category = !flagsOnly && article.category ? s.text(article.category.name_te, article.category.name_en) : null;
  const district = !flagsOnly && article.district ? s.text(article.district.name_te, article.district.name_en) : null;

  if (!article.is_breaking && !article.is_exclusive && !article.ai_generated && !category && !district) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {article.is_breaking ? (
        <Badge tone="breaking" size="xs" icon={Zap}>
          {t('ui.breaking')}
        </Badge>
      ) : null}
      {article.is_exclusive ? (
        <Badge tone="exclusive" size="xs">
          {t('article.exclusive')}
        </Badge>
      ) : null}
      {article.ai_generated ? (
        // The language sits on the two runs, not the badge: the visible "AI" is
        // Latin, the sr-only expansion is whatever the reader's language is.
        <Badge tone="ai" size="xs" icon={Sparkles}>
          <span lang="en">AI</span>
          <span className="sr-only" lang={language}>
            {' — '}
            {t('ui.aiAssisted')}
          </span>
        </Badge>
      ) : null}
      {category ? (
        <Badge tone="brand" size="xs" lang={category.lang}>
          {category.text}
        </Badge>
      ) : null}
      {district ? (
        <Badge tone="district" size="xs" lang={district.lang}>
          {district.text}
        </Badge>
      ) : null}
    </div>
  );
}

/** Byline · relative time. District lives in the badge row, not here. */
function Meta({ article, className }: { article: Item; className?: string }) {
  const { language } = useI18n();
  const s = useScript();
  const time = relativeTime(article.published_at, language);
  if (!article.byline_te && !time) return null;
  return (
    <p className={cn('mt-2 text-meta text-muted', className)}>
      {/* Bylines are personal names; they stay in Telugu script in both modes. */}
      {article.byline_te ? (
        <span lang="te" className="te">
          {article.byline_te}
        </span>
      ) : null}
      {article.byline_te && time ? <span aria-hidden> · </span> : null}
      {/* relativeTime returns Telugu in te mode — it is content, not chrome. */}
      {time ? (
        <span lang={language} className={cn(s.body, 'tabular-nums')}>
          {time}
        </span>
      ) : null}
    </p>
  );
}

/** Card image. Every call site declares an honest `sizes` — a 112px thumbnail
 * must not pull the 1600px rendition on district 4G (§7.4, §10.3). */
function Media({
  article,
  ratio,
  sizes,
  radius = 'xl',
  className,
  priority = false,
}: {
  article: Item;
  ratio: string;
  sizes: string;
  radius?: 'xl' | '2xl';
  className?: string;
  priority?: boolean;
}) {
  const { t } = useI18n();
  return (
    <NewsImage
      media={article.hero}
      ratio={ratio}
      sizes={sizes}
      radius={radius}
      priority={priority}
      placeholderLabel={t('state.photo')}
      className={className}
    />
  );
}

/** Lead story — the big one at the top of the home and section grids. */
export function LeadCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <Card as="article" padding="sm" interactive>
      <Link to={article.url} className="group block">
        <div className="relative">
          {/* The lead hero is the LCP element — eager, high priority (§10.3). */}
          <Media
            article={article}
            ratio="16/9"
            radius="2xl"
            sizes="(max-width: 1024px) 100vw, 640px"
            priority
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-2xl bg-gradient-to-t from-overlay/60 to-transparent"
          />
          {/* Right-aligned: NewsImage parks its AI-image label bottom-left. */}
          <Badges article={article} className="absolute inset-x-3 bottom-3 justify-end" />
        </div>
        <div className="mt-3">
          <h2 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-3 text-headline-md sm:text-headline-lg')}>
            {headline.text}
          </h2>
          {/* Summaries exist only in Telugu until AI translation lands (§7.3). */}
          {article.summary_te ? (
            <p lang="te" className="te te-clamp-3 mt-2 text-te-body-sm text-ink-soft">
              {article.summary_te}
            </p>
          ) : null}
          <Meta article={article} />
        </div>
      </Link>
    </Card>
  );
}

/** Secondary story — thumbnail left, headline right. */
export function SecondaryCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <Card as="article" padding="sm" interactive>
      <Link to={article.url} className="group flex gap-3">
        <Media
          article={article}
          ratio="4/3"
          sizes="(max-width: 768px) 112px, 128px"
          className="w-28 shrink-0 sm:w-32"
        />
        <div className="min-w-0 flex-1">
          <Badges article={article} className="mb-1.5" />
          <h3 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-3 text-headline-sm')}>
            {headline.text}
          </h3>
          <Meta article={article} className="mt-1.5" />
        </div>
      </Link>
    </Card>
  );
}

/** Brief — a single bulleted headline, no image. */
export function BriefCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <li className={ROW}>
      <Link to={article.url} className={cn(ROW_LINK, 'flex items-start gap-2')}>
        <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-pill bg-brand" />
        <div className="min-w-0 flex-1">
          <Badges article={article} flagsOnly className="mb-1" />
          <span
            lang={headline.lang}
            className={cn(headline.head, HEADLINE, 'te-clamp-2 block text-headline-xs')}
          >
            {headline.text}
          </span>
        </div>
      </Link>
    </li>
  );
}

/** Grid card — used by section rails, category feeds and "read next". */
export function GridCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <Card as="article" padding="sm" interactive>
      <Link to={article.url} className="group block">
        <Media article={article} ratio="16/10" sizes="(max-width: 768px) 50vw, 300px" />
        <div className="mt-3">
          <Badges article={article} className="mb-1.5" />
          <h3 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-3 text-headline-sm')}>
            {headline.text}
          </h3>
          <Meta article={article} />
        </div>
      </Link>
    </Card>
  );
}

/** Row card — used by search results, district feeds and saved lists. */
export function RowCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <Card as="article" padding="sm" interactive>
      <Link to={article.url} className="group flex gap-3">
        <Media
          article={article}
          ratio="4/3"
          sizes="(max-width: 768px) 112px, 144px"
          className="w-28 shrink-0 sm:w-36"
        />
        <div className="min-w-0 flex-1">
          <Badges article={article} className="mb-1.5" />
          <h3 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-3 text-headline-sm')}>
            {headline.text}
          </h3>
          {article.summary_te ? (
            <p lang="te" className="te te-clamp-2 mt-1.5 text-te-body-xs text-ink-soft">
              {article.summary_te}
            </p>
          ) : null}
          <Meta article={article} className="mt-1.5" />
        </div>
      </Link>
    </Card>
  );
}

/**
 * Mid-column story — badge kicker above the headline, byline below, separated
 * by a hairline. The broadsheet front-page pattern: a reader scans section +
 * headline without needing images.
 */
export function KickerCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <article className={ROW}>
      <Link to={article.url} className={ROW_LINK}>
        <Badges article={article} className="mb-1.5" />
        <h3 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-3 text-headline-sm')}>
          {headline.text}
        </h3>
        <Meta article={article} className="mt-1.5" />
      </Link>
    </article>
  );
}

/** Latest-news rail item — relative timestamp above the headline. */
export function LatestCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  const { language } = useI18n();
  const s = useScript();
  const time = relativeTime(article.published_at, language);
  return (
    <article className={ROW}>
      <Link to={article.url} className={ROW_LINK}>
        {time ? (
          <p lang={language} className={cn(s.body, 'mb-1 text-meta font-semibold text-brand')}>
            {time}
          </p>
        ) : null}
        <Badges article={article} className="mb-1.5" />
        <h3 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-2 text-headline-xs')}>
          {headline.text}
        </h3>
      </Link>
    </article>
  );
}

/** Compact list row used inside section blocks — no image, hairline separated. */
export function CompactCard({ article }: ArticleCardProps) {
  const headline = useHeadline()(article);
  return (
    <article className={ROW}>
      <Link to={article.url} className={ROW_LINK}>
        <Badges article={article} className="mb-1.5" />
        <h3 lang={headline.lang} className={cn(headline.head, HEADLINE, 'te-clamp-2 text-headline-xs')}>
          {headline.text}
        </h3>
        <Meta article={article} className="mt-1.5" />
      </Link>
    </article>
  );
}
