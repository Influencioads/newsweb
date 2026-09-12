import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { Button, IconButton } from './Button';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Dialog family — every modal surface in the app.
 *
 * - `Dialog`         centred panel (bottom sheet under md by default).
 * - `Sheet`          edge-anchored panel: bottom (grab handle), left or right.
 * - `ConfirmDialog`  yes/no with a primary or danger confirm.
 * `PromptDialog` is the sibling file `./PromptDialog` — it imports Dialog, so it
 * is NOT re-exported here; a barrel re-export would make the pair circular.
 * - `useConfirm`     imperative `await confirm({...})`; render `{dialog}` once.
 *
 * Shared behaviour: portal into `#overlay-root`, role=dialog + aria-modal,
 * focus trap (Tab / Shift+Tab wrap), Esc closes, body scroll lock with
 * scrollbar-width compensation, focus restored to the opener on close.
 *
 *     <Dialog open={open} onClose={close} title={t('ui.readerSettings')}>…</Dialog>
 *     const { confirm, dialog } = useConfirm();
 *     if (await confirm({ title: t('state.confirmDelete'), tone: 'danger' })) …
 *     {dialog}
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function overlayRoot(): HTMLElement {
  let el = document.getElementById('overlay-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-root';
    document.body.appendChild(el);
  }
  return el;
}

// Body scroll lock is counted across instances: a confirm raised inside an
// open Dialog must not restore `overflow: hidden` when the outer one closes.
let locks = 0;
let savedBody: { overflow: string; paddingRight: string } | null = null;

function lockBody(): void {
  if (locks++ > 0) return;
  const body = document.body;
  savedBody = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  const gap = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (gap > 0) body.style.paddingRight = `${gap}px`;
}

function unlockBody(): void {
  if (--locks > 0 || !savedBody) return;
  document.body.style.overflow = savedBody.overflow;
  document.body.style.paddingRight = savedBody.paddingRight;
  savedBody = null;
}

/**
 * Scroll lock, focus trap, Esc, focus restore. Runs while `open`.
 * Initial focus: `initialFocusRef`, else the first `[data-autofocus]`, else the
 * first focusable, else the panel.
 */
function useModal(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement>,
  initialFocusRef?: RefObject<HTMLElement>,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const opener = document.activeElement as HTMLElement | null;
    lockBody();

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    (
      initialFocusRef?.current ??
      panel.querySelector<HTMLElement>('[data-autofocus]') ??
      focusables()[0] ??
      panel
    ).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', onKey);
    return () => {
      panel.removeEventListener('keydown', onKey);
      unlockBody();
      opener?.focus({ preventScroll: true });
    };
  }, [open, panelRef, initialFocusRef]);
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Overlay flex alignment classes. */
  align: string;
  /** Panel shape / motion classes. */
  panel: string;
  labelId: string;
  descId?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  children: ReactNode;
}

