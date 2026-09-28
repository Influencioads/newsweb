import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ImageOff, ImagePlus, Search, SearchX, Sparkles, Trash2, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, FileDrop, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { CmsMediaRef } from '@/types/cms';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

/**
 * §1 hero image and gallery.
 *
 * Three ways in, because all three are real newsroom habits: pick from the
 * library (a photographer already uploaded it), upload right here (the reporter
 * has it on their phone), or ask a provider to draw one (§17 — there is no
 * photograph of a budget announcement, and the desk would otherwise publish
 * with no art). All three live in one Dialog — a FileDrop above a searchable
 * grid — and every one of them adds to the library, so the paths never diverge.
 *
 * Generation is deliberately the third option and not the first: it needs a
 * saved article to bill and attribute against, so without `articleId` the
 * button is simply absent rather than present and broken.
 */

type Target = 'hero' | 'gallery';

interface LibraryItem {
  id: number;
  url: string;
  alt_te: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
  /** §7.4 — an AI image carries a visible label wherever it is shown, and the
   *  picker grid is where an editor decides whether to run one on page one. */
  ai_generated?: boolean;
}

const toRef = (m: LibraryItem): CmsMediaRef => ({
  id: m.id,
  url: m.url,
  alt_te: m.alt_te ?? null,
  credit: m.credit ?? null,
  width: m.width ?? null,
  height: m.height ?? null,
});

const ACCEPT = 'image/jpeg,image/png,image/webp';

function Tile({
  item,
  selected,
  onClick,
  reveal,
}: {
  item: LibraryItem;
  selected: boolean;
  onClick: () => void;
  reveal: (el: HTMLButtonElement | null) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      ref={reveal}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={item.alt_te ?? `#${item.id}`}
      className={cn(
        'relative block w-full overflow-hidden rounded-xl border-2 bg-placeholder shadow-card',
        'transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:-translate-y-0.5 hover:shadow-raised active:scale-[.98]',
        selected ? 'border-brand' : 'border-rule hover:border-brand',
      )}
    >
      <img src={item.url} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
      {selected ? (
        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-pill bg-brand text-on-brand">
          <Icon icon={Check} size="xs" strokeWidth={3} />
        </span>
      ) : null}
      {item.ai_generated ? (
        <span className="absolute bottom-1 left-1 rounded-pill bg-overlay/70 px-2 font-sans text-meta font-bold text-on-ink">
          {t('article.aiImage')}
        </span>
      ) : null}
    </button>
  );
}

export interface MediaPickerProps {
  heroId: number | null;
  hero: CmsMediaRef | null;
  gallery: CmsMediaRef[];
  onHeroChange: (media: CmsMediaRef | null) => void;
  onGalleryChange: (items: CmsMediaRef[]) => void;
  /** Absent on the new-article form, where nothing has been saved yet. The
   *  generate button is not rendered without it. */
  articleId?: number;
}

