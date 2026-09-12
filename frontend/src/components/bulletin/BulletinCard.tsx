import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';

import { api } from '@/api/client';
import { AudioPlayer } from '@/components/article/AudioPlayer';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTts } from '@/features/reader/tts';
import { useI18n } from '@/i18n';

/**
 * The latest three-hourly bulletin, on the home page.
 *
 * Not a sixth tab: the mobile bar is already at five, which is as many as a
 * bottom bar carries well, and six items a day does not earn a permanent slot.
 * A card above the fold gets it in front of readers without pushing anything
 * else out.
 *
 * Playback goes through the shared `AudioPlayer` (seek, speed, one pill in
 * every state) pointed at this slot's public audio route, rather than a native
 * `<audio controls>` whose chrome is a different colour in every browser.
 *
 * Renders nothing at all when there is no live bulletin — including when an
 * admin has flipped the kill switch, which arrives here as `available: false`.
 */

interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  date: string | null;
  slot: number | null;
  slot_label_te: string | null;
  items: Array<{ position: number; short_id: string | null; url: string | null; headline_te: string }>;
}

export function BulletinCard() {
  const { language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);

  const bulletin = useQuery({
    queryKey: ['bulletin', 'latest'],
    queryFn: async () => (await api.get<BulletinSummary>('/public/bulletins/latest')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const data = bulletin.data;
  // The headline list is the transcript, so it is also what the device voice
  // reads when the server file is missing. Hook order: this runs every render.
  const tts = useTts((data?.items ?? []).map((item) => item.headline_te).join('. '));

  if (!data?.available || !data.url) return null;

  const minutes = Math.floor(data.duration_sec / 60);
  const seconds = String(data.duration_sec % 60).padStart(2, '0');
  const length = `${minutes}:${seconds}`;

  return (
    <Card as="section" tone="surface" padding="md" aria-label={L('ఆడియో బులెటిన్', 'Audio bulletin')} className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="breaking" size="xs" icon={Radio} lang={language}>
          {L('ఆన్ ఎయిర్', 'On air')}
        </Badge>
        {data.slot_label_te ? (
          <h2 lang="te" className="th text-headline-xs font-bold text-ink">
            {data.slot_label_te}
          </h2>
        ) : null}
        <span className="font-sans text-meta tabular-nums text-muted">{length}</span>
      </div>

      <div className="mt-3">
        <AudioPlayer
          shortId={`${data.date ?? 'latest'}-${data.slot ?? 0}`}
          readingLabel={length}
          deviceTts={tts}
          endpoint={`/public/bulletins/${data.date}/${data.slot}`}
        />
      </div>

      {data.items.length ? (
        <ol className="mt-3 divide-y divide-rule-soft">
          {data.items.slice(0, 5).map((item) => (
            <li key={item.position}>
              {item.url ? (
                <Link
                  to={item.url}
                  lang="te"
                  className="te flex min-h-tap items-center rounded-xl py-1 text-te-body-xs text-ink-soft transition-[colors,transform,box-shadow] duration-base ease-standard hover:text-brand"
                >
                  {item.headline_te}
                </Link>
              ) : (
                <p lang="te" className="te flex min-h-tap items-center py-1 text-te-body-xs text-ink-soft">
                  {item.headline_te}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      <ButtonLink to="/bulletin" variant="link" size="sm" className="mt-2">
        {L('ఈ రోజు బులెటిన్లన్నీ', 'All of today’s bulletins')}
      </ButtonLink>
    </Card>
  );
}
