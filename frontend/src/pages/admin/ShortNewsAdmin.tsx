import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trash2, Zap } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Dialog';
import { Checkbox, Field, FileDrop, Input } from '@/components/ui/Field';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import type { ShortNewsCard } from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { useL } from './useL';

/**
 * Short News — the pictures in the app's swipe tab. The desk adds the day's
 * 4:5 / 9:16 news cards here (or from the creative studio, which also links
 * the story); newest shows first. Removing a card takes it off the swipe only:
 * the image stays in the media library.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp';
const SHAPES = { '4:5': 4 / 5, '9:16': 9 / 16 };

/** "4:5" / "9:16" within 2 % (the server applies the same rule), else null. */
export function shortShape(w: number, h: number): keyof typeof SHAPES | null {
  const ratio = w / h;
  return (Object.keys(SHAPES) as Array<keyof typeof SHAPES>).find((k) => Math.abs(ratio - SHAPES[k]) <= SHAPES[k] * 0.02) ?? null;
}

async function shapeOf(file: File) {
  const bmp = await createImageBitmap(file);
  const shape = shortShape(bmp.width, bmp.height);
  bmp.close();
  return shape;
}

export default function ShortNewsAdmin() {
  const { t, language } = useI18n();
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [alt, setAlt] = useState('');
  const [ai, setAi] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);

  // Paged: at the desk's daily pace the list passes a page in days, and a card
  // still live in the swipe must stay reachable to take it down.
  const cards = useInfiniteQuery({
    queryKey: ['cms', 'short-news'],
    queryFn: ({ pageParam }) => cmsApi.fetchShortNewsCards(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const shown = pages.reduce((n, p) => n + p.items.length, 0);
      return shown < last.total ? shown : undefined;
    },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cms', 'short-news'] });

  async function upload(files: File[]) {
    setProgress({ done: 0, of: files.length });
    let added = 0;
    // One at a time, in the order picked: the feed shows the last one first.
    for (const [i, file] of files.entries()) {
      try {
        const shape = await shapeOf(file);
        if (!shape) {
          toast.error(L(`${file.name}: 4:5 లేదా 9:16 చిత్రం కాదు.`, `${file.name}: not a 4:5 or 9:16 image.`));
        } else {
          const media = await cmsApi.uploadMedia(file, { alt_te: alt.trim() || undefined, ai_generated: ai });
          await cmsApi.addShortNews({ media_id: media.id });
          added += 1;
        }
      } catch (e) {
        toast.error(e);
      }
      setProgress({ done: i + 1, of: files.length });
    }
    setProgress(null);
    setAlt('');
    setAi(false);
    refresh();
    if (added) toast.success(L(`${added} షార్ట్ న్యూస్ ప్రచురించబడ్డాయి.`, `${added} short news card(s) published.`));
  }

  const remove = useMutation({
    mutationFn: cmsApi.removeShortNews,
    onSuccess: refresh,
    onError: (e) => toast.error(e),
  });
  async function askRemove(card: ShortNewsCard) {
    const ok = await confirm({
      title: L('ఈ కార్డ్‌ను షార్ట్ న్యూస్ నుంచి తీసేయాలా?', 'Take this card off Short News?'),
      body: L('చిత్రం మీడియా లైబ్రరీలో అలాగే ఉంటుంది.', 'The image stays in the media library.'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    });
    if (ok) remove.mutate(card.id);
  }

  // Grouped by the day it went up, newest day first (the API sorts).
  const locale = language === 'te' ? 'te-IN' : 'en-IN';
  const days = new Map<string, ShortNewsCard[]>();
  for (const c of cards.data?.pages.flatMap((p) => p.items) ?? []) {
    const day = new Date(c.created_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' });
    days.set(day, [...(days.get(day) ?? []), c]);
  }

  return (
    <AdminPage
      title={t('admin.page.shortNews')}
      subtitle={L('యాప్ షార్ట్ న్యూస్ ట్యాబ్ — ఒక్కో స్వైప్‌కు ఒక చిత్రం', "The app's Short News tab — one picture per swipe")}
    >
      {dialog}
      <Section
        title={L('ఈరోజు చిత్రాలు జోడించండి', "Add today's images")}
        subtitle={L(
          '4:5 (1080 × 1350) లేదా 9:16 (1080 × 1920) మాత్రమే. జోడించగానే యాప్‌లో కనిపిస్తాయి. క్రియేటివ్ స్టూడియోలో తయారు చేసినవి అక్కడి నుంచే జోడించవచ్చు.',
          '4:5 (1080 × 1350) or 9:16 (1080 × 1920) only. They go live in the app at once. Cards made in the creative studio can be added from there.',
        )}
      >
        <div className="space-y-3">
          <Field
            label={L('చిత్రంలోని శీర్షిక (ఐచ్ఛికం)', 'Headline on the image (optional)')}
            hint={L('చూపు లేని పాఠకులకు చదివి వినిపిస్తుంది. ఈ అప్‌లోడ్‌లోని అన్ని చిత్రాలకు వర్తిస్తుంది.', 'Read aloud to blind readers. Applies to every image in this upload.')}
          >
            <Input script="te" value={alt} maxLength={500} onChange={(e) => setAlt(e.target.value)} disabled={!!progress} />
          </Field>
          <Checkbox
            checked={ai}
            onChange={setAi}
            disabled={!!progress}
            label={L('AI తో తయారైన చిత్రాలు', 'AI-made images')}
            hint={L('యాప్‌లో "AI చిత్రం" గుర్తు చూపుతుంది (§7.4).', 'The app shows the "AI image" label on them (§7.4).')}
          />
          <FileDrop
            accept={ACCEPT}
            multiple
            disabled={!!progress}
            progress={progress ? (progress.done / progress.of) * 100 : undefined}
            label={progress ? `${t('ui.uploading')} ${progress.done} / ${progress.of}` : L('చిత్రాలు ఎంచుకోండి లేదా ఇక్కడ వదలండి', 'Choose images or drop them here')}
            hint={L('JPEG, PNG లేదా WebP', 'JPEG, PNG or WebP')}
            onFiles={(files) => void upload(files)}
          />
        </div>
      </Section>

      <QueryState
        query={cards}
        isEmpty={(d) => !d.pages[0]?.items.length}
        skeleton={<Skeleton variant="image" ratio="4/5" className="w-40" />}
        empty={<EmptyState icon={Zap} title={L('ఇంకా షార్ట్ న్యూస్ లేవు', 'No short news yet')} />}
      >
        {() => (
          <div className="space-y-6">
            {[...days].map(([day, list]) => (
              <section key={day} aria-label={day}>
                <h2 className={cn(s.head, 'mb-2 text-ui-sm font-bold text-ink')}>
                  {day} <span className="font-normal text-muted">· {list.length}</span>
                </h2>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {list.map((c) => (
                    <li key={c.id} className="relative min-w-0 space-y-1.5 rounded-xl border border-rule bg-surface p-2">
                      <img
                        src={c.url}
                        alt=""
                        loading="lazy"
                        className="w-full rounded-lg bg-placeholder object-contain"
                        style={{ aspectRatio: c.width && c.height ? `${c.width} / ${c.height}` : '4 / 5' }}
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.shape ? <Badge tone="muted" size="xs">{c.shape}</Badge> : null}
                        <time dateTime={c.created_at} className="font-sans text-meta tabular-nums text-muted">
                          {new Date(c.created_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
                        </time>
                      </div>
                      {c.article_id && c.article_title_te ? (
                        <Link
                          to={`/admin/articles/${c.article_id}/edit`}
                          lang="te"
                          className="te te-clamp-2 block text-te-body-xs font-semibold text-ink hover:text-brand"
                        >
                          {c.article_title_te}
                        </Link>
                      ) : null}
                      {/* Its own box: the button's base class is `relative`, which would win over `absolute`. */}
                      <div className="absolute right-3 top-3">
                        <IconButton
                          icon={Trash2}
                          label={L('షార్ట్ న్యూస్ నుంచి తీసేయండి', 'Remove from Short News')}
                          variant="secondary"
                          iconSize="sm"
                          className="shadow-card"
                          disabled={remove.isPending}
                          onClick={() => void askRemove(c)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {cards.hasNextPage ? (
              <Button variant="secondary" pending={cards.isFetchingNextPage} onClick={() => void cards.fetchNextPage()}>
                {L('పాత కార్డ్‌లు చూపించండి', 'Show older cards')}
              </Button>
            ) : null}
          </div>
        )}
      </QueryState>
    </AdminPage>
  );
}
