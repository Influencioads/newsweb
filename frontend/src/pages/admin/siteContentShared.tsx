import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImageUp, RotateCcw, Trash2 } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { cn } from '@/utils/cn';

import { useL } from './useL';

/**
 * Shared bits for CMS → Site content and CMS → Footer pages: list editing
 * (move / remove), the picture field, and the slug rule the API checks.
 */

/** `Morning Mantra!` -> `morning-mantra`; Telugu-only text gives ''. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** A slug for `wanted` not already in `taken`: wanted, wanted-2, wanted-3, … */
export function uniqueSlug(wanted: string, taken: Set<string>, fallback: string): string {
  const base = wanted || fallback;
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

/** Up / down / remove for one row of an editable list. */
export function RowActions({
  index,
  count,
  onMove,
  onRemove,
  minCount = 1,
  disabled,
}: {
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  minCount?: number;
  disabled?: boolean;
}) {
  const L = useL();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton icon={ArrowUp} variant="ghost" label={L('పైకి', 'Move up')} disabled={disabled || index === 0} onClick={() => onMove(-1)} />
      <IconButton icon={ArrowDown} variant="ghost" label={L('కిందికి', 'Move down')} disabled={disabled || index === count - 1} onClick={() => onMove(1)} />
      <IconButton icon={Trash2} variant="ghost" label={L('తొలగించండి', 'Remove')} disabled={disabled || count <= minCount} onClick={onRemove} />
    </div>
  );
}

/**
 * Our own upload as a /media/... path: the site serves it on its own address
 * (and the API accepts only that or an https address).
 */
export function ownMediaPath(url: string): string {
  const path = new URL(url, window.location.origin).pathname;
  return path.startsWith('/media/') ? path : url;
}

/**
 * A picture the desk uploads (to the media library) or leaves blank for the
 * built-in one. `value` is what is stored; `fallback` is what blank shows
 * (none: `originalLabel` says what the site uses instead).
 */
export function ImageField({
  value,
  fallback,
  alt,
  onChange,
  disabled,
  wide = false,
  originalLabel,
}: {
  value: string;
  fallback: string;
  alt: string;
  /** What blank means, when it is not a built-in picture. */
  originalLabel?: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  /** A 16:9 picture rather than a wide logo strip. */
  wide?: boolean;
}) {
  const L = useL();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => cmsApi.uploadMedia(file),
    onSuccess: (media) => media.url && onChange(ownMediaPath(media.url)),
    onError: (err) => toast.error(err),
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className={cn('flex items-center justify-center rounded-xl border border-rule bg-paper p-3', wide ? 'h-28 w-48' : 'h-20 min-w-48')}>
        {value || fallback ? (
          <img src={value || fallback} alt={alt} className={cn('max-h-full w-auto', wide && 'rounded-lg object-cover')} />
        ) : (
          <span className="px-2 text-center font-sans text-meta text-muted">{L('చిత్రం లేదు', 'No picture uploaded')}</span>
        )}
      </div>
      <div className="flex flex-col items-start gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button icon={ImageUp} variant="secondary" size="sm" pending={upload.isPending} disabled={disabled} onClick={() => input.current?.click()}>
          {L('కొత్త చిత్రం అప్‌లోడ్ చేయండి', 'Upload a new picture')}
        </Button>
        {value ? (
          <Button icon={RotateCcw} variant="ghost" size="sm" disabled={disabled} onClick={() => onChange('')}>
            {L('అసలు చిత్రాన్ని వాడండి', 'Use the original picture')}
          </Button>
        ) : (
          <span className="font-sans text-meta text-muted">{originalLabel ?? L('అసలు చిత్రం చూపిస్తోంది', 'Showing the original picture')}</span>
        )}
      </div>
    </div>
  );
}
