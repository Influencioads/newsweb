import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Pencil, Plus, Search } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { WorkflowPill } from '@/components/admin/StatusPill';
import { Button, ButtonLink, IconButtonLink } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/Dialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { WORKFLOW_STATUS } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';
import type { CmsArticle } from '@/types/cms';
import { cn } from '@/utils/cn';
import { relativeTime } from '@/utils/time';

import { useL } from './useL';

/**
 * Articles — the editorial list from draft to publication.
 *
 * Search (`?q=`, so the topbar search lands here prefilled), a workflow-state
 * filter (`?state=`), offset paging and the per-row workflow transitions,
 * gated by the same permissions the backend re-checks. `WorkflowActions` is
 * shared with the pending queue: reject / unpublish confirm first, request
 * changes collects a reason, and approve is withheld on the editor's own
 * story (§6 four-eyes, as in the review queue).
 */

/** action → [te, en, permission], keyed by the state the article is in. */
const ACTIONS: Record<string, Array<[string, string, string, PermissionKey]>> = {
  DRAFT: [['submit', 'సమర్పించండి', 'Submit', 'article.submit']],
  CHANGES_REQUESTED: [['submit', 'మళ్లీ సమర్పించండి', 'Resubmit', 'article.submit']],
  SUBMITTED: [
    ['review', 'రివ్యూ ప్రారంభించండి', 'Start review', 'article.review'],
    ['approve', 'ఆమోదించండి', 'Approve', 'article.approve'],
    ['request-changes', 'మార్పులు కోరండి', 'Request changes', 'article.reject'],
  ],
  IN_REVIEW: [
    ['approve', 'ఆమోదించండి', 'Approve', 'article.approve'],
    ['request-changes', 'మార్పులు కోరండి', 'Request changes', 'article.reject'],
    ['reject', 'తిరస్కరించండి', 'Reject', 'article.reject'],
  ],
  APPROVED: [['publish', 'ప్రచురించండి', 'Publish', 'article.publish']],
  PUBLISHED: [['unpublish', 'ప్రచురణ ఆపండి', 'Unpublish', 'article.unpublish']],
};

/** Transitions that take the story away from readers or the author: confirm first. */
const CONFIRMED: Record<string, [string, string]> = {
  reject: ['ఈ కథనాన్ని తిరస్కరించాలా?', 'Reject this article?'],
  unpublish: ['ఈ కథనం ప్రచురణను ఆపాలా?', 'Take this article off the site?'],
};

/** Order of the state filter; the queue states double as quick chips. */
const STATES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'REJECTED', 'ARCHIVED'];
const QUICK_STATES = ['SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'];
const PAGE = 50;

function stateLabel(state: string, te: boolean): string {
  const entry = WORKFLOW_STATUS[state.toLowerCase() as keyof typeof WORKFLOW_STATUS];
  return entry ? (te ? entry.te : entry.en) : state.replaceAll('_', ' ');
}

