import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, Pause, Play, Radio } from 'lucide-react';

import { api } from '@/api/client';
import { bulletinArt } from '@/components/bulletin/art';
import { Equalizer } from '@/components/player/parts';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { selectTrack, usePlayer } from '@/stores/player';
import { cn } from '@/utils/cn';

/**
 * The latest audio bulletin at the top of the home page: the show's own banner
 * art (`art.ts`) as the play button, its name, time and length underneath.
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

  const art = bulletinArt(data.slot);

  return (
    <section aria-label={t('player.kind.bulletin')} className="overflow-hidden rounded-2xl bg-black shadow-card">
      {/* The show's banner is the play button — "Click To Listen" is drawn into it. */}
      <button
        type="button"
        aria-label={`${t('reader.listen')}: ${title}`}
        aria-pressed={playing}
        onClick={listen}
        className="group block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-exclusive"
      >
        {art ? (
          <img
            src={art}
            alt=""
            decoding="async"
            className="h-28 w-full object-contain transition-transform duration-base ease-standard group-hover:scale-[1.02] sm:h-32"
          />
        ) : (
          <span lang="te" className="th flex h-28 items-center justify-center gap-2 text-headline-sm font-bold text-white sm:h-32">
            <Icon icon={Play} size="md" />
            {title}
          </span>
        )}
      </button>

      <div className="flex items-center gap-2 border-t border-white/10 py-1 pl-3 pr-1 text-white">
        {/* Live mark: equalizer while it plays, else the radio with a red pulse. */}
        <span aria-hidden className="relative flex h-5 w-5 shrink-0 items-center justify-center text-breaking">
          {playing ? (
            <Equalizer playing />
          ) : (
            <>
              <Icon icon={Radio} size="sm" />
              <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-pill bg-breaking motion-safe:animate-ping" />
              <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-pill bg-breaking" />
            </>
          )}
        </span>
        <p className="min-w-0 flex-1 truncate">
          <span lang="te" className="th text-ui font-bold">
            {title}
          </span>
          <span className="font-sans text-meta font-semibold tabular-nums text-white/70">
            {' · '}
            {clock}
            {minutes ? (
              <>
                {' · '}
                <span className={s.body}>{`${minutes} ${L('ని', 'min')}`}</span>
              </>
            ) : null}
          </span>
        </p>
        {playing ? <Icon icon={Pause} size="sm" className="text-white/70" /> : null}
        <Link
          to="/bulletin"
          className={cn(
            s.body,
            'flex min-h-tap shrink-0 items-center gap-0.5 rounded-xl px-2 text-ui-sm font-semibold text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-exclusive',
          )}
        >
          {L('అన్ని బులెటిన్లు', 'All bulletins')}
          <Icon icon={ChevronRight} size="sm" />
        </Link>
      </div>
    </section>
  );
}
