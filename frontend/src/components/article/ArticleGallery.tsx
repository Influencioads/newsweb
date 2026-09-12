import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { ImageCaption, NewsImage } from '@/components/media/NewsImage';
import { IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { SectionHeader } from '@/components/ui/Layout';
import { useI18n, useScript } from '@/i18n';
import type { MediaOut } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * Photo gallery for an article (`article_media.role = 'gallery'`).
 *
 * Thumbnails open a lightbox built on `Dialog`, so the focus trap, Escape,
 * scroll lock and focus restore are the app's one implementation rather than a
 * second one grown here. On top of that the lightbox adds what a photo viewer
 * needs: 44px prev/next buttons, arrow keys, and a pointer swipe for phones.
 *
 * Every frame keeps its Telugu caption and §12.5 credit visible; a photo whose
 * credit only appears on hover is a credit nobody reads.
 */

interface Props {
  images: MediaOut[];
  title?: string;
}

/** Below this many pixels a horizontal drag is a tap, not a swipe. */
const SWIPE_PX = 48;

export function ArticleGallery({ images, title }: Props) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const { t, language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const heading = title ?? t('article.gallery');
  const swipeFrom = useRef<number | null>(null);

  const close = useCallback(() => setOpenAt(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenAt((current) =>
        current === null ? null : (current + delta + images.length) % images.length,
      ),
    [images.length],
  );

  // Arrows are listened for on the document: the focus may sit on the Dialog's
  // own close button, which is outside this component's subtree.
  useEffect(() => {
    if (openAt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openAt, step]);

  if (images.length === 0) return null;

  const active = openAt === null ? null : images[openAt];

  return (
    <section className="mt-8">
      <SectionHeader title={heading} level={3} />

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              aria-label={`${image.caption_te ?? t('state.photo')} — ${t('gallery.enlarge')}`}
              className="group block w-full rounded-xl text-left transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:-translate-y-0.5 active:scale-[.98]"
            >
              <NewsImage
                media={image}
                ratio="4/3"
                sizes="(max-width: 640px) 50vw, 220px"
                className="group-hover:shadow-raised"
              />
              {image.caption_te ? (
                <p lang="te" className="te te-clamp-2 mt-2 text-te-body-xs text-muted">
                  {image.caption_te}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={active !== null}
        onClose={close}
        title={heading}
        sheetOnMobile={false}
        closeLabel={t('gallery.close')}
        className="md:max-w-4xl"
      >
        {active ? (
          <figure
            className="flex flex-col items-center"
            onPointerDown={(e) => {
              swipeFrom.current = e.clientX;
            }}
            onPointerUp={(e) => {
              const from = swipeFrom.current;
              swipeFrom.current = null;
              if (from === null || images.length < 2) return;
              const delta = e.clientX - from;
              if (Math.abs(delta) >= SWIPE_PX) step(delta < 0 ? 1 : -1);
            }}
          >
            <img
              src={active.url ?? ''}
              {...(active.srcset ? { srcSet: active.srcset } : {})}
              sizes="(max-width: 1024px) 100vw, 900px"
              alt={active.alt_te ?? ''}
              className="max-h-[60vh] w-auto select-none rounded-xl bg-placeholder object-contain"
            />
            <div className="mt-4 flex w-full items-center justify-between gap-3">
              <IconButton
                icon={ChevronLeft}
                label={t('gallery.previous')}
                onClick={() => step(-1)}
                disabled={images.length < 2}
              />
              {/* role="status": prev/next (and the document-level arrow keys)
                  swap the photo and its caption with no other announcement. */}
              <p role="status" lang={language} className={cn(s.body, 'text-meta tabular-nums text-muted')}>
                {L(`ఫోటో ${(openAt ?? 0) + 1} / ${images.length}`, `Photo ${(openAt ?? 0) + 1} of ${images.length}`)}
              </p>
              <IconButton
                icon={ChevronRight}
                label={t('gallery.next')}
                onClick={() => step(1)}
                disabled={images.length < 2}
              />
            </div>
            <ImageCaption media={active} />
          </figure>
        ) : null}
      </Dialog>
    </section>
  );
}
