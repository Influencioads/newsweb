import { create } from 'zustand';

/**
 * Toast queue — the transient "saved / failed / copied" notices that
 * `<ToastHost>` (src/ui/Toast.tsx) renders above the tab bar.
 *
 * At most three are visible; each auto-dismisses after 4 s (errors 6 s).
 * Screens do not touch this store directly — they call `useToast()`.
 */
export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Override the auto-dismiss delay in ms. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  /** Enqueue a toast; returns its id. */
  push: (kind: ToastKind, message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const MAX_VISIBLE = 3;
const DURATION: Record<ToastKind, number> = { success: 4000, info: 4000, error: 6000 };

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (kind, message, opts) => {
    const id = ++seq;
    const toast: Toast = { id, kind, message, action: opts?.action };
    // Oldest falls off the front; its timer firing later is a harmless no-op.
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_VISIBLE) }));
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), opts?.duration ?? DURATION[kind]),
    );
    return id;
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    set((s) => (s.toasts.some((x) => x.id === id) ? { toasts: s.toasts.filter((x) => x.id !== id) } : s));
  },
}));
