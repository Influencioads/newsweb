import { useState } from 'react';
import { ImageDown, Link2, MessageCircle, Share2 } from 'lucide-react';

import { API_BASE } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { trackShare } from '@/features/engagement/beacon';
import { useI18n } from '@/i18n';

/**
 * Sharing one story — the single implementation for every share surface.
 *
 * - `useShareActions`  the four paths (WhatsApp, copy link, card download,
 *                      native share) as plain functions; each reports the
 *                      share so trending does not depend on which one was
 *                      pressed. Reusable by EngagementBar / EpaperPage.
 * - `ShareSheet`       bottom `Sheet` listing those paths as full-width rows.
 * - `ShareButton`      owns the open state; icon or labelled trigger.
 *
 * WhatsApp sends text + URL; the link preview at the other end carries a
 * rendered Telugu headline card because nginx routes WhatsApp's crawler to
 * the API's Open Graph stub. The card download exists for WhatsApp Status
 * and family groups, where a link preview does not exist at all.
 *
 *     <ShareButton variant="button" shortId={a.short_id} url={a.url} title={title} cardAvailable={card} />
 */

export interface ShareTarget {
  shortId: string;
  /** The story's canonical path, e.g. /politics/slug-ab12cd. */
  url: string;
  title: string;
}

export interface ShareSheetProps extends ShareTarget {
  open: boolean;
  onClose: () => void;
  /** False when this host cannot render a Telugu card — see core/fonts.py. */
  cardAvailable: boolean;
}

export interface ShareButtonProps extends ShareTarget {
  cardAvailable: boolean;
  /** `icon` = IconButton (Share2, aria-label); `button` = labelled Button. */
  variant?: 'icon' | 'button';
  /** Label for the `button` variant; defaults to `ui.share`. */
  label?: string;
  className?: string;
}

/** The share paths for one story. `downloading` is the card fetch's pending state. */
export function useShareActions(shortId: string, url: string, title: string) {
  const { t } = useI18n();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const absolute = `${window.location.origin}${url}`;

  // `navigator.share` is typed as always present, so testing it directly is a
  // compile error; the capability genuinely varies at runtime.
  const canNative = typeof navigator !== 'undefined' && 'share' in navigator;

  function whatsapp() {
    trackShare(shortId);
    const text = encodeURIComponent(`${title}\n${absolute}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  /** Resolves false when the clipboard was refused (a toast has been shown), so the sheet stays open. */
  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(absolute);
      trackShare(shortId);
      toast.success(t('ui.copied'));
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    }
  }

  /** Resolves false when the card could not be fetched (a toast has been shown). */
  async function download(): Promise<boolean> {
    setDownloading(true);
    try {
      const response = await fetch(`${API_BASE}/public/articles/${shortId}/card.png`);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${shortId}.png`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      trackShare(shortId);
      toast.success(t('ui.done'));
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setDownloading(false);
    }
  }

  async function native() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, url: absolute });
      trackShare(shortId);
    } catch {
      // A cancelled share sheet throws. That is not a failure.
    }
  }

  return { whatsapp, copy, download, downloading, native, canNative };
}

export function ShareSheet({ open, onClose, shortId, url, title, cardAvailable }: ShareSheetProps) {
  const { t } = useI18n();
  const { whatsapp, copy, download, downloading, native, canNative } = useShareActions(shortId, url, title);

  // Every row dismisses the sheet once its path has run (focus returns to the
  // opener) — except a path that reports failure, which stays open for a retry.
  const run = (action: () => void | boolean | Promise<void | boolean>) => async () => {
    if ((await action()) !== false) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('ui.share')}>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" size="lg" full icon={MessageCircle} onClick={run(whatsapp)}>
          {t('ui.whatsapp')}
        </Button>
        <Button variant="secondary" size="lg" full icon={Link2} onClick={run(copy)}>
          {t('ui.copyLink')}
        </Button>
        {cardAvailable && (
          <Button variant="secondary" size="lg" full icon={ImageDown} pending={downloading} onClick={run(download)}>
            {t('ui.shareCard')}
          </Button>
        )}
        {canNative && (
          <Button variant="secondary" size="lg" full icon={Share2} onClick={run(native)}>
            {t('ui.shareNative')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

export function ShareButton({ shortId, url, title, cardAvailable, variant = 'icon', label, className }: ShareButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const text = label ?? t('ui.share');
  return (
    <>
      {variant === 'icon' ? (
        <IconButton icon={Share2} label={text} className={className} onClick={() => setOpen(true)} />
      ) : (
        <Button variant="secondary" icon={Share2} className={className} onClick={() => setOpen(true)}>
          {text}
        </Button>
      )}
      <ShareSheet
        open={open}
        onClose={() => setOpen(false)}
        shortId={shortId}
        url={url}
        title={title}
        cardAvailable={cardAvailable}
      />
    </>
  );
}
