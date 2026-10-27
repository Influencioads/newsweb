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

/**
 * Hero banner (pitch §2 "Featured Story", redesigned as a banner).
 *
 * A wide, full-bleed photo banner in the WOW colours: the photo fills the
 * card, a deep-blue wash from the left carries the copy (category, Telugu
 * headline, standfirst, Read / Share), and an orange "Every Story Has a WOW!"
 * tag sits on top. Up to four top stories rotate every few seconds; the
 * reader can step with the arrows or the numbered tabs at the bottom right,
 * and hovering or focusing the banner pauses it. Reduced-motion readers get
 * no autoplay.
 */

const ROTATE_MS = 7000;

export function HeroBanner({ stories }: { stories: ArticleCard[] }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const slides = stories.slice(0, 4);
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
      {/* Photos, cross-fading. All stay mounted so the next one is already decoded. */}
      {slides.map((a, i) => (
        <div
          key={a.short_id}
          aria-hidden={i !== index}
          className={cn(
            'absolute inset-0 -z-10 transition-opacity duration-slow ease-standard',
            i === index ? 'opacity-100' : 'opacity-0',
          )}
        >
          <NewsImage
            media={a.hero}
            ratio="auto"
            radius="none"
            priority={i === 0}
            className="h-full w-full"
            sizes="(max-width: 1200px) 100vw, 1200px"
          />
        </div>
      ))}
      {/* Brand wash: deep blue from the left (and from the bottom on phones) so the copy always reads. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-deep via-brand-deep/70 to-brand-deep/10 md:bg-gradient-to-r md:from-brand-deep md:via-brand-deep/75 md:to-transparent"
      />
      <div aria-hidden className="absolute -left-20 -top-24 -z-10 h-72 w-72 rounded-full bg-wow/25 blur-3xl" />

      <div className="flex min-h-[440px] flex-col justify-end gap-4 p-5 pt-16 sm:p-7 sm:pt-16 md:min-h-[480px] md:max-w-[62%] md:justify-center md:p-10 lg:min-h-[520px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-wow-deep px-3 py-1 font-sans text-meta font-bold uppercase tracking-wide text-on-wow">
            <Icon icon={Sparkles} size="xs" />
            Every Story Has a WOW!
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
          className={cn(head.head, 'animate-fade-up text-headline-lg font-bold text-on-ink sm:text-headline-xl md:text-display')}
        >
          <Link to={article.url} className="hover:underline hover:decoration-wow hover:decoration-2 hover:underline-offset-8">
            {head.text}
          </Link>
        </h1>
        {article.summary_te ? (
          <p lang="te" className="te te-clamp-3 max-w-2xl text-te-body-sm text-on-ink/85">
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

      {/* Controls: arrows + tabs. Top right on a phone, where they cannot sit on
          the Read / Share buttons; bottom right from md up. */}
      {slides.length > 1 ? (
        <div className="absolute right-3 top-3 flex items-center gap-1 md:bottom-6 md:right-6 md:top-auto md:gap-2">
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
