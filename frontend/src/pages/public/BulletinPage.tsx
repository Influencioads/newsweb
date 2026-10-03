import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, Radio } from 'lucide-react';

import { api } from '@/api/client';
import { AudioPlayer } from '@/components/article/AudioPlayer';
import { bulletinArt, SLOTS } from '@/components/bulletin/art';
import { Equalizer, PAUSED } from '@/components/player/parts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useI18n, useScript } from '@/i18n';
import { usePlayer, type Track } from '@/stores/player';
import { cn } from '@/utils/cn';
import { useDocumentTitle, useReveal } from '@/utils/motion';

/**
 * Today's audio bulletins — six a day, 07:00 to 21:00, each with its own
 * name (`slot_label_te`, set on the server).
 *
 * Only slots that are actually on air appear. A slot that has not been
 * produced yet, or one an editor pulled, simply is not in the list: a reader
 * has no use for the distinction between "not made yet" and "taken down".
 *
 * The on-air bulletins are one running order for the global player: "Play
 * all", a tap on the radio dial, or any card's own listen control starts the
 * day's queue at that bulletin, and the player carries on to the next. The
 * dial shows all six slots — off-air ones inert — with a needle that glides to
 * the bulletin on air, or rests on the latest one when nothing plays.
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

// The dial spans the first slot to the last.
const FIRST = SLOTS[0]!;
const SPAN = SLOTS[SLOTS.length - 1]! - FIRST;
/** A tick every half hour; the ones on a slot's hour are drawn long. */
const TICKS = SPAN * 2 + 1;

const slotClock = (slot: number) => `${String(slot).padStart(2, '0')}:00`;
const bulletinId = (date: string, slot: number) => `/public/bulletins/${date}/${slot}`;
const dialLeft = (slot: number) => `${((slot - FIRST) / SPAN) * 100}%`;

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The on-air bulletins, in running order, as player tracks. */
function dayQueue(items: BulletinSummary[]): Track[] {
  return items
    .filter((b) => b.available && b.url && b.date != null && b.slot != null)
    .sort((a, b) => a.slot! - b.slot!)
    .map((b): Track => ({
      id: bulletinId(b.date!, b.slot!),
      kind: 'bulletin',
      title: b.slot_label_te || slotClock(b.slot!),
      subtitle: slotClock(b.slot!),
      url: b.url!,
      durationSec: b.duration_sec,
    }));
}

