import { useState } from 'react';

import { useI18n } from '@/i18n';
import type { VideoRef } from '@/types/public';

/**
 * The story's video, when it has one.
 *
 * Returns `null` otherwise — no placeholder, no "video coming soon". Most
 * stories will never have one, and an empty slot on every article would be a
 * worse page than no slot at all.
 *
 * The iframe is not mounted until the reader asks for it. A YouTube embed
 * costs several hundred kilobytes and sets cookies before anyone presses play,
 * so the default state is the thumbnail, which is one image from
 * `i.ytimg.com`. Pressing play mounts the privacy-enhanced (`youtube-nocookie`)
 * embed with autoplay.
 */

export function ArticleVideo({ video }: { video: VideoRef | null | undefined }) {
  const { language } = useI18n();
  const en = language === 'en';
  const [playing, setPlaying] = useState(false);

  if (!video) return null;

  return (
    <figure className="mt-5">
      <div className="relative aspect-video overflow-hidden rounded-card bg-ink">
        {playing ? (
          <iframe
            src={`${video.embed_url}?autoplay=1&rel=0`}
            title={video.title_te ?? (en ? 'Video' : 'వీడియో')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={en ? 'Play video' : 'వీడియో ప్లే చేయండి'}
            className="group absolute inset-0 h-full w-full"
          >
            <img
              src={video.thumbnail_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-[22px] text-white shadow-card group-hover:scale-105">
                ▶
              </span>
            </span>
          </button>
        )}
      </div>
      {video.title_te ? (
        <figcaption className="te mt-2 text-[12.5px] leading-telugu text-muted">
          {video.title_te}
        </figcaption>
      ) : null}
    </figure>
  );
}
