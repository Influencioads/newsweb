import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '@/api/client';
import { useI18n } from '@/i18n';

/**
 * Today's audio bulletins — six a day, 06:00 to 21:00.
 *
 * Only slots that are actually on air appear. A slot that has not been
 * produced yet, or one an editor pulled, simply is not in the list: a reader
 * has no use for the distinction between "not made yet" and "taken down".
 */

interface BulletinSummary {
  available: boolean;
  url: string | null;
  duration_sec: number;
  date: string | null;
  slot: number | null;
  slot_label_te: string | null;
  published_at?: string | null;
  items: Array<{ position: number; url: string | null; headline_te: string }>;
}

interface BulletinDay {
  enabled: boolean;
  date?: string;
  items: BulletinSummary[];
}

function Bulletin({ bulletin }: { bulletin: BulletinSummary }) {
  const { language } = useI18n();
  const en = language === 'en';
  if (!bulletin.available || !bulletin.url) return null;

  const minutes = Math.floor(bulletin.duration_sec / 60);
  const seconds = String(bulletin.duration_sec % 60).padStart(2, '0');

  return (
    <article className="rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="te text-[16px] font-bold leading-telugu text-ink">
          {bulletin.slot_label_te}
        </h2>
        <span className="font-sans text-[11.5px] tabular-nums text-muted">
          {minutes}:{seconds}
        </span>
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the headlines below are the transcript */}
      <audio controls preload="none" src={bulletin.url} className="mt-2.5 w-full" />

      {bulletin.items.length ? (
        <ol className="mt-3 space-y-1.5">
          {bulletin.items.map((item) => (
            <li key={item.position} className="te text-[13.5px] leading-telugu text-ink-soft">
              <span className="mr-1 font-sans text-[11px] tabular-nums text-muted">
                {item.position}.
              </span>
              {item.url ? (
                <Link to={item.url} className="hover:underline">{item.headline_te}</Link>
              ) : (
                item.headline_te
              )}
            </li>
          ))}
        </ol>
      ) : null}

      <p className="te mt-2.5 text-[11px] text-muted">
        {en
          ? 'Read from stories already published on this site.'
          : 'ఈ సైట్‌లో ఇప్పటికే ప్రచురించిన వార్తల నుంచి చదివినవి.'}
      </p>
    </article>
  );
}

export default function BulletinPage() {
  const { language } = useI18n();
  const en = language === 'en';

  const day = useQuery({
    queryKey: ['bulletin', 'day'],
    queryFn: async () => (await api.get<BulletinDay>('/public/bulletins')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const data = day.data;
  const live = (data?.items ?? []).filter((b) => b.available);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5">
        <h1 className="th text-[26px] font-extrabold text-ink">
          {en ? 'Audio news' : 'ఆడియో వార్తలు'}
        </h1>
        <p className="te mt-1 text-[13px] leading-telugu text-muted">
          {en
            ? 'A three-minute bulletin every three hours, from six in the morning to nine at night.'
            : 'ప్రతి మూడు గంటలకు మూడు నిమిషాల బులెటిన్ — ఉదయం ఆరు నుంచి రాత్రి తొమ్మిది వరకు.'}
        </p>
      </header>

      {day.isLoading ? (
        <p className="te text-[13px] text-muted">{en ? 'Loading…' : 'లోడ్ అవుతోంది…'}</p>
      ) : null}

      <div className="space-y-4">
        {live.map((bulletin) => (
          <Bulletin key={`${bulletin.date}-${bulletin.slot}`} bulletin={bulletin} />
        ))}
      </div>

      {!day.isLoading && live.length === 0 ? (
        <p className="te rounded-card border border-rule bg-white p-8 text-center text-[13px] leading-telugu text-muted dark:bg-surface">
          {en
            ? 'No bulletin is on air right now. The next one is at the top of the next three-hour slot.'
            : 'ప్రస్తుతం బులెటిన్ ఏదీ లేదు. తదుపరిది మూడు గంటల తర్వాత వస్తుంది.'}
        </p>
      ) : null}
    </main>
  );
}
