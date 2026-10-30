import { useState, type RefObject } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImageOff, ImagePlus, Search, SearchX, Trash2 } from 'lucide-react';

import { ACCEPT, Tile, toRef, type LibraryItem } from '@/components/admin/MediaPicker';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FileDrop, Input } from '@/components/ui/Field';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { CmsMediaRef } from '@/types/cms';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

import { imageMarker, markerId, MAX_BODY_IMAGES, paragraphsOf, type BodyImage } from './form';

/**
 * Pictures inside the story, besides the main image.
 *
 * "Insert image" puts the picture where the cursor is in the body: a line
 * `[చిత్రం:ID]` is added there as its own paragraph, and that line is where the
 * picture prints between paragraphs. The list below the body shows each
 * picture with its caption; the arrows move it up or down a paragraph, and the
 * editor can also cut and paste the marker line anywhere in the text. Up to
 * MAX_BODY_IMAGES pictures.
 */

interface Props {
  body: string;
  images: Record<string, BodyImage>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onChange: (body: string, images: Record<string, BodyImage>) => void;
}

/** Insert `[చిత్రం:ID]` as its own paragraph at the paragraph boundary nearest the caret. */
function insertAt(body: string, caret: number | null, id: number): string {
  const marker = imageMarker(id);
  if (!body.trim()) return marker;
  if (caret === null || caret >= body.length) return `${body.replace(/\s+$/, '')}\n\n${marker}`;
  // Move to the end of the paragraph the caret is in, so a picture never splits one.
  const next = body.indexOf('\n\n', caret);
  const at = next === -1 ? body.length : next;
  const before = body.slice(0, at).replace(/\s+$/, '');
  const after = body.slice(at).replace(/^\s+/, '');
  return after ? `${before}\n\n${marker}\n\n${after}` : `${before}\n\n${marker}`;
}