function Modal({ open, onClose, align, panel, labelId, descId, initialFocusRef, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(open, onClose, ref, initialFocusRef);
  if (!open) return null;
  return createPortal(
    <div className={cn('fixed inset-0 z-overlay flex', align)}>
      <div className="absolute inset-0 bg-overlay/60 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={descId}
        tabIndex={-1}
        className={cn('relative flex min-h-0 flex-col bg-surface text-ink outline-none', panel)}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children}
      </div>
    </div>,
    overlayRoot(),
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  /** Bottom sheet under md (default). `false` = centred at every width. */
  sheetOnMobile?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement>;
  closeLabel?: string;
  className?: string;
}

const DIALOG_WIDTH: Record<DialogSize, string> = {
  sm: 'md:max-w-sm',
  md: 'md:max-w-lg',
  lg: 'md:max-w-2xl',
};

/** Body-copy classes for chrome text in the interface language. */
function useBodyClass(): string {
  const s = useScript();
  return cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  sheetOnMobile = true,
  children,
  footer,
  initialFocusRef,
  closeLabel,
  className,
}: DialogProps) {
  const { t } = useI18n();
  const s = useScript();
  const bodyClass = useBodyClass();
  const id = useId();
  const labelId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  const centred = 'items-center justify-center p-4';
  const centredPanel = 'w-full max-h-[85vh] rounded-2xl shadow-raised animate-scale-in';
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelId={labelId}
      descId={descId}
      initialFocusRef={initialFocusRef}
      align={sheetOnMobile ? 'items-end justify-center md:items-center md:p-4' : centred}
      panel={cn(
        sheetOnMobile
          ? 'w-full max-h-[85vh] rounded-t-2xl shadow-sheet animate-slide-up md:rounded-2xl md:shadow-raised md:animate-scale-in'
          : centredPanel,
        DIALOG_WIDTH[size],
        className,
      )}
    >
      {/* Plain divs: <header>/<footer> inside role=dialog would expose extra
          banner/contentinfo landmarks; the h2 + aria-labelledby carry the semantics. */}
      <div className="flex items-start gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 id={labelId} className={cn(s.head, 'text-headline-md font-semibold text-ink')}>
            {title}
          </h2>
          {description && (
            <p id={descId} className={cn(bodyClass, 'mt-1 text-muted')}>
              {description}
            </p>
          )}
        </div>
        <IconButton icon={X} label={closeLabel ?? t('ui.close')} onClick={onClose} className="-mr-2 -mt-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-4">{footer}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export type SheetSide = 'bottom' | 'left' | 'right';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  side?: SheetSide;
  children?: ReactNode;
  className?: string;
  closeLabel?: string;
}

const SHEET: Record<SheetSide, { align: string; panel: string }> = {
  bottom: {
    align: 'items-end justify-center',
    panel: 'w-full max-h-[85vh] rounded-t-2xl animate-slide-up md:max-w-lg',
  },
  left: { align: 'items-stretch justify-start', panel: 'h-full w-4/5 max-w-sm animate-slide-in-left' },
  // No slide-in-right keyframe in the token set; fade is the closest match.
  right: { align: 'items-stretch justify-end', panel: 'h-full w-4/5 max-w-sm animate-fade-in' },
};

export function Sheet({ open, onClose, title, side = 'bottom', children, className, closeLabel }: SheetProps) {
  const { t } = useI18n();
  const s = useScript();
  const labelId = `${useId()}-title`;
  const { align, panel } = SHEET[side];
  return (
    <Modal open={open} onClose={onClose} labelId={labelId} align={align} panel={cn('shadow-sheet', panel, className)}>
      {side === 'bottom' && <div aria-hidden className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-pill bg-rule-strong" />}
      <div className="flex items-center gap-3 px-5 pb-2 pt-3">
        <h2 id={labelId} className={cn(s.head, 'min-w-0 flex-1 text-headline-md font-semibold text-ink')}>
          {title}
        </h2>
        <IconButton icon={X} label={closeLabel ?? t('ui.close')} onClick={onClose} className="-mr-2" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog + useConfirm
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void | Promise<void>;
  pending?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  onConfirm,
  pending,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const bodyClass = useBodyClass();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={pending}>
            {cancelLabel ?? t('ui.cancel')}
          </Button>
          <Button variant={tone} onClick={() => void onConfirm()} pending={pending}>
            {confirmLabel ?? t('ui.confirm')}
          </Button>
        </>
      }
    >
      {body && <p className={cn(bodyClass, 'text-ink-soft')}>{body}</p>}
    </Dialog>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
}

/** `const { confirm, dialog } = useConfirm();` — render `{dialog}` once, then `await confirm({...})`. */
export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );
  const settle = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = (
    <ConfirmDialog
      open={state !== null}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={state?.opts.title}
      body={state?.opts.body}
      confirmLabel={state?.opts.confirmLabel}
      tone={state?.opts.tone}
    />
  );
  return { confirm, dialog };
}
