import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pause, Play, Square, type LucideIcon } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import * as publicApi from '@/features/public/api';
import { audioQuery } from '@/components/article/AudioPlayer';
import { useTts } from '@/features/reader/tts';
import { usePlayer, type Track } from '@/stores/player';
import { useI18n, useScript } from '@/i18n';
import type { ArticleCard, RadioSegment } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import { wowIcon } from './icons';
import { PhonePicture } from './PhonePicture';
import { DEFAULT_CONTENT, DEFAULT_RADIO_IMAGE, useSiteContent } from './siteContent';

/**
 * WOW Radio (pitch §2): a highlighted audio player with four segments —
 * Morning Mantra, Spoorthi, WOW News and Mystery. The segments (names, lines,
 * icons, colours, categories) and the card picture are edited in CMS → Site
 * content → WOW Radio; the defaults are in ./siteContent.
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

/** The CMS's tone names (backend site_content.RADIO_TONES) as theme gradients. */
const TONES: Record<string, string> = {
  orange: 'from-wow to-wow-deep',
  green: 'from-success/80 to-success',
  blue: 'from-brand to-brand-dark',
  purple: 'from-ai to-ai-text',
};

const toSegment = (sg: RadioSegment): Segment => ({
  id: sg.id,
  te: sg.te,
  en: sg.en,
  taglineTe: sg.tagline_te,
  taglineEn: sg.tagline_en || sg.tagline_te,
  icon: wowIcon(sg.icon),
  tone: TONES[sg.tone] ?? TONES.orange!,
  categories: sg.categories,
});

/** The segments and the card picture, as set in CMS → Site content → WOW Radio. */
function useRadio(): { segments: Segment[]; image: string; phoneImage: string } {
  const { radio } = useSiteContent();
  // Memoised on the stored list: the player's effects key on the segment, so a
  // fresh array every render would restart them forever.
  const segments = useMemo(
    () => (radio.segments.length ? radio.segments : DEFAULT_CONTENT.radio.segments).map(toSegment),
    [radio.segments],
  );
  return { segments, image: radio.image_url || DEFAULT_RADIO_IMAGE, phoneImage: radio.mobile_image_url };
}

