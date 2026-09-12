import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { ApiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon, type LucideIcon } from '@/components/ui/Icon';
import { translate, useI18n, useScript } from '@/i18n';
import { useToastStore, type ToastItem, type ToastKind, type ToastOptions } from '@/stores/toast';
import { cn } from '@/utils/cn';

export type { ToastKind, ToastOptions } from '@/stores/toast';

/**
 * Toast notifications.
 *
 * Mount `<Toaster />` once (the app shell); it portals into `#overlay-root`,
 * creating the node if index.html did not. Fire toasts with `useToast()`:
 *
 *     const toast = useToast();
 *     toast.success(t('state.saved'));
 *     toast.error(err);                        // ApiError → message in the UI language
 *     toast.info(msg, { action: { label, onClick } });
 *
 * At most three are visible; each auto-dismisses (4 s, errors 6 s) and the
 * timer pauses while hovered or focused.
 */

// The toast is a constant-dark panel, so the status colours (deep in light
// mode) would sit under 3:1 on it; the glyph carries the kind, the colour stays on-ink.
const KIND_ICON: Record<ToastKind, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-on-ink' },
  error: { icon: AlertCircle, cls: 'text-on-ink' },
  info: { icon: Info, cls: 'text-on-ink' },
};

const ROOT_ID = 'overlay-root';
const TELUGU = /[ఀ-౿]/;

function getOverlayRoot(): HTMLElement {
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { t } = useI18n();
  const s = useScript();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);

  // Countdown runs only while not paused; the remainder carries across pauses.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const id = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, dismiss, toast.id]);

  const kind = KIND_ICON[toast.kind];
  // The message can be Telugu even in English mode (ApiError.displayMessage
  // fallback, non-React pushes), so detect the script per message.
  const te = s.te || TELUGU.test(toast.message);

  // No role="status" here: the Toaster region is the one live region, so each
  // toast is announced once. `ring-on-ink/10` gives the panel an edge in dark
  // mode, where bg-ink and the canvas are both near-black.
  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ink py-2 pl-4 pr-2 text-on-ink shadow-raised ring-1 ring-on-ink/10 animate-slide-up"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <Icon icon={kind.icon} size="md" className={kind.cls} />
      <p lang={te ? 'te' : 'en'} className={cn('min-w-0 flex-1 break-words', te ? 'te text-te-body-xs' : 'font-sans text-ui')}>
        {toast.message}
      </p>
      {toast.action && (
        <Button
          variant="inverse"
          size="sm"
          className="shrink-0"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton
        icon={X}
        label={t('ui.dismiss')}
        variant="inverse"
        className="shrink-0"
        onClick={() => dismiss(toast.id)}
      />
    </div>
  );
}

/** Renders the toast stack. Mount once, anywhere under the providers. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const { t } = useI18n();
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => setRoot(getOverlayRoot()), []);

  if (!root) return null;
  return createPortal(
    <div
      role="region"
      aria-live="polite"
      aria-label={t('ui.toastRegion')}
      className="pointer-events-none fixed inset-x-4 bottom-4 z-toast flex flex-col gap-2 md:left-auto md:right-6 md:w-96"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>,
    root,
  );
}

/**
 * Push helpers. Accepts a string, an `ApiError` (message in the current UI
 * language) or any thrown value (generic `state.errorBody`). Stable per language.
 */
export function useToast() {
  const { language } = useI18n();
  const push = useToastStore((s) => s.push);

  return useMemo(() => {
    const text = (msg: unknown): string => {
      if (typeof msg === 'string') return msg;
      if (msg instanceof ApiError) {
        return (language === 'te' ? msg.messageTe : msg.messageEn) || msg.displayMessage;
      }
      return translate('state.errorBody', language);
    };
    return {
      success: (msg: unknown, opts?: ToastOptions) => push('success', text(msg), opts),
      error: (msg: unknown, opts?: ToastOptions) => push('error', text(msg), opts),
      info: (msg: unknown, opts?: ToastOptions) => push('info', text(msg), opts),
    };
  }, [language, push]);
}
