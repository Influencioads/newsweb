import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SkipBack, SkipForward } from 'lucide-react';

import { AudioPlayer } from '@/components/article/AudioPlayer';
import { IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/Layout';
import { ErrorState, Skeleton } from '@/components/ui/State';
import * as epaperApi from '@/features/epaper/api';
import { useI18n, useScript } from '@/i18n';
import type { EpaperEdition } from '@/types/epaper';
import { cn } from '@/utils/cn';

/**
 * "Listen like radio" — the edition's stories read out back to back.
 *
 * The edition endpoint supplies the running order; each track is an article,
 * so playback itself is the shared `AudioPlayer` pointed at that article's
 * audio route (scrubber, elapsed time and the visible speed chips come with
 * it). Skip back / forward move the running order.
 */

/**
 * The edition has no per-track device voice to fall back on — the tracks are
 * server renditions or they do not exist. Module-level so the identity is
 * stable across renders (AudioPlayer cleans up on `stop` changing).
 */
const NO_DEVICE_TTS = { state: 'unavailable' as const, toggle: () => {}, stop: () => {} };

export function EpaperRadio({ edition }: { edition: EpaperEdition }) {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const audio = useQuery({
    queryKey: ['epaper-audio', edition.edition_date],
    queryFn: () => epaperApi.fetchEpaperAudio(edition.edition_date),
    enabled: edition.audio_enabled,
  });
  const [track, setTrack] = useState(0);
  const tracks = audio.data?.tracks ?? [];
  const now = tracks[track];

  return (
    <Card as="section" className="mt-7 md:mt-10">
      <SectionHeader title={t('epaper.listen')} />
      {edition.audio_enabled && audio.isLoading ? (
        <Skeleton variant="block" />
      ) : now ? (
        <div className="flex flex-col gap-3">
          {/* Remounted per track so the element, the scrubber and the speed reset together. */}
          <AudioPlayer
            key={now.short_id}
            shortId={now.short_id}
            endpoint={`/public/articles/${now.short_id}/audio`}
            readingLabel={`${t('epaper.page')} ${now.page_number}`}
            deviceTts={NO_DEVICE_TTS}
          />
          <p className={cn(s.body, 'text-ui-sm text-muted')}>
            {L('ఇప్పుడు వినిపిస్తోంది', 'Now playing')}:{' '}
            <span lang="te" className="te text-te-body-xs font-semibold text-ink">
              {now.title_te}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton
              icon={SkipBack}
              label={t('ui.previous')}
              variant="secondary"
              disabled={track === 0}
              onClick={() => setTrack((i) => Math.max(0, i - 1))}
            />
            <IconButton
              icon={SkipForward}
              label={t('ui.next')}
              variant="secondary"
              disabled={track === tracks.length - 1}
              onClick={() => setTrack((i) => Math.min(tracks.length - 1, i + 1))}
            />
            <span aria-live="polite" className="font-sans text-meta tabular-nums text-muted">
              {track + 1} / {tracks.length}
            </span>
          </div>
        </div>
      ) : audio.isError ? (
        // A failed fetch is not the same thing as an edition without audio.
        <ErrorState compact error={audio.error} onRetry={() => void audio.refetch()} />
      ) : (
        <p className={cn(s.body, 'text-ui-sm text-muted')}>
          {L('ఈ ఎడిషన్‌కు ఆడియో అందుబాటులో లేదు.', 'Audio is unavailable for this edition.')}
        </p>
      )}
    </Card>
  );
}