export function MediaPicker({ heroId, hero, gallery, onHeroChange, onGalleryChange, articleId }: MediaPickerProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [open, setOpen] = useState<Target | null>(null);
  const [q, setQ] = useState('');
  const [brief, setBrief] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reveal = useReveal<HTMLButtonElement>();

  const library = useQuery({
    queryKey: ['cms', 'media-library'],
    queryFn: () => cmsApi.fetchManagement<{ items: LibraryItem[] }>('media'),
    enabled: open !== null,
  });

  const upload = useMutation({
    mutationFn: ({ file }: { file: File; target: Target }) => cmsApi.uploadMedia(file),
    onSuccess: (media, { target }) => {
      const ref = toRef(media);
      if (target === 'hero') {
        onHeroChange(ref);
        setOpen(null);
      } else {
        onGalleryChange([...gallery, ref]);
      }
      void library.refetch();
    },
    onError: () => toast.error(L('అప్‌లోడ్ విఫలమైంది — JPEG/PNG/WebP మాత్రమే, 15MB లోపు.', 'Upload failed — JPEG, PNG or WebP only, under 15MB.')),
  });

  const generate = useMutation({
    mutationFn: () => cmsApi.generateArticleImage(articleId as number, brief.trim()),
    onSuccess: (result) => {
      // `available:false` is an answer, not a throw — the reason stays on
      // screen and the dialog stays open so the editor can edit the brief.
      if (!result.media) return;
      // An illustration has no photographer, so the endpoint sends no credit.
      onHeroChange({ ...result.media, credit: null });
      setOpen(null);
      setBriefOpen(false);
      setBrief('');
      void library.refetch();
    },
    onError: (e) => {
      if (!(e instanceof ApiError && e.status === 422)) toast.error(e);
    },
  });
  // A 422 is the sensitive-topic screen refusing before any call was made.
  // It is the feature working, so it is shown in place and in Telugu rather
  // than thrown at the editor as a red toast.
  const refusal = generate.error instanceof ApiError && generate.error.status === 422 ? generate.error.displayMessage : null;

  function pick(item: LibraryItem) {
    const ref = toRef(item);
    if (open === 'hero') {
      onHeroChange(ref);
      setOpen(null);
    } else if (!gallery.some((g) => g.id === ref.id)) {
      onGalleryChange([...gallery, ref]);
    }
  }

  const label = cn(s.body, 'block text-ui-sm font-semibold text-ink');
  const needle = q.trim().toLowerCase();
  const matches = (item: LibraryItem) =>
    !needle || (item.alt_te ?? '').toLowerCase().includes(needle) || (item.credit ?? '').toLowerCase().includes(needle);

  return (
    <div className="space-y-5">
      {/* -------------------------------------------------------- hero -- */}
      <div className="space-y-2">
        <span className={label}>{L('ప్రధాన చిత్రం', 'Main image')}</span>
        {hero || heroId ? (
          <div className="flex items-start gap-3">
            {hero ? (
              <img src={hero.url} alt={hero.alt_te ?? ''} className="aspect-[4/3] w-40 shrink-0 rounded-xl border border-rule object-cover" />
            ) : (
              <div aria-hidden className="aspect-[4/3] w-40 shrink-0 rounded-xl border border-rule bg-placeholder" />
            )}
            <div className="min-w-0 space-y-2">
              {hero?.credit ? (
                <p className={cn(s.body, 'text-meta text-muted')}>
                  {L('క్రెడిట్:', 'Credit:')} {hero.credit}
                </p>
              ) : null}
              {/* Where an imported photo came from and what the page will
                  print under it. Without this an open-licence Commons photo
                  looks exactly like a staff photograph to the approver. */}
              {hero?.licence ? (
                <p className={cn(s.body, 'text-meta text-muted')}>
                  {L('లైసెన్స్:', 'Licence:')} {hero.licence}
                  {hero.source_type ? ` · ${hero.source_type}` : ''}
                </p>
              ) : null}
              {hero?.caption_te ? (
                <p lang="te" className={cn(s.body, 'te text-meta text-muted')}>
                  {L('శీర్షిక:', 'Caption:')} {hero.caption_te}
                </p>
              ) : null}
              <Button variant="secondary" size="sm" icon={Trash2} onClick={() => onHeroChange(null)}>
                {t('ui.remove')}
              </Button>
            </div>
          </div>
        ) : null}
        <Button variant="secondary" size="sm" icon={ImagePlus} onClick={() => setOpen('hero')}>
          {hero ? L('మార్చండి', 'Replace') : L('ఎంచుకోండి లేదా అప్‌లోడ్ చేయండి', 'Choose or upload')}
        </Button>
      </div>

      {/* ----------------------------------------------------- gallery -- */}
      <div className="space-y-2">
        <span className={label}>
          {L('ఫోటో గ్యాలరీ', 'Gallery')} <span className="font-normal text-muted">({gallery.length})</span>
        </span>
        {gallery.length > 0 ? (
          <ul className="grid grid-cols-3 gap-3">
            {gallery.map((g, index) => (
              <li key={g.id} className="relative">
                <img src={g.url} alt={g.alt_te ?? ''} loading="lazy" className="aspect-[4/3] w-full rounded-xl border border-rule object-cover" />
                <span aria-hidden className="absolute bottom-1 left-1 rounded-pill bg-overlay/70 px-2 font-sans text-meta font-bold text-on-ink">
                  {index + 1}
                </span>
                <IconButton
                  icon={X}
                  label={`${t('ui.remove')} ${index + 1}`}
                  variant="secondary"
                  iconSize="sm"
                  className="absolute -right-2 -top-2 shadow-card"
                  onClick={() => onGalleryChange(gallery.filter((x) => x.id !== g.id))}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <Button variant="secondary" size="sm" icon={ImagePlus} onClick={() => setOpen('gallery')}>
          {L('చిత్రాలు జోడించండి', 'Add images')}
        </Button>
      </div>

      {/* ------------------------------------------------------ browser -- */}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        size="lg"
        title={open === 'hero' ? L('ప్రధాన చిత్రం ఎంచుకోండి', 'Choose the main image') : L('గ్యాలరీకి చిత్రాలు జోడించండి', 'Add images to the gallery')}
        initialFocusRef={searchRef}
        footer={open === 'gallery' ? <Button onClick={() => setOpen(null)}>{t('ui.done')}</Button> : undefined}
      >
        <div className="space-y-4">
          <FileDrop
            accept={ACCEPT}
            disabled={upload.isPending}
            label={upload.isPending ? t('ui.uploading') : undefined}
            hint={L('JPEG, PNG లేదా WebP — 15MB లోపు', 'JPEG, PNG or WebP — under 15MB')}
            onFiles={(files) => {
              const file = files[0];
              if (file && open) upload.mutate({ file, target: open });
            }}
          />
          {/* ---------------------------------------------- §17 generate -- */}
          {open === 'hero' && articleId ? (
            <div className="space-y-3 rounded-xl border border-rule bg-canvas p-3">
              {briefOpen ? (
                <>
                  <Field
                    label={L('ఏమి గీయాలో రాయండి', 'Describe the illustration')}
                    hint={L(
                      'కథనం సారాంశం ఒక్క వాక్యంలో. ఉన్న వ్యక్తుల ఫోటోలు తయారు చేయబడవు.',
                      'One sentence about the story. Photoreal images of real people are never made.',
                    )}
                  >
                    <Input
                      value={brief}
                      onChange={(e) => setBrief(e.target.value)}
                      disabled={generate.isPending}
                      placeholder={L('ఉదా: రాష్ట్ర బడ్జెట్ ప్రసంగం', 'e.g. a state budget announcement')}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      icon={Sparkles}
                      pending={generate.isPending}
                      disabled={!brief.trim() || generate.isPending}
                      onClick={() => generate.mutate()}
                    >
                      {generate.isPending ? t('ui.generating') : t('ui.generate')}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={generate.isPending} onClick={() => setBriefOpen(false)}>
                      {t('ui.cancel')}
                    </Button>
                  </div>
                  {/* Four to eleven seconds, measured. A wordless spinner that
                      long reads as a hang, so the wait says what it is. */}
                  {generate.isPending ? (
                    <p role="status" className={cn(s.body, 'text-meta text-muted')}>
                      {L(
                        'చిత్రం తయారవుతోంది — సాధారణంగా 5–10 సెకన్లు. ఈ విండో మూసివేయకండి.',
                        'Drawing the picture — usually five to ten seconds. Leave this window open.',
                      )}
                    </p>
                  ) : null}
                  {refusal ? (
                    <p role="alert" className={cn(s.body, 'text-meta text-partial')}>
                      {refusal}
                    </p>
                  ) : null}
                  {generate.data && !generate.data.available && generate.data.reason ? (
                    <p role="alert" className={cn(s.body, 'text-meta text-partial')}>
                      {generate.data.reason}
                    </p>
                  ) : null}
                </>
              ) : (
                <Button variant="secondary" size="sm" icon={Sparkles} onClick={() => setBriefOpen(true)}>
                  {L('AI చిత్రం తయారు చేయండి', 'Generate an image')}
                </Button>
              )}
            </div>
          ) : null}
          <Input ref={searchRef} leading={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ui.search')} aria-label={t('ui.search')} />
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
              const items = data.items.filter(matches);
              if (!items.length) return <EmptyState compact icon={SearchX} title={t('state.noResults')} />;
              return (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Tile
                        item={item}
                        reveal={reveal}
                        onClick={() => pick(item)}
                        selected={open === 'gallery' ? gallery.some((g) => g.id === item.id) : hero?.id === item.id}
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
