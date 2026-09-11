import { useState } from 'react';

import { API_BASE } from '@/api/client';
import { trackShare } from '@/features/engagement/beacon';
import { useI18n } from '@/i18n';

/**
 * Sharing one story: WhatsApp, the card as a file, a copied link.
 *
 * The WhatsApp button still sends text and a URL — that has not changed, and
 * it did not need to. What changed is what arrives at the other end: the link
 * preview now carries a rendered Telugu headline card, because nginx routes
 * WhatsApp's crawler to the API's Open Graph stub.
 *
 * The download button is the one readers actually asked for. A picture of the
 * headline is what gets posted to a WhatsApp Status or a family group, where a
 * link preview does not exist at all.
 *
 * Every path reports the share, so the trending signal does not depend on
 * which button somebody pressed.
 */

interface Props {
  shortId: string;
  /** The story's canonical path, e.g. /politics/slug-ab12cd. */
  url: string;
  title: string;
  /** False when this host cannot render a Telugu card — see core/fonts.py. */
  cardAvailable: boolean;
}

export function ShareSheet({ shortId, url, title, cardAvailable }: Props) {
  const { language } = useI18n();
  const en = language === 'en';
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const absolute = `${window.location.origin}${url}`;

  function whatsapp() {
    trackShare(shortId);
    const text = encodeURIComponent(`${title}\n${absolute}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  }

  async function downloadCard() {
    setDownloading(true);
    try {
      const response = await fetch(`${API_BASE}/public/articles/${shortId}/card.png`);
      if (!response.ok) return;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${shortId}.png`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      trackShare(shortId);
    } finally {
      setDownloading(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      trackShare(shortId);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard a browser will not grant is not an error worth showing;
      // the reader can still use the WhatsApp button.
    }
  }

  async function nativeShare() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, url: absolute });
      trackShare(shortId);
    } catch {
      // A cancelled share sheet throws. That is not a failure.
    }
  }

  // `navigator.share` is typed as always present, so testing it directly is a
  // compile error; the capability genuinely varies at runtime.
  const canNativeShare =
    typeof navigator !== 'undefined' && 'share' in navigator;

  const button =
    'flex min-h-tap items-center rounded-control border border-rule px-3 font-sans text-[11px] font-semibold';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={whatsapp} className={`${button} text-success`}>
        WhatsApp
      </button>

      {cardAvailable ? (
        <button type="button" onClick={downloadCard} disabled={downloading}
          className={`${button} te text-brand disabled:opacity-50`}>
          {downloading
            ? (en ? 'Preparing…' : 'సిద్ధమవుతోంది…')
            : (en ? 'Download card' : 'కార్డ్ డౌన్‌లోడ్')}
        </button>
      ) : null}

      <button type="button" onClick={copyLink} className={`${button} te text-ink-soft`}>
        {copied ? (en ? 'Copied' : 'కాపీ అయ్యింది') : (en ? 'Copy link' : 'లింక్ కాపీ')}
      </button>

      {canNativeShare ? (
        <button type="button" onClick={nativeShare} className={`${button} te text-ink-soft`}>
          {en ? 'More' : 'మరిన్ని'}
        </button>
      ) : null}
    </div>
  );
}
