import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Last-resort error boundary for a route subtree.
 *
 * Catches a render crash, logs it, and shows a small recoverable screen with a
 * reload button and a link home. Pass the route as `resetKey` so a navigation
 * clears the error without remounting the subtree (a `key` would also work but
 * tears the layouts down on every route change):
 *
 *     <AppErrorBoundary resetKey={location.pathname}>
 *       <Routes … />
 *     </AppErrorBoundary>
 *
 * Deliberately free of the ui/ primitives so it still renders when one of them
 * is what crashed.
 */
export interface AppErrorBoundaryProps {
  children: ReactNode;
  /** When this changes while failed, the boundary clears and re-renders children. */
  resetKey?: unknown;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prev: AppErrorBoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

/** Function child so the class can use hooks-based i18n. */
function CrashScreen() {
  const { t } = useI18n();
  const s = useScript();
  const button =
    'inline-flex min-h-tap items-center justify-center rounded-xl px-5 text-ui font-semibold ' +
    'transition-[colors,transform,box-shadow] duration-base ease-standard active:scale-[.98]';
  return (
    <div role="alert" className="mx-auto w-full max-w-form px-4 py-16 text-center md:px-6">
      {/* font-bold: the serif headline face is loaded as a 400–900 variable font; 700 is the headline weight. */}
      <h1 className={cn(s.head, 'text-headline-md font-bold text-ink')}>{t('state.errorTitle')}</h1>
      <p className={cn(s.body, s.te ? 'text-te-body-sm' : 'text-ui', 'mt-2 text-muted')}>
        {t('state.errorBody')}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={cn(s.body, button, 'bg-brand text-on-brand hover:bg-brand-dark')}
        >
          {t('state.retry')}
        </button>
        <Link
          to="/"
          className={cn(s.body, button, 'border border-rule bg-surface text-ink hover:border-brand hover:text-brand')}
        >
          {t('state.goHome')}
        </Link>
      </div>
    </div>
  );
}
