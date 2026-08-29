import { useState } from 'react';

import { useI18n } from '@/i18n';
import type { MediaOut } from '@/types/public';

/**
 * The single image component for the whole reader site.
 *
 * It carries four requirements that are easy to get wrong if each page rolls
 * its own `<img>`:
 *
 *  §10.3  The box reserves its space before the file arrives (aspect-ratio +
 *         width/height), so images never shift the layout. CLS target < 0.1.
 *  §10.3  `srcset` + `sizes` let the browser pick one of the four §7.4 widths.
 *         A 120px thumbnail must not download the 1600px rendition — on the
 *         patchy district 4G we target, that is the difference between a page
 *         that loads and one that does not.
 *  §7.4   An AI-generated image renders a visible Telugu label. Non-optional.
 *  §12.5  Photo credit is displayed wherever a caption is shown.
 *
 * The blurhash is used as a cheap tinted placeholder rather than decoded into a
 * canvas: decoding costs main-thread time on exactly the low-end devices the
 * placeholder is meant to help.
 */

interface Props {
  media: MediaOut | null | undefined;
  /** CSS aspect-ratio for the reserved box, e.g. "16/9". */
  ratio?: string;
  /** `sizes` hint — tell the browser how wide this slot actually renders. */
  sizes?: string;
  className?: string;
  /** Eager-load the LCP image (the lead story hero); everything else is lazy. */
  priority?: boolean;
  /** Fallback label shown when no image exists yet. */
  placeholderLabel?: string;
  /** Render the AI label. Defaults to the media's own flag. */
  showAiLabel?: boolean;
}

/** Average colour extracted from a blurhash, used as the placeholder tint. */
function blurhashTint(hash: string | null | undefined): string | undefined {
  if (!hash || hash.length < 6) return undefined;
  // Characters 2-6 encode the DC (average colour) in base83.
  const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
  let value = 0;
  for (let i = 2; i < 6; i += 1) {
    const idx = B83.indexOf(hash[i] ?? '');
    if (idx < 0) return undefined;
    value = value * 83 + idx;
  }
  const srgb = (v: number) => {
    const c = v / 255;
    return Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255);
  };
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  // The DC is stored linear; convert back so the tint matches the image.
  return `rgb(${srgb(r)}, ${srgb(g)}, ${srgb(b)})`;
}

export function NewsImage({
  media,
  ratio = '16/9',
  sizes = '100vw',
  className = '',
  priority = false,
  placeholderLabel,
  showAiLabel,
}: Props) {
  const { t, language } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const tint = blurhashTint(media?.blurhash);
  const showAi = showAiLabel ?? media?.ai_generated ?? false;

  // React 18 forwards unknown props verbatim, so the LCP hint must use the
  // lowercase HTML attribute name. React 19 accepts the camelCase `fetchPriority`
  // — change this when the app moves to 19.
  const priorityAttrs: Record<string, string> = priority ? { fetchpriority: 'high' } : {};

  return (
    <div
      className={`relative overflow-hidden bg-placeholder ${className}`}
      style={{ aspectRatio: ratio, backgroundColor: tint }}
    >
      {media?.url ? (
        <>
          <img
            src={media.url}
            {...(media.srcset ? { srcSet: media.srcset } : {})}
            sizes={sizes}
            alt={media.alt_te ?? ''}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            loading={priority ? 'eager' : 'lazy'}
            // The LCP image should not wait behind other decodes.
            decoding={priority ? 'sync' : 'async'}
            {...priorityAttrs}
            onLoad={() => setLoaded(true)}
            className={[
              'h-full w-full object-cover transition-opacity duration-300',
              loaded ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          />
          {showAi ? (
            // §7.4 — "The frontend renders a visible 'AI రూపొందించిన చిత్రం'
            // label on the image itself and in the caption. Non-optional."
            <span
              className={`${language === 'te' ? 'te' : 'font-sans'} absolute bottom-1.5 left-1.5 rounded-[3px] bg-ai/95 px-1.5 py-0.5 text-[9px] font-bold leading-[1.4] text-white`}
            >
              {t('article.aiImage')}
            </span>
          ) : null}
        </>
      ) : (
        <span className="te absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-placeholder-text">
          {placeholderLabel ?? t('state.photo')}
        </span>
      )}
    </div>
  );
}

/**
 * Caption + credit line.
 *
 * §12.5 makes credit mandatory when the source is not our own. For CC-licensed
 * photographs the licence additionally requires naming the creator and linking
 * back to the original where practical — so when the media carries a
 * `source_url`, the credit becomes a real link rather than plain text.
 */
export function ImageCaption({ media }: { media: MediaOut | null | undefined }) {
  const { t, language } = useI18n();
  if (!media || (!media.caption_te && !media.credit)) return null;

  const credit = media.credit ? (
    media.source_url ? (
      <a
        href={media.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-exclusive underline decoration-dotted underline-offset-2 hover:text-brand"
      >
        {media.credit}
      </a>
    ) : (
      <span className="text-exclusive">{media.credit}</span>
    )
  ) : null;

  return (
    <figcaption className="te mt-1.5 text-[11px] leading-telugu text-muted-light">
      {media.caption_te}
      {credit ? (
        <span className={media.caption_te ? 'ml-1' : ''}>
          {media.caption_te ? '· ' : ''}
          {t('article.photoBy')}: {credit}
        </span>
      ) : null}
      {media.ai_generated ? (
        <span className={`${language === 'te' ? 'te' : 'font-sans'} ml-1 font-semibold text-ai`}>
          · {t('article.aiImage')}
        </span>
      ) : null}
    </figcaption>
  );
}
