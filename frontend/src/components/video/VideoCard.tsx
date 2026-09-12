import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import type { MediaOut, VideoOut } from '@/types/public';
import { cn } from '@/utils/cn';
import { relativeTime } from '@/utils/time';

/**
 * One video in a rail or grid (§15).
 *
 * Thumbnail, title, publisher, age — the four things a reader needs to decide
 * whether to tap. The card never plays inline: playback belongs on the video
 * page, where the view is counted and the publisher is credited properly.
 *
 * The whole card is one hit target: the title link stretches over it with
 * `after:inset-0`, so there is a single ≥44px control per card rather than a
 * small link plus a separately-clickable thumbnail.
 */

export function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(value: number, te: boolean): string {
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}${te ? 'కో' : 'Cr'}`;
  if (value >= 100_000) return `${(value / 100_000).toFixed(1)}${te ? 'ల' : 'L'}`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}${te ? 'వే' : 'K'}`;
  return String(value);
}

/**
 * YouTube gives us a bare thumbnail URL, not a MediaOut row. Wrapping it keeps
 * every image on the site going through NewsImage (reserved box, no CLS).
 */
function thumbnail(video: VideoOut): MediaOut {
  return {
    id: video.id,
    url: video.thumbnail_url,
    srcset: null,
    alt_te: null,
    caption_te: null,
    credit: null,
    license_label: null,
    source_url: null,
    width: null,
    height: null,
    blurhash: null,
    ai_generated: false,
  };
}

export function VideoCard({ video, wide = false }: { video: VideoOut; wide?: boolean }) {
  const { t, language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const title = s.forText(video.title_te, video.title_en);
  const duration = formatDuration(video.duration_sec);

  return (
    <Card
      as="article"
      padding="none"
      interactive
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl',
        wide ? 'w-full' : 'w-[240px] shrink-0 snap-start',
      )}
    >
      <div className="relative">
        <NewsImage
          media={thumbnail(video)}
          ratio="16/9"
          sizes={wide ? '(min-width: 768px) 320px, 45vw' : '240px'}
          placeholderLabel={t('ui.videos')}
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center opacity-0 transition-[colors,transform,box-shadow,opacity] duration-base ease-standard group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <span className="flex h-tap w-tap items-center justify-center rounded-pill bg-overlay/60 text-on-ink">
            <Icon icon={Play} size="lg" />
          </span>
        </span>
        {duration ? (
          <Badge tone="muted" size="xs" lang="en" className="absolute bottom-2 right-2 tabular-nums shadow-card">
            {duration}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3
          lang={title.lang}
          className={cn(
            title.cls,
            'te-clamp-2 font-semibold text-ink',
            title.telugu ? 'text-te-body-xs' : 'text-ui',
          )}
        >
          <Link
            to={`/videos/${video.id}`}
            className="rounded-xl transition-[colors,transform,box-shadow] duration-base ease-standard after:absolute after:inset-0 hover:text-brand"
          >
            {s.pick(video.title_te, video.title_en)}
          </Link>
        </h3>

        {/* Latin chrome on the <p>; the two Telugu runs carry their own lang. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-sans text-meta text-muted">
          {video.channel ? <span className="font-semibold text-ink-soft">{video.channel.name}</span> : null}
          {video.view_count > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="tabular-nums">{formatCount(video.view_count, te)}</span>{' '}
                <span lang={language} className={s.body}>
                  {te ? 'వ్యూస్' : 'views'}
                </span>
              </span>
            </>
          ) : null}
          {video.published_at ? (
            <>
              <span aria-hidden>·</span>
              <span lang={language} className={s.body}>
                {relativeTime(video.published_at, language)}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </Card>
  );
}
