import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { PlayCircle } from 'lucide-react';

import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { relativeTime } from '@/utils/time';
import type { VideoOut } from '@/types/public';

/**
 * Video hub (updated doc §15, YouTube links only).
 *
 * Cards show the YouTube thumbnail; clicking swaps the card for the
 * privacy-enhanced (`youtube-nocookie`) iframe with autoplay — §15's "no
 * aggressive autoplay" rule holds because nothing plays until the reader asks.
 */
export default function VideosPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const [category, setCategory] = useState('');
  const [playingId, setPlayingId] = useState<number | null>(null);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['public', 'videos', category],
    queryFn: ({ pageParam }) =>
      publicApi.fetchVideos({
        category: category || undefined,
        offset: pageParam,
        limit: 12,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });

  const videos = feed.data?.pages.flatMap((page) => page.videos) ?? [];

  function VideoCard({ video }: { video: VideoOut }) {
    const playing = playingId === video.id;
    return (
      <article className="overflow-hidden rounded-card border border-rule bg-white shadow-card">
        {playing ? (
          <div className="aspect-video w-full bg-ink">
            <iframe
              src={`${video.embed_url}?autoplay=1&rel=0`}
              title={video.title_te}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPlayingId(video.id)}
            aria-label={`${te ? 'ప్లే' : 'Play'}: ${video.title_te}`}
            className="group relative block aspect-video w-full bg-placeholder"
          >
            <img
              src={video.thumbnail_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
              <PlayCircle className="h-12 w-12 text-white drop-shadow" aria-hidden />
            </span>
          </button>
        )}
        <div className="p-3">
          {video.category ? (
            <p className={`${teCls} text-[10.5px] font-bold uppercase tracking-[0.08em] text-brand`}>
              {pick(video.category.name_te, video.category.name_en)}
            </p>
          ) : null}
          <h2 lang="te" className="te mt-0.5 text-[15px] font-bold leading-telugu text-ink">
            {video.title_te}
          </h2>
          <p className="mt-1 font-sans text-[10.5px] text-muted-light">
            {relativeTime(video.published_at, language)}
          </p>
        </div>
      </article>
    );
  }

  return (
    <main className="mx-auto min-h-[55vh] max-w-[1100px] px-4 py-7 sm:py-10">
      <div className="mb-6 border-b-2 border-ink pb-4">
        <p className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          <PlayCircle className="h-3.5 w-3.5" aria-hidden />
          {te ? 'వీడియో వార్తలు' : 'VIDEO NEWS'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[27px] font-extrabold text-ink sm:text-[32px]`}>
          {te ? 'వీడియోలు' : 'Videos'}
        </h1>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory('')}
          aria-pressed={!category}
          className={`${teCls} rounded-chip border px-3 py-1.5 text-[12.5px] font-semibold ${!category ? 'border-brand bg-brand-tint text-brand' : 'border-rule bg-paper text-muted hover:border-brand'}`}
        >
          {te ? 'అన్నీ' : 'All'}
        </button>
        {config.data?.categories.filter((c) => c.show_in_nav).slice(0, 8).map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => setCategory(category === c.slug ? '' : c.slug)}
            aria-pressed={category === c.slug}
            className={`${teCls} rounded-chip border px-3 py-1.5 text-[12.5px] font-semibold ${category === c.slug ? 'border-brand bg-brand-tint text-brand' : 'border-rule bg-paper text-muted hover:border-brand'}`}
          >
            {pick(c.name_te, c.name_en)}
          </button>
        ))}
      </div>

      {feed.isLoading ? (
        <p className={`${teCls} text-muted`}>{te ? 'లోడ్ అవుతోంది…' : 'Loading…'}</p>
      ) : feed.isError ? (
        <p className={`${teCls} text-brand`}>{te ? 'లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.' : 'Could not load. Try again.'}</p>
      ) : videos.length === 0 ? (
        <p className={`${teCls} rounded border border-rule bg-paper px-4 py-8 text-center text-[14.5px] text-muted`}>
          {te ? 'ఇంకా వీడియోలు లేవు.' : 'No videos yet.'}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
          {feed.hasNextPage ? (
            <button
              type="button"
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
              className={`${teCls} mt-6 w-full border border-rule bg-paper py-3 text-[13.5px] font-bold text-ink hover:border-brand hover:text-brand disabled:opacity-60`}
            >
              {te ? 'మరిన్ని వీడియోలు' : 'More videos'}
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}
