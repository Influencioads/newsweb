import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { NewsImage } from '@/components/media/NewsImage';
import { useI18n } from '@/i18n';
import type { MediaOut } from '@/types/public';

/**
 * Photo gallery for an article (`article_media.role = 'gallery'`).
 *
 * Thumbnails open a lightbox. The lightbox is keyboard-driven — arrows move,
 * Escape closes — because a photo strip that can only be used with a mouse
 * fails the accessibility bar the brief sets in §1.
 *
 * Every frame keeps its Telugu caption and §12.5 credit visible; a photo whose
 * credit only appears on hover is a credit nobody reads.
 */

interface Props {
  images: MediaOut[];
  title?: string;
}

export function ArticleGallery({ images, title }: Props) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const { t, language } = useI18n();
  const script = language === 'te' ? 'te' : 'font-sans';
  const heading = title ?? t('article.gallery');

  const close = useCallback(() => setOpenAt(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenAt((current) =>
        current === null ? null : (current + delta + images.length) % images.length,
      ),
    [images.length],
  );

  useEffect(() => {
    if (openAt === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    }
    document.addEventListener('keydown', onKey);
    // Stop the page scrolling behind the lightbox.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [openAt, close, step]);

  if (images.length === 0) return null;

  const active = openAt === null ? null : images[openAt];

  return (
    <section className="mt-6 border-t-2 border-ink pt-3">
      <h2
        className={`${language === 'te' ? 'th' : 'font-sans'} mb-3 text-[16px] font-bold text-brand`}
      >
        {heading}
      </h2>

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              aria-label={`${image.caption_te ?? t('state.photo')} — ${t('gallery.enlarge')}`}
              className="group block w-full text-left focus-visible:outline-2 focus-visible:outline-brand"
            >
              <NewsImage
                media={image}
                ratio="4/3"
                sizes="(max-width: 640px) 50vw, 220px"
                className="rounded-[4px] transition-opacity group-hover:opacity-90"
              />
              {image.caption_te ? (
                <p className="te te-clamp-2 mt-1.5 text-[11.5px] leading-telugu text-muted">
                  {image.caption_te}
                </p>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.caption_te ?? t('state.photo')}
          className="fixed inset-0 z-50 flex flex-col bg-ink-deep/95 p-4"
          onClick={close}
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              aria-label={t('gallery.close')}
              className="flex h-tap w-tap items-center justify-center rounded text-white/80 hover:text-white"
            >
              <X className="h-6 w-6" aria-hidden />
            </button>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {images.length > 1 ? (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t('gallery.previous')}
                className="flex h-tap w-tap shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden />
              </button>
            ) : null}

            <figure className="flex min-h-0 max-w-4xl flex-col">
              <img
                src={active.url ?? ''}
                {...(active.srcset ? { srcSet: active.srcset } : {})}
                sizes="(max-width: 1024px) 100vw, 900px"
                alt={active.alt_te ?? ''}
                className="max-h-[70vh] w-auto rounded object-contain"
              />
              <figcaption className="te mt-3 text-center text-[12.5px] leading-telugu text-white/85">
                {active.caption_te}
                {active.credit ? (
                  <span className="ml-1 text-white/60">
                    · {t('article.photoBy')}: {active.credit}
                  </span>
                ) : null}
                {active.ai_generated ? (
                  <span className={`${script} ml-1 font-semibold text-[#B9A6EE]`}>
                    · {t('article.aiImage')}
                  </span>
                ) : null}
                <span className="ml-2 font-sans text-white/50">
                  {(openAt ?? 0) + 1} / {images.length}
                </span>
              </figcaption>
            </figure>

            {images.length > 1 ? (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t('gallery.next')}
                className="flex h-tap w-tap shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <ChevronRight className="h-6 w-6" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