/** The workflow transition buttons for one article; invalidates every CMS query on success. */
export function WorkflowActions({ article }: { article: CmsArticle }) {
  const { language, t } = useI18n();
  const L = useL();
  const s = useScript();
  const te = language === 'te';
  const can = useAuth((st) => st.can);
  const meId = useAuth((st) => st.me?.user.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [changesFor, setChangesFor] = useState(false);
  const transition = useMutation({
    mutationFn: ({ action, note }: { action: string; note?: string }) => cmsApi.transitionArticle(article.id, action, note),
    onSuccess: () => {
      toast.success(t('state.updated'));
      void qc.invalidateQueries({ queryKey: ['cms'] });
    },
    onError: (err) => toast.error(err),
  });

  const actions = (ACTIONS[article.workflow_state] ?? []).filter(([, , , perm]) => can(perm));
  if (!actions.length) return null;

  const title = s.text(article.title_te, article.title_en);
  const run = async (action: string, label: string) => {
    if (action === 'request-changes') {
      setChangesFor(true);
      return;
    }
    const ask = CONFIRMED[action];
    if (
      ask &&
      !(await confirm({
        title: ask[te ? 0 : 1],
        body: (
          <span lang={title.lang} className={title.cls}>
            {title.text}
          </span>
        ),
        tone: 'danger',
        confirmLabel: label,
      }))
    )
      return;
    transition.mutate({ action });
  };
  const requestChanges = async (values: Record<string, string>) => {
    try {
      await transition.mutateAsync({ action: 'request-changes', note: values.note });
      setChangesFor(false);
    } catch {
      // onError already toasted; the dialog stays open so the reason is not lost.
    }
  };

  return (
    <>
      {actions.map(([action, teLabel, enLabel]) =>
        action === 'approve' && meId !== null && article.author_id === meId ? (
          <span key={action} className={cn(s.body, 'text-meta text-muted')}>
            {t('admin.selfApprove')}
          </span>
        ) : (
          <Button
            key={action}
            size="sm"
            variant={action in CONFIRMED ? 'danger' : 'secondary'}
            pending={transition.isPending && transition.variables?.action === action}
            disabled={transition.isPending}
            onClick={() => void run(action, te ? teLabel : enLabel)}
          >
            {te ? teLabel : enLabel}
          </Button>
        ),
      )}
      <PromptDialog
        open={changesFor}
        onClose={() => setChangesFor(false)}
        title={L('మార్పులు కోరండి', 'Request changes')}
        description={L('రచయితకు ఏమి మార్చాలో తెలియజేయండి.', 'Tell the writer what needs to change.')}
        fields={[{ name: 'note', label: L('కారణం', 'Reason'), type: 'textarea', required: true }]}
        submitLabel={L('మార్పులు కోరండి', 'Request changes')}
        pending={transition.isPending}
        onSubmit={requestChanges}
      />
      {dialog}
    </>
  );
}

export default function Articles() {
  const { language, t } = useI18n();
  const L = useL();
  const s = useScript();
  const te = language === 'te';
  const can = useAuth((st) => st.can);
  const navigate = useNavigate();

  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const state = params.get('state') ?? '';
  const [search, setSearch] = useState(q);
  const [page, setPage] = useState(0);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Debounce typing into ?q=; a new ?q= from the topbar search refills the box.
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const id = window.setTimeout(() => setParam('q', search.trim()), 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => setPage(0), [q, state]);

  const query = useQuery({
    queryKey: ['cms', 'articles', { q, state, page }],
    queryFn: () => cmsApi.fetchArticles({ search: q || undefined, state: state || undefined, offset: page * PAGE, limit: PAGE }),
    placeholderData: keepPreviousData,
  });
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });
  const categorySlug = (id: number | null) => options.data?.categories.find((c) => c.id === id)?.slug ?? 'news';

  const rows = query.data?.articles ?? [];
  const total = query.data?.total ?? 0;
  const filtered = Boolean(q || state);

  const columns: DataTableColumn<CmsArticle>[] = [
    {
      key: 'title',
      header: L('శీర్షిక', 'Headline'),
      render: (a) => {
        const title = s.text(a.title_te, a.title_en);
        return (
          <>
            <Link
              to={`/admin/articles/${a.id}/edit`}
              lang={title.lang}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                title.cls,
                'inline-flex min-h-tap items-center font-semibold text-ink transition-[colors,transform,box-shadow,opacity] duration-base ease-standard hover:text-brand',
                title.telugu && 'text-te-body-sm',
              )}
            >
              {title.text}
            </Link>
            <span className="mt-0.5 block font-mono text-meta text-muted">
              #{a.id} · {a.short_id}
            </span>
          </>
        );
      },
    },
    { key: 'state', header: L('స్థితి', 'State'), nowrap: true, render: (a) => <WorkflowPill status={a.workflow_state} /> },
    {
      key: 'updated',
      header: L('నవీకరణ', 'Updated'),
      hideBelow: 'md',
      nowrap: true,
      render: (a) => (
        <time dateTime={a.updated_at} title={new Date(a.updated_at).toLocaleString(te ? 'te-IN' : 'en-IN')} className="text-muted">
          {relativeTime(a.updated_at, language)}
        </time>
      ),
    },
  ];

  return (
    <AdminPage
      title={t('admin.page.articles')}
      subtitle={L('డ్రాఫ్ట్ నుంచి ప్రచురణ వరకు సంపాదకీయ వర్క్‌ఫ్లో', 'Editorial workflow from draft to publication')}
      actions={
        can('article.create') ? (
          <ButtonLink to="/admin/articles/new" icon={Plus}>
            {t('admin.page.newArticle')}
          </ButtonLink>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="md:max-w-md md:flex-1">
            <Input
              type="search"
              leading={Search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.searchPlaceholder')}
              aria-label={t('ui.search')}
            />
          </div>
          <div className="md:w-56">
            <Select value={state} onChange={(e) => setParam('state', e.target.value)} aria-label={L('స్థితి', 'State')}>
              <option value="">{L('అన్ని స్థితులు', 'All states')}</option>
              {STATES.map((st) => (
                <option key={st} value={st}>
                  {stateLabel(st, te)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <ChipRail ariaLabel={L('స్థితి', 'State')}>
          <Chip selected={!state} onClick={() => setParam('state', '')}>
            {t('ui.showAll')}
          </Chip>
          {QUICK_STATES.map((st) => (
            <Chip key={st} selected={state === st} onClick={() => setParam('state', st)}>
              {stateLabel(st, te)}
            </Chip>
          ))}
        </ChipRail>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} title={L('కథనాలు లోడ్ కాలేదు.', 'Could not load articles.')} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(a) => a.id}
          loading={query.isLoading}
          caption={t('admin.page.articles')}
          onRowClick={(a) => navigate(`/admin/articles/${a.id}/edit`)}
          empty={
            <EmptyState
              icon={filtered ? Search : FileText}
              title={filtered ? t('state.noResults') : L('ఇంకా కథనాలు లేవు.', 'No articles yet.')}
              compact
            />
          }
          rowActions={(a) => (
            <>
              <WorkflowActions article={a} />
              {a.workflow_state === 'PUBLISHED' ? (
                <IconButtonLink to={`/${categorySlug(a.category_id)}/${a.slug}-${a.short_id}`} external icon={ExternalLink} label={L('చూడండి', 'View')} />
              ) : null}
              <IconButtonLink to={`/admin/articles/${a.id}/edit`} icon={Pencil} label={t('ui.edit')} />
            </>
          )}
        />
      )}

      {total > PAGE ? (
        <nav aria-label={L('పేజీ నావిగేషన్', 'Pagination')} className="flex items-center justify-between gap-3">
          <p className={cn(s.body, 'text-ui-sm tabular-nums text-muted')}>
            {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} / {total}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {t('ui.previous')}
            </Button>
            <Button variant="secondary" size="sm" iconRight={ChevronRight} disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
              {t('ui.next')}
            </Button>
          </div>
        </nav>
      ) : null}
    </AdminPage>
  );
}
