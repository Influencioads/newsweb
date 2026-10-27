import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ghost, Lightbulb, Pause, Play, Radio, Square, Sunrise, Zap, type LucideIcon } from 'lucide-react';

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
 * Morning Mantra, Spoorthi, WOW Facts and Mystery.
 *
 * The four segments sit as a 2 × 2 grid of tiles (four in a row on the radio
 * page), each with its own icon, colour and line; the selected one drives the
 * player underneath. A segment's programme is built from the newest stories in
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
    id: 'wow-facts',
    te: 'వావ్ ఫ్యాక్ట్స్',
    en: 'WOW Facts',
    taglineTe: 'ఆసక్తికరమైన నిజాలు, తెలుసుకోవాల్సిన విషయాలు',
    taglineEn: 'Surprising facts worth knowing',
    icon: Zap,
    tone: 'from-brand to-brand-dark',
    categories: ['wow-tech', 'wow-idea', 'startup-stories'],
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

export function WowRadio({ variant = 'card' }: { variant?: 'card' | 'page' }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const [segmentId, setSegmentId] = useState(DEFAULT_SEGMENT.id);
  const segment: Segment = SEGMENTS.find((sg) => sg.id === segmentId) ?? DEFAULT_SEGMENT;

  const programme = useQuery({
    queryKey: ['wow-radio', segment.id],
    queryFn: () => fetchSegment(segment),
    staleTime: 120_000,
  });
  const items = programme.data ?? [];
  const { state, toggle, stop } = useTts(script(segment, items));
  const live = state === 'speaking';
  const page = variant === 'page';

  const tune = (id: string) => {
    if (id === segmentId) return;
    stop();
    setSegmentId(id);
  };

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

      {/* Header */}
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-wow-deep text-on-wow shadow-raised">
            <Icon icon={Radio} size="lg" />
          </span>
          <div>
            <p className="inline-flex items-center gap-1.5 font-sans text-eyebrow font-bold uppercase text-wow">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-wow opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-wow" />
              </span>
              On air · ప్రసారంలో
            </p>
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
            {te ? 'రేడియో తెరవండి' : 'Open Radio'}
          </Link>
        ) : null}
      </div>

      {/* The four segments */}
      <div
        role="radiogroup"
        aria-label={te ? 'సెగ్మెంట్లు' : 'Segments'}
        className={cn('relative mt-5 grid gap-2.5', page ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2')}
      >
        {SEGMENTS.map((sg) => {
          const active = sg.id === segment.id;
          return (
            <button
              key={sg.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => tune(sg.id)}
              className={cn(
                'group relative flex items-center gap-3 overflow-hidden rounded-xl border p-3 text-left transition-[border-color,background-color,transform] duration-base',
                active
                  ? 'border-wow bg-on-ink/15'
                  : 'border-on-ink/15 bg-on-ink/5 hover:-translate-y-0.5 hover:border-on-ink/35 motion-reduce:transform-none',
              )}
            >
              <span
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-on-ink shadow-raised',
                  sg.tone,
                )}
              >
                <Icon icon={active && live ? Pause : sg.icon} size="md" />
              </span>
              <span className="min-w-0">
                <span lang="te" className="te block text-te-body-xs font-bold leading-snug">
                  {sg.te}
                </span>
                <span className="block font-sans text-meta text-on-ink/70">{sg.en}</span>
              </span>
              {active ? (
                <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-wow" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Player */}
      <div className="relative mt-5 flex items-center gap-4 rounded-xl bg-on-ink/5 p-3">
        <button
          type="button"
          onClick={toggle}
          disabled={state === 'unavailable' || !items.length}
          aria-label={live ? (te ? 'ఆపు' : 'Pause') : te ? 'ప్లే' : 'Play'}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-pill bg-wow-deep text-on-wow shadow-raised transition-transform duration-base hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
        >
          <Icon icon={live ? Pause : Play} size="lg" />
        </button>
        <div className="min-w-0 flex-1">
          <p lang="te" className="th text-headline-xs font-bold">
            {segment.te}
          </p>
          <p className={cn(s.body, 'te-clamp-1 text-ui-sm text-on-ink/75')}>{te ? segment.taglineTe : segment.taglineEn}</p>
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

      {/* Running order (radio page) */}
      {page && items.length ? (
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
