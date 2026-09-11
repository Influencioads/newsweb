import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RefreshCw, SearchX, type LucideIcon } from 'lucide-react';

import { ApiError } from '@/api/client';
import { useI18n, useScript, type ScriptAttrs } from '@/i18n';
import { cn } from '@/utils/cn';

import { Button } from './Button';
import { Icon } from './Icon';

/**
 * State — the loading / empty / error surfaces every data-driven view shares.
 *
 * - `Skeleton`      one shimmer bar, block, image box or circle (`.skeleton`).
 * - `SkeletonCard`  a skeleton with the geometry of an ArticleCard variant.
 * - `EmptyState`    icon + title + body + optional action, centred.
 * - `ErrorState`    same shell, `role="alert"`, ApiError-aware copy, retry button.
 * - `QueryState`    wires a TanStack query to the three above; renders
 *                   `children(data)` once data is present and non-empty.
 *
 *     <QueryState query={q} skeleton={<SkeletonCard variant="lead" />}>
 *       {(data) => <LeadCard article={data} />}
 *     </QueryState>
 */

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export interface SkeletonProps {
  variant?: 'text' | 'headline' | 'block' | 'image' | 'circle';
  /** Bars to render for `text` / `headline`; the last one is shortened. */
  lines?: number;
  /** CSS aspect-ratio for `image`, e.g. "16/9". */
  ratio?: string;
  className?: string;
}

export function Skeleton({ variant = 'text', lines = 1, ratio, className }: SkeletonProps) {
  if (variant === 'text' || variant === 'headline') {
    const headline = variant === 'headline';
    return (
      <div aria-hidden className={cn('flex flex-col', headline ? 'gap-2.5' : 'gap-2', className)}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={cn(
              'skeleton block rounded-pill',
              headline ? 'h-5' : 'h-3.5',
              lines > 1 && i === lines - 1 ? 'w-2/3' : 'w-full',
            )}
          />
        ))}
      </div>
    );
  }
  const shape = variant === 'circle' ? 'h-10 w-10 rounded-pill' : variant === 'block' ? 'h-24 rounded-xl' : 'rounded-xl';
  return (
    <div
      aria-hidden
      className={cn('skeleton', shape, className)}
      style={variant === 'image' ? { aspectRatio: ratio ?? '16/9' } : undefined}
    />
  );
}

export type SkeletonCardVariant = 'lead' | 'row' | 'grid' | 'compact';

