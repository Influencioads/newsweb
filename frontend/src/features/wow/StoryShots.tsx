import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronLeft, ChevronRight, GalleryVerticalEnd, Pause, Play, X } from 'lucide-react';

import { ShareButton } from '@/components/article/ShareSheet';
import { NewsImage } from '@/components/media/NewsImage';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState } from '@/components/ui/State';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * Story Shots (pitch §2): quick, swipeable visual stories — a tall image, a
 * short caption, one tap to share. The home page shows them as a sideways
 * shelf of 9:16 cards; tapping one opens the full-screen deck at that story,
 * where the reader swipes up for the next.
 *
 * The source is the short-news feed: the newsroom already writes a headline
 * and a short text for those, which is exactly what a Story Shot needs. Until
 * there are short items, the newest stories with a photograph stand in.
 */

const SHOTS_LIMIT = 12;

function useShots() {
  return useQuery({
    queryKey: ['public', 'story-shots'],
    queryFn: async () => {
      // The newest illustrated stories. Short news can't feed this any more:
      // since the short-news cards change it is a picture-only card with no
      // headline or summary for a shot to show.
      const latest = (await publicApi.fetchFeed({ limit: SHOTS_LIMIT * 2 })).articles;
      return latest.filter((a) => a.hero?.url).slice(0, SHOTS_LIMIT);
    },
    staleTime: 60_000,
  });
}

/** Home shelf: a row of tall cards that scrolls sideways. */
export function StoryShotsStrip() {
  const { language } = useI18n();
  const s = useScript();
  const shots = useShots();
  const items = shots.data ?? [];
  if (!items.length) return null;

  return (
    <section aria-labelledby="story-shots">
      <SectionHeader
        title={<span id="story-shots">{language === 'te' ? 'స్టోరీ షాట్స్' : 'Story Shots'}</span>}
        to="/story-shots"
        toLabel={language === 'te' ? 'అన్నీ చూడండి' : 'View all'}
      />
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:px-0">
        {items.map((article) => {
          const head = s.text(article.title_te, article.title_en);
          return (
            <li key={article.short_id} className="w-[44%] shrink-0 snap-start md:w-[24%] lg:w-[15.5%]">
              <Link
                to={`/story-shots?start=${article.short_id}`}
                className="group relative block overflow-hidden rounded-2xl bg-ink"
              >
                <NewsImage media={article.hero} ratio="9/16" radius="2xl" sizes="(max-width: 768px) 45vw, 200px" />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-t from-overlay/90 via-overlay/25 to-transparent"
                />
                <span className="absolute left-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-pill bg-wow-deep text-on-wow ring-2 ring-on-ink/80">
                  <Icon icon={GalleryVerticalEnd} size="xs" />
                </span>
                <p
                  lang={head.lang}
                  className={cn(head.head, 'te-clamp-3 absolute inset-x-2.5 bottom-2.5 text-headline-xs font-bold text-on-ink')}
                >
                  {head.text}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


/** Seconds each shot stays up before the deck moves on by itself. */
const SHOT_SECONDS = 8;

/**
 * `/story-shots` — a full-screen story viewer, the way readers already know
 * from WhatsApp Status and Instagram Stories:
 *
 *   - segmented progress bars across the top; the current one fills over
 *     SHOT_SECONDS and then the next shot opens on its own;
 *   - tap the right side (or →, or swipe left / up) for next, the left side
 *     (or ←, swipe right / down) for previous; press and hold to pause;
 *   - close (✕ or Esc) goes back to where the reader came from.
 *
 * On a desktop the 9:16 card sits in the middle over a blurred copy of its own
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
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);

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
        <ButtonLink to="/" variant="primary" className="mt-4">
          {te ? 'హోమ్‌కి వెళ్లండి' : 'Go home'}
        </ButtonLink>
      </div>
    );
  }

  const head = s.text(article.title_te, article.title_en);
  const hasStory = article.reading_time_sec > 0;

  return (
    <div className={shell} role="dialog" aria-modal="true" aria-label={te ? 'స్టోరీ షాట్స్' : 'Story Shots'}>
      {/* Blurred backdrop from the current photo (desktop only — on a phone the card fills the screen). */}
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

        {/* The card */}
        <article
          key={article.short_id}
          className="relative h-full w-full overflow-hidden bg-ink md:aspect-[9/16] md:h-full md:max-h-[860px] md:w-auto md:rounded-2xl md:shadow-raised"
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (t) touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
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
          <NewsImage
            media={article.hero}
            ratio="auto"
            radius="none"
            priority
            className="absolute inset-0 h-full w-full"
            sizes="(max-width: 768px) 100vw, 480px"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-overlay/70 via-transparent via-30% to-overlay"
          />

          {/* Top: progress + controls */}
          <div className="absolute inset-x-0 top-0 z-10 space-y-3 p-3 md:p-4">
            <div className="flex gap-1" aria-hidden>
              {items.map((a, i) => (
                <span key={a.short_id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-on-ink/30">
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
                <p className="font-sans text-meta tabular-nums text-on-ink/75">
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

          {/* Tap zones: left third back, the rest forward (kept below the controls). */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={prev}
            className="absolute bottom-48 left-0 top-28 w-1/3 cursor-w-resize"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={next}
            className="absolute bottom-48 right-0 top-28 w-2/3 cursor-e-resize"
          />

          {/* Bottom: caption + actions */}
          <div className="absolute inset-x-0 bottom-0 z-10 space-y-3 p-5 pb-6">
            {article.category ? (
              <span className={cn(s.body, 'inline-block rounded-pill bg-wow-deep px-3 py-0.5 text-meta font-bold text-on-wow')}>
                {s.pick(article.category.name_te, article.category.name_en)}
              </span>
            ) : null}
            <h1 lang={head.lang} className={cn(head.head, 'text-headline-md font-bold text-on-ink md:text-headline-lg')}>
              {head.text}
            </h1>
            {article.summary_te ? (
              <p lang="te" className="te te-clamp-4 text-te-body-sm text-on-ink/90">
                {article.summary_te}
              </p>
            ) : null}
            <div className="flex items-center gap-2 pt-1">
              {hasStory ? (
                <ButtonLink to={article.url} variant="primary" iconRight={ArrowRight} className="flex-1 md:flex-none">
                  {te ? 'పూర్తి కథ చదవండి' : 'Read full story'}
                </ButtonLink>
              ) : null}
              <ShareButton
                shortId={article.short_id}
                url={article.url}
                title={head.text}
                cardAvailable={false}
                className="bg-on-ink/15 text-on-ink hover:bg-on-ink/25"
              />
            </div>
          </div>
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
