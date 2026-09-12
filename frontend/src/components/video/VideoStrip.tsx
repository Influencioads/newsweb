import { useQuery } from '@tanstack/react-query';

import { ChipRail } from '@/components/ui/Chip';
import { SectionHeader } from '@/components/ui/Layout';
import { VideoCard } from '@/components/video/VideoCard';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';

/**
 * Category-aware video shelf (§15) — a snap rail of VideoCards.
 *
 * Renders nothing when the category has no videos, so pages never show an
 * empty shelf. Playback is a deliberate reader action, as §15 requires: a card
 * navigates to the video page, where the embed loads, the view is counted and
 * the channel is credited. (Before the UI upgrade the thumbnail swapped itself
 * for an inline embed; that path duplicated the video page and counted nothing.)
 */
export function VideoStrip({
  category,
  limit = 4,
  className,
}: {
  category?: string;
  limit?: number;
  className?: string;
}) {
  const { t } = useI18n();

  const videos = useQuery({
    queryKey: ['public', 'videos-strip', category ?? 'all', limit],
    queryFn: () => publicApi.fetchVideos({ category, limit }),
    staleTime: 120_000,
  });

  const items = videos.data?.videos ?? [];
  if (items.length === 0) return null;

  return (
    <section className={className}>
      <SectionHeader title={t('ui.videos')} to="/videos" />
      <ChipRail ariaLabel={t('ui.videos')} itemGap="gap-3">
        {items.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
      </ChipRail>
    </section>
  );
}
