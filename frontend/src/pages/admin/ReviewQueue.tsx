import { useState } from 'react';
import { useMutation, useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, Undo2 } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { WorkflowPill } from '@/components/admin/StatusPill';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PromptDialog } from '@/components/ui/Dialog';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';
import type { CmsArticle, CmsArticleList } from '@/types/cms';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

import { useL } from './useL';

/**
 * Editor review queue — a three-column kanban of everything between
 * submission and publication (SUBMITTED → IN_REVIEW → APPROVED).
 *
 * Each column is one `fetchArticles({ state })` query; every tile offers the
 * column's forward transition plus "request changes" (with a reason, via
 * PromptDialog), each gated by the same permission the Articles list uses.
 * Approve is withheld on the editor's own articles (§6 four-eyes; the backend
 * enforces it too). The APPROVED column keeps the legacy publish transition
 * and nothing more.
 */

interface Column {
  state: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED';
  te: string;
  en: string;
  action: 'review' | 'approve' | 'publish';
  actionTe: string;
  actionEn: string;
  permission: PermissionKey;
}

const COLUMNS: Column[] = [
  { state: 'SUBMITTED', te: 'సమర్పించినవి', en: 'Submitted', action: 'review', actionTe: 'రివ్యూ ప్రారంభించండి', actionEn: 'Start review', permission: 'article.review' },
  { state: 'IN_REVIEW', te: 'రివ్యూలో', en: 'In review', action: 'approve', actionTe: 'ఆమోదించండి', actionEn: 'Approve', permission: 'article.approve' },
  { state: 'APPROVED', te: 'ఆమోదించినవి', en: 'Approved', action: 'publish', actionTe: 'ప్రచురించండి', actionEn: 'Publish', permission: 'article.publish' },
];

/** "Request changes" is a reject-class transition. */
const REQUEST_CHANGES_PERMISSION: PermissionKey = 'article.reject';

/** Tiles older than this (since last update) get the breaking-toned age chip. */
const OVERDUE_MINUTES = 30;

function ageMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

function ageLabel(minutes: number, en: boolean): string {
  return minutes < 60 ? `${minutes} ${en ? 'min' : 'ని.'}` : `${Math.floor(minutes / 60)} ${en ? 'hr' : 'గం.'}`;
}