export function BodyImages({ body, images, textareaRef, onChange }: Props) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const reveal = useReveal<HTMLButtonElement>();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [caret, setCaret] = useState<number | null>(null);

  const paragraphs = paragraphsOf(body);
  // The pictures actually placed, in reading order, with the paragraph they follow.
  const placed = paragraphs.flatMap((p, index) => {
    const id = markerId(p);
    const img = id ? images[id] : undefined;
    if (!id || !img) return [];
    const after = paragraphs.slice(0, index).filter((x) => markerId(x) === null).length;
    return [{ id, img, index, after }];
  });
  const full = placed.length >= MAX_BODY_IMAGES;

  const library = useQuery({
    queryKey: ['cms', 'media-library'],
    queryFn: () => cmsApi.fetchManagement<{ items: LibraryItem[] }>('media'),
    enabled: open,
  });

  function add(media: CmsMediaRef) {
    if (placed.some((p) => p.id === String(media.id))) {
      toast.error(L('ఈ చిత్రం ఇప్పటికే కథనంలో ఉంది.', 'That picture is already in the story.'));
      return;
    }
    onChange(insertAt(body, caret, media.id), {
      ...images,
      [String(media.id)]: { media, caption: media.caption_te ?? '' },
    });
    setOpen(false);
  }

  const upload = useMutation({
    mutationFn: (file: File) => cmsApi.uploadMedia(file),
    onSuccess: (media) => {
      add(toRef(media));
      void library.refetch();
    },
    onError: () => toast.error(L('అప్‌లోడ్ విఫలమైంది — JPEG/PNG/WebP మాత్రమే, 15MB లోపు.', 'Upload failed — JPEG, PNG or WebP only, under 15MB.')),
  });

  function openPicker() {
    // Remember where the cursor was (focus moves into the dialog). No cursor
    // yet means the end of the story.
    const el = textareaRef.current;
    setCaret(el && el.selectionStart > 0 ? el.selectionStart : null);
    setOpen(true);
  }

  function remove(id: string) {
    const kept = paragraphs.filter((p) => markerId(p) !== id);
    const nextImages = { ...images };
    delete nextImages[id];
    onChange(kept.join('\n\n'), nextImages);
  }

  function move(index: number, dir: -1 | 1) {
    const list = [...paragraphs];
    const to = index + dir;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to] as string, list[index] as string];
    onChange(list.join('\n\n'), images);
  }

  function setCaption(id: string, caption: string) {
    const img = images[id];
    if (img) onChange(body, { ...images, [id]: { ...img, caption } });
  }

  const needle = q.trim().toLowerCase();
  const label = cn(s.body, 'block text-ui-sm font-semibold text-ink');

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-rule bg-canvas p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={label}>
          {L('కథనం మధ్యలో చిత్రాలు', 'Pictures inside the story')}{' '}
          <span className="font-normal text-muted">
            · {L('ఐచ్ఛికం', 'optional')} ({placed.length}/{MAX_BODY_IMAGES})
          </span>
        </span>
        <Button variant="secondary" size="sm" icon={ImagePlus} disabled={full} onClick={openPicker}>
          {full ? L('గరిష్టం చేరింది', 'Limit reached') : L('చిత్రం చొప్పించండి', 'Insert image')}
        </Button>
      </div>
      <p className={cn(s.body, 'text-meta text-muted')}>
        {L(
          'కర్సర్ ఉన్న పేరాగ్రాఫ్ తర్వాత చిత్రం వస్తుంది. బాణాలతో పైకి/కిందికి జరపండి, లేదా [చిత్రం:…] లైన్‌ను కావలసిన చోటుకి కట్ చేసి పేస్ట్ చేయండి.',
          'The picture goes after the paragraph your cursor is in. Move it with the arrows, or cut and paste its [చిత్రం:…] line anywhere in the body.',
        )}
      </p>

      {placed.length > 0 ? (
        <ul className="space-y-3">
          {placed.map((p, n) => (
            <li key={p.id} className="flex gap-3 rounded-xl border border-rule bg-surface p-2.5">
              <img
                src={p.img.media.url}
                alt={p.img.media.alt_te ?? ''}
                className="aspect-[4/3] w-28 shrink-0 rounded-lg border border-rule object-cover"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p className={cn(s.body, 'text-meta font-semibold text-ink-soft')}>
                  {L(`చిత్రం ${n + 1} · ${p.after}వ పేరాగ్రాఫ్ తర్వాత`, `Picture ${n + 1} · after paragraph ${p.after}`)}
                </p>
                <Field label={L('క్యాప్షన్', 'Caption')} optionalLabel>
                  <Input script="te" value={p.img.caption} onChange={(e) => setCaption(p.id, e.target.value)} />
                </Field>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <IconButton
                  icon={ArrowUp}
                  iconSize="sm"
                  variant="secondary"
                  label={L('పైకి జరపండి', 'Move up')}
                  disabled={p.index === 0}
                  onClick={() => move(p.index, -1)}
                />
                <IconButton
                  icon={ArrowDown}
                  iconSize="sm"
                  variant="secondary"
                  label={L('కిందికి జరపండి', 'Move down')}
                  disabled={p.index === paragraphs.length - 1}
                  onClick={() => move(p.index, 1)}
                />
                <IconButton icon={Trash2} iconSize="sm" variant="secondary" label={t('ui.remove')} onClick={() => remove(p.id)} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={open} onClose={() => setOpen(false)} size="lg" title={L('కథనంలో చిత్రం చొప్పించండి', 'Insert a picture in the story')}>
        <div className="space-y-4">
          <FileDrop
            accept={ACCEPT}
            disabled={upload.isPending}
            label={upload.isPending ? t('ui.uploading') : undefined}
            hint={L('JPEG, PNG లేదా WebP — 15MB లోపు', 'JPEG, PNG or WebP — under 15MB')}
            onFiles={(files) => {
              const file = files[0];
              if (file) upload.mutate(file);
            }}
          />
          <Input leading={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ui.search')} aria-label={t('ui.search')} />
          <QueryState
            query={library}
            isEmpty={(d) => d.items.length === 0}
            skeleton={
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} variant="image" ratio="4/3" />
                ))}
              </div>
            }
            empty={
              <EmptyState
                compact
                icon={ImageOff}
                title={L('లైబ్రరీ ఖాళీగా ఉంది', 'The library is empty')}
                body={L('పైన కొత్త చిత్రం అప్‌లోడ్ చేయండి.', 'Upload a new image above.')}
              />
            }
          >
            {(data) => {
              const items = data.items.filter(
                (item) =>
                  !needle ||
                  (item.alt_te ?? '').toLowerCase().includes(needle) ||
                  (item.credit ?? '').toLowerCase().includes(needle),
              );
              if (!items.length) return <EmptyState compact icon={SearchX} title={t('state.noResults')} />;
              return (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Tile
                        item={item}
                        reveal={reveal}
                        onClick={() => add(toRef(item))}
                        selected={placed.some((p) => p.id === String(item.id))}
                      />
                    </li>
                  ))}
                </ul>
              );
            }}
          </QueryState>
        </div>
      </Dialog>
    </div>
  );
}
