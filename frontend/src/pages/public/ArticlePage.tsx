import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pause, Volume2 } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdSlot } from '@/components/ads/AdSlot';
import { GridCard } from '@/components/article/ArticleCard';
import { ArticleGallery } from '@/components/article/ArticleGallery';
import { ArticleRenderer } from '@/components/article/ArticleRenderer';
import { ImageCaption, NewsImage } from '@/components/media/NewsImage';
import { useReadingBeacon, trackShare } from '@/features/engagement/beacon';
import { CommentsSection } from '@/features/engagement/components/CommentsSection';
import { EngagementBar } from '@/features/engagement/components/EngagementBar';
import { FollowButton } from '@/features/engagement/components/FollowButton';
import * as publicApi from '@/features/public/api';
import { extractPlainText, useTts } from '@/features/reader/tts';
import { useI18n } from '@/i18n';
import { FONT_STEPS, useReaderPrefs } from '@/stores/readerPrefs';
import type { ArticleDetail } from '@/types/public';
import { formatDate, formatTime, readingTime } from '@/utils/time';

/**
 * Article reader — mockup `1c`.
 *
 * Carries three things the spec makes non-negotiable:
 *   * the A-/A/A+/A++ switcher and TTS control (§4.1, §10.4)
 *   * the AI-assistance disclosure when `ai_generated` is true (§7.2)
 *   * "సవరించబడింది: {date}" plus the editor's note on a material correction (§12.5)
 */

/** §10.3 — NewsArticle JSON-LD on every article page. */
function useNewsArticleJsonLd(article: ArticleDetail | undefined) {
  useEffect(() => {
    if (!article) return;
    const id = 'newsarticle-jsonld';
    document.getElementById(id)?.remove();

    const script = document.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      // §10.3 — headline in the language the page is serving.
      headline: article.title_en || article.title_te,
      alternativeHeadline: article.title_en ? article.title_te : undefined,
      description: article.summary_te ?? undefined,
      inLanguage: 'te',
      datePublished: article.published_at ?? undefined,
      dateModified: article.updated_at ?? article.published_at ?? undefined,
      articleSection: article.category?.name_en ?? undefined,
      author: article.author
        ? {
            '@type': 'Person',
            name: article.author.name_te,
            url: article.author.author_slug
              ? `${window.location.origin}/author/${article.author.author_slug}`
              : undefined,
          }
        : undefined,
      publisher: {
        '@type': 'NewsMediaOrganization',
        name: 'టాప్ తెలుగు న్యూస్',
      },
      image: article.hero?.url ? [article.hero.url] : undefined,
      mainEntityOfPage: window.location.href,
    });
    document.head.appendChild(script);

    document.title = `${article.title_te} · టాప్ తెలుగు న్యూస్`;
    return () => document.getElementById(id)?.remove();
  }, [article]);
}