interface Transition {
  id: number;
  action: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

interface ReviewTileProps {
  article: CmsArticle;
  column: Column;
  /** Any transition is in flight — every action waits. */
  busy: boolean;
  /** This tile's transition is the one in flight. */
  pending: boolean;
  selfAuthored: boolean;
  onAction: (action: string) => void;
  onRequestChanges: () => void;
  reveal: (el: HTMLElement | null) => void;
}

function ReviewTile({ article, column, busy, pending, selfAuthored, onAction, onRequestChanges, reveal }: ReviewTileProps) {
  const { t, language } = useI18n();
  const L = useL();
  const s = useScript();
  const can = useAuth((st) => st.can);
  const en = language === 'en';
  const minutes = ageMinutes(article.updated_at);
  const title = s.text(article.title_te, article.title_en);
  const selfApprove = column.action === 'approve' && selfAuthored;

  return (
    <Card as="article" padding="sm" interactive ref={reveal}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-meta text-muted">
          #{article.id} · {article.short_id}
        </span>
        <Badge tone={minutes > OVERDUE_MINUTES ? 'breaking' : 'muted'} size="xs" icon={Clock} className="tabular-nums">
          {ageLabel(minutes, en)}
        </Badge>
      </div>

      <Link
        to={`/admin/articles/${article.id}/edit`}
        lang={title.lang}
        className={cn(
          title.head,
          'te-clamp-2 mt-2 min-h-tap text-headline-xs font-bold text-ink transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand',
        )}
      >
        {title.text}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <WorkflowPill status={article.workflow_state} />
        {article.byline_te ? (
          <span lang="te" className="te te-clamp-1 min-w-0 text-meta text-muted">
            {article.byline_te}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {selfApprove ? (
          <span className={cn(s.body, 'text-meta text-muted')}>{t('admin.selfApprove')}</span>
        ) : can(column.permission) ? (
          <Button size="sm" pending={pending} disabled={busy} onClick={() => onAction(column.action)}>
            {en ? column.actionEn : column.actionTe}
          </Button>
        ) : null}
        {column.state !== 'APPROVED' && can(REQUEST_CHANGES_PERMISSION) ? (
          <Button size="sm" variant="secondary" icon={Undo2} disabled={busy} onClick={onRequestChanges}>
            {L('మార్పులు', 'Request changes')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

interface ReviewColumnProps {
  column: Column;
  query: UseQueryResult<CmsArticleList>;
  busy: boolean;
  pendingId: number | null;
  meId: number | null;
  onAction: (id: number, action: string) => void;
  onRequestChanges: (id: number) => void;
}

function ReviewColumn({ column, query, busy, pendingId, meId, onAction, onRequestChanges }: ReviewColumnProps) {
  const { language } = useI18n();
  const en = language === 'en';
  const reveal = useReveal<HTMLElement>();

  return (
    <Card as="section" padding="sm" tone="paper" aria-label={en ? column.en : column.te}>
      <SectionHeader
        level={2}
        tone="ink"
        title={en ? column.en : column.te}
        action={
          <Badge tone="brand" lang="en" className="tabular-nums">
            {query.data?.total ?? 0}
          </Badge>
        }
      />
      <QueryState
        query={query}
        compact
        isEmpty={(d) => d.articles.length === 0}
        skeleton={
          <div className="flex flex-col gap-3">
            <SkeletonCard variant="compact" />
            <SkeletonCard variant="compact" />
            <SkeletonCard variant="compact" />
          </div>
        }
        empty={<EmptyState compact title={en ? 'No articles in this queue.' : 'ఈ క్యూలో కథనాలు లేవు.'} />}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            {data.articles.map((a) => (
              <ReviewTile
                key={a.id}
                article={a}
                column={column}
                busy={busy}
                pending={pendingId === a.id}
                selfAuthored={meId !== null && a.author_id === meId}
                onAction={(action) => onAction(a.id, action)}
                onRequestChanges={() => onRequestChanges(a.id)}
                reveal={reveal}
              />
            ))}
          </div>
        )}
      </QueryState>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewQueue() {
  const { t } = useI18n();
  const L = useL();
  const me = useAuth((s) => s.me);
  const toast = useToast();
  const client = useQueryClient();
  const [changesFor, setChangesFor] = useState<number | null>(null);

  const queries = useQueries({
    queries: COLUMNS.map((c) => ({
      queryKey: ['cms', 'review', c.state],
      queryFn: () => cmsApi.fetchArticles({ state: c.state, limit: 100 }),
    })),
  });

  const transition = useMutation({
    mutationFn: ({ id, action, note }: Transition) => cmsApi.transitionArticle(id, action, note),
    onSuccess: () => {
      toast.success(t('state.updated'));
      void client.invalidateQueries({ queryKey: ['cms'] });
    },
    onError: (err) => toast.error(err),
  });

  const requestChanges = async (values: Record<string, string>) => {
    if (changesFor === null) return;
    try {
      await transition.mutateAsync({ id: changesFor, action: 'request-changes', note: values.note });
      setChangesFor(null);
    } catch {
      // onError already toasted; the dialog stays open so the reason is not lost.
    }
  };

  return (
    <AdminPage
      title={t('admin.page.review')}
      subtitle={L('సమర్పణ నుంచి ప్రచురణ వరకు ప్రత్యక్ష సంపాదకీయ స్థితి', 'Live editorial status from submission to publication')}
    >
      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        {COLUMNS.map((column, i) => {
          const query = queries[i];
          if (!query) return null;
          return (
            <ReviewColumn
              key={column.state}
              column={column}
              query={query}
              busy={transition.isPending}
              pendingId={transition.isPending ? transition.variables.id : null}
              meId={me?.user.id ?? null}
              onAction={(id, action) => transition.mutate({ id, action })}
              onRequestChanges={setChangesFor}
            />
          );
        })}
      </div>

      <PromptDialog
        open={changesFor !== null}
        onClose={() => setChangesFor(null)}
        title={L('మార్పులు కోరండి', 'Request changes')}
        description={L('రచయితకు ఏమి మార్చాలో తెలియజేయండి.', 'Tell the writer what needs to change.')}
        fields={[{ name: 'note', label: L('కారణం', 'Reason'), type: 'textarea', required: true }]}
        submitLabel={L('మార్పులు కోరండి', 'Request changes')}
        pending={transition.isPending}
        onSubmit={requestChanges}
      />
    </AdminPage>
  );
}
