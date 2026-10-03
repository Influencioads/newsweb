import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Pause, Play, Radio } from 'lucide-react';

import { api } from '@/api/client';
import { Equalizer } from '@/components/player/parts';
import { IconButton, IconButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { selectTrack, usePlayer } from '@/stores/player';
import { cn } from '@/utils/cn';

/**
 * "▶ వినండి: గరం చాయ్ న్యూస్" — the latest audio bulletin as one strip at the
 * top of the home page.
 *
 * `/public/bulletins/latest` is the same serialized bulletin as the slot route,
 * file URL included, so play hands the global player a track straight away — no
 * second fetch. The track id is the slot route, the id `AudioPlayer` and the
 * bulletin page use, so all of them agree on what is on air and playback keeps
 * going in the dock while the reader browses.
 *
 * Renders nothing without a live file (incl. the admin kill switch, which
 * arrives as `available: false`).
 */

interface LatestBulletin {
  available: boolean;
  url: string | null;
  duration_sec: number;
  date: string | null;
  slot: number | null;
  slot_label_te: string | null;
}

export function BulletinBanner() {
  const { t, language } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);

  // Same key as BulletinCard: one request however many show it.
  const { data } = useQuery({
    queryKey: ['bulletin', 'latest'],
    queryFn: async () => (await api.get<LatestBulletin>('/public/bulletins/latest')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const id = data ? `/public/bulletins/${data.date}/${data.slot}` : '';
  // On air only while this exact file plays — a regenerated file keeps the route, not the URL.
  const onAir = usePlayer((p) => {
    const current = selectTrack(p);
    return !!data?.url && current?.id === id && current.url === data.url;
  });
  const playing = usePlayer((p) => onAir && p.playing);

  if (!data?.available || !data.url) return null;

  const clock = `${String(data.slot ?? 0).padStart(2, '0')}:00`;
  const title = data.slot_label_te || clock;
  const minutes = data.duration_sec > 0 ? Math.max(1, Math.round(data.duration_sec / 60)) : 0;

  function listen(): void {
    const player = usePlayer.getState();
    if (onAir) player.toggle();
    else
      player.playTrack({
        id,
        kind: 'bulletin',
        title,
        subtitle: clock,
        url: data!.url!,
        durationSec: data!.duration_sec,
      });
  }

  return (
    <section
      aria-label={t('player.kind.bulletin')}
      className="flex items-center gap-3 rounded-2xl border border-brand/20 border-l-4 border-l-breaking bg-brand-tint py-1.5 pl-3 pr-1.5 shadow-card"
    >
      {/* Live mark: equalizer while it plays, else the radio with a red pulse. */}
      <span aria-hidden className="relative flex h-6 w-6 shrink-0 items-center justify-center text-breaking">
        {playing ? (
          <Equalizer playing />
        ) : (
          <>
            <Icon icon={Radio} size="md" />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-pill bg-breaking motion-safe:animate-ping" />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-pill bg-breaking" />
          </>
        )}
      </span>

      <p className="min-w-0 flex-1 md:flex md:items-baseline md:gap-3">
        <span className="block">
          <span className={cn(s.body, 'text-ui font-bold text-breaking')}>{t('reader.listen')}:</span>{' '}
          <span lang="te" className="th text-headline-xs font-bold text-ink">
            {title}
          </span>
        </span>
        <span className="block font-sans text-meta font-semibold tabular-nums text-ink-soft">
          {clock}
          {minutes ? (
            <>
              {' · '}
              <span className={s.body}>{`${minutes} ${L('ని', 'min')}`}</span>
            </>
          ) : null}
        </span>
      </p>

      <IconButton
        icon={playing ? Pause : Play}
        label={`${t('reader.listen')}: ${title}`}
        variant="primary"
        round
        pressed={playing}
        onClick={listen}
      />
      <IconButtonLink to="/bulletin" icon={ChevronRight} label={L('ఈ రోజు బులెటిన్లన్నీ', 'All of today’s bulletins')} round />
    </section>
  );
}
