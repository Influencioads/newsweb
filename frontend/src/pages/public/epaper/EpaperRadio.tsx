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
import { usePlayer, type Track } from '@/stores/player';
import type { EpaperEdition } from '@/types/epaper';
import { cn } from '@/utils/cn';

/**
 * "Listen like radio" — the edition's stories read out back to back.
 *
 * The edition endpoint supplies the running order; each track is an article.
 * Pressing listen hands the WHOLE edition to the global player, starting at the
 * chosen story, and it carries on page after page — in the dock, even after
 * the reader leaves the e-paper. The inline control is the shared
 * `AudioPlayer` pointed at the chosen article's audio route (it shows the live
 * status while that story is on air). Skip back / forward move the choice
 * while idle, and move the player itself while the edition is playing.
 */

/**
 * The edition has no per-track device voice to fall back on — the tracks are
 * server renditions or they do not exist. Module-level so the identity is
 * stable across renders (AudioPlayer cleans up on `stop` changing).
 */
const NO_DEVICE_TTS = { state: 'unavailable' as const, toggle: () => {}, stop: () => {} };

const audioRoute = (shortId: string) => `/public/articles/${shortId}/audio`;

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
  const [chosen, setChosen] = useState(0);
  const tracks = audio.data?.tracks ?? [];
  const page = (n: number) => `${t('epaper.page')} ${n}`;
  const queue: Track[] = tracks.map((item) => ({
    id: audioRoute(item.short_id),
    kind: 'epaper',
    title: item.title_te,
    subtitle: page(item.page_number),
    url: item.url,
  }));

  // While this edition is on air, the player's position is the selection.
  const liveIndex = usePlayer((p) => {
    const id = p.queue[p.index]?.id;
    return id ? tracks.findIndex((item) => audioRoute(item.short_id) === id) : -1;
  });
  const track = liveIndex >= 0 ? liveIndex : Math.min(chosen, Math.max(0, tracks.length - 1));
  const now = tracks[track];
  const go = (i: number) => (liveIndex >= 0 ? usePlayer.getState().playQueue(queue, i) : setChosen(i));

  return (
    <Card as="section" className="mt-7 md:mt-10">
      <SectionHeader title={t('epaper.listen')} />
      {edition.audio_enabled && audio.isLoading ? (
        <Skeleton variant="block" />
      ) : now ? (
        <div className="flex flex-col gap-3">
          {/* Keyed per track so the control follows the choice; the queue
              carries each file, so it fetches nothing of its own. */}
          <AudioPlayer
            key={now.short_id}
            shortId={now.short_id}
            endpoint={audioRoute(now.short_id)}
            readingLabel={page(now.page_number)}
            deviceTts={NO_DEVICE_TTS}
            track={{ kind: 'epaper', title: now.title_te, subtitle: page(now.page_number) }}
            queue={queue}
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
              onClick={() => go(track - 1)}
            />
            <IconButton
              icon={SkipForward}
              label={t('ui.next')}
              variant="secondary"
              disabled={track === tracks.length - 1}
              onClick={() => go(track + 1)}
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
