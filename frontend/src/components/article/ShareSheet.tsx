import { useState } from 'react';
import { Copy, ImageDown, Link2, Share2 } from 'lucide-react';

import { API_BASE } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TelegramIcon, WhatsAppIcon, XIcon } from '@/components/ui/glyphs';
import { Sheet } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { trackShare } from '@/features/engagement/beacon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

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
  /**
   * Report the share to the article counters. `false` for a surface that counts
   * itself (an e-paper page, a video) and whose `shortId` is not an article.
   */
  track?: boolean;
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
export function useShareActions(shortId: string, url: string, title: string, track = true) {
  const { t } = useI18n();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const absolute = `${window.location.origin}${url}`;
  const report = () => {
    if (track) trackShare(shortId);
  };

  // `navigator.share` is typed as always present, so testing it directly is a
  // compile error; the capability genuinely varies at runtime.
  const canNative = typeof navigator !== 'undefined' && 'share' in navigator;

  const intent = (href: string) => {
    report();
    window.open(href, '_blank', 'noopener,noreferrer');
  };
  const link = encodeURIComponent(absolute);
  const text = encodeURIComponent(title);
  const whatsapp = () => intent(`https://wa.me/?text=${encodeURIComponent(`${title}\n${absolute}`)}`);
  const x = () => intent(`https://x.com/intent/tweet?url=${link}&text=${text}`);
  const telegram = () => intent(`https://t.me/share/url?url=${link}&text=${text}`);

  /** Resolves false when the clipboard was refused (a toast has been shown), so the sheet stays open. */
  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(absolute);
      report();
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
      const response = await fetch(`${API_BASE}/public/articles/${shortId}/card.jpg`);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${shortId}.jpg`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      report();
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
      report();
    } catch {
      // A cancelled share sheet throws. That is not a failure.
    }
  }

  return { whatsapp, x, telegram, copy, download, downloading, native, canNative };
}

/** End-of-article strip: four coloured buttons, always on the page — no sheet to open. */
export function ShareStrip({ shortId, url, title, className }: ShareTarget & { className?: string }) {
  const { t } = useI18n();
  const s = useScript();
  const { whatsapp, x, telegram, copy } = useShareActions(shortId, url, title);
  const pill = cn(s.body, 'inline-flex min-h-tap-lg items-center justify-center gap-2 rounded-pill px-4 text-ui font-semibold');
  return (
    <Card tone="warm" padding="md" as="aside" className={cn('border-l-4 border-l-brand', className)}>
      <p className={cn(s.body, 'flex items-center gap-2 text-ui font-bold text-ink')}>
        <span aria-hidden>📢</span>
        {t('ui.shareStripTitle')}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" onClick={whatsapp} className={cn(pill, 'bg-social-whatsapp text-on-ink')}>
          <WhatsAppIcon size={18} />
          {t('ui.whatsapp')}
        </button>
        <button type="button" onClick={x} className={cn(pill, 'bg-social-x text-on-ink')}>
          <XIcon size={16} />X (Twitter)
        </button>
        <button type="button" onClick={telegram} className={cn(pill, 'bg-social-telegram text-on-ink')}>
          <TelegramIcon size={18} />
          Telegram
        </button>
        <button type="button" onClick={() => void copy()} className={cn(pill, 'border border-rule-strong bg-surface-sub text-ink')}>
          <Copy size={18} aria-hidden />
          {t('ui.copyLinkShort')}
        </button>
      </div>
    </Card>
  );
}

export function ShareSheet({ open, onClose, shortId, url, title, track, cardAvailable }: ShareSheetProps) {
  const { t } = useI18n();
  const { whatsapp, copy, download, downloading, native, canNative } = useShareActions(shortId, url, title, track);

  // Every row dismisses the sheet once its path has run (focus returns to the
  // opener) — except a path that reports failure, which stays open for a retry.
  const run = (action: () => void | boolean | Promise<void | boolean>) => async () => {
    if ((await action()) !== false) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('ui.share')}>
      <div className="flex flex-col gap-2">
        {/* The only filled control in the sheet: WhatsApp is how this
            product is distributed, so it leads rather than sits in a list. */}
        <Button variant="primary" size="lg" full icon={WhatsAppIcon} onClick={run(whatsapp)}>
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

export function ShareButton({ shortId, url, title, track, cardAvailable, variant = 'icon', label, className }: ShareButtonProps) {
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
        track={track}
        cardAvailable={cardAvailable}
      />
    </>
  );
}
