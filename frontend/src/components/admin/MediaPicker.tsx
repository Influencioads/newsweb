import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import * as cmsApi from '@/features/cms/api';
import type { CmsMediaRef } from '@/types/cms';

/**
 * §1 hero image and gallery.
 *
 * Two ways in, because both are real newsroom habits: pick from the library
 * (a photographer already uploaded it) or upload right here (the reporter has
 * it on their phone). Uploading adds to the library too, so the two paths do
 * not diverge.
 */
interface LibraryItem { id: number; url: string; alt_te: string | null; credit: string | null; width: number | null; height: number | null }

function Thumb({
  item, selected, onClick, label,
}: { item: { url: string; alt_te: string | null }; selected?: boolean; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative aspect-[4/3] overflow-hidden rounded border-2 transition ${
        selected ? 'border-brand' : 'border-rule hover:border-brand/60'
      }`}
    >
      <img src={item.url} alt={item.alt_te ?? ''} loading="lazy" className="h-full w-full object-cover" />
      {label ? (
        <span className="absolute bottom-0 left-0 right-0 bg-ink/70 px-1 py-0.5 font-sans text-[10px] font-bold text-white">
          {label}
        </span>
      ) : null}
    </button>
  );
}

export function MediaPicker({
  heroId, hero, gallery, onHeroChange, onGalleryChange,
}: {
  heroId: number | null;
  hero: CmsMediaRef | null;
  gallery: CmsMediaRef[];
  onHeroChange: (media: CmsMediaRef | null) => void;
  onGalleryChange: (items: CmsMediaRef[]) => void;
}) {
  const [open, setOpen] = useState<'hero' | 'gallery' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<'hero' | 'gallery'>('hero');

  const library = useQuery({
    queryKey: ['cms', 'media-library'],
    queryFn: () => cmsApi.fetchManagement<{ items: LibraryItem[] }>('media'),
    enabled: open !== null,
  });

  const upload = useMutation({
    mutationFn: (file: File) => cmsApi.uploadMedia(file),
    onSuccess: (media) => {
      const ref: CmsMediaRef = {
        id: media.id, url: media.url, alt_te: media.alt_te ?? null,
        credit: media.credit ?? null, width: media.width ?? null, height: media.height ?? null,
      };
      if (uploadTarget === 'hero') onHeroChange(ref);
      else onGalleryChange([...gallery, ref]);
      void library.refetch();
    },
  });

  function pick(item: LibraryItem) {
    const ref: CmsMediaRef = {
      id: item.id, url: item.url, alt_te: item.alt_te, credit: item.credit,
      width: item.width, height: item.height,
    };
    if (open === 'hero') { onHeroChange(ref); setOpen(null); }
    else if (!gallery.some((g) => g.id === ref.id)) onGalleryChange([...gallery, ref]);
  }

  return (
    <div className="space-y-5">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }}
      />

      {/* -------------------------------------------------------- hero -- */}
      <div>
        <span className="te mb-1.5 block text-[12px] font-bold text-ink">ప్రధాన చిత్రం · Main image</span>
        {hero || heroId ? (
          <div className="flex items-start gap-3">
            <div className="w-40 shrink-0">
              {hero ? <Thumb item={hero} selected /> : <div className="aspect-[4/3] rounded border border-rule bg-canvas" />}
            </div>
            <div className="space-y-1.5">
              {hero?.credit ? <p className="te text-[11.5px] text-muted">క్రెడిట్: {hero.credit}</p> : null}
              <button type="button" onClick={() => onHeroChange(null)}
                className="te rounded-control border border-rule px-2.5 py-1 text-[11.5px] font-semibold text-breaking">
                తీసివేయండి
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen('hero')}
              className="te min-h-[34px] rounded-control border border-rule bg-white px-3 text-[12.5px] font-semibold text-ink dark:bg-surface">
              లైబ్రరీ నుంచి ఎంచుకోండి
            </button>
            <button type="button" disabled={upload.isPending}
              onClick={() => { setUploadTarget('hero'); fileInput.current?.click(); }}
              className="te min-h-[34px] rounded-control border border-brand px-3 text-[12.5px] font-bold text-brand disabled:opacity-50">
              {upload.isPending && uploadTarget === 'hero' ? 'అప్‌లోడ్…' : 'కొత్తది అప్‌లోడ్'}
            </button>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------- gallery -- */}
      <div>
        <span className="te mb-1.5 block text-[12px] font-bold text-ink">
          ఫోటో గ్యాలరీ · Gallery <span className="font-normal text-muted">({gallery.length})</span>
        </span>
        {gallery.length > 0 ? (
          <div className="mb-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {gallery.map((g, index) => (
              <div key={g.id} className="relative">
                <Thumb item={g} label={`${index + 1}`} />
                <button
                  type="button"
                  aria-label="గ్యాలరీ నుంచి తీసివేయండి"
                  onClick={() => onGalleryChange(gallery.filter((x) => x.id !== g.id))}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-breaking font-sans text-[11px] font-bold leading-none text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen('gallery')}
            className="te min-h-[32px] rounded-control border border-rule bg-white px-3 text-[12px] font-semibold text-ink dark:bg-surface">
            లైబ్రరీ నుంచి జోడించండి
          </button>
          <button type="button" disabled={upload.isPending}
            onClick={() => { setUploadTarget('gallery'); fileInput.current?.click(); }}
            className="te min-h-[32px] rounded-control border border-brand px-3 text-[12px] font-bold text-brand disabled:opacity-50">
            అప్‌లోడ్
          </button>
        </div>
      </div>

      {upload.isError ? (
        <p className="te text-[12px] text-breaking">
          అప్‌లోడ్ విఫలమైంది — JPEG/PNG/WebP మాత్రమే, 15MB లోపు.
        </p>
      ) : null}

      {/* ------------------------------------------------------ browser -- */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-card bg-white shadow-card dark:bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h3 className="th text-[15px] font-bold text-ink">
                {open === 'hero' ? 'ప్రధాన చిత్రం ఎంచుకోండి' : 'గ్యాలరీకి చిత్రాలు జోడించండి'}
              </h3>
              <button type="button" onClick={() => setOpen(null)}
                className="font-sans text-[13px] font-bold text-muted">మూసివేయండి</button>
            </div>
            <div className="grid flex-1 grid-cols-3 gap-2 overflow-y-auto p-4 sm:grid-cols-5">
              {(library.data?.items ?? []).map((item) => (
                <Thumb key={item.id} item={item} onClick={() => pick(item)}
                  selected={open === 'gallery' && gallery.some((g) => g.id === item.id)} />
              ))}
              {library.isLoading ? <p className="te col-span-full text-[12.5px] text-muted">లోడ్ అవుతోంది…</p> : null}
              {library.data && library.data.items.length === 0 ? (
                <p className="te col-span-full text-[12.5px] text-muted">లైబ్రరీ ఖాళీగా ఉంది. కొత్త చిత్రం అప్‌లోడ్ చేయండి.</p>
              ) : null}
            </div>
            {open === 'gallery' ? (
              <div className="border-t border-rule px-4 py-3 text-right">
                <button type="button" onClick={() => setOpen(null)}
                  className="te min-h-[34px] rounded-control bg-brand px-4 text-[13px] font-bold text-white">
                  పూర్తయింది
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
