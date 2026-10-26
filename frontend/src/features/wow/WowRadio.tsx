import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Radio, Square } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { useTts } from '@/features/reader/tts';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * WOW Radio (pitch §2): a prominent audio player for daily inspiration,
 * comedy and storytelling.
 *
 * Each station is a short programme built from the newest stories in its
 * categories, read aloud on the listener's own device in Telugu (the same
 * Web Speech voice the article "Listen" control uses — features/reader/tts).
 * A station lists fallbacks so it is never silent while its own category is
 * still filling up. When the newsroom starts producing recorded episodes,
 * they replace the device voice here and nothing else on the page changes.
 */

interface Station {
  id: string;
  te: string;
  en: string;
  taglineTe: string;
  taglineEn: string;
  /** Tried in order; the first with stories is played. */
  categories: string[];
}

export const STATIONS: readonly Station[] = [
  {
    id: 'morning-mantra',
    te: 'మార్నింగ్ మంత్ర',
    en: 'Morning Mantra',
    taglineTe: 'రోజుకు సానుకూల ఆరంభం',
    taglineEn: 'A positive start to the day',
    categories: ['morning-mantra', 'devotional'],
  },
  {
    id: 'inspiration',
    te: 'స్ఫూర్తి',
    en: 'Inspiration',
    taglineTe: 'హీరోల కథలు, విజయ గాథలు',
    taglineEn: 'Hero stories and journeys',
    categories: ['real-heroes', 'inspiring', 'zero-to-hero'],
  },
  {
    id: 'stories',
    te: 'కథలు',
    en: 'Stories',
    taglineTe: 'పురాణాలు, మీ కథలు',
    taglineEn: 'Epics and reader stories',
    categories: ['wow-puranam', 'my-story', 'lifestyle'],
  },
  {
    id: 'fun',
    te: 'హాస్యం & వినోదం',
    en: 'Comedy & Fun',
    taglineTe: 'నవ్వులు, ఆశ్చర్యాలు',
    taglineEn: 'Laughs and surprises',
    categories: ['wow-news', 'cinema'],
  },
  {
    id: 'local',
    te: 'ఊరి కబుర్లు',
    en: 'Village Voices',
    taglineTe: 'లోకల్ హీరోలు, ఊరి కథలు',
    taglineEn: 'Local heroes and village stories',
    categories: ['local-hero', 'my-village-story', 'andhra-pradesh'],
  },
];

const PER_STATION = 5;
const DEFAULT_STATION: Station = STATIONS[0] as Station;

async function fetchStation(station: Station): Promise<ArticleCard[]> {
  for (const category of station.categories) {
    try {
      const feed = await publicApi.fetchFeed({ category, limit: PER_STATION });
      if (feed.articles.length) return feed.articles.slice(0, PER_STATION);
    } catch {
      // A category that does not exist yet just falls through to the next.
    }
  }
  return [];
}

function script(station: Station, items: ArticleCard[]): string {
  const intro = `వావ్ రేడియోకి స్వాగతం. ఇది ${station.te}.`;
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
  const [stationId, setStationId] = useState(DEFAULT_STATION.id);
  const station: Station = STATIONS.find((st) => st.id === stationId) ?? DEFAULT_STATION;

  const programme = useQuery({
    queryKey: ['wow-radio', station.id],
    queryFn: () => fetchStation(station),
    staleTime: 120_000,
  });
  const items = programme.data ?? [];
  const { state, toggle, stop } = useTts(script(station, items));
  const live = state === 'speaking';
  const page = variant === 'page';

  const tune = (id: string) => {
    if (id === stationId) return;
    stop();
    setStationId(id);
  };

  const status =
    state === 'unavailable'
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
        'relative overflow-hidden rounded-2xl bg-brand-deep text-on-ink',
        page ? 'p-5 md:p-8' : 'p-5 md:p-6',
      )}
    >
      {/* Soft orange glow in the corner — the "on air" lamp. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-wow/25 blur-3xl"
      />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-wow-deep text-on-wow">
            <Icon icon={Radio} size="md" />
          </span>
          <div>
            <h2 id={`wow-radio-${variant}`} className="font-serif text-headline-md font-bold leading-tight">
              WOW Radio <span lang="te" className="th text-headline-xs font-semibold text-on-ink/75">· వావ్ రేడియో</span>
            </h2>
            <p className={cn(s.body, 'text-meta text-on-ink/70')}>
              {te ? 'ప్రేరణ · హాస్యం · కథలు' : 'Inspiration · Comedy · Stories'}
            </p>
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

      {/* Station dial */}
      <div role="tablist" aria-label={te ? 'స్టేషన్లు' : 'Stations'} className="relative mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {STATIONS.map((st) => {
          const active = st.id === station.id;
          return (
            <button
              key={st.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => tune(st.id)}
              className={cn(
                'shrink-0 rounded-pill border px-3.5 py-1.5 text-left transition-colors duration-base',
                active
                  ? 'border-wow bg-wow-deep text-on-wow'
                  : 'border-on-ink/20 bg-on-ink/5 text-on-ink hover:border-on-ink/40',
              )}
            >
              <span lang="te" className="te block text-te-body-xs font-semibold">
                {st.te}
              </span>
            </button>
          );
        })}
      </div>

      {/* Player */}
      <div className="relative mt-5 flex items-center gap-4">
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
          <p lang="te" className="th text-headline-sm font-bold">
            {station.te}
          </p>
          <p className={cn(s.body, 'text-ui-sm text-on-ink/75')}>{te ? station.taglineTe : station.taglineEn}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Equalizer live={live} />
            <span role="status" className={cn(s.body, 'text-meta text-on-ink/80')}>
              {programme.isLoading ? (te ? 'ట్యూన్ అవుతోంది…' : 'Tuning…') : status}
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
        <ol className={cn('relative mt-5 space-y-1 border-t border-on-ink/15 pt-4', !page && 'hidden md:block')}>
          <li className={cn(s.body, 'mb-1 text-meta font-semibold uppercase tracking-wide text-on-ink/60')}>
            {te ? 'ఈ కార్యక్రమంలో' : 'In this programme'}
          </li>
          {(page ? items : items.slice(0, 3)).map((a, i) => (
            <li key={a.short_id}>
              <Link
                to={a.url}
                className="flex items-baseline gap-3 rounded-lg px-1 py-1 hover:bg-on-ink/5"
              >
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
