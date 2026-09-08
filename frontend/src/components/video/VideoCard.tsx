import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';

import { useI18n } from '@/i18n';
import { relativeTime } from '@/utils/time';
import type { VideoOut } from '@/types/public';

/**
 * One video in a rail or grid (§15).
 *
 * Thumbnail, title, publisher, age — the four things a reader needs to decide
 * whether to tap. The card never plays inline: playback belongs on the video
 * page, where the view is counted and the publisher is credited properly.
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

export function VideoCard({ video, wide = false }: { video: VideoOut; wide?: boolean }) {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const duration = formatDuration(video.duration_sec);

  return (
    <Link
      to={`/videos/${video.id}`}
      className={`group block ${wide ? '' : 'w-[240px] shrink-0'}`}
    >
      <div className="relative aspect-video overflow-hidden rounded-card bg-placeholder">
        <img
          src={video.thumbnail_url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-ink/10 opacity-0 transition group-hover:opacity-100">
          <PlayCircle className="h-10 w-10 text-white drop-shadow" aria-hidden />
        </span>
        {duration ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-ink/85 px-1.5 py-0.5 font-sans text-[11px] font-bold tabular-nums text-white">
            {duration}
          </span>
        ) : null}
      </div>

      <h3 className={`${te ? 'te' : 'font-sans'} mt-2 line-clamp-2 text-[13.5px] font-semibold leading-telugu text-ink group-hover:text-brand`}>
        {pick(video.title_te, video.title_en)}
      </h3>

      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-sans text-[11.5px] text-muted">
        {video.channel ? (
          <span className="truncate font-semibold text-ink-soft">{video.channel.name}</span>
        ) : null}
        {video.view_count > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span>{formatCount(video.view_count, te)} {te ? 'వ్యూస్' : 'views'}</span>
          </>
        ) : null}
        {video.published_at ? (
          <>
            <span aria-hidden>·</span>
            <span>{relativeTime(video.published_at, language)}</span>
          </>
        ) : null}
      </p>
    </Link>
  );
}
