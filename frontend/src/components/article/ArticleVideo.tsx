import { useState } from 'react';
import { Play } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
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
 * embed with autoplay. The 16/9 box is reserved either way, so the swap moves
 * nothing on the page.
 */
export function ArticleVideo({ video }: { video: VideoRef | null | undefined }) {
  const { language } = useI18n();
  // Copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [playing, setPlaying] = useState(false);

  if (!video) return null;

  return (
    <figure className="my-6">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
        {playing ? (
          <iframe
            src={`${video.embed_url}?autoplay=1&rel=0`}
            title={video.title_te ?? L('వీడియో', 'Video')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={L('వీడియో ప్లే చేయండి', 'Play video')}
            className="group absolute inset-0 h-full w-full"
          >
            <img
              src={video.thumbnail_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-opacity duration-base ease-standard group-hover:opacity-90"
            />
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center"
            >
              <span className="flex h-tap w-tap items-center justify-center rounded-pill bg-brand text-on-brand shadow-raised transition-transform duration-base ease-standard group-hover:scale-105 group-active:scale-[.98]">
                <Icon icon={Play} size="lg" />
              </span>
            </span>
          </button>
        )}
      </div>
      {video.title_te ? (
        <figcaption lang="te" className="te reader-caption mt-2 text-muted">
          {video.title_te}
        </figcaption>
      ) : null}
    </figure>
  );
}