function RadioDial({ date, queue }: { date: string; queue: Track[] }) {
  const { t } = useI18n();
  const s = useScript();
  const headingId = useId();
  const currentId = usePlayer((p) => p.queue[p.index]?.id);
  const playing = usePlayer((p) => p.playing);
  const { playQueue, toggle } = usePlayer.getState();

  const slots = SLOTS.map((slot) => ({ slot, index: queue.findIndex((track) => track.id === bulletinId(date, slot)) }));
  const onAir = slots.filter((entry) => entry.index >= 0);
  const live = slots.find((entry) => entry.index >= 0 && queue[entry.index]?.id === currentId);
  const needle = live?.slot ?? onAir[onAir.length - 1]?.slot ?? FIRST;

  return (
    <section
      aria-labelledby={headingId}
      className="-mx-4 mb-6 bg-ink px-4 py-3 text-on-ink shadow-raised sm:mx-0 sm:rounded-2xl sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-pill',
            live ? 'bg-exclusive animate-pulse' : 'bg-on-ink/30',
            live && !playing && PAUSED,
          )}
        />
        <h2 id={headingId} className={cn(s.body, 'min-w-0 flex-1 text-ui font-bold')}>
          {t('player.dial')}
        </h2>
        <Button variant="inverse" icon={Play} disabled={!queue.length} onClick={() => playQueue(queue, 0)}>
          {t('player.playAll')}
        </Button>
      </div>

      {/* Edge slots centre on the ends of the scale, so the scale is inset by half a button.
          Pixel math: the closest slots are 2h apart and each is a 44px (min-w-tap) target
          centred on its hour, so the 14h scale needs ≥ 22px/h = 308px, plus 22px past each
          end. Inside a 375px phone's gutters there is only 343 − 44 = 299px, hence the
          edge-to-edge band: 375 − 44 = 331px, a 47px step (45px at 360). Labels drop the
          ":00" there too ("07" is ~17px). From `sm` up the scale has 75px+ per step. */}
      <div className="relative mx-1.5 mt-4 h-24 sm:mx-5">
        <div aria-hidden className="absolute inset-x-0 top-0 flex h-5 items-start justify-between">
          {Array.from({ length: TICKS }, (_, i) => (
            <span
              key={i}
              className={cn(
                'w-px',
                SLOTS.includes(FIRST + i / 2) ? 'h-5 bg-on-ink/70' : i % 2 === 0 ? 'h-3 bg-on-ink/40' : 'h-2 bg-on-ink/25',
              )}
            />
          ))}
        </div>
        <span
          aria-hidden
          className="absolute top-0 h-9 w-0.5 -translate-x-1/2 rounded-pill bg-exclusive transition-[left] duration-slow ease-emphasized"
          style={{ left: dialLeft(needle) }}
        />
        <ol className="absolute inset-x-0 top-9">
          {slots.map(({ slot, index }) => {
            const available = index >= 0;
            const current = available && queue[index]?.id === currentId;
            return (
              <li key={slot} className="absolute -translate-x-1/2" style={{ left: dialLeft(slot) }}>
                <button
                  type="button"
                  disabled={!available}
                  aria-current={current || undefined}
                  // The one on air pauses and resumes, like Now Playing's queue; a restart would lose the place.
                  onClick={() => (current ? toggle() : playQueue(queue, index))}
                  className={cn(
                    'flex min-h-tap min-w-tap flex-col items-center justify-center gap-0.5 rounded-xl px-1 font-sans text-ui-sm font-bold tabular-nums',
                    'transition-colors duration-base ease-standard',
                    available ? 'hover:bg-on-ink/10' : 'cursor-default opacity-40',
                    current ? 'text-exclusive' : available ? 'text-on-ink' : 'text-muted-inverse',
                  )}
                >
                  {/* The phone label drops ":00", so screen readers get the whole time, and the name, below. */}
                  <span aria-hidden>
                    {String(slot).padStart(2, '0')}
                    <span className="hidden sm:inline">:00</span>
                  </span>
                  {current ? <Equalizer playing={playing} /> : <span aria-hidden className="h-3.5" />}
                  <span className="sr-only">
                    {slotClock(slot)}
                    {' · '}
                    {available ? <span lang="te">{queue[index]!.title}</span> : t('player.offAir')}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function BulletinCard({
  bulletin,
  queue,
  revealRef,
}: {
  bulletin: BulletinSummary;
  queue: Track[];
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
  const art = bulletinArt(bulletin.slot);
  const id = bulletinId(bulletin.date, bulletin.slot);

  // The art says "Click To Listen", so it does — a mouse shortcut to the player below,
  // which stays the one keyboard and screen-reader control.
  function listen(): void {
    const player = usePlayer.getState();
    if (player.queue[player.index]?.id === id) player.toggle();
    else player.playQueue(queue, Math.max(0, queue.findIndex((track) => track.id === id)));
  }

  return (
    <Card as="li" ref={revealRef} padding="md" className="space-y-3">
      {art ? (
        <button type="button" tabIndex={-1} aria-hidden onClick={listen} className="group block w-full overflow-hidden rounded-xl bg-black">
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-28 w-full object-contain transition-transform duration-base ease-standard group-hover:scale-[1.02] sm:h-32"
          />
        </button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span lang="en" className="font-sans text-ui-sm font-bold tabular-nums text-ink-soft">
          {slotClock(bulletin.slot)}
        </span>
        <h2 lang="te" className="th text-headline-sm font-bold text-ink">
          {bulletin.slot_label_te}
        </h2>
        <Badge tone="muted" size="xs" lang="en" className="tabular-nums">
          {duration}
        </Badge>
      </div>

      {/* Same payload shape as an article's audio, so the one player fits; it
          starts the day's running order here. */}
      <AudioPlayer
        shortId={`${bulletin.date}-${bulletin.slot}`}
        readingLabel={duration}
        deviceTts={NO_DEVICE_TTS}
        endpoint={bulletinId(bulletin.date, bulletin.slot)}
        track={{
          kind: 'bulletin',
          title: bulletin.slot_label_te || slotClock(bulletin.slot),
          subtitle: slotClock(bulletin.slot),
        }}
        queue={queue}
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
          'రోజుకు ఆరు బులెటిన్లు, ఒక్కొక్కటి మూడు నిమిషాలు — ఉదయం 7 నుంచి రాత్రి 9 వరకు.',
          'Six three-minute bulletins a day, from 7am to 9pm.',
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
              'బులెటిన్లు ఉదయం 7, 9, మధ్యాహ్నం 1, 3, సాయంత్రం 5, రాత్రి 7, 9 గంటలకు వస్తాయి.',
              'Bulletins go out at 7am, 9am, 1pm, 3pm, 5pm, 7pm and 9pm.',
            )}
          />
        }
      >
        {(data) => {
          const queue = dayQueue(data.items);
          const date = data.date ?? data.items.find((b) => b.date)?.date ?? '';
          return (
            <>
              <RadioDial date={date} queue={queue} />
              <ul className="flex flex-col gap-4">
                {data.items
                  .filter((bulletin) => bulletin.available)
                  .map((bulletin) => (
                    <BulletinCard
                      key={`${bulletin.date}-${bulletin.slot}`}
                      bulletin={bulletin}
                      queue={queue}
                      revealRef={reveal}
                    />
                  ))}
              </ul>
            </>
          );
        }}
      </QueryState>
    </PageContainer>
  );
}
