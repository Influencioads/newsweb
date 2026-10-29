import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Ghost, Lightbulb, Newspaper, Pause, Play, Square, Sunrise, type LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useTts } from '@/features/reader/tts';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * WOW Radio (pitch §2): a highlighted audio player with four segments —
 * Morning Mantra, Spoorthi, WOW News and Mystery.
 *
 * The four segments sit as a 2 × 2 grid of tiles on the home card (a row of
 * four on /radio), each with its own icon, colour and line. Tapping one opens
 * that segment's own page, /radio/<segment>, with the player and its running
 * order. A segment's programme is built from the newest stories in
 * its categories and read aloud on the listener's own device in Telugu (the
 * same Web Speech voice the article "Listen" control uses —
 * features/reader/tts). Each segment lists fallbacks so it is not silent while
 * its own category fills up. When recorded episodes exist they replace the
 * device voice here and nothing else on the page changes.
 */

interface Segment {
  id: string;
  te: string;
  en: string;
  taglineTe: string;
  taglineEn: string;
  icon: LucideIcon;
  /** Tile accent: a gradient pair from the theme tokens. */
  tone: string;
  /** Tried in order; the first with stories is played. */
  categories: string[];
}

export const SEGMENTS: readonly Segment[] = [
  {
    id: 'morning-mantra',
    te: 'మార్నింగ్ మంత్ర',
    en: 'Morning Mantra',
    taglineTe: 'రోజుకు సానుకూల ఆరంభం',
    taglineEn: 'A positive start to the day',
    icon: Sunrise,
    tone: 'from-wow to-wow-deep',
    categories: ['morning-mantra', 'devotional'],
  },
  {
    id: 'spoorthi',
    te: 'స్ఫూర్తి',
    en: 'Spoorthi',
    taglineTe: 'హీరోల కథలు, విజయ గాథలు',
    taglineEn: 'Hero stories that inspire',
    icon: Lightbulb,
    tone: 'from-success/80 to-success',
    categories: ['real-heroes', 'zero-to-hero', 'inspiring'],
  },
  {
    id: 'wow-news',
    te: 'వావ్ న్యూస్',
    en: 'WOW News',
    taglineTe: 'వావ్ అనిపించే వార్తలు',
    taglineEn: 'News that makes you say WOW',
    icon: Newspaper,
    tone: 'from-brand to-brand-dark',
    categories: ['jai-telugoda', 'business-guru', 'wow-tech', 'startup-stories', 'wow-idea'],
  },
  {
    id: 'mystery',
    te: 'మిస్టరీ',
    en: 'Mystery',
    taglineTe: 'వివరించలేని సంఘటనలు, రహస్యాలు',
    taglineEn: 'Unexplained events and secrets',
    icon: Ghost,
    tone: 'from-ai to-ai-text',
    categories: ['mystery', 'wow-puranam'],
  },
];

const PER_SEGMENT = 5;
const DEFAULT_SEGMENT: Segment = SEGMENTS[0] as Segment;

async function fetchSegment(segment: Segment): Promise<ArticleCard[]> {
  for (const category of segment.categories) {
    try {
      const feed = await publicApi.fetchFeed({ category, limit: PER_SEGMENT });
      if (feed.articles.length) return feed.articles.slice(0, PER_SEGMENT);
    } catch {
      // A category that does not exist yet just falls through to the next.
    }
  }
  return [];
}

function script(segment: Segment, items: ArticleCard[]): string {
  const intro = `వావ్ రేడియోకి స్వాగతం. ఇది ${segment.te}.`;
  const body = items.map((a) => [a.title_te, a.summary_te].filter(Boolean).join('. ')).join('. తర్వాత కథ. ');
  return items.length ? `${intro} ${body}. వింటున్నందుకు ధన్యవాదాలు.` : '';
}

