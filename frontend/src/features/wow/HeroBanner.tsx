import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

import { ShareButton } from '@/components/article/ShareSheet';
import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';

import { scriptOf, useSiteContent } from './siteContent';

/**
 * Hero banner (pitch §2 "Featured Story", redesigned as a banner).
 *
 * A wide, full-bleed photo banner in the WOW colours: the photo fills the
 * card, a deep-blue wash from the left carries the copy (category, Telugu
 * headline, standfirst, Read / Share), and an orange "Every Story Has a WOW!"
 * tag sits on top. Ten top stories rotate every few seconds; the
 * reader can step with the arrows or the numbered tabs at the bottom right,
 * and hovering or focusing the banner pauses it. Reduced-motion readers get
 * no autoplay.
 */

const ROTATE_MS = 7000;
/** How many stories the banner rotates through. */
export const HERO_SLIDES = 10;

export function HeroBanner({ stories }: { stories: ArticleCard[] }) {
  const { language } = useI18n();
  const s = useScript();
  const { home } = useSiteContent();
  const tag = s.pick(home.banner_tag_te, home.banner_tag_en);
  const tagScript = scriptOf(tag);
  const te = language === 'te';
  const slides = stories.slice(0, HERO_SLIDES);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const go = useCallback((i: number) => setIndex((i + slides.length) % slides.length), [slides.length]);

  useEffect(() => {
    if (paused || reduced || slides.length < 2) return;
    const id = window.setTimeout(() => go(index + 1), ROTATE_MS);
    return () => window.clearTimeout(id);
  }, [index, paused, reduced, slides.length, go]);

  const article = slides[index];
  if (!article) return null;
  const head = s.text(article.title_te, article.title_en);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={te ? 'ముఖ్య కథనాలు' : 'Top stories'}
      className="relative isolate overflow-hidden rounded-2xl bg-brand-deep text-on-ink shadow-raised"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* The story's photo fills the banner under a deep-blue wash (solid on
          the left where the copy sits, clearing to the right) and an orange glow. */}
      <div aria-hidden key={`bg-${article.short_id}`} className="absolute inset-0 -z-10 animate-fade-in">
        <NewsImage media={article.hero} ratio="auto" radius="none" priority className="h-full w-full" sizes="100vw" />
      </div>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-deep via-brand-deep/85 to-brand-deep/40 md:bg-gradient-to-r md:from-brand-deep md:via-brand-deep/80 md:to-brand-deep/10"
      />
      <div aria-hidden className="absolute -left-20 -top-24 -z-10 h-72 w-72 rounded-full bg-wow/25 blur-3xl" />

      <div className="flex flex-col justify-center gap-4 p-5 pb-3 sm:p-7 sm:pb-3 md:min-h-[340px] md:max-w-[80%] md:p-10">
        <div className="flex flex-wrap items-center gap-2">
          <span
            lang={tagScript.lang}
            className={cn(tagScript.cls, 'inline-flex items-center gap-1.5 rounded-pill bg-gradient-to-br from-wow to-wow-deep px-3 py-1 text-meta font-bold uppercase tracking-wide text-on-wow')}
          >
            <Icon icon={Sparkles} size="xs" />
            {tag}
          </span>
          {article.category ? (
            <span className={cn(s.body, 'rounded-pill bg-on-ink/15 px-3 py-1 text-meta font-semibold backdrop-blur')}>
              {s.pick(article.category.name_te, article.category.name_en)}
            </span>
          ) : null}
        </div>

        <h1
          key={article.short_id}
          lang={head.lang}
          className={cn(head.head, 'animate-fade-up text-headline-md font-bold text-on-ink md:text-headline-lg')}
        >
          <Link to={article.url} className="hover:underline hover:decoration-wow hover:decoration-2 hover:underline-offset-8">
            {head.text}
          </Link>
        </h1>
        {article.summary_te ? (
          <p lang="te" className="te te-clamp-3 max-w-2xl text-te-body-xs text-on-ink/85">
            {article.summary_te}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ButtonLink to={article.url} variant="wow" size="lg" iconRight={ArrowRight}>
            {te ? 'పూర్తి కథ చదవండి' : 'Read the story'}
          </ButtonLink>
          <ShareButton
            shortId={article.short_id}
            url={article.url}
            title={head.text}
            cardAvailable={false}
            className="bg-on-ink/15 text-on-ink hover:bg-on-ink/25"
          />
        </div>
      </div>

      {/* Controls: arrows + tabs. Under the Read / Share buttons on a phone,
          centred; bottom right from md up. */}
      {slides.length > 1 ? (
        <div className="flex items-center justify-center gap-1 px-5 pb-4 sm:px-7 md:absolute md:bottom-6 md:right-6 md:gap-2 md:p-0">
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label={te ? 'మునుపటి కథ' : 'Previous story'}
            className="flex h-10 w-10 items-center justify-center rounded-pill bg-on-ink/15 text-on-ink backdrop-blur transition hover:bg-on-ink/30 md:h-tap md:w-tap"
          >
            <Icon icon={ChevronLeft} size="md" />
          </button>
          <div role="tablist" aria-label={te ? 'కథను ఎంచుకోండి' : 'Choose a story'} className="flex items-center gap-1.5">
            {slides.map((a, i) => (
              <button
                key={a.short_id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${i + 1} / ${slides.length}`}
                onClick={() => go(i)}
                className="flex h-tap items-center px-0.5"
              >
                <span
                  className={cn(
                    'block h-1.5 rounded-pill transition-all duration-base',
                    i === index ? 'w-8 bg-wow' : 'w-3 bg-on-ink/50 hover:bg-on-ink/80',
                  )}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label={te ? 'తదుపరి కథ' : 'Next story'}
            className="flex h-10 w-10 items-center justify-center rounded-pill bg-on-ink/15 text-on-ink backdrop-blur transition hover:bg-on-ink/30 md:h-tap md:w-tap"
          >
            <Icon icon={ChevronRight} size="md" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