/** Loading stand-in shaped like the matching ArticleCard variant. */
export function SkeletonCard({ variant }: { variant: SkeletonCardVariant }) {
  if (variant === 'row') {
    return (
      <div aria-hidden className="flex gap-3">
        <Skeleton variant="image" ratio="4/3" className="w-28 shrink-0" />
        <Skeleton variant="headline" lines={2} className="min-w-0 flex-1" />
      </div>
    );
  }
  if (variant === 'compact') return <Skeleton variant="headline" lines={2} />;
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton variant="image" ratio={variant === 'lead' ? '16/9' : '16/10'} />
      <Skeleton variant="headline" lines={2} />
      {variant === 'lead' && <Skeleton variant="text" lines={3} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / Error
// ---------------------------------------------------------------------------

interface ShellProps {
  icon: LucideIcon;
  iconTone: string;
  title: ReactNode;
  body?: ReactNode;
  /** Script attrs for a body that came from the API rather than the chrome strings. */
  bodyScript?: ScriptAttrs;
  action?: ReactNode;
  compact?: boolean;
  role?: 'alert' | 'status';
  headingLevel?: 1 | 2;
  className?: string;
}

function Shell({ icon, iconTone, title, body, bodyScript, action, compact, role, headingLevel = 2, className }: ShellProps) {
  const s = useScript();
  const telugu = bodyScript ? bodyScript.telugu : s.te;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div
      role={role}
      className={cn(
        'mx-auto flex w-full max-w-form flex-col items-center px-4 text-center',
        compact ? 'py-6' : 'py-12 md:py-16',
        className,
      )}
    >
      <span
        className={cn(
          'mb-4 flex items-center justify-center rounded-pill',
          compact ? 'h-10 w-10' : 'h-12 w-12',
          iconTone,
        )}
      >
        <Icon icon={icon} size={compact ? 'md' : 'lg'} />
      </span>
      <Heading className={cn(s.head, compact ? 'text-headline-xs' : 'text-headline-sm', 'font-bold text-ink')}>
        {title}
      </Heading>
      {body != null && (
        <p
          lang={bodyScript?.lang}
          className={cn(
            'mt-2 text-muted',
            bodyScript?.cls ?? s.body,
            telugu ? 'text-te-body-xs' : 'text-ui',
          )}
        >
          {body}
        </p>
      )}
      {action != null && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  /** `1` when the state IS the page (404); default `2`. */
  headingLevel?: 1 | 2;
  className?: string;
}

export function EmptyState({ icon = Inbox, title, body, action, compact, headingLevel, className }: EmptyStateProps) {
  return (
    <Shell
      icon={icon}
      iconTone="bg-rule-soft text-muted"
      title={title}
      body={body}
      action={action}
      compact={compact}
      headingLevel={headingLevel}
      className={className}
    />
  );
}

export interface ErrorStateProps {
  error?: unknown;
  onRetry?: () => void;
  compact?: boolean;
  /** Defaults to `state.errorTitle`, or `state.notFound` for a 404. */
  title?: ReactNode;
  headingLevel?: 1 | 2;
  className?: string;
}

export function ErrorState({ error, onRetry, compact, title, headingLevel, className }: ErrorStateProps) {
  const { t } = useI18n();
  const s = useScript();
  const api = error instanceof ApiError ? error : null;
  const notFound = api?.status === 404;
  // The §13 envelope carries both languages; pick like any other DB pair so an
  // English page still tags a Telugu-only message with lang="te".
  const msg = api ? s.text(api.messageTe, api.messageEn) : null;
  return (
    <Shell
      role="alert"
      icon={notFound ? SearchX : AlertCircle}
      iconTone={notFound ? 'bg-rule-soft text-muted' : 'bg-breaking-tint text-breaking'}
      title={title ?? t(notFound ? 'state.notFound' : 'state.errorTitle')}
      body={msg?.text || t(notFound ? 'state.notFoundBody' : 'state.errorBody')}
      bodyScript={msg?.text ? msg : undefined}
      action={
        onRetry && (
          <Button icon={RefreshCw} onClick={onRetry}>
            {t('state.retry')}
          </Button>
        )
      }
      compact={compact}
      headingLevel={headingLevel}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// QueryState
// ---------------------------------------------------------------------------

/** The slice of a TanStack `UseQueryResult` this component reads. */
export interface QueryStateQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface QueryStateProps<T> {
  query: QueryStateQuery<T>;
  /** Loading node; defaults to three `row` skeleton cards. */
  skeleton?: ReactNode;
  /** Empty node; defaults to `EmptyState` with `state.emptyTitle`. */
  empty?: ReactNode;
  /** Custom emptiness test; default is `data == null` or an empty array. */
  isEmpty?: (data: T) => boolean;
  errorTitle?: string;
  compact?: boolean;
  children: (data: T) => ReactNode;
}

export function QueryState<T>({ query, skeleton, empty, isEmpty, errorTitle, compact, children }: QueryStateProps<T>) {
  const { t } = useI18n();
  if (query.isLoading) {
    return (
      <div aria-busy="true">
        <span role="status" className="sr-only">
          {t('state.loading')}
        </span>
        {skeleton ?? (
          <div className="flex flex-col gap-4">
            <SkeletonCard variant="row" />
            <SkeletonCard variant="row" />
            <SkeletonCard variant="row" />
          </div>
        )}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} title={errorTitle} compact={compact} />;
  }
  const data = query.data;
  const blank = data == null || (isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0);
  if (blank) return <>{empty ?? <EmptyState title={t('state.emptyTitle')} compact={compact} />}</>;
  return <>{children(data as T)}</>;
}
