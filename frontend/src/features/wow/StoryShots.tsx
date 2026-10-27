import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GalleryVerticalEnd,
  MapPin,
  Pause,
  Play,
  X,
} from 'lucide-react';

import { ShareButton } from '@/components/article/ShareSheet';
import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';
import { relativeTime } from '@/utils/time';

/**
 * Story Shots (pitch §2) as infographics.
 *
 * Every shot is laid out like a news infographic rather than a photo with a
 * caption: a coloured header band with the section, the photo as a framed
 * panel, the story's key number drawn large in WOW orange (pulled from the
 * headline — "905 పోస్టులు", "₹1,250 కోట్లు", "18 గంటలు"), the headline, and the
 * key points as ticked bullets with place and time. The home page shows them
 * as a sideways shelf; tapping one opens the full-screen deck at that shot.
 *
 * The source is the short-news feed: the newsroom already writes a headline
 * and a short text for those. Until there are short items, the newest
 * stories with a photograph stand in.
 */

const SHOTS_LIMIT = 12;

function useShots() {
  return useQuery({
    queryKey: ['public', 'story-shots'],
    queryFn: async () => {
      const shorts = (await publicApi.fetchShortNews({ offset: 0, limit: SHOTS_LIMIT })).articles;
      if (shorts.length) return shorts;
      // No short items written yet: the newest illustrated stories stand in.
      const latest = (await publicApi.fetchFeed({ limit: SHOTS_LIMIT * 2 })).articles;
      return latest.filter((a) => a.hero?.url).slice(0, SHOTS_LIMIT);
    },
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------------ */
/* What an infographic is made of                                           */
/* ------------------------------------------------------------------------ */

export interface Stat {
  value: string;
  unit: string | null;
}

/**
 * The headline's key number: the one with the most digits ("905" beats the
 * "2" in "గ్రూప్-2"), with the word after it as its unit. Numbers glued to a
 * word or hyphen (Group-2, IPL 2026's year is fine) are skipped as labels.
 */
export function extractStat(title: string): Stat | null {
  const re = /(?<![\p{L}\p{M}\d-])(₹\s?)?(\d[\d,]*(?:\.\d+)?)(?:\s+([^\s;,.:—–-]+))?/gu;
  let best: { digits: number; stat: Stat } | null = null;
  for (const m of title.matchAll(re)) {
    const num = (m[1] ? '₹' : '') + (m[2] ?? '');
    const digits = num.replace(/\D/g, '').length;
    if (!best || digits > best.digits) best = { digits, stat: { value: num, unit: m[3] ?? null } };
  }
  return best?.stat ?? null;
}

/** Up to three key points from the summary, one sentence each. */
export function keyPoints(summary: string | null): string[] {
  if (!summary) return [];
  return summary
    .split(/(?<=[.!?।])\s+/u)
    .map((p) => p.trim().replace(/[.।]$/u, ''))
    .filter((p) => p.length > 3)
    .slice(0, 3);
}

function useShotParts(article: ArticleCard) {
  const { language } = useI18n();
  const s = useScript();
  return {
    head: s.text(article.title_te, article.title_en),
    stat: extractStat(article.title_te),
    points: keyPoints(article.summary_te),
    category: article.category ? s.pick(article.category.name_te, article.category.name_en) : null,
    place: article.district ? s.pick(article.district.name_te, article.district.name_en) : null,
    when: relativeTime(article.published_at, language),
    minutes: Math.max(1, Math.round(article.reading_time_sec / 60)),
  };
}

/** The orange number block; falls back to a chart glyph when the headline has no number. */
function StatBlock({ stat, size }: { stat: Stat | null; size: 'sm' | 'lg' }) {
  if (!stat) {
    return (
      <span
        className={cn(
          'flex items-center justify-center rounded-xl bg-wow-tint text-wow-deep',
          size === 'lg' ? 'h-16 w-16' : 'h-10 w-10',
        )}
      >
        <Icon icon={BarChart3} size={size === 'lg' ? 'lg' : 'md'} />
      </span>
    );
  }
  return (
    <span className="flex items-baseline gap-2">
      <span
        className={cn(
          'font-sans font-extrabold leading-none tabular-nums text-wow-deep',
          size === 'lg' ? 'text-display' : 'text-headline-lg',
        )}
      >
        {stat.value}
      </span>
      {stat.unit ? (
        <span lang="te" className={cn('te font-bold text-ink', size === 'lg' ? 'text-headline-sm' : 'text-te-body-xs')}>
          {stat.unit}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Home shelf                                                               */
/* ------------------------------------------------------------------------ */

function ShelfCard({ article, n }: { article: ArticleCard; n: number }) {
  const s = useScript();
  const p = useShotParts(article);
  return (
    <Link
      to={`/story-shots?start=${article.short_id}`}
      className="group flex aspect-[9/16] flex-col overflow-hidden rounded-2xl border border-rule bg-surface transition-[border-color,box-shadow,transform] duration-base hover:-translate-y-0.5 hover:border-wow hover:shadow-raised motion-reduce:transform-none"
    >
      {/* Header band */}
      <div className="flex items-center justify-between gap-2 bg-brand-deep px-3 py-2 text-on-ink">
        <span className={cn(s.body, 'te-clamp-1 text-meta font-bold')}>{p.category ?? 'WOW'}</span>
        <span className="shrink-0 font-sans text-eyebrow font-bold uppercase text-wow">#{n}</span>
      </div>
      {/* Photo panel */}
      <div className="px-2.5 pt-2.5">
        <NewsImage media={article.hero} ratio="16/10" radius="xl" sizes="200px" />
      </div>
      {/* Number + headline */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
        <StatBlock stat={p.stat} size="sm" />
        <p lang={p.head.lang} className={cn(p.head.head, 'te-clamp-3 text-headline-xs font-bold text-ink')}>
          {p.head.text}
        </p>
        <div className="mt-auto flex items-center gap-1 border-t border-dashed border-rule pt-2 text-muted">
          <Icon icon={MapPin} size="xs" className="shrink-0 text-wow-deep" />
          <span className={cn(s.body, 'te-clamp-1 text-meta')}>{p.place ?? p.when}</span>
        </div>
      </div>
    </Link>
  );
}

/** Home shelf: a row of infographic cards that scrolls sideways. */
export function StoryShotsStrip() {
  const { language } = useI18n();
  const shots = useShots();
  const items = shots.data ?? [];
  if (!items.length) return null;

  return (
    <section aria-labelledby="story-shots">
      <SectionHeader
        title={
          <span id="story-shots" className="inline-flex items-center gap-2">
            <Icon icon={GalleryVerticalEnd} size="md" className="text-wow-deep" />
            {language === 'te' ? 'స్టోరీ షాట్స్' : 'Story Shots'}
          </span>
        }
        to="/story-shots"
        toLabel={language === 'te' ? 'అన్నీ చూడండి' : 'View all'}
      />
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:px-0">
        {items.map((article, i) => (
          <li key={article.short_id} className="w-[58%] shrink-0 snap-start sm:w-[44%] md:w-[28%] lg:w-[19%]">
            <ShelfCard article={article} n={i + 1} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Full-screen deck                                                         */
/* ------------------------------------------------------------------------ */

/** Seconds each shot stays up before the deck moves on by itself. */
const SHOT_SECONDS = 9;

/** One infographic poster inside the deck card. */
function Poster({ article }: { article: ArticleCard }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const p = useShotParts(article);
  const hasStory = article.reading_time_sec > 0;
  const facts = [
    p.place ? { icon: MapPin, text: p.place } : null,
    { icon: Clock, text: te ? `${p.when} · ${p.minutes} ని. చదువు` : `${p.when} · ${p.minutes} min read` },
  ].filter(Boolean) as { icon: typeof MapPin; text: string }[];

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      {/* Photo with the section on it — leaves room for the progress bar above. */}
      <div className="relative h-[34%] shrink-0">
        <NewsImage media={article.hero} ratio="auto" radius="none" priority className="h-full w-full" sizes="480px" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-overlay/80 via-overlay/10 to-transparent" />
        {p.category ? (
          <span className={cn(s.body, 'absolute bottom-3 left-4 rounded-pill bg-wow-deep px-3 py-1 text-meta font-bold text-on-wow')}>
            {p.category}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5 pt-4">
        {/* Key number */}
        <div className="flex items-center gap-3 rounded-xl border-l-4 border-wow bg-wow-tint/60 px-4 py-3">
          <StatBlock stat={p.stat} size="lg" />
        </div>

        <h1 lang={p.head.lang} className={cn(p.head.head, 'text-headline-md font-bold text-ink')}>
          {p.head.text}
        </h1>

        {/* Key points */}
        {p.points.length ? (
          <div>
            <p className={cn(s.body, 'mb-1.5 text-meta font-bold uppercase tracking-wide text-brand')}>
              {te ? 'కీలక అంశాలు' : 'Key points'}
            </p>
            <ul className="space-y-1.5">
              {p.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2">
                  <Icon icon={CheckCircle2} size="sm" className="mt-1 shrink-0 text-success" />
                  <span lang="te" className="te text-te-body-xs text-ink-soft">
                    {pt}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Facts row */}
        <ul className="flex flex-wrap gap-2">
          {facts.map((f) => (
            <li key={f.text} className="inline-flex items-center gap-1.5 rounded-pill bg-brand-tint px-3 py-1 text-brand">
              <Icon icon={f.icon} size="xs" />
              <span className={cn(s.body, 'text-meta font-semibold')}>{f.text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center gap-2 pt-2">
          {hasStory ? (
            <ButtonLink to={article.url} variant="wow" iconRight={ArrowRight} className="flex-1">
              {te ? 'పూర్తి కథ చదవండి' : 'Read full story'}
            </ButtonLink>
          ) : null}
          <ShareButton shortId={article.short_id} url={article.url} title={p.head.text} cardAvailable={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * `/story-shots` — a full-screen story viewer, the way readers already know
 * from WhatsApp Status and Instagram Stories, showing one infographic poster
 * at a time:
 *
 *   - segmented progress bars across the top; the current one fills over
 *     SHOT_SECONDS and then the next shot opens on its own;
 *   - tap the right side of the photo (or →, or swipe left / up) for next, the
 *     left side (or ←, swipe right / down) for previous; press and hold to pause;
 *   - close (✕ or Esc) goes back to where the reader came from.
 *
 * On a desktop the 9:16 poster sits in the middle over a blurred copy of its
 * photo, with round previous / next buttons beside it. Readers who prefer
 * reduced motion get no autoplay — they step through by hand.
 */
export default function StoryShotsPage() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  useDocumentTitle(te ? 'స్టోరీ షాట్స్' : 'Story Shots');
  const navigate = useNavigate();
  const shots = useShots();
  const items = useMemo(() => shots.data ?? [], [shots.data]);
  const [params] = useSearchParams();
  const start = params.get('start');

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(Boolean(reducedMotion));
  const [held, setHeld] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Open at the shot the reader tapped on the home shelf.
  useEffect(() => {
    if (!start || !items.length) return;
    const at = items.findIndex((a) => a.short_id === start);
    if (at >= 0) setIndex(at);
  }, [start, items]);

  const close = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  }, [navigate]);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i < items.length - 1) return i + 1;
      // After the last shot, stop on it rather than looping forever.
      setPaused(true);
      return i;
    });
  }, [items.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Keyboard: arrows step, space pauses, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prev();
      else if (e.key === 'Escape') close();
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, close]);

  // The viewer owns the screen: the page behind must not scroll.
  useEffect(() => {
    const body = document.body.style;
    const before = body.overflow;
    body.overflow = 'hidden';
    return () => {
      body.overflow = before;
    };
  }, []);

  const article = items[index];
  const upcoming = items[index + 1];
  const running = !paused && !held;

  const shell =
    'fixed inset-0 z-overlay flex flex-col bg-ink-deep text-on-ink [padding-top:env(safe-area-inset-top)] [padding-bottom:env(safe-area-inset-bottom)]';

  if (shots.isLoading) {
    return (
      <div className={shell} aria-busy="true">
        <div className="m-auto aspect-[9/16] h-[80dvh] max-w-full animate-pulse rounded-2xl bg-on-ink/10" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className={cn(shell, 'items-center justify-center p-6')}>
        <EmptyState
          title={te ? 'స్టోరీ షాట్స్ త్వరలో' : 'Story Shots are on the way'}
          body={te ? 'సంపాదకులు కొత్త కథలు సిద్ధం చేస్తున్నారు.' : 'The desk is preparing new stories.'}
        />
        <ButtonLink to="/" variant="wow" className="mt-4">
          {te ? 'హోమ్‌కి వెళ్లండి' : 'Go home'}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className={shell} role="dialog" aria-modal="true" aria-label={te ? 'స్టోరీ షాట్స్' : 'Story Shots'}>
      {/* Blurred backdrop from the current photo (desktop only — on a phone the poster fills the screen). */}
      {article.hero?.url ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden scale-110 bg-cover bg-center opacity-40 blur-3xl md:block"
          style={{ backgroundImage: `url(${article.hero.url})` }}
        />
      ) : null}

      <div className="relative flex min-h-0 flex-1 items-center justify-center gap-6 md:py-6">
        {/* Desktop previous */}
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          aria-label={te ? 'మునుపటి' : 'Previous'}
          className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-on-ink/15 text-on-ink transition hover:bg-on-ink/25 disabled:invisible md:flex"
        >
          <Icon icon={ChevronLeft} size="lg" />
        </button>

        {/* The poster */}
        <article
          key={article.short_id}
          className="relative h-full w-full animate-fade-in overflow-hidden bg-paper md:aspect-[9/16] md:h-full md:max-h-[880px] md:w-auto md:rounded-2xl md:shadow-raised"
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) touch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start0 = touch.current;
            const t = e.changedTouches[0];
            touch.current = null;
            if (!start0 || !t) return;
            const dx = t.clientX - start0.x;
            const dy = t.clientY - start0.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return; // a tap, handled by the zones
            if (Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
            else (dy < 0 ? next : prev)();
          }}
        >
          <Poster article={article} />

          {/* Top: progress + controls, over the photo. */}
          <div className="absolute inset-x-0 top-0 z-10 space-y-2.5 p-3 text-on-ink md:p-4">
            <div className="flex gap-1" aria-hidden>
              {items.map((a, i) => (
                <span key={a.short_id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-on-ink/35">
                  {i < index ? (
                    <span className="block h-full w-full bg-on-ink" />
                  ) : i === index ? (
                    <span
                      key={`${a.short_id}-${index}`}
                      className="block h-full w-full origin-left bg-on-ink"
                      style={{
                        animation: reducedMotion ? 'none' : `wow-progress ${SHOT_SECONDS}s linear forwards`,
                        animationPlayState: running ? 'running' : 'paused',
                        transform: reducedMotion ? 'scaleX(1)' : undefined,
                      }}
                      onAnimationEnd={next}
                    />
                  ) : null}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-wow-deep text-on-wow">
                <Icon icon={GalleryVerticalEnd} size="sm" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className={cn(s.body, 'text-ui-sm font-bold')}>{te ? 'స్టోరీ షాట్స్' : 'Story Shots'}</p>
                <p className="font-sans text-meta tabular-nums text-on-ink/80">
                  {index + 1} / {items.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? (te ? 'ప్లే' : 'Play') : te ? 'ఆపు' : 'Pause'}
                className="flex h-tap w-tap items-center justify-center rounded-pill text-on-ink hover:bg-on-ink/15"
              >
                <Icon icon={paused ? Play : Pause} size="md" />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label={te ? 'మూసివేయండి' : 'Close'}
                className="flex h-tap w-tap items-center justify-center rounded-pill text-on-ink hover:bg-on-ink/15"
              >
                <Icon icon={X} size="lg" />
              </button>
            </div>
          </div>

          {/* Tap zones over the photo: left third back, the rest forward. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={prev}
            className="absolute left-0 top-24 h-[calc(34%-6rem)] w-1/3 cursor-w-resize"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={next}
            className="absolute right-0 top-24 h-[calc(34%-6rem)] w-2/3 cursor-e-resize"
          />
        </article>

        {/* Desktop next */}
        <button
          type="button"
          onClick={next}
          disabled={index === items.length - 1}
          aria-label={te ? 'తదుపరి' : 'Next'}
          className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-on-ink/15 text-on-ink transition hover:bg-on-ink/25 disabled:invisible md:flex"
        >
          <Icon icon={ChevronRight} size="lg" />
        </button>
      </div>

      {/* Warm the next photo so the swipe never waits on the network. */}
      {upcoming?.hero?.url ? <link rel="preload" as="image" href={upcoming.hero.url} /> : null}
    </div>
  );
}
