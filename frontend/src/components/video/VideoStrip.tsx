import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PlayCircle } from 'lucide-react';

import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';

/**
 * Category-aware YouTube video strip (§15). Renders nothing when the category
 * has no videos, so pages never show an empty shelf. Clicking a thumbnail
 * swaps it for the privacy-enhanced embed *in place* — playback is always a
 * reader action, never autoplay on load (§15).
 */
export function VideoStrip({
  category,
  limit = 4,
  className = '',
}: {
  category?: string;
  limit?: number;
  className?: string;
}) {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const [playing, setPlaying] = useState<string | null>(null);

  const videos = useQuery({
    queryKey: ['public', 'videos-strip', category ?? 'all', limit],
    queryFn: () => publicApi.fetchVideos({ category, limit }),
    staleTime: 120_000,
  });

  const items = videos.data?.videos ?? [];
  if (items.length === 0) return null;

  return (
    <section className={className}>
      <div className="mb-2.5 flex items-baseline justify-between border-b-2 border-ink pb-1.5">
        <h2 className={`${te ? 'th' : 'font-sans'} flex items-center gap-1.5 text-[17px] font-extrabold text-brand`}>
          <PlayCircle className="h-4 w-4" aria-hidden />
          {te ? 'వీడియోలు' : 'Videos'}
        </h2>
        <Link
          to="/videos"
          className={`${te ? 'te' : 'font-sans'} text-[11px] font-semibold text-info hover:underline`}
        >
          {te ? 'అన్నీ చూడండి' : 'See all'} →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((video) => (
          <article key={video.id} className="min-w-0">
            {playing === video.youtube_id ? (
              <div className="aspect-video w-full overflow-hidden rounded-[4px] bg-ink">
                <iframe
                  src={`${video.embed_url}?autoplay=1&rel=0`}
                  title={pick(video.title_te, video.title_en)}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(video.youtube_id)}
                aria-label={pick(video.title_te, video.title_en)}
                className="group relative block aspect-video w-full overflow-hidden rounded-[4px] bg-placeholder"
              >
                <img
                  src={video.thumbnail_url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
                  <PlayCircle className="h-9 w-9 text-white drop-shadow" aria-hidden />
                </span>
              </button>
            )}
            <h3
              lang="te"
              className="te te-clamp-2 mt-1.5 text-[12.5px] font-semibold leading-telugu text-ink"
            >
              {pick(video.title_te, video.title_en)}
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}