/** Five bars that dance while the voice is on air. */
function Equalizer({ live }: { live: boolean }) {
  return (
    <span aria-hidden className="flex h-6 items-end gap-[3px]">
      {[0.5, 0.9, 0.65, 1, 0.75].map((h, i) => (
        <span
          key={i}
          className={cn('w-[4px] rounded-full bg-wow', live ? 'animate-pulse' : '')}
          style={{
            height: `${(live ? h : 0.25) * 100}%`,
            animationDelay: `${i * 120}ms`,
            animationDuration: `${700 + i * 90}ms`,
            transition: 'height 300ms ease',
          }}
        />
      ))}
    </span>
  );
}

type PlayState = 'idle' | 'loading' | 'speaking' | 'paused';

/**
 * The four segment tiles. Each name opens that segment's own page; with
 * `onPlay` (the home card) the round play button plays the segment right
 * there instead.
 */
function SegmentTiles({
  large = false,
  active,
  playState = 'idle',
  onPlay,
}: {
  large?: boolean;
  active?: string | null;
  playState?: PlayState;
  onPlay?: (id: string) => void;
}) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  return (
    <ul className={cn('relative grid gap-2.5', large ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2')}>
      {SEGMENTS.map((sg) => {
        const current = active === sg.id;
        const live = current && playState === 'speaking';
        const name = te ? sg.te : sg.en;
        const playMark = cn(
          'flex shrink-0 items-center justify-center rounded-pill bg-wow-deep text-on-wow shadow-raised transition-transform duration-base hover:scale-110 motion-reduce:transform-none',
          // On the small home tiles the play button sits in the corner so it never covers the name.
          large ? 'h-8 w-8' : 'absolute right-2 top-2 z-10 h-7 w-7 md:h-8 md:w-8',
          current && 'ring-2 ring-on-ink/70',
        );
        return (
          <li
            key={sg.id}
            className={cn(
              'group relative min-w-0 overflow-hidden rounded-xl border bg-on-ink/5 transition-[border-color,background-color,transform] duration-base hover:-translate-y-0.5 hover:bg-on-ink/10 motion-reduce:transform-none',
              current ? 'border-wow bg-on-ink/10' : 'border-on-ink/15 hover:border-wow',
            )}
          >
            <Link
              to={`/radio/${sg.id}`}
              className={cn(
                'flex h-full text-left',
                // Phone: icon on top (play button beside it), name and English underneath,
                // so a long Telugu name never runs into the play button.
                large ? 'items-center gap-3 p-4' : 'flex-col items-start gap-1.5 p-2.5 md:flex-row md:items-center md:gap-3 md:p-3 md:pr-11',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-on-ink shadow-raised',
                  large ? 'h-14 w-14' : 'h-8 w-8 md:h-11 md:w-11',
                  sg.tone,
                )}
              >
                <Icon icon={sg.icon} size={large ? 'lg' : 'sm'} />
              </span>
              <span className="min-w-0 w-full flex-1 md:w-auto">
                <span lang="te" className={cn('te block font-bold leading-snug', large ? 'text-te-body-sm' : 'text-te-body-xs')}>
                  {sg.te}
                </span>
                <span className={cn(s.body, 'block text-meta text-on-ink/70', large && 'te-clamp-2')}>
                  {current && playState !== 'idle' ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-wow">
                      {playState === 'loading'
                        ? te ? 'ట్యూన్ అవుతోంది…' : 'Tuning…'
                        : playState === 'speaking'
                          ? te ? 'ప్రసారంలో' : 'On air'
                          : te ? 'ఆపబడింది' : 'Paused'}
                    </span>
                  ) : large ? (
                    te ? sg.taglineTe : sg.taglineEn
                  ) : (
                    sg.en
                  )}
                </span>
              </span>
              {!onPlay ? (
                <span aria-hidden className={playMark}>
                  <Icon icon={Play} size="xs" />
                </span>
              ) : null}
            </Link>
            {onPlay ? (
              <button
                type="button"
                onClick={() => onPlay(sg.id)}
                aria-label={live ? `${te ? 'ఆపు' : 'Pause'} · ${name}` : `${te ? 'ప్లే' : 'Play'} · ${name}`}
                aria-pressed={live}
                className={playMark}
              >
                <Icon icon={live ? Pause : Play} size="xs" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The home card's inline player: the play button on a tile reads that
 * segment's stories aloud right on the home page (same voice and running
 * order as its /radio page); pressing it again pauses, another tile switches.
 */
function useInlineRadio() {
  const [active, setActive] = useState<string | null>(null);
  const [startWhenReady, setStartWhenReady] = useState(false);
  const segment = SEGMENTS.find((sg) => sg.id === active) ?? null;
  const programme = useQuery({
    queryKey: ['wow-radio', active],
    queryFn: () => fetchSegment(segment ?? DEFAULT_SEGMENT),
    enabled: Boolean(segment),
    staleTime: 120_000,
  });
  const items = programme.data ?? [];
  const text = segment ? script(segment, items) : '';
  const { state, toggle, stop } = useTts(text);

  // A new segment's stories have arrived: start reading as soon as the text is in.
  useEffect(() => {
    if (!startWhenReady || programme.isFetching || !(programme.isSuccess || programme.isError)) return;
    setStartWhenReady(false);
    if (text && state === 'idle') toggle();
  }, [startWhenReady, text, programme.isFetching, programme.isSuccess, programme.isError, state, toggle]);

  const play = useCallback(
    (id: string) => {
      if (id === active && (state === 'speaking' || state === 'paused')) {
        toggle();
        return;
      }
      stop();
      setActive(id);
      setStartWhenReady(true);
    },
    [active, state, toggle, stop],
  );

  const playState: PlayState =
    state === 'speaking'
      ? 'speaking'
      : state === 'paused'
        ? 'paused'
        : active && (startWhenReady || programme.isFetching)
          ? 'loading'
          : 'idle';

  const note =
    active && state === 'unavailable'
      ? 'unavailable'
      : active && programme.isSuccess && !items.length && !startWhenReady
        ? 'empty'
        : null;

  return { active, play, playState, note };
}

function OnAirLabel() {
  return (
    <p className="inline-flex items-center gap-1.5 font-sans text-eyebrow font-bold uppercase text-wow">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-wow opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-wow" />
      </span>
      On air · ప్రసారంలో
    </p>
  );
}

/**
 * WOW Radio — the home card (`card`) and the /radio page (`page`): the four
 * segments as tiles. Tapping one opens /radio/<segment>, where it plays.
 */
export function WowRadio({ variant = 'card' }: { variant?: 'card' | 'page' }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const page = variant === 'page';
  const radio = useInlineRadio();

  return (
    <section
      aria-labelledby={`wow-radio-${variant}`}
      className={cn(
        'relative h-full overflow-hidden rounded-2xl bg-brand-deep text-on-ink ring-2 ring-wow/60',
        page ? 'p-5 md:p-8' : 'p-5 md:p-6',
      )}
    >
      {/* Soft orange glow in the corner — the "on air" lamp. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-wow/25 blur-3xl"
      />

      {page ? (
        <img
          src="/wow-radio.webp"
          alt={te ? 'వావ్ రేడియో' : 'WOW Radio'}
          width={960}
          height={540}
          className="relative mb-5 aspect-[16/7] w-full rounded-xl object-cover shadow-raised"
        />
      ) : null}

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!page ? (
            <img
              src="/wow-radio.webp"
              alt=""
              width={960}
              height={540}
              className="h-14 w-auto shrink-0 rounded-xl object-cover shadow-raised ring-1 ring-on-ink/20 md:h-16"
            />
          ) : null}
          <div>
            <OnAirLabel />
            <h2 id={`wow-radio-${variant}`} className="font-serif text-headline-md font-bold leading-tight">
              WOW Radio <span lang="te" className="th text-headline-xs font-semibold text-on-ink/75">· వావ్ రేడియో</span>
            </h2>
          </div>
        </div>
        {!page ? (
          <Link
            to="/radio"
            className={cn(s.body, 'rounded-xl px-2 py-1 text-ui-sm font-semibold text-wow underline-offset-4 hover:underline')}
          >
            {te ? 'వినడానికి క్లిక్ చేయండి' : 'Click to listen'}
          </Link>
        ) : null}
      </div>

      <p role="status" className={cn(s.body, 'relative mt-3 text-ui-sm text-on-ink/75')}>
        {radio.note === 'unavailable'
          ? te
            ? 'ఈ బ్రౌజర్‌లో తెలుగు వాయిస్ లేదు. Android లేదా Chrome లో ప్రయత్నించండి.'
            : 'This browser has no Telugu voice. Try Chrome or an Android phone.'
          : radio.note === 'empty'
            ? te
              ? 'ఈ సెగ్మెంట్ ఎపిసోడ్‌లు త్వరలో.'
              : 'Episodes for this segment are coming soon.'
            : page
              ? te
                ? 'ఒక సెగ్మెంట్ ఎంచుకోండి — దాని పేజీలో వినండి.'
                : 'Pick a segment to listen on its own page.'
              : te
                ? '▶ నొక్కి ఇక్కడే వినండి — పేరు నొక్కితే ఆ సెగ్మెంట్ పేజీ.'
                : 'Press ▶ to listen right here, or tap a name for its page.'}
      </p>
      <div className="relative mt-3">
        {page ? (
          <SegmentTiles large />
        ) : (
          <SegmentTiles active={radio.active} playState={radio.playState} onPlay={radio.play} />
        )}
      </div>
    </section>
  );
}

/** `/radio` */
export default function RadioPage() {
  const { language } = useI18n();
  useDocumentTitle(language === 'te' ? 'వావ్ రేడియో' : 'WOW Radio');
  return (
    <PageContainer width="page" className="py-6 md:py-10">
      <WowRadio variant="page" />
    </PageContainer>
  );
}

/**
 * `/radio/:segment` — one segment's own page: its banner, the play button and
 * the running order, with the other three segments one tap away.
 */
export function RadioSegmentPage() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const { segment: segmentId } = useParams();
  const segment = SEGMENTS.find((sg) => sg.id === segmentId);
  useDocumentTitle(segment ? `${te ? segment.te : segment.en} · ${te ? 'వావ్ రేడియో' : 'WOW Radio'}` : te ? 'వావ్ రేడియో' : 'WOW Radio');

  const programme = useQuery({
    queryKey: ['wow-radio', segment?.id],
    queryFn: () => fetchSegment(segment ?? DEFAULT_SEGMENT),
    enabled: Boolean(segment),
    staleTime: 120_000,
  });
  const items = programme.data ?? [];
  const { state, toggle, stop } = useTts(segment ? script(segment, items) : '');
  const live = state === 'speaking';

  if (!segment) return <Navigate to="/radio" replace />;

  const status = programme.isLoading
    ? te
      ? 'ట్యూన్ అవుతోంది…'
      : 'Tuning…'
    : !items.length
      ? te
        ? 'ఈ సెగ్మెంట్ ఎపిసోడ్‌లు త్వరలో'
        : 'Episodes for this segment are coming soon'
      : state === 'unavailable'
        ? te
          ? 'ఈ బ్రౌజర్‌లో తెలుగు వాయిస్ లేదు. Android లేదా Chrome లో ప్రయత్నించండి.'
          : 'This browser has no Telugu voice. Try Chrome or an Android phone.'
        : live
          ? te
            ? 'ప్రసారంలో'
            : 'On air'
          : state === 'paused'
            ? te
              ? 'ఆపబడింది'
              : 'Paused'
            : te
              ? 'వినడానికి ప్లే నొక్కండి'
              : 'Press play to listen';

  return (
    <PageContainer width="page" className="space-y-5 py-6 md:py-10">
      <Link
        to="/radio"
        className={cn(s.body, 'inline-flex min-h-tap items-center gap-1.5 rounded-pill pr-3 text-ui-sm font-semibold text-ink-soft hover:text-ink')}
      >
        <Icon icon={ChevronLeft} size="sm" />
        {te ? 'వావ్ రేడియో' : 'WOW Radio'}
      </Link>

      <section
        aria-labelledby="radio-segment"
        className="relative overflow-hidden rounded-2xl bg-brand-deep p-5 text-on-ink ring-2 ring-wow/60 md:p-8"
      >
        <div aria-hidden className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-30', segment.tone)} />
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-wow/25 blur-3xl" />

        <div className="relative flex items-center gap-4">
          <span
            className={cn(
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-on-ink shadow-raised md:h-20 md:w-20',
              segment.tone,
            )}
          >
            <Icon icon={segment.icon} size="lg" />
          </span>
          <div className="min-w-0">
            <OnAirLabel />
            <h1 id="radio-segment" lang="te" className="th text-headline-lg font-bold md:text-headline-xl">
              {segment.te}
            </h1>
            <p className={cn(s.body, 'text-ui-sm text-on-ink/80')}>{te ? segment.taglineTe : segment.taglineEn}</p>
          </div>
          <img
            src="/wow-radio.webp"
            alt=""
            width={960}
            height={540}
            className="ml-auto hidden h-16 w-auto shrink-0 rounded-xl object-cover shadow-raised ring-1 ring-on-ink/20 md:block md:h-20"
          />
        </div>

        {/* Player */}
        <div className="relative mt-6 flex items-center gap-4 rounded-xl bg-on-ink/10 p-4">
          <button
            type="button"
            onClick={toggle}
            disabled={state === 'unavailable' || !items.length}
            aria-label={live ? (te ? 'ఆపు' : 'Pause') : te ? 'ప్లే' : 'Play'}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-pill bg-wow-deep text-on-wow shadow-raised transition-transform duration-base hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
          >
            <Icon icon={live ? Pause : Play} size="lg" />
          </button>
          <div className="min-w-0 flex-1">
            <p lang="te" className="th text-headline-xs font-bold">
              {te ? 'వావ్ రేడియో' : 'WOW Radio'} · {segment.te}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Equalizer live={live} />
              <span role="status" className={cn(s.body, 'text-meta text-on-ink/80')}>
                {status}
              </span>
            </div>
          </div>
          {state === 'speaking' || state === 'paused' ? (
            <button
              type="button"
              onClick={stop}
              aria-label={te ? 'ఆపివేయండి' : 'Stop'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-on-ink/25 text-on-ink hover:bg-on-ink/10"
            >
              <Icon icon={Square} size="sm" />
            </button>
          ) : null}
        </div>

        {/* Running order */}
        {items.length ? (
          <ol className="relative mt-5 space-y-1 border-t border-on-ink/15 pt-4">
            <li className={cn(s.body, 'mb-1 text-meta font-semibold uppercase tracking-wide text-on-ink/60')}>
              {te ? 'ఈ కార్యక్రమంలో' : 'In this programme'}
            </li>
            {items.map((a, i) => (
              <li key={a.short_id}>
                <Link to={a.url} className="flex items-baseline gap-3 rounded-lg px-1 py-1 hover:bg-on-ink/5">
                  <span className="font-sans text-meta font-bold tabular-nums text-wow">{String(i + 1).padStart(2, '0')}</span>
                  <span lang="te" className="te te-clamp-2 text-te-body-xs text-on-ink/90">
                    {a.title_te}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {/* The other three segments */}
      <nav aria-label={te ? 'ఇతర సెగ్మెంట్లు' : 'Other segments'} className="space-y-2">
        <p className={cn(s.body, 'text-ui-sm font-semibold text-ink-soft')}>{te ? 'ఇతర సెగ్మెంట్లు' : 'Other segments'}</p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SEGMENTS.filter((sg) => sg.id !== segment.id).map((sg) => (
            <li key={sg.id}>
              <Link
                to={`/radio/${sg.id}`}
                onClick={stop}
                className="flex items-center gap-3 rounded-xl border border-rule bg-surface p-3 transition-colors duration-base hover:border-wow"
              >
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-on-ink', sg.tone)}>
                  <Icon icon={sg.icon} size="md" />
                </span>
                <span className="min-w-0">
                  <span lang="te" className="te block text-te-body-xs font-bold text-ink">
                    {sg.te}
                  </span>
                  <span className="block font-sans text-meta text-muted">{sg.en}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PageContainer>
  );
}
