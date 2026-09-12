import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Video } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { VideoCard } from '@/components/video/VideoCard';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { VideoOut } from '@/types/public';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Video hub (§15).
 *
 * A tablist of the categories that actually have video over one paginated grid.
 * The old page rendered a rail per category, which meant the reader could only
 * ever see the first four videos of each — choosing a section now filters the
 * grid and "load more" keeps going, so a section can be browsed rather than
 * only sampled. (The hand-rolled edge-arrow rail that used to live here is now
 * ChipRail, built in W1.)
 *
 * Length is a second, client-side axis over what is already loaded: the list
 * endpoint filters by category only, and `duration_sec` arrives with every card.
 *
 * Nothing plays here. Playback lives on the video page, where the view is
 * counted and the publisher is credited.
 */

/** Anything at or under a minute is a short. */
const SHORT_MAX_SEC = 60;

type Length = 'all' | 'short' | 'long';

const PAGE_SIZE = 12;

function matchesLength(video: VideoOut, length: Length): boolean {
  if (length === 'all') return true;
  const seconds = video.duration_sec;
  // Videos with no reported duration stay in "all" only — guessing would hide them.
  if (!seconds) return false;
  return length === 'short' ? seconds <= SHORT_MAX_SEC : seconds > SHORT_MAX_SEC;
}

export default function VideosPage() {
  const { t, language, pick } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLLIElement>();
  const [category, setCategory] = useState('');
  const [length, setLength] = useState<Length>('all');
  useDocumentTitle(t('page.videos'));

  // Still the hub call: it is the only source that knows which categories
  // actually carry video, which is exactly what the tablist must list.
  const hub = useQuery({
    queryKey: ['public', 'video-rails'],
    queryFn: publicApi.fetchVideoRails,
    staleTime: 120_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['public', 'videos', category],
    queryFn: ({ pageParam }) =>
      publicApi.fetchVideos({ category: category || undefined, offset: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });

  const tabs = hub.data?.tabs ?? [];
  const lengths: Array<{ key: Length; label: string }> = [
    { key: 'all', label: t('ui.showAll') },
    { key: 'short', label: t('ui.shorts') },
    { key: 'long', label: L('పూర్తి వీడియోలు', 'Full videos') },
  ];

  return (
    <PageContainer className="py-7 md:py-10">
      <PageHeader
        icon={Video}
        title={t('page.videos')}
        subtitle={L('విభాగాల వారీగా తాజా వీడియో వార్తలు.', 'The latest video news, by section.')}
      />

      <div className="space-y-7 md:space-y-10">
        {tabs.length > 0 ? (
          <Tabs
            ariaLabel={t('ui.sections')}
            scrollable
            value={category || 'all'}
            onChange={(key) => setCategory(key === 'all' ? '' : key)}
            items={[
              { key: 'all', label: t('ui.showAll') },
              ...tabs.map((tab) => ({
                key: tab.slug,
                label: pick(tab.name_te, tab.name_en),
                lang: s.forText(tab.name_te, tab.name_en).lang,
              })),
            ]}
          />
        ) : null}

        <ChipRail ariaLabel={L('నిడివి', 'Length')}>
          {lengths.map((item) => (
            <Chip key={item.key} selected={length === item.key} onClick={() => setLength(item.key)}>
              {item.label}
            </Chip>
          ))}
        </ChipRail>

        <QueryState
          query={feed}
          skeleton={
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonCard key={i} variant="grid" />
              ))}
            </div>
          }
          isEmpty={(data) => !data.pages.some((page) => page.videos.length)}
          empty={<EmptyState icon={Video} title={L('ఇంకా వీడియోలు లేవు.', 'No videos yet.')} />}
        >
          {(data) => {
            const loaded = data.pages.flatMap((page) => page.videos);
            const videos = loaded.filter((video) => matchesLength(video, length));
            if (videos.length === 0) {
              return (
                <EmptyState
                  icon={Video}
                  title={L('ఈ నిడివిలో వీడియోలు లేవు.', 'No videos of this length.')}
                  action={
                    <Button variant="secondary" onClick={() => setLength('all')}>
                      {t('ui.showAll')}
                    </Button>
                  }
                />
              );
            }
            return (
              <>
                <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {videos.map((video) => (
                    <li key={video.id} ref={reveal}>
                      <VideoCard video={video} wide />
                    </li>
                  ))}
                </ul>

                {feed.hasNextPage ? (
                  <div className="mt-7">
                    <Button
                      variant="secondary"
                      full
                      pending={feed.isFetchingNextPage}
                      onClick={() => void feed.fetchNextPage()}
                    >
                      {t('ui.loadMore')}
                    </Button>
                  </div>
                ) : (
                  <p lang={language} className={cn(s.body, 'mt-7 text-center text-meta text-muted')}>
                    {t('state.endOfList')}
                  </p>
                )}
              </>
            );
          }}
        </QueryState>
      </div>
    </PageContainer>
  );
}
