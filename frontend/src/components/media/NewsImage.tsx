import { Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import type { MediaOut } from '@/types/public';
import { cn } from '@/utils/cn';

/**
 * The single image component for the whole reader site.
 *
 * It carries four requirements that are easy to get wrong if each page rolls
 * its own `<img>`:
 *
 *  §10.3  The box reserves its space before the file arrives (aspect-ratio +
 *         width/height), so images never shift the layout. CLS target < 0.1.
 *         The wrapper declares `aspect-ratio` unconditionally — placeholder,
 *         loading and loaded states all occupy the same box.
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
  /** Corner radius: the card ladder default, or `2xl` for heroes. */
  radius?: 'xl' | '2xl';
  className?: string;
  /** Eager-load the LCP image (the lead story hero); everything else is lazy. */
  priority?: boolean;
  /** Fallback label shown when no image exists yet. */
  placeholderLabel?: string;
  /** Render the AI label. Defaults to the media's own flag. */
  showAiLabel?: boolean;
}

const RADIUS = { xl: 'rounded-xl', '2xl': 'rounded-2xl' } as const;

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
  radius = 'xl',
  className = '',
  priority = false,
  placeholderLabel,
  showAiLabel,
}: Props) {
  const { t } = useI18n();
  const s = useScript();
  const [loaded, setLoaded] = useState(false);
  // A 404 or a blocked host would otherwise leave the <img> at opacity-0
  // forever; failing over to the placeholder is the honest empty state.
  const [failed, setFailed] = useState(false);
  const tint = blurhashTint(media?.blurhash);
  const showAi = showAiLabel ?? media?.ai_generated ?? false;

  // React 18 forwards unknown props verbatim, so the LCP hint must use the
  // lowercase HTML attribute name. React 19 accepts the camelCase `fetchPriority`
  // — change this when the app moves to 19.
  const priorityAttrs: Record<string, string> = priority ? { fetchpriority: 'high' } : {};

  return (
    <div
      className={cn('relative overflow-hidden bg-placeholder', RADIUS[radius], className)}
      style={{ aspectRatio: ratio, backgroundColor: tint }}
    >
      {media?.url && !failed ? (
        <>
          <img
            src={media.url}
            {...(media.srcset ? { srcSet: media.srcset } : {})}
            sizes={sizes}
            // An empty alt means "decorative"; a captioned news photo is not.
            alt={media.alt_te ?? media.caption_te ?? ''}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            loading={priority ? 'eager' : 'lazy'}
            // The LCP image should not wait behind other decodes.
            decoding={priority ? 'sync' : 'async'}
            {...priorityAttrs}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              'h-full w-full object-cover transition-opacity duration-slow ease-standard',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
          {showAi ? (
            // §7.4 — "The frontend renders a visible 'AI రూపొందించిన చిత్రం'
            // label on the image itself and in the caption. Non-optional."
            <Badge tone="ai" size="xs" className="absolute bottom-2 left-2 shadow-card">
              {t('article.aiImage')}
            </Badge>
          ) : null}
        </>
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center text-placeholder-text">
          <Icon icon={ImageIcon} size="md" />
          <span className={cn(s.body, 'text-meta')}>{placeholderLabel ?? t('state.photo')}</span>
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
  const { t } = useI18n();
  const s = useScript();
  if (!media || (!media.caption_te && !media.credit)) return null;

  const credit = media.credit ? (
    media.source_url ? (
      <a
        href={media.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink-soft underline decoration-dotted underline-offset-2 transition-colors duration-base ease-standard hover:text-brand"
      >
        {media.credit}
      </a>
    ) : (
      <span className="text-ink-soft">{media.credit}</span>
    )
  ) : null;

  return (
    // `.reader-caption` carries the reader scale (13px * --reader-scale); `.te`
    // carries the Telugu line-height. A fixed text-meta here froze every photo
    // caption in the article column at 12.5px.
    <figcaption lang="te" className="te reader-caption mt-1.5 text-muted">
      {media.caption_te}
      {credit ? (
        <span className={media.caption_te ? 'ml-1' : ''}>
          {media.caption_te ? '· ' : ''}
          {t('article.photoBy')}: {credit}
        </span>
      ) : null}
      {media.ai_generated ? (
        <span className={cn(s.body, 'ml-1 font-semibold text-ai-text')}>· {t('article.aiImage')}</span>
      ) : null}
    </figcaption>
  );
}
