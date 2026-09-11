import { create } from 'zustand';

/**
 * Toast queue.
 *
 * Framework-free state so anything (API interceptors, stores, React) can push
 * a toast: `useToastStore.getState().push('error', msg)`. Components render it
 * through `<Toaster />` and push through `useToast()` (components/ui/Toast),
 * which also translates `ApiError`s. Auto-dismiss timers live in the Toaster so
 * they can pause on hover/focus; the store only records the duration.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Auto-dismiss delay in ms. Default 4000 (error 6000). */
  duration?: number;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const MAX_VISIBLE = 3;
const DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, error: 6000 };

let seq = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, message, opts) => {
    const id = ++seq;
    const item: ToastItem = { id, kind, message, duration: opts?.duration ?? DURATION[kind] };
    if (opts?.action) item.action = opts.action;
    // Oldest drops off once more than MAX_VISIBLE are queued.
    set((s) => ({ toasts: [...s.toasts, item].slice(-MAX_VISIBLE) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
