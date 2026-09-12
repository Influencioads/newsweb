import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Radio } from 'lucide-react';

import { api } from '@/api/client';
import { AudioPlayer } from '@/components/article/AudioPlayer';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';

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

/**
 * A bulletin is a finished file, not a page of prose: there is no device-voice
 * fallback to offer, so the shared player's TTS branch is a no-op here.
 */
const NO_DEVICE_TTS = {
  state: 'idle' as const,
  toggle: () => undefined,
  stop: () => undefined,
};

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function BulletinCard({
  bulletin,
  revealRef,
}: {
  bulletin: BulletinSummary;
  /** The page's single reveal observer — one per card means a batch of one. */
  revealRef: (el: HTMLElement | null) => void;
}) {
  const { language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);

  if (!bulletin.available || !bulletin.url || bulletin.date == null || bulletin.slot == null) {
    return null;
  }
  const duration = clock(bulletin.duration_sec);

  return (
    <Card as="li" ref={revealRef} padding="md" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 lang="te" className="th text-headline-sm font-bold text-ink">
          {bulletin.slot_label_te}
        </h2>
        <Badge tone="muted" size="xs" lang="en" className="tabular-nums">
          {duration}
        </Badge>
      </div>

      {/* Same payload shape as an article's audio, so the one player fits. */}
      <AudioPlayer
        shortId={`${bulletin.date}-${bulletin.slot}`}
        readingLabel={duration}
        deviceTts={NO_DEVICE_TTS}
        endpoint={`/public/bulletins/${bulletin.date}/${bulletin.slot}`}
      />

      {/* The headlines below are the transcript. */}
      {bulletin.items.length ? (
        <ol className="space-y-1">
          {bulletin.items.map((item) => (
            <li key={item.position} className="flex items-baseline gap-2">
              <span className="font-sans text-meta tabular-nums text-muted">{item.position}.</span>
              {item.url ? (
                <Link
                  to={item.url}
                  lang="te"
                  className="te flex min-h-tap flex-1 items-center rounded-xl text-te-body-sm text-ink-soft transition-[colors,transform,box-shadow] duration-base ease-standard hover:text-brand"
                >
                  {item.headline_te}
                </Link>
              ) : (
                <span lang="te" className="te flex-1 text-te-body-sm text-ink-soft">
                  {item.headline_te}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      <p className={cn(s.body, 'text-meta text-muted')}>
        {L(
          'ఈ సైట్‌లో ఇప్పటికే ప్రచురించిన వార్తల నుంచి చదివినవి.',
          'Read from stories already published on this site.',
        )}
      </p>
    </Card>
  );
}

export default function BulletinPage() {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLElement>();
  useDocumentTitle(t('page.bulletin'));

  const day = useQuery({
    queryKey: ['bulletin', 'day'],
    queryFn: async () => (await api.get<BulletinDay>('/public/bulletins')).data,
    retry: false,
    staleTime: 5 * 60_000,
  });

  return (
    <PageContainer width="wrap" className="py-7 md:py-10">
      <PageHeader
        icon={Radio}
        title={L('ఆడియో వార్తలు', 'Audio news')}
        subtitle={L(
          'ప్రతి మూడు గంటలకు మూడు నిమిషాల బులెటిన్ — ఉదయం ఆరు నుంచి రాత్రి తొమ్మిది వరకు.',
          'A three-minute bulletin every three hours, from six in the morning to nine at night.',
        )}
      />

      <QueryState
        query={day}
        isEmpty={(data) => data.items.every((b) => !b.available)}
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton variant="block" />
            <Skeleton variant="block" />
          </div>
        }
        empty={
          <EmptyState
            icon={Radio}
            title={L('ప్రస్తుతం బులెటిన్ లేదు', 'No bulletin on air')}
            body={L(
              'తదుపరిది మూడు గంటల స్లాట్ మొదట్లో వస్తుంది.',
              'The next one is at the top of the next three-hour slot.',
            )}
          />
        }
      >
        {(data) => (
          <ul className="flex flex-col gap-4">
            {data.items
              .filter((bulletin) => bulletin.available)
              .map((bulletin) => (
                <BulletinCard
                  key={`${bulletin.date}-${bulletin.slot}`}
                  bulletin={bulletin}
                  revealRef={reveal}
                />
              ))}
          </ul>
        )}
      </QueryState>
    </PageContainer>
  );
}