const PER_SEGMENT = 5;

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
  const { segments } = useRadio();
  return (
    // auto-rows-fr: every tile as tall as the tallest, so a line that wraps doesn't make one tile stick out.
    // The large tiles (icon, name, line, play in a row) need a tablet's width for two across: this
    // site's `sm` is 390px, an ordinary phone, where two columns crushed the text to a letter a line.
    <ul className={cn('relative grid auto-rows-fr gap-2.5', large ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2')}>
      {segments.map((sg) => {
        const current = active === sg.id;
        const live = current && playState === 'speaking';
        const name = te ? sg.te : sg.en;
        const playMark = cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-on-ink text-wow-deep shadow-raised transition-transform duration-base group-hover/play:scale-110 motion-reduce:transform-none',
          current && 'ring-2 ring-wow',
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
                large ? 'items-center gap-3 p-4' : 'flex-col items-start gap-2 p-3 md:flex-row md:items-center md:gap-3 md:pr-12',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-on-ink shadow-raised',
                  large ? 'h-14 w-14' : 'h-10 w-10 md:h-11 md:w-11',
                  sg.tone,
                )}
              >
                <Icon icon={sg.icon} size={large ? 'lg' : 'md'} />
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
                <span aria-hidden className={cn(playMark, 'group-hover:scale-110')}>
                  <Icon icon={Play} size="xs" />
                </span>
              ) : null}
            </Link>
            {onPlay ? (
              // A full 44px tap area in the tile's corner, so it never covers the
              // name; the white circle inside stays small.
              <button
                type="button"
                onClick={() => onPlay(sg.id)}
                aria-label={live ? `${te ? 'ఆపు' : 'Pause'} · ${name}` : `${te ? 'ప్లే' : 'Play'} · ${name}`}
                aria-pressed={live}
                className="group/play absolute right-1 top-1 z-10 flex h-11 w-11 items-center justify-center rounded-pill md:top-1/2 md:-translate-y-1/2"
              >
                <span className={playMark}>
                  <Icon icon={live ? Pause : Play} size="xs" />
                </span>
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The audio route of a story — also its track id in the global player. */
const audioRoute = (a: ArticleCard) => `/public/articles/${a.short_id}/audio`;

/**
 * WOW Radio playback, shared by the home card and the segment pages.
 *
 * Server audio first: each story's narration (`/public/articles/{id}/audio`,
 * the same Telugu voice the article player uses) is queued in the one global
 * player, so it plays in every browser and keeps playing across pages. Only
 * when no story has a server file does it fall back to the device's Telugu
 * voice (Web Speech). Pressing play again pauses; another segment switches.
 */
function useRadioPlayer(initial: string | null = null) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(initial);
  const [startWhenReady, setStartWhenReady] = useState(false);
  const [mode, setMode] = useState<'server' | 'voice' | null>(null);
  const [trackIds, setTrackIds] = useState<string[]>([]);
  const { segments } = useRadio();
  const segment = segments.find((sg) => sg.id === active) ?? null;
  const programme = useQuery({
    // Segments are edited in the CMS; the key carries its categories so an edit refetches.
    queryKey: ['wow-radio', active, segment?.categories.join(',')],
    queryFn: () => (segment ? fetchSegment(segment) : Promise.resolve([])),
    enabled: Boolean(segment),
    staleTime: 120_000,
  });
  const items = useMemo(() => programme.data ?? [], [programme.data]);
  const text = segment ? script(segment, items) : '';
  const tts = useTts(text);
  // Read inside the async start below without re-running it on every render.
  const ttsRef = useRef(tts);
  useEffect(() => {
    ttsRef.current = tts;
  });
  // Each start gets a number; a slower, older start that resolves late is ignored.
  const request = useRef(0);

  const currentId = usePlayer((p) => (p.index >= 0 ? p.queue[p.index]?.id : undefined));
  const playerPlaying = usePlayer((p) => p.playing);
  const ours = mode === 'server' && currentId !== undefined && trackIds.includes(currentId);

  // A segment's stories have arrived: queue their narration, or read them aloud.
  useEffect(() => {
    if (!startWhenReady || !segment || programme.isFetching || !(programme.isSuccess || programme.isError)) return;
    setStartWhenReady(false);
    if (!items.length) return;
    const mine = ++request.current;
    void Promise.all(
      items.map((a) =>
        queryClient
          .fetchQuery(audioQuery(audioRoute(a)))
          .then((audio) => (audio.available && audio.url ? { a, audio } : null))
          .catch(() => null),
      ),
    ).then((found) => {
      if (request.current !== mine) return;
      const tracks: Track[] = found
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .map(({ a, audio }) => ({
          id: audioRoute(a),
          kind: 'article',
          title: a.title_te,
          subtitle: `${'వావ్ రేడియో'} · ${segment.te}`,
          url: audio.url as string,
          durationSec: audio.duration_sec,
          href: a.url,
        }));
      if (tracks.length) {
        setMode('server');
        setTrackIds(tracks.map((tr) => tr.id));
        usePlayer.getState().playQueue(tracks, 0);
      } else {
        setMode('voice');
        if (ttsRef.current.state === 'idle') ttsRef.current.toggle();
      }
    });
  }, [startWhenReady, segment, items, programme.isFetching, programme.isSuccess, programme.isError, queryClient]);

  const stop = useCallback(() => {
    tts.stop();
    if (ours) usePlayer.getState().pause();
  }, [tts, ours]);

  const play = useCallback(
    (id: string) => {
      if (id === active && ours) {
        usePlayer.getState().toggle();
        return;
      }
      if (id === active && mode === 'voice' && (tts.state === 'speaking' || tts.state === 'paused')) {
        tts.toggle();
        return;
      }
      stop();
      request.current += 1;
      setMode(null);
      setActive(id);
      setStartWhenReady(true);
    },
    [active, ours, mode, tts, stop],
  );

  const playState: PlayState = ours
    ? playerPlaying
      ? 'speaking'
      : 'paused'
    : mode === 'voice' && tts.state === 'speaking'
      ? 'speaking'
      : mode === 'voice' && tts.state === 'paused'
        ? 'paused'
        : active && (startWhenReady || programme.isFetching)
          ? 'loading'
          : 'idle';

  const note =
    !active || startWhenReady || programme.isFetching
      ? null
      : programme.isSuccess && !items.length
        ? 'empty'
        : mode === 'voice' && tts.state === 'unavailable'
          ? 'unavailable'
          : null;

  return { active, items, loading: programme.isLoading, play, stop, playState, note };
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
  const radio = useRadioPlayer();
  const { image, phoneImage } = useRadio();

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
        <PhonePicture
          src={image}
          mobileSrc={phoneImage}
          alt={te ? 'వావ్ రేడియో' : 'WOW Radio'}
          width={960}
          height={540}
          className={cn(
            'relative mb-5 w-full rounded-xl object-cover shadow-raised md:aspect-[16/7]',
            // The phone picture is 4:3.
            phoneImage ? 'aspect-[4/3]' : 'aspect-[16/7]',
          )}
        />
      ) : null}

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!page ? (
            <PhonePicture
              src={image}
              mobileSrc={phoneImage}
              alt=""
              width={960}
              height={540}
              className="h-14 w-auto shrink-0 rounded-xl object-cover shadow-raised ring-1 ring-on-ink/20 md:h-16"
            />
          ) : null}
          <div>
            <OnAirLabel />
            {/* English and Telugu names on one line, the English a step smaller on phones. */}
            <h2
              id={`wow-radio-${variant}`}
              className="flex items-baseline gap-1.5 whitespace-nowrap font-serif text-headline-sm font-bold leading-tight md:text-headline-md"
            >
              WOW Radio
              <span lang="te" className="th text-headline-xs font-semibold text-on-ink/75">· వావ్ రేడియో</span>
            </h2>
          </div>
        </div>
        {!page ? (
          <Link
            to="/radio"
            className={cn(
              s.body,
              'inline-flex min-h-tap items-center gap-1 rounded-pill border border-wow/70 px-4 text-ui-sm font-semibold text-wow',
              'transition-colors duration-base hover:bg-wow hover:text-on-wow',
            )}
          >
            {te ? 'వినడానికి క్లిక్ చేయండి' : 'Click to listen'}
            <Icon icon={ChevronRight} size="sm" />
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
  const { segment: segmentId } = useParams();
  const { segments } = useRadio();
  const segment = segments.find((sg) => sg.id === segmentId);
  if (!segment) return <Navigate to="/radio" replace />;
  // Keyed, so moving to another segment starts that one's player fresh.
  return <SegmentView key={segment.id} segment={segment} />;
}

function SegmentView({ segment }: { segment: Segment }) {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  useDocumentTitle(`${te ? segment.te : segment.en} · ${te ? 'వావ్ రేడియో' : 'WOW Radio'}`);
  const { segments, image } = useRadio();

  const radio = useRadioPlayer(segment.id);
  const items = radio.items;
  const live = radio.playState === 'speaking';
  const stop = radio.stop;

  const status = radio.loading
    ? te
      ? 'ట్యూన్ అవుతోంది…'
      : 'Tuning…'
    : !items.length
      ? te
        ? 'ఈ సెగ్మెంట్ ఎపిసోడ్‌లు త్వరలో'
        : 'Episodes for this segment are coming soon'
      : radio.note === 'unavailable'
        ? te
          ? 'ఈ బ్రౌజర్‌లో తెలుగు వాయిస్ లేదు. Android లేదా Chrome లో ప్రయత్నించండి.'
          : 'This browser has no Telugu voice. Try Chrome or an Android phone.'
        : radio.playState === 'loading'
          ? te
            ? 'ట్యూన్ అవుతోంది…'
            : 'Tuning…'
          : live
            ? te
              ? 'ప్రసారంలో'
              : 'On air'
            : radio.playState === 'paused'
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
            src={image}
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
            onClick={() => radio.play(segment.id)}
            disabled={radio.note === 'unavailable' || !items.length}
            aria-label={live ? (te ? 'ఆపు' : 'Pause') : te ? 'ప్లే' : 'Play'}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-pill bg-on-ink text-wow-deep shadow-raised transition-transform duration-base hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
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
          {radio.playState === 'speaking' || radio.playState === 'paused' ? (
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
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {segments.filter((sg) => sg.id !== segment.id).map((sg) => (
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
