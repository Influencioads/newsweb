import { Link } from 'react-router-dom';

import { NewsImage } from '@/components/media/NewsImage';
import { useI18n } from '@/i18n';
import type { ArticleCard as Card } from '@/types/public';
import { relativeTime } from '@/utils/time';

/**
 * Article cards.
 *
 * Telugu rules that apply to every variant (§4.1):
 *   * Telugu headlines use `.th` (Anek Telugu, lh 1.5) and never a fixed height
 *   * clamping is by line count (`.te-clamp-*`), so the box grows with the text
 *   * every image box declares an aspect ratio so nothing shifts on load (§10.3)
 *
 * Bilingual rules (§16 item 3, decided in favour of Telugu + English):
 *   * a headline renders English when the story has one, otherwise Telugu
 *   * whichever script actually renders carries a matching `lang` attribute, so
 *     a screen reader does not read Telugu with an English voice
 *   * summaries and bylines stay Telugu until AI translation lands (§7.3)
 */

/** Headline text plus the `lang` and font class it needs. */
function useHeadline() {
  const { pick, isFallback, language } = useI18n();
  return (article: Card) => {
    const text = pick(article.title_te, article.title_en);
    const telugu = language === 'te' || isFallback(article.title_te, article.title_en);
    return { text, lang: telugu ? 'te' : 'en', telugu, cls: telugu ? 'th' : 'font-sans' };
  };
}

/**
 * Thin wrapper over `NewsImage` so every card declares an honest `sizes` hint.
 * Without it the browser assumes 100vw and downloads the 1600px rendition for a
 * 120px thumbnail.
 */
function Media({
  hero,
  ratio = '16/9',
  className = '',
  sizes = '100vw',
  priority = false,
}: {
  hero: Card['hero'];
  ratio?: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const { t } = useI18n();
  return (
    <NewsImage
      media={hero}
      ratio={ratio}
      sizes={sizes}
      priority={priority}
      placeholderLabel={t('state.photo')}
      className={`rounded-[4px] ${className}`}
    />
  );
}

function Badges({ article }: { article: Card }) {
  const { pick, t, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {article.category ? (
        <span
          className={`${script} rounded-[3px] bg-brand-tint px-2 py-0.5 text-[10.5px] font-bold leading-[1.4] text-brand`}
        >
          {pick(article.category.name_te, article.category.name_en)}
        </span>
      ) : null}
      {article.district ? (
        <span
          className={`${script} rounded-[3px] bg-rule-soft px-2 py-0.5 text-[10.5px] font-medium leading-[1.4] text-muted`}
        >
          {pick(article.district.name_te, article.district.name_en)}
        </span>
      ) : null}
      {article.is_exclusive ? (
        <span
          className={`${script} rounded-[3px] bg-exclusive-tint px-2 py-0.5 text-[10.5px] font-bold leading-[1.4] text-exclusive`}
        >
          ★ {t('article.exclusive')}
        </span>
      ) : null}
      {article.ai_generated ? (
        <span className="rounded-[3px] bg-ai-tint px-2 py-0.5 font-sans text-[10.5px] font-bold leading-[1.4] text-ai">
          AI
        </span>
      ) : null}
    </div>
  );
}

function Meta({ article }: { article: Card }) {
  const { language } = useI18n();
  return (
    <p className="mt-2 font-sans text-[11.5px] text-muted-light">
      {/* Bylines are personal names; they stay in Telugu script in both modes. */}
      {article.byline_te ? (
        <span lang="te" className="te">
          {article.byline_te}
        </span>
      ) : null}
      {article.byline_te && article.published_at ? ' · ' : ''}
      {relativeTime(article.published_at, language)}
    </p>
  );
}

/** Translated district label, reused across several card metas. */
function DistrictLabel({ article }: { article: Card }) {
  const { pick } = useI18n();
  if (!article.district) return null;
  return <span>{pick(article.district.name_te, article.district.name_en)} · </span>;
}

/** Lead story — the big one at the top left of the home grid. */
export function LeadCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  return (
    <article>
      <Link to={article.url} className="group block">
        {/* Lead hero is the LCP element — eager, high priority (§10.3). */}
        <Media hero={article.hero} sizes="(max-width: 1024px) 100vw, 600px" priority />
        <div className="mt-2.5">
          <Badges article={article} />
          <h2
            lang={headline.lang}
            className={`${headline.cls} text-[24px] font-bold text-ink group-hover:text-brand sm:text-headline-lg`}
          >
            {headline.text}
          </h2>
          {/* Summaries exist only in Telugu until AI translation lands (§7.3). */}
          {article.summary_te ? (
            <p lang="te" className="te te-clamp-3 mt-1.5 text-[15.5px] text-ink-soft">
              {article.summary_te}
            </p>
          ) : null}
          <Meta article={article} />
        </div>
      </Link>
    </article>
  );
}

