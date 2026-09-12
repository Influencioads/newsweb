import { ChevronRight, Sparkles, Star, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ImageCaption, NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { FollowButton } from '@/features/engagement/components/FollowButton';
import { useI18n, useScript } from '@/i18n';
import type { ArticleDetail } from '@/types/public';
import { cn } from '@/utils/cn';
import { firstGrapheme } from '@/utils/text';
import { formatDate, formatTime, readingTime } from '@/utils/time';

/**
 * The top of the story: breadcrumb, kickers, headline, standfirst, byline, hero.
 *
 * Everything here is content, not chrome — the script of each line follows the
 * *text* (`useScript().forText`) rather than the interface language, so an
 * English reader still gets `lang="te"` on a Telugu-only headline.
 */

const CRUMB =
  'inline-flex min-h-tap items-center rounded-xl font-semibold transition-[colors,transform,box-shadow] duration-base ease-standard';

/**
 * The crumbs carry DB content (the category name, the headline), so Telugu gets
 * the te-body scale rather than the 13px reserved for Latin chrome.
 */
const crumbSize = (telugu: boolean) => (telugu ? 'text-te-body-xs' : 'text-ui-sm');

export function ArticleBreadcrumb({ article }: { article: ArticleDetail }) {
  const { t, pick, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const headline = s.text(article.title_te, article.title_en);
  const category = article.category;
  const cat = category ? s.forText(category.name_te, category.name_en) : null;

  return (
    <nav aria-label={L('పేజీ మార్గం', 'Breadcrumb')} className="flex flex-wrap items-center gap-1">
      <Link to="/" className={cn(s.body, CRUMB, crumbSize(s.te), 'text-muted hover:text-brand')}>
        {t('nav.home')}
      </Link>
      {category && cat ? (
        <>
          <Icon icon={ChevronRight} size="xs" className="text-muted-light" />
          <Link
            to={`/section/${category.slug}`}
            lang={cat.lang}
            className={cn(cat.cls, CRUMB, crumbSize(cat.telugu), 'text-muted hover:text-brand')}
          >
            {pick(category.name_te, category.name_en)}
          </Link>
        </>
      ) : null}
      <Icon icon={ChevronRight} size="xs" className="text-muted-light" />
      <span
        aria-current="page"
        lang={headline.lang}
        className={cn(headline.cls, crumbSize(headline.telugu), 'te-clamp-1 min-w-0 text-muted')}
      >
        {headline.text}
      </span>
    </nav>
  );
}

/** Kickers · headline · standfirst · byline · hero. */
export function ArticleHead({ article }: { article: ArticleDetail }) {
  const { t, pick, language } = useI18n();
  const s = useScript();
  const headline = s.forText(article.title_te, article.title_en);
  const category = article.category;
  const author = article.author;

  // Who wrote it, in whichever script that name exists in.
  const byline = author
    ? s.text(author.name_te, author.name_en)
    : article.byline_te
      ? s.text(article.byline_te, null)
      : { text: t('reader.desk'), lang: s.language, cls: s.body };
  // One code unit would split a Telugu akshara from its matra (శ్రీ -> శ).
  const initial = firstGrapheme(byline.text);

  // §7.3 — standfirst and body exist only in Telugu until AI translation lands.
  const teluguOnly = language === 'en' && Boolean(article.title_en);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {article.is_breaking ? (
          <Badge tone="breaking" icon={Zap}>
            {t('home.breaking')}
          </Badge>
        ) : null}
        {article.is_exclusive ? (
          <Badge tone="exclusive" icon={Star}>
            {t('article.exclusive')}
          </Badge>
        ) : null}
        {category ? (
          <Badge tone="brand" lang={s.forText(category.name_te, category.name_en).lang}>
            {pick(category.name_te, category.name_en)}
          </Badge>
        ) : null}
        {article.ai_generated ? (
          <Badge tone="ai" icon={Sparkles}>
            {t('ui.aiAssisted')}
          </Badge>
        ) : null}
      </div>

      {/* No fixed height, no overflow hidden — a Telugu headline grows (§4.1).
          `reader-h1` rather than a fixed headline-xl: everything else inside
          .reader-column follows --reader-scale, and the headline must too. */}
      <h1 lang={headline.lang} className={cn(headline.head, 'reader-h1 mt-3 font-extrabold text-ink')}>
        {pick(article.title_te, article.title_en)}
      </h1>

      {article.sub_title_te ? (
        <p lang="te" className="te reader-lead mt-3 text-ink-soft">
          {article.sub_title_te}
        </p>
      ) : null}

      {teluguOnly ? (
        <p className={cn(s.body, 'mt-2 text-meta text-muted')}>{t('article.teluguOnly')}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-y border-rule py-3">
        <span
          aria-hidden
          lang={byline.lang}
          className={cn(
            byline.cls,
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-pill bg-brand-tint text-ui font-bold text-brand',
          )}
        >
          {initial}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {author?.author_slug ? (
              <Link
                to={`/author/${author.author_slug}`}
                lang={byline.lang}
                className={cn(
                  byline.cls,
                  'inline-flex min-h-tap items-center rounded-xl text-ui font-semibold text-ink underline-offset-4 transition-[colors,transform,box-shadow] duration-base ease-standard hover:text-brand hover:underline',
                )}
              >
                {byline.text}
              </Link>
            ) : (
              <span lang={byline.lang} className={cn(byline.cls, 'text-ui font-semibold text-ink')}>
                {byline.text}
              </span>
            )}
            {author?.author_slug ? (
              <FollowButton
                targetType="author"
                slug={author.author_slug}
                name={pick(author.name_te, author.name_en)}
                compact
              />
            ) : null}
          </div>
          <p className={cn(s.body, 'mt-0.5 text-meta text-muted')}>
            {readingTime(article.reading_time_sec, language)} {'·'}{' '}
            {formatDate(article.published_at, language)} {'·'} {formatTime(article.published_at)}
            {article.corrected_at ? (
              <span className="ml-1 font-semibold text-exclusive-text">
                {'·'} {t('article.corrected')}: {formatDate(article.corrected_at, language)}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </>
  );
}

/** Hero — the LCP element on this page, so it loads eagerly. */
export function ArticleHero({ article }: { article: ArticleDetail }) {
  const { t } = useI18n();
  if (!article.hero) return null;
  return (
    <figure className="mt-5">
      <NewsImage
        media={article.hero}
        ratio="16/9"
        radius="2xl"
        sizes="(max-width: 768px) 100vw, 680px"
        priority
        placeholderLabel={t('state.heroPhoto')}
      />
      <ImageCaption media={article.hero} />
    </figure>
  );
}
