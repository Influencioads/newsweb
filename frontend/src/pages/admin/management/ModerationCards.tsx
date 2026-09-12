import { useState, type ReactNode } from 'react';
import { Check, ExternalLink, Eye, EyeOff, FileText, Flag, MessageSquare, X } from 'lucide-react';

import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { useL } from './shared';

/**
 * Moderation cards — one presentational Card per report, comment and reader
 * submission. The page owns the queries, mutations and dialogs; cards only
 * report clicks and show the pending state they are handed.
 */

export type ReportRow = {
  id: number;
  reason: string;
  note: string | null;
  status: string;
  created_at: string;
  resolution_note: string | null;
  target: {
    kind: string;
    id: number;
    title_te?: string | null;
    short_id?: string | null;
    url?: string | null;
    body?: string | null;
    status?: string | null;
    author?: string | null;
  };
};

export type CommentRow = {
  id: number;
  body: string;
  status: string;
  author: string | null;
  article_title_te: string | null;
  article_short_id: string | null;
  created_at: string;
};

export type SubmissionRow = {
  id: number;
  title_te: string;
  body_te: string;
  creator_name_te: string | null;
  creator_phone: string | null;
  category_slug: string | null;
  district_slug: string | null;
  status: string;
  created_at: string;
};

const when = (iso: string) => new Date(iso).toLocaleString('en-IN');

/** Content column + trailing action column; stacks under md. */
function Split({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <Card as="article" padding="md">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      </div>
    </Card>
  );
}

export type ReportBusy = 'hide' | 'resolve' | 'dismiss' | null;

export function ReportCard({
  report: r,
  busy,
  onHide,
  onResolve,
  onDismiss,
}: {
  report: ReportRow;
  busy: ReportBusy;
  onHide: () => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const L = useL();
  const s = useScript();
  const isComment = r.target.kind === 'comment';
  return (
    <Split
      actions={
        <>
          {isComment && r.target.status !== 'hidden' ? (
            <Button variant="danger" size="sm" icon={EyeOff} pending={busy === 'hide'} disabled={busy !== null} onClick={onHide}>
              {L('వ్యాఖ్య దాచండి', 'Hide comment')}
            </Button>
          ) : null}
          <Button size="sm" icon={Check} pending={busy === 'resolve'} disabled={busy !== null} onClick={onResolve}>
            {L('పరిష్కరించండి', 'Resolve')}
          </Button>
          <Button variant="secondary" size="sm" icon={X} pending={busy === 'dismiss'} disabled={busy !== null} onClick={onDismiss}>
            {L('తోసిపుచ్చండి', 'Dismiss')}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="breaking" size="xs" icon={Flag} lang="en">
          {r.reason}
        </Badge>
        <Badge tone="muted" size="xs" icon={isComment ? MessageSquare : FileText}>
          {isComment ? L('వ్యాఖ్య', 'Comment') : L('కథనం', 'Article')}
        </Badge>
        {isComment && r.target.status ? <StatusPill status={r.target.status} /> : null}
      </div>
      {isComment ? (
        <p lang="te" className="te mt-2 text-te-body-xs text-ink">
          “{r.target.body ?? '—'}” <span className="font-sans text-meta text-muted">— {r.target.author ?? '?'}</span>
        </p>
      ) : r.target.url ? (
        <a
          href={r.target.url}
          target="_blank"
          rel="noreferrer"
          lang="te"
          className="th mt-1 inline-flex min-h-tap items-center gap-1 rounded-xl text-headline-xs font-bold text-ink transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand"
        >
          {r.target.title_te ?? '—'}
          <Icon icon={ExternalLink} size="xs" />
        </a>
      ) : (
        <span lang="te" className="th mt-1 block text-headline-xs font-bold text-ink">
          {r.target.title_te ?? '—'}
        </span>
      )}
      {r.note ? (
        <p className="mt-1 text-muted">
          <span className={cn(s.body, 'text-meta font-semibold')}>{L('నివేదిక గమనిక', 'Reporter note')}: </span>
          <span lang="te" className="te text-te-body-xs">
            {r.note}
          </span>
        </p>
      ) : null}
      <p className="mt-1 font-sans text-meta text-muted">{when(r.created_at)}</p>
    </Split>
  );
}

export function CommentCard({
  comment: c,
  busy,
  onHide,
  onRestore,
}: {
  comment: CommentRow;
  busy: boolean;
  onHide: () => void;
  onRestore: () => void;
}) {
  const L = useL();
  return (
    <Split
      actions={
        c.status === 'visible' ? (
          <Button variant="danger" size="sm" icon={EyeOff} pending={busy} onClick={onHide}>
            {L('దాచండి', 'Hide')}
          </Button>
        ) : c.status === 'hidden' ? (
          <Button variant="secondary" size="sm" icon={Eye} pending={busy} onClick={onRestore}>
            {L('పునరుద్ధరించండి', 'Restore')}
          </Button>
        ) : null
      }
    >
      <p lang="te" className="te text-te-body-xs text-ink">
        “{c.body}”
      </p>
      {c.article_title_te ? (
        <p lang="te" className="te mt-1 text-te-body-xs text-muted">
          {c.article_title_te}
        </p>
      ) : null}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-meta text-muted">
        <span>{c.author ?? '?'}</span>
        <span>{when(c.created_at)}</span>
        <StatusPill status={c.status} />
      </p>
    </Split>
  );
}

export function SubmissionCard({
  submission: sub,
  busy,
  onApprove,
  onReject,
}: {
  submission: SubmissionRow;
  busy: 'approve' | 'reject' | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useI18n();
  const L = useL();
  const [expanded, setExpanded] = useState(false);
  const long = sub.body_te.length > 280;
  const meta = [
    sub.creator_phone ? `+${sub.creator_phone}` : null,
    sub.category_slug,
    sub.district_slug,
    when(sub.created_at),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Split
      actions={
        <>
          <Button size="sm" icon={Check} pending={busy === 'approve'} disabled={busy !== null} onClick={onApprove}>
            {L('ఆమోదించి సమీక్షకు', 'Approve for review')}
          </Button>
          <Button variant="danger" size="sm" icon={X} pending={busy === 'reject'} disabled={busy !== null} onClick={onReject}>
            {L('తిరస్కరించండి', 'Reject')}
          </Button>
        </>
      }
    >
      <h3 lang="te" className="th text-headline-xs font-bold text-ink">
        {sub.title_te}
      </h3>
      <p lang="te" className="te text-te-body-xs text-ink-soft">
        {sub.creator_name_te ?? '?'}
      </p>
      <p className="mt-1 font-sans text-meta text-muted">{meta}</p>
      <p
        lang="te"
        className={cn(
          'te mt-3 whitespace-pre-wrap rounded-xl bg-paper-sub p-3 text-te-body-xs text-ink-soft',
          long && !expanded && 'te-clamp-4',
        )}
      >
        {sub.body_te}
      </p>
      {long ? (
        <Button variant="link" size="sm" className="mt-1" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? L('తగ్గించండి', 'Show less') : t('ui.more')}
        </Button>
      ) : null}
    </Split>
  );
}