/** Secondary story — thumbnail left, headline right. */
export function SecondaryCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  const { language } = useI18n();
  return (
    <article>
      <Link to={article.url} className="group flex gap-2.5">
        <Media hero={article.hero} className="w-[120px] shrink-0" sizes="120px" />
        <div className="min-w-0">
          <h3
            lang={headline.lang}
            className={`${headline.cls} te-clamp-3 text-[16.5px] font-bold text-ink group-hover:text-brand`}
          >
            {headline.text}
          </h3>
          <p className="mt-1 font-sans text-[10.5px] text-muted-light">
            <DistrictLabel article={article} />
            {relativeTime(article.published_at, language)}
          </p>
        </div>
      </Link>
    </article>
  );
}

/** Brief — a single bulleted headline, no image. */
export function BriefCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  return (
    <li>
      <Link
        to={article.url}
        lang={headline.lang}
        className={`${headline.telugu ? 'te' : 'font-sans'} block text-[14.5px] font-medium text-ink hover:text-brand`}
      >
        <span aria-hidden className="text-muted-light">
          •{' '}
        </span>
        {headline.text}
      </Link>
    </li>
  );
}

/** Grid card — used by section rails and category feeds. */
export function GridCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  const { language } = useI18n();
  return (
    <article>
      <Link to={article.url} className="group block">
        <Media hero={article.hero} ratio="16/10" sizes="(max-width: 768px) 50vw, 280px" />
        <div className="mt-2">
          <Badges article={article} />
          <h3
            lang={headline.lang}
            className={`${headline.cls} te-clamp-3 text-[15px] font-bold text-ink group-hover:text-brand`}
          >
            {headline.text}
          </h3>
          <p className="mt-1 font-sans text-[10.5px] text-muted-light">
            {relativeTime(article.published_at, language)}
          </p>
        </div>
      </Link>
    </article>
  );
}

/** Row card — used by search results and district feeds. */
export function RowCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  const { language } = useI18n();
  return (
    <article className="border-b border-rule-soft pb-3.5 last:border-0">
      <Link to={article.url} className="group flex gap-3">
        <Media hero={article.hero} className="w-[110px] shrink-0" sizes="110px" />
        <div className="min-w-0">
          <h3
            lang={headline.lang}
            className={`${headline.cls} text-[16px] font-bold text-ink group-hover:text-brand`}
          >
            {headline.text}
          </h3>
          {article.summary_te ? (
            <p lang="te" className="te te-clamp-2 mt-1 text-[13px] text-muted">
              {article.summary_te}
            </p>
          ) : null}
          <p className="mt-1 font-sans text-[11px] text-muted-light">
            <DistrictLabel article={article} />
            {relativeTime(article.published_at, language)}
          </p>
        </div>
      </Link>
    </article>
  );
}

/**
 * Mid-column story — section kicker above the headline, byline below,
 * separated by a hairline rule. The standard broadsheet front-page pattern:
 * it lets a reader scan section + headline without images.
 */
export function KickerCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  const { pick, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';
  return (
    <article className="border-b border-rule py-3 first:pt-0 last:border-0">
      <Link to={article.url} className="group block">
        {article.category ? (
          <p className={`${script} mb-1 text-[11px] font-bold leading-[1.4] text-brand`}>
            {pick(article.category.name_te, article.category.name_en)}
            {article.district ? (
              <span className="font-medium text-muted-light">
                {' · '}
                {pick(article.district.name_te, article.district.name_en)}
              </span>
            ) : null}
          </p>
        ) : null}
        <h3
          lang={headline.lang}
          className={`${headline.cls} text-[17px] font-bold text-ink group-hover:text-brand`}
        >
          {headline.text}
        </h3>
        {article.byline_te ? (
          <p
            lang="te"
            className="te mt-1.5 text-[10.5px] font-medium tracking-[0.04em] text-muted-light"
          >
            {article.byline_te}
          </p>
        ) : null}
      </Link>
    </article>
  );
}

/** Latest-news rail item — relative timestamp above the headline. */
export function LatestCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  const { language } = useI18n();
  return (
    <article className="border-b border-rule py-2.5 first:pt-0 last:border-0">
      <Link to={article.url} className="group block">
        <p
          className={`${language === 'te' ? 'te' : 'font-sans'} mb-0.5 text-[10.5px] font-bold leading-[1.4] text-brand`}
        >
          {relativeTime(article.published_at, language)}
        </p>
        <h3
          lang={headline.lang}
          className={`${headline.cls} text-[14.5px] font-semibold text-ink group-hover:text-brand`}
        >
          {headline.text}
        </h3>
      </Link>
    </article>
  );
}

/** Compact list row used inside section blocks — no image, hairline separated. */
export function CompactCard({ article }: { article: Card }) {
  const headline = useHeadline()(article);
  const { language } = useI18n();
  return (
    <article className="border-b border-rule py-2.5 first:pt-0 last:border-0">
      <Link to={article.url} className="group block">
        <h3
          lang={headline.lang}
          className={`${headline.cls} text-[14.5px] font-semibold text-ink group-hover:text-brand`}
        >
          {headline.text}
        </h3>
        <p className="mt-1 font-sans text-[10.5px] text-muted-light">
          <DistrictLabel article={article} />
          {relativeTime(article.published_at, language)}
        </p>
      </Link>
    </article>
  );
}
