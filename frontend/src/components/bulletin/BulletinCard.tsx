import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '@/api/client';
import { useI18n } from '@/i18n';

/**
 * The latest three-hourly bulletin, on the home page.
 *
 * Not a sixth tab: the mobile bar is already at five, which is as many as a
 * bottom bar carries well, and six items a day does not earn a permanent slot.
 * A card above the fold gets it in front of readers without pushing anything
 * else out.
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
  const en = language === 'en';

  const bulletin = useQuery({
    queryKey: ['bulletin', 'latest'],
    queryFn: async () =>
      (await api.get<BulletinSummary>('/public/bulletins/latest')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const data = bulletin.data;
  if (!data?.available || !data.url) return null;

  const minutes = Math.floor(data.duration_sec / 60);
  const seconds = String(data.duration_sec % 60).padStart(2, '0');

  return (
    <section
      aria-label={en ? 'Audio bulletin' : 'ఆడియో బులెటిన్'}
      className="mb-5 rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-block rounded-chip bg-brand px-2 py-0.5 font-sans text-[10.5px] font-bold uppercase tracking-wide text-white">
          {en ? 'Audio news' : 'ఆడియో వార్తలు'}
        </span>
        <h2 className="te text-[15px] font-bold leading-telugu text-ink">
          {data.slot_label_te}
        </h2>
        <span className="font-sans text-[11.5px] tabular-nums text-muted">
          {minutes}:{seconds}
        </span>
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the headline list below is the transcript */}
      <audio controls preload="none" src={data.url} className="mt-2.5 w-full" />

      {data.items.length ? (
        <ol className="mt-2.5 space-y-1">
          {data.items.slice(0, 5).map((item) => (
            <li key={item.position} className="te text-[13px] leading-telugu text-ink-soft">
              {item.url ? (
                <Link to={item.url} className="hover:underline">
                  {item.headline_te}
                </Link>
              ) : (
                item.headline_te
              )}
            </li>
          ))}
        </ol>
      ) : null}

      <Link to="/bulletin"
        className="te mt-2.5 inline-block text-[12.5px] font-semibold text-brand underline">
        {en ? 'All of today’s bulletins' : 'ఈ రోజు బులెటిన్లన్నీ'}
      </Link>
    </section>
  );
}
