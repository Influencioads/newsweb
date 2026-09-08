import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { VideoCard } from '@/components/video/VideoCard';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import type { VideoRail } from '@/types/public';

/**
 * Video hub (§15).
 *
 * A tab strip of the categories that actually have video, then a rail per
 * category — the shape a reader browsing video expects, and the one that lets
 * a section be skimmed without committing to it. Choosing a tab filters to
 * that one rail rather than navigating away, so comparing sections costs no
 * page loads.
 *
 * Nothing plays here. Playback lives on the video page, where the view is
 * counted and the publisher is credited.
 */

function Rail({ rail }: { rail: VideoRail }) {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  function measure() {
    const el = track.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    // The arrows must disappear at the ends, so they follow the scroll
    // position rather than being permanently half-useful.
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  function nudge(direction: -1 | 1) {
    track.current?.scrollBy({ left: direction * 520, behavior: 'smooth' });
  }

  return (
    <section className="mt-7">
      <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b-2 border-ink pb-1.5">
        <h2 className={`${te ? 'th' : 'font-sans'} text-[17px] font-extrabold text-ink`}>
          {pick(rail.title_te, rail.title_en)}
        </h2>
        <Link
          to={`/section/${rail.key}`}
          className={`${te ? 'te' : 'font-sans'} shrink-0 text-[12px] font-bold text-brand hover:underline`}
        >
          {te ? 'అన్నీ చూడండి →' : 'See all →'}
        </Link>
      </div>

      <div className="relative">
        <div
          ref={track}
          className="flex gap-3.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {rail.videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>

        {!edges.start ? (
          <button
            type="button"
            aria-label={te ? 'వెనక్కి' : 'Scroll left'}
            onClick={() => nudge(-1)}
            className="absolute left-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-rule bg-white/95 text-ink shadow-card hover:text-brand md:flex dark:bg-surface"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
        {!edges.end ? (
          <button
            type="button"
            aria-label={te ? 'ముందుకు' : 'Scroll right'}
            onClick={() => nudge(1)}
            className="absolute right-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-rule bg-white/95 text-ink shadow-card hover:text-brand md:flex dark:bg-surface"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default function VideosPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const [active, setActive] = useState('');

  const hub = useQuery({
    queryKey: ['public', 'video-rails'],
    queryFn: publicApi.fetchVideoRails,
    staleTime: 120_000,
  });

  const rails = (hub.data?.rails ?? []).filter((r) => !active || r.key === active);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="border-b-2 border-brand pb-3">
        <h1 className={`${te ? 'th' : 'font-sans'} text-[26px] font-extrabold text-ink`}>
          ▶ {te ? 'వీడియోలు' : 'Videos'}
        </h1>
        <p className={`${teCls} mt-1 text-[12.5px] text-muted`}>
          {te
            ? 'విభాగాల వారీగా తాజా వీడియో వార్తలు.'
            : 'The latest video news, by section.'}
        </p>
      </header>

      {/* -------------------------------------------------- category tabs -- */}
      {hub.data && hub.data.tabs.length ? (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-pressed={active === ''}
            onClick={() => setActive('')}
            className={`${teCls} min-h-[34px] shrink-0 rounded-chip border px-3.5 text-[12.5px] font-semibold ${
              active === '' ? 'border-brand bg-brand text-white' : 'border-rule bg-white text-ink dark:bg-surface'
            }`}
          >
            {te ? 'అన్నీ' : 'All'}
          </button>
          {hub.data.tabs.map((tab) => (
            <button
              key={tab.slug}
              type="button"
              aria-pressed={active === tab.slug}
              onClick={() => setActive(active === tab.slug ? '' : tab.slug)}
              className={`${teCls} min-h-[34px] shrink-0 rounded-chip border px-3.5 text-[12.5px] font-semibold ${
                active === tab.slug
                  ? 'border-brand bg-brand text-white'
                  : 'border-rule bg-white text-ink dark:bg-surface'
              }`}
            >
              {pick(tab.name_te, tab.name_en)}
            </button>
          ))}
        </div>
      ) : null}

      {hub.isLoading ? (
        <p className={`${teCls} mt-8 text-center text-[13px] text-muted`} role="status">
          {te ? 'లోడ్ అవుతోంది…' : 'Loading…'}
        </p>
      ) : null}

      {hub.isError ? (
        <p role="alert" className={`${teCls} mt-8 rounded-card border border-breaking-border bg-breaking-tint p-5 text-[13px] text-breaking`}>
          {te ? 'వీడియోలు లోడ్ కాలేదు.' : 'Could not load videos.'}
        </p>
      ) : null}

      {hub.data && rails.length === 0 ? (
        <p className={`${teCls} mt-8 rounded-card border border-rule bg-white p-8 text-center text-[13px] text-muted dark:bg-surface`}>
          {te ? 'ఇంకా వీడియోలు లేవు.' : 'No videos yet.'}
        </p>
      ) : null}

      {rails.map((rail) => (
        <Rail key={rail.key} rail={rail} />
      ))}
    </main>
  );
}
