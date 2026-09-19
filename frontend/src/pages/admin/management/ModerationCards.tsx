import { useState, type ReactNode } from 'react';
import { Check, ExternalLink, Eye, EyeOff, FileText, Flag, MessageSquare, Pin, Undo2, X } from 'lucide-react';

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
  /** Open reports against this same target, this one included. */
  report_count: number;
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
  is_pinned: boolean;
  /** Editorially seeded: no account behind it, so the name is not a reader. */
  is_seeded: boolean;
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
  vertical?: string | null;
  /** Photographs the contributor attached. Resolved server-side to URLs,
   *  because a moderator cannot look at a media id. */
  media?: { id: number; url: string | null; alt_te: string | null }[];
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

export type ReportBusy = 'hide' | 'resolve' | 'dismiss' | 'unpublish' | null;

export function ReportCard({
  report: r,
  busy,
  canUnpublish,
  onHide,
  onUnpublish,
  onResolve,
  onDismiss,
}: {
  report: ReportRow;
  busy: ReportBusy;
  /**
   * `article.unpublish`, which a moderator does not hold. Taking a story off
   * the site is an editorial act, so for a moderator the button is absent
   * rather than disabled — a control that always 403s teaches people to ignore
   * permission errors.
   */
  canUnpublish: boolean;
  onHide: () => void;
  onUnpublish: () => void;
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
          {!isComment && canUnpublish ? (
            <Button variant="danger" size="sm" icon={Undo2} pending={busy === 'unpublish'} disabled={busy !== null} onClick={onUnpublish}>
              {L('ప్రచురణ ఉపసంహరించండి', 'Unpublish')}
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
        {/* Three complaints about one story is a different fact from one, and
            the queue is already ordered by it — say the number out loud. */}
        {r.report_count > 1 ? (
          <Badge tone="breaking" size="xs">
            {r.report_count} {L('నివేదికలు', 'reports')}
          </Badge>
        ) : null}
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
  onPin,
}: {
  comment: CommentRow;
  busy: boolean;
  onHide: () => void;
  onRestore: () => void;
  /** Promote to the top of the thread. Moderation, so no new permission. */
  onPin: (pinned: boolean) => void;
}) {
  const L = useL();
  return (
    <Split
      actions={
        c.status === 'visible' ? (
          <>
            <Button
              variant={c.is_pinned ? 'primary' : 'secondary'}
              size="sm"
              icon={Pin}
              pending={busy}
              onClick={() => onPin(!c.is_pinned)}
            >
              {c.is_pinned ? L('పిన్ తీయండి', 'Unpin') : L('పిన్ చేయండి', 'Pin')}
            </Button>
            <Button variant="danger" size="sm" icon={EyeOff} pending={busy} onClick={onHide}>
              {L('దాచండి', 'Hide')}
            </Button>
          </>
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
        {c.is_pinned ? <Badge tone="brand" size="xs">{L('పిన్ చేసినది', 'Pinned')}</Badge> : null}
        {/* Say so plainly in the queue: a moderator must never mistake a
            seeded comment for a reader they could look up. */}
        {c.is_seeded ? <Badge tone="partial" size="xs">{L('సీడ్', 'Seeded')}</Badge> : null}
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
      {sub.media?.length ? (
        <div className="mt-3">
          <p className="font-sans text-meta text-muted">
            {L(`ఫోటోలు (${sub.media.length})`, `Photographs (${sub.media.length})`)}
          </p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {sub.media.map((photo) => (
              <li key={photo.id}>
                {/* Opens full size: approving a photo you only saw at 80px is
                    not reviewing it. */}
                <a href={photo.url ?? '#'} target="_blank" rel="noreferrer">
                  <img
                    src={photo.url ?? ''}
                    alt={photo.alt_te ?? ''}
                    loading="lazy"
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Split>
  );
}