function ReaderToolbar({ article }: { article: ArticleDetail }) {
  const { fontStep, setFontStep } = useReaderPrefs();
  const { t, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';
  // §16 audio news, v1: on-device Telugu speech. The headline leads so a
  // listener knows immediately which story started.
  const tts = useTts(`${article.title_te}. ${extractPlainText(article.body)}`);

  function shareToWhatsApp() {
    // §4.6 — WhatsApp is the #1 distribution channel. The Latin slug in the URL
    // is what keeps the shared link readable rather than percent-encoded.
    const url = `${window.location.origin}${article.url}`;
    const shared = language === 'en' && article.title_en ? article.title_en : article.title_te;
    const text = encodeURIComponent(`${shared}\n${url}`);
    trackShare(article.short_id);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex items-center gap-0.5 rounded-control border border-rule px-1.5 py-1"
        role="group"
        aria-label={t('reader.fontSize')}
      >
        {FONT_STEPS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => setFontStep(step)}
            aria-pressed={fontStep === step}
            className={[
              'min-h-[32px] min-w-[32px] rounded px-1 font-sans text-[11px] font-semibold',
              fontStep === step ? 'bg-brand-tint text-brand' : 'text-ink-soft hover:text-brand',
            ].join(' ')}
          >
            {step}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={tts.toggle}
        disabled={tts.state === 'unavailable'}
        aria-pressed={tts.state === 'speaking'}
        title={
          tts.state === 'unavailable'
            ? language === 'te'
              ? 'ఈ పరికరంలో తెలుగు వాయిస్ లేదు'
              : 'No Telugu voice on this device'
            : t('reader.listen')
        }
        className={[
          script,
          'flex min-h-tap items-center gap-1.5 rounded-control border px-3 text-[11.5px] font-semibold leading-[1.4] disabled:opacity-50',
          tts.state === 'speaking' || tts.state === 'paused'
            ? 'border-brand bg-brand-tint text-brand'
            : 'border-rule text-brand',
        ].join(' ')}
      >
        {tts.state === 'speaking' ? (
          <Pause className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Volume2 className="h-3.5 w-3.5" aria-hidden />
        )}
        {tts.state === 'speaking'
          ? language === 'te' ? 'ఆపండి' : 'Pause'
          : tts.state === 'paused'
            ? language === 'te' ? 'కొనసాగించండి' : 'Resume'
            : `${t('reader.listen')} ${readingTime(article.reading_time_sec, language)}`}
      </button>

      <button
        type="button"
        onClick={shareToWhatsApp}
        className="flex min-h-tap items-center rounded-control border border-rule px-3 font-sans text-[11px] font-semibold text-success"
      >
        WhatsApp
      </button>
    </div>
  );
}

export default function ArticlePage() {
  const { slugAndId } = useParams<{ slugAndId: string }>();
  // §4.5 URL pattern: /{category}/{slug}-{shortId}; the short id is the last segment.
  const shortId = slugAndId?.split('-').pop() ?? '';

  const { t, pick, isFallback, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['public', 'article', shortId],
    queryFn: () => publicApi.fetchArticle(shortId),
    enabled: Boolean(shortId),
  });

  useNewsArticleJsonLd(data);
  // §3.1 behaviour tracking: view on open, read-time heartbeats, scroll depth.
  useReadingBeacon(data ? shortId : undefined);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [shortId]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-article px-4 py-8" aria-busy="true">
        <p className="sr-only" role="status">
          {t('state.loadingArticle')}
        </p>
        <div className="h-8 w-11/12 animate-pulse rounded bg-placeholder" />
        <div className="mt-3 h-8 w-7/12 animate-pulse rounded bg-placeholder" />
        <div className="ph mt-5 rounded-[6px]" style={{ aspectRatio: '16/9' }} />
      </div>
    );
  }

  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-[680px] px-4 py-16 text-center">
        <h1 className={`${language === 'te' ? 'th' : 'font-sans'} text-[22px] font-bold text-ink`}>
          {notFound ? t('state.articleNotFound') : t('state.articleFailed')}
        </h1>
        <p className={`${script} mt-2 text-[14px] text-muted`}>
          {error instanceof ApiError
            ? language === 'en'
              ? error.messageEn
              : error.messageTe
            : t('state.retry')}
        </p>
        <Link
          to="/"
          className={`${script} mt-4 inline-block min-h-tap rounded-control bg-brand px-6 py-3 font-bold text-white`}
        >
          {t('state.goHome')}
        </Link>
      </div>
    );
  }

  // Which script the headline actually renders in, and whether to tell the
  // reader the rest of the story is Telugu-only.
  const teluguHeadline =
    language === 'te' || isFallback(data.title_te, data.title_en);
  const showTeluguOnlyNotice = language === 'en' && Boolean(data.title_en);

  return (
    <main className="bg-white">
      {/* Breadcrumb strip — mockup 1c shows the canonical URL here. */}
      <div className="border-b border-rule bg-paper-sub">
        <div className="mx-auto max-w-[880px] px-4 py-1.5">
          <nav aria-label="Breadcrumb" className={`${script} text-[11px] text-muted`}>
            <Link to="/" className="hover:text-brand">
              {t('nav.home')}
            </Link>
            {data.category ? (
              <>
                {' › '}
                <Link to={`/section/${data.category.slug}`} className="hover:text-brand">
                  {pick(data.category.name_te, data.category.name_en)}
                </Link>
              </>
            ) : null}
            {data.district
              ? ` › ${pick(data.district.name_te, data.district.name_en)}`
              : null}
          </nav>
        </div>
      </div>

      <article className="mx-auto max-w-article px-4 py-6">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {data.category ? (
            <span className={`${script} rounded-[3px] bg-brand-tint px-2.5 py-0.5 text-[11px] font-bold leading-[1.4] text-brand`}>
              {pick(data.category.name_te, data.category.name_en)}
            </span>
          ) : null}
          {data.is_exclusive ? (
            <span className={`${script} rounded-[3px] bg-exclusive-tint px-2.5 py-0.5 text-[11px] font-bold leading-[1.4] text-exclusive`}>
              ★ {t('article.exclusive')}
            </span>
          ) : null}
          {data.is_breaking ? (
            <span className={`${script} rounded-[3px] bg-breaking px-2.5 py-0.5 text-[11px] font-bold leading-[1.4] text-white`}>
              ⚡ {t('home.breaking')}
            </span>
          ) : null}
        </div>

        {/* Headline: no fixed height, no overflow hidden (§4.1). */}
        <h1
          lang={teluguHeadline ? 'te' : 'en'}
          className={`${teluguHeadline ? 'th' : 'font-sans'} text-[26px] font-extrabold text-ink sm:text-headline-xl`}
        >
          {pick(data.title_te, data.title_en)}
        </h1>

        {/* Standfirst and body exist only in Telugu until AI translation
            lands (§7.3), so they are always tagged lang="te". */}
        {data.sub_title_te ? (
          <p lang="te" className="te mt-2 text-[16px] text-ink-soft sm:text-te-lead">
            {data.sub_title_te}
          </p>
        ) : null}

        {showTeluguOnlyNotice ? (
          <p className="mt-2 font-sans text-[12px] text-muted-light">
            {t('article.teluguOnly')}
          </p>
        ) : null}

        {/* Byline + toolbar */}
        <div className="mt-3.5 flex flex-col gap-3 border-y border-rule py-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-placeholder font-sans text-[12px] font-semibold text-muted-light"
            >
              {data.author?.name_te?.[0] ?? '·'}
            </span>
            <div>
              <p lang="te" className="te text-[12.5px] font-bold leading-[1.5] text-ink">
                {data.author?.name_te ?? data.byline_te ?? t('reader.desk')}
                {data.author?.author_slug ? (
                  <Link
                    to={`/author/${data.author.author_slug}`}
                    className="ml-1.5 font-sans text-[10.5px] font-normal text-info hover:underline"
                  >
                    — {t('reader.authorPage')}
                  </Link>
                ) : null}
              </p>
              <p className="font-sans text-[10.5px] text-muted-light">
                {formatDate(data.published_at, language)} · {formatTime(data.published_at)}
                {data.corrected_at ? (
                  <span className={`${script} ml-1 font-semibold text-exclusive`}>
                    · {t('article.corrected')}: {formatDate(data.corrected_at, language)}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <ReaderToolbar article={data} />
        </div>

        {/* Hero — the LCP element on this page, so it loads eagerly. */}
        <figure className="mt-4">
          <NewsImage
            media={data.hero}
            ratio="16/9"
            sizes="(max-width: 768px) 100vw, 680px"
            priority
            placeholderLabel={t('state.heroPhoto')}
            className="rounded-[4px]"
          />
          <ImageCaption media={data.hero} />
        </figure>

        {/* Correction note (§12.5) */}
        {data.correction_note_te ? (
          <aside className="mt-4 rounded-r-[6px] border border-l-4 border-rule border-l-exclusive bg-[#FDFBF5] px-3.5 py-2.5">
            <p className={`${script} text-[10px] font-bold tracking-[0.08em] text-exclusive`}>
              {t('article.editorNote')}
            </p>
            <p lang="te" className="te mt-1 text-[13.5px] text-ink-soft">
              {data.correction_note_te}
            </p>
          </aside>
        ) : null}

        {/* Body — Tiptap JSON rendered as React */}
        <div className="mt-5">
          <ArticleRenderer doc={data.body} />
        </div>

        {/* AI disclosure (§7.2) — non-optional when AI assisted the draft. */}
        {data.ai_generated ? (
          <aside className="mt-5 flex items-start gap-2 rounded-[6px] border border-ai-border bg-ai-tint px-3.5 py-2.5">
            <span className="mt-0.5 shrink-0 rounded-[3px] bg-ai px-1.5 py-0.5 font-sans text-[9px] font-bold tracking-[0.06em] text-white">
              AI
            </span>
            <p className={`${script} text-[12.5px] text-ai-text`}>
              {t('article.aiDisclosure')}
            </p>
          </aside>
        ) : null}

        {/* Source credit (§12.5) */}
        {data.source_credit ? (
          <p className={`${script} mt-3 text-[12px] text-muted`}>
            {t('article.source')}: {data.source_credit}
          </p>
        ) : null}

        {/* Like · comment · save · share · report (§5) */}
        <EngagementBar article={data} />

        {/* §26 article-page ad, category-targeted; collapses when unfilled. */}
        <AdSlot placement="article" category={data.category?.slug} className="mt-6" />

        {/* Follow the threads this story belongs to (§12) */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`${script} text-[12px] font-semibold text-muted`}>
            {language === 'te' ? 'ఫాలో అవ్వండి:' : 'Follow:'}
          </span>
          {data.category ? (
            <FollowButton
              targetType="category"
              slug={data.category.slug}
              name={pick(data.category.name_te, data.category.name_en)}
              compact
            />
          ) : null}
          {data.district ? (
            <FollowButton
              targetType="district"
              slug={data.district.slug}
              name={pick(data.district.name_te, data.district.name_en)}
              compact
            />
          ) : null}
          {data.author?.author_slug ? (
            <FollowButton
              targetType="author"
              slug={data.author.author_slug}
              name={pick(data.author.name_te, data.author.name_en)}
              compact
            />
          ) : null}
          {data.tags.slice(0, 3).map((tag) => (
            <FollowButton
              key={tag.slug}
              targetType="tag"
              slug={tag.slug}
              name={`# ${tag.name_te}`}
              compact
            />
          ))}
        </div>

        {/* Photo gallery — the rest of the desk's take on this story. */}
        <ArticleGallery images={data.gallery} />

        {/* Tags */}
        {data.tags.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {data.tags.map((tag) => (
              <Link
                key={tag.slug}
                to={`/tag/${tag.slug}`}
                lang="te"
                className="te rounded-chip border border-rule px-3 py-1 text-[11px] font-medium leading-[1.5] text-muted hover:border-brand hover:text-brand"
              >
                # {tag.name_te}
              </Link>
            ))}
          </div>
        ) : null}

        {/* Comments (§5) */}
        <CommentsSection shortId={data.short_id} />

        {/* Related */}
        {data.related.length > 0 ? (
          <section className="mt-7 border-t-2 border-ink pt-3">
            <h2 className={`${language === 'te' ? 'th' : 'font-sans'} mb-2.5 text-[16px] font-bold text-brand`}>
              {t('article.related')}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {data.related.map((a) => (
                <GridCard key={a.short_id} article={a} />
              ))}
            </div>
          </section>
        ) : null}

        {/* §5: more from the same category and the same location */}
        <MoreFromRail
          kind="category"
          slug={data.category?.slug}
          name={data.category ? pick(data.category.name_te, data.category.name_en) : ''}
          exclude={[data.short_id, ...data.related.map((a) => a.short_id)]}
        />
        <MoreFromRail
          kind="district"
          slug={data.district?.slug}
          name={data.district ? pick(data.district.name_te, data.district.name_en) : ''}
          exclude={[data.short_id, ...data.related.map((a) => a.short_id)]}
        />
      </article>
    </main>
  );
}

/** §5 "More from same category" / "More from same location" rails. */
function MoreFromRail({
  kind,
  slug,
  name,
  exclude,
}: {
  kind: 'category' | 'district';
  slug: string | undefined;
  name: string;
  exclude: string[];
}) {
  const { language } = useI18n();
  const te = language === 'te';
  const feed = useQuery({
    queryKey: ['public', 'more-from', kind, slug],
    queryFn: () => publicApi.fetchFeed({ [kind]: slug, limit: 7 }),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
  const articles = (feed.data?.articles ?? [])
    .filter((a) => !exclude.includes(a.short_id))
    .slice(0, 3);
  if (!slug || articles.length === 0) return null;

  const title =
    kind === 'category'
      ? te ? `${name}లో మరిన్ని` : `More from ${name}`
      : te ? `${name} నుంచి మరిన్ని` : `More from ${name}`;

  return (
    <section className="mt-7 border-t border-rule pt-3">
      <h2 className={`${te ? 'th' : 'font-sans'} mb-2.5 text-[15px] font-bold text-brand`}>
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {articles.map((a) => (
          <GridCard key={a.short_id} article={a} />
        ))}
      </div>
    </section>
  );
}
