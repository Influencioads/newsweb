import { useState, type ComponentType } from 'react';
import { ImageDown, Share2, type LucideProps } from 'lucide-react';

import { API_BASE } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { FacebookIcon, InstagramIcon, TelegramIcon, WhatsAppIcon, XIcon } from '@/components/ui/glyphs';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { trackShare } from '@/features/engagement/beacon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Sharing one story — the single implementation for every share surface.
 *
 * - `useShareActions`  the paths (WhatsApp, Facebook, Instagram, Telegram, X,
 *                      card download, native share) as plain functions; each reports the
 *                      share so trending does not depend on which one was
 *                      pressed. Reusable by EngagementBar / EpaperPage.
 * - `ShareButtons`     the five network pills; `ShareBlock` wraps them with the
 *                      end-of-story prompt.
 * - `ShareSheet`       bottom `Sheet` with the network pills (and the card).
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

  const facebook = () => intent(`https://www.facebook.com/sharer/sharer.php?u=${link}`);

  /**
   * Instagram has no web share link. On a phone the system share sheet lists
   * Instagram, so that is used; on a computer the link is put on the clipboard
   * and Instagram opens, ready for it to be pasted into a story or DM.
   */
  async function instagram() {
    if (canNative && navigator.share) {
      try {
        await navigator.share({ title, url: absolute });
        report();
      } catch {
        // Cancelled.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(absolute);
      toast.success(t('ui.instagramCopied'));
    } catch {
      // Clipboard refused: Instagram still opens.
    }
    intent('https://www.instagram.com/');
  }

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

  return { whatsapp, facebook, instagram, telegram, x, copy, download, downloading, native, canNative };
}

type Network = 'whatsapp' | 'facebook' | 'instagram' | 'telegram' | 'x';

/** In the order the desk asked for: WhatsApp, Facebook, Instagram, Telegram, X. */
const NETWORKS: readonly { id: Network; icon: ComponentType<LucideProps>; te: string; en: string; tone: string }[] = [
  { id: 'whatsapp', icon: WhatsAppIcon, te: 'వాట్సాప్', en: 'WhatsApp', tone: 'bg-social-whatsapp hover:bg-social-whatsapp/90' },
  { id: 'facebook', icon: FacebookIcon, te: 'ఫేస్‌బుక్', en: 'Facebook', tone: 'bg-social-facebook hover:bg-social-facebook/90' },
  { id: 'instagram', icon: InstagramIcon, te: 'ఇన్‌స్టాగ్రామ్', en: 'Instagram', tone: 'bg-social-instagram hover:bg-social-instagram/90' },
  { id: 'telegram', icon: TelegramIcon, te: 'టెలిగ్రామ్', en: 'Telegram', tone: 'bg-social-telegram hover:bg-social-telegram/90' },
  { id: 'x', icon: XIcon, te: 'X (ట్విట్టర్)', en: 'X (Twitter)', tone: 'bg-social-x hover:bg-social-x/85' },
];

/**
 * The five network buttons as a grid of coloured pills, icon and name on one
 * line. `onDone` runs after a button has opened its network (the sheet uses it
 * to close itself).
 */
export function ShareButtons({
  shortId,
  url,
  title,
  track,
  onDone,
  className,
}: ShareTarget & { onDone?: () => void; className?: string }) {
  const { language } = useI18n();
  const s = useScript();
  const actions = useShareActions(shortId, url, title, track);
  return (
    <ul className={cn('grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5', className)}>
      {NETWORKS.map((n) => (
        <li key={n.id} className="min-w-0">
          <button
            type="button"
            onClick={async () => {
              await actions[n.id]();
              onDone?.();
            }}
            className={cn(
              n.tone,
              s.body,
              s.te ? 'text-te-body-sm' : 'text-ui',
              'flex min-h-tap w-full items-center justify-center gap-2 rounded-pill px-3 py-2 font-bold text-on-ink',
              'transition-[background-color,transform] duration-base ease-standard active:scale-[.98]',
            )}
          >
            <Icon icon={n.icon} size="md" className="shrink-0" />
            <span className="min-w-0 text-center">{language === 'te' ? n.te : n.en}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The end-of-story prompt: "Liked this story? Share it with friends:" and the five buttons. */
export function ShareBlock(props: ShareTarget & { className?: string }) {
  const { language } = useI18n();
  const s = useScript();
  return (
    <section
      aria-label={language === 'te' ? 'షేర్ చేయండి' : 'Share'}
      className={cn('rounded-2xl border border-rule border-l-4 border-l-wow bg-surface p-4 shadow-card md:p-5', props.className)}
    >
      <p className={cn(s.head, s.te ? 'text-te-body-sm' : 'text-headline-sm', 'mb-3 flex items-center gap-2 font-bold text-ink')}>
        <Icon icon={Share2} size="md" className="shrink-0 text-wow-deep" />
        {language === 'te' ? 'ఈ కథనం నచ్చిందా? మిత్రులతో పంచుకోండి:' : 'Liked this story? Share it with friends:'}
      </p>
      <ShareButtons {...props} className={undefined} />
    </section>
  );
}

export function ShareSheet({ open, onClose, shortId, url, title, track, cardAvailable }: ShareSheetProps) {
  const { t } = useI18n();
  const { download, downloading } = useShareActions(shortId, url, title, track);

  return (
    <Sheet open={open} onClose={onClose} title={t('ui.share')}>
      <div className="flex flex-col gap-3">
        <ShareButtons shortId={shortId} url={url} title={title} track={track} onDone={onClose} />
        {cardAvailable && (
          <Button
            variant="secondary"
            size="lg"
            full
            icon={ImageDown}
            pending={downloading}
            onClick={async () => {
              if ((await download()) !== false) onClose();
            }}
          >
            {t('ui.shareCard')}
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
