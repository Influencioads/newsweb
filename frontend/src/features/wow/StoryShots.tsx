import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  GalleryVerticalEnd,
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

/**
 * Story Shots (pitch §2): pictures only.
 *
 * A shot is its picture — the home shelf shows four of them, and the
 * full-screen deck shows one at a time, filling the card, with only the
 * progress bar and controls on top and Read story / Share at the bottom.
 * Tapping a shelf picture opens the deck at that shot.
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
      // The newest stories that have a picture.
      const latest = (await publicApi.fetchFeed({ limit: SHOTS_LIMIT * 2 })).articles;
      return latest.filter((a) => a.hero?.url).slice(0, SHOTS_LIMIT);
    },
    staleTime: 60_000,
  });
}

/** The headline, for each shot's accessible name and share text. */
function useShotParts(article: ArticleCard) {
  const s = useScript();
  return { head: s.text(article.title_te, article.title_en) };
}

/* ------------------------------------------------------------------------ */
/* Home shelf                                                               */
/* ------------------------------------------------------------------------ */

/** A home shelf tile: just the picture; the headline is its accessible name. */
function ShelfCard({ article }: { article: ArticleCard }) {
  const p = useShotParts(article);
  return (
    <Link
      to={`/story-shots?start=${article.short_id}`}
      aria-label={p.head.text}
      className="group block overflow-hidden rounded-2xl shadow-card transition-[box-shadow,transform] duration-base hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transform-none"
    >
      <NewsImage media={article.hero} ratio="4/5" radius="2xl" sizes="(min-width: 768px) 25vw, 60vw" />
    </Link>
  );
}

/** Home shelf: one row of four pictures (sideways scroll on phones). */
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
      <ul className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 md:pb-0">
        {items.slice(0, 4).map((article) => (
          <li key={article.short_id} className="w-[62%] shrink-0 snap-start sm:w-[44%] md:w-auto">
            <ShelfCard article={article} />
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

/**
 * One shot inside the deck card: just the picture, filling the card. The
 * headline stays as its accessible name; a slim bar at the bottom keeps the
 * way to the full story and sharing.
 */
function Poster({ article }: { article: ArticleCard }) {
  const { language } = useI18n();
  const te = language === 'te';
  const p = useShotParts(article);
  const hasStory = article.reading_time_sec > 0;

  return (
    <div className="relative h-full bg-ink">
      <NewsImage
        media={article.hero}
        ratio="auto"
        radius="none"
        priority
        className="h-full w-full"
        sizes="(min-width: 768px) 500px, 100vw"
      />
      <h1 className="sr-only">{p.head.text}</h1>
      {/* Shades under the controls at the top and the buttons at the bottom. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-overlay/70 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-overlay/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-end gap-2 p-3 md:p-4">
        {hasStory ? (
          <ButtonLink to={article.url} variant="wow" size="sm" iconRight={ArrowRight}>
            {te ? 'కథ చదవండి' : 'Read story'}
          </ButtonLink>
        ) : null}
        <ShareButton
          shortId={article.short_id}
          url={article.url}
          title={p.head.text}
          cardAvailable={false}
          className="bg-on-ink/15 text-on-ink hover:bg-on-ink/25"
        />
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
 * photo, with round previous / next buttons beside it; on a phone a
 * Previous / Next bar sits under the poster. Readers who prefer
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
              <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep text-on-wow">
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

      {/* Phone: previous / next bar under the poster, so moving on never
          depends on knowing the tap zones or the swipe. */}
      <div className="relative flex items-center justify-between gap-3 border-t border-on-ink/10 bg-ink-deep px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          aria-label={te ? 'మునుపటి' : 'Previous'}
          className={cn(
            s.body,
            'flex min-h-tap items-center gap-1.5 rounded-pill bg-on-ink/15 pl-2 pr-4 text-ui-sm font-bold text-on-ink transition active:scale-[.97] disabled:invisible',
          )}
        >
          <Icon icon={ChevronLeft} size="md" />
          {te ? 'మునుపటి' : 'Previous'}
        </button>
        <span className="font-sans text-meta tabular-nums text-on-ink/75">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          onClick={next}
          disabled={index === items.length - 1}
          aria-label={te ? 'తదుపరి' : 'Next'}
          className={cn(
            s.body,
            'flex min-h-tap items-center gap-1.5 rounded-pill bg-gradient-to-br from-wow to-wow-deep pl-4 pr-2 text-ui-sm font-bold text-on-wow transition active:scale-[.97] disabled:invisible',
          )}
        >
          {te ? 'తదుపరి' : 'Next'}
          <Icon icon={ChevronRight} size="md" />
        </button>
      </div>

      {/* Warm the next photo so the swipe never waits on the network. */}
      {upcoming?.hero?.url ? <link rel="preload" as="image" href={upcoming.hero.url} /> : null}
    </div>
  );
}
