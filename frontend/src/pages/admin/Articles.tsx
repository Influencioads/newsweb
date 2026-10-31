import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { WorkflowPill } from '@/components/admin/StatusPill';
import { Button, ButtonLink, IconButton, IconButtonLink } from '@/components/ui/Button';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { Checkbox } from '@/components/ui/Choice';
import { useConfirm } from '@/components/ui/Dialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { WORKFLOW_STATUS } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import { LEVEL_SELF_APPROVE, useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';
import type { CmsArticle } from '@/types/cms';
import { cn } from '@/utils/cn';
import { relativeTime } from '@/utils/time';

import { useL } from './useL';

/**
 * Articles — the editorial list from draft to publication.
 *
 * Search (`?q=`, so the topbar search lands here prefilled), a workflow-state
 * filter (`?state=`), a category filter (`?category=`) and column, offset paging and the per-row workflow transitions,
 * gated by the same permissions the backend re-checks. `WorkflowActions` is
 * shared with the pending queue: reject / unpublish confirm first, request
 * changes collects a reason, and approve is withheld on the editor's own
 * story (§6 four-eyes, as in the review queue). Whoever may delete also gets
 * a checkbox per row, "select all" for the page and "Delete selected".
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
  // Admins may approve their own copy, so for them nothing is "self".
  const meId = useAuth((st) => (st.hasLevel(LEVEL_SELF_APPROVE) ? null : st.me?.user.id ?? null));
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

/**
 * Delete, for whoever holds `article.delete` — super admin, admin and
 * editor-in-chief. A soft delete: the story leaves the site and every CMS
 * list, but stays in the database (and the audit log) and can be restored.
 */
export function DeleteArticleButton({ article }: { article: CmsArticle }) {
  const { t } = useI18n();
  const L = useL();
  const s = useScript();
  const can = useAuth((st) => st.can);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const remove = useMutation({
    mutationFn: () => cmsApi.deleteArticle(article.id),
    onSuccess: () => {
      toast.success(t('state.deleted'));
      void qc.invalidateQueries({ queryKey: ['cms'] });
    },
    onError: (err) => toast.error(err),
  });
  if (!can('article.delete')) return null;

  const title = s.text(article.title_te, article.title_en);
  const run = async () => {
    const ok = await confirm({
      title: L('ఈ కథనాన్ని తొలగించాలా?', 'Delete this article?'),
      body: (
        <>
          <span lang={title.lang} className={cn(title.cls, 'block')}>
            {title.text}
          </span>
          <span className={cn(s.body, 'mt-2 block text-meta text-muted')}>
            {L(
              'ఇది సైట్ నుంచి, CMS జాబితాల నుంచి తొలగిపోతుంది. డేటాబేస్‌లో భద్రంగా ఉంటుంది, తిరిగి తీసుకురావచ్చు.',
              'It disappears from the site and the CMS lists. It stays in the database and can be restored.',
            )}
          </span>
        </>
      ),
      tone: 'danger',
      confirmLabel: t('ui.delete'),
    });
    if (ok) remove.mutate();
  };

  return (
    <>
      <IconButton icon={Trash2} label={t('ui.delete')} variant="danger" pending={remove.isPending} onClick={() => void run()} />
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
  const category = params.get('category') ?? '';
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
  useEffect(() => setPage(0), [q, state, category]);

  // Bulk delete: the selection is the rows ticked on this page.
  const canDelete = can('article.delete');
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  useEffect(() => setSelected(new Set()), [q, state, category, page]);
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const bulkDelete = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => cmsApi.deleteArticle(id)));
      return { done: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
    },
    onSuccess: ({ done, failed }) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['cms'] });
      if (done) toast.success(L(`${done} కథనాలు తొలగించబడ్డాయి`, `${done} deleted`));
      if (failed) toast.error(L(`${failed} కథనాలు తొలగించలేకపోయాం`, `${failed} could not be deleted`));
    },
    onError: (err) => toast.error(err),
  });

  const query = useQuery({
    queryKey: ['cms', 'articles', { q, state, category, page }],
    queryFn: () =>
      cmsApi.fetchArticles({
        search: q || undefined,
        state: state || undefined,
        category_id: category ? Number(category) : undefined,
        offset: page * PAGE,
        limit: PAGE,
      }),
    placeholderData: keepPreviousData,
  });
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });
  const categories = options.data?.categories ?? [];
  const categoryOf = (id: number | null) => categories.find((c) => c.id === id);
  // The filter lists each section with its sub-sections straight after it.
  const categoryChoices = categories
    .filter((c) => !c.parent_id)
    .flatMap((c) => [c, ...categories.filter((sub) => sub.parent_id === c.id)]);
  const categorySlug = (id: number | null) => categoryOf(id)?.slug ?? 'news';

  const rows = query.data?.articles ?? [];
  const total = query.data?.total ?? 0;
  const filtered = Boolean(q || state || category);
  const allOnPage = rows.length > 0 && rows.every((a) => selected.has(a.id));
  const selectAll = (on: boolean) => setSelected(on ? new Set(rows.map((a) => a.id)) : new Set());
  const askBulkDelete = async () => {
    const ids = [...selected];
    const ok = await confirm({
      title: L(`${ids.length} కథనాలను తొలగించాలా?`, ids.length === 1 ? 'Delete 1 article?' : `Delete ${ids.length} articles?`),
      body: L(
        'ఇవి సైట్ నుంచి, CMS జాబితాల నుంచి తొలగిపోతాయి. డేటాబేస్‌లో భద్రంగా ఉంటాయి, తిరిగి తీసుకురావచ్చు.',
        'They disappear from the site and the CMS lists. They stay in the database and can be restored.',
      ),
      tone: 'danger',
      confirmLabel: L('తొలగించండి', 'Delete'),
    });
    if (ok) bulkDelete.mutate(ids);
  };

  /** A tick box that never opens the row it sits in. */
  const tick = (checked: boolean, onChange: (on: boolean) => void, label: string) => (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Checkbox checked={checked} onChange={onChange} label={<span className="sr-only">{label}</span>} className="py-0" />
    </span>
  );

  const columns: DataTableColumn<CmsArticle>[] = [
    ...(canDelete
      ? [
          {
            key: 'select',
            header: tick(allOnPage, selectAll, L('ఈ పేజీలోని అన్నీ ఎంచుకోండి', 'Select all on this page')),
            width: 'w-12',
            render: (a: CmsArticle) => tick(selected.has(a.id), (on) => toggle(a.id, on), `${L('ఎంచుకోండి', 'Select')} #${a.id}`),
          },
        ]
      : []),
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
    {
      key: 'category',
      header: L('విభాగం', 'Category'),
      nowrap: true,
      render: (a) => {
        const cat = categoryOf(a.category_id);
        const sub = categoryOf(a.subcategory_id);
        const more = (a.extra_category_ids ?? []).map(categoryOf).filter((c) => c !== undefined);
        if (!cat) return <span className="text-muted">—</span>;
        return (
          <span className={cn(s.body, 'text-ui-sm text-ink')}>
            <span className="font-semibold">{te ? cat.name_te : cat.name_en}</span>
            {sub ? <span className="block text-meta text-muted">{te ? sub.name_te : sub.name_en}</span> : null}
            {more.map((c) => (
              <span key={c.id} className="block text-meta text-muted">
                + {te ? c.name_te : c.name_en}
              </span>
            ))}
          </span>
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
            <Select value={category} onChange={(e) => setParam('category', e.target.value)} aria-label={L('విభాగం', 'Category')}>
              <option value="">{L('అన్ని విభాగాలు', 'All categories')}</option>
              {categoryChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? '— ' : ''}
                  {te ? c.name_te : c.name_en}
                </option>
              ))}
            </Select>
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
        {canDelete && rows.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rule bg-paper px-3 py-2">
            <Checkbox
              checked={allOnPage}
              onChange={selectAll}
              label={L(`ఈ పేజీలోని అన్నీ (${rows.length})`, `Select all on this page (${rows.length})`)}
              className="py-0"
            />
            {selected.size ? (
              <>
                <span className={cn(s.body, 'text-ui-sm font-semibold text-ink')}>
                  · {L(`${selected.size} ఎంచుకున్నారు`, `${selected.size} selected`)}
                </span>
                <span className="ml-auto flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" icon={X} onClick={() => setSelected(new Set())}>
                    {L('ఎంపిక తీసేయండి', 'Clear')}
                  </Button>
                  <Button variant="danger" size="sm" icon={Trash2} pending={bulkDelete.isPending} onClick={() => void askBulkDelete()}>
                    {L(`ఎంచుకున్నవి తొలగించండి (${selected.size})`, `Delete selected (${selected.size})`)}
                  </Button>
                </span>
              </>
            ) : null}
          </div>
        ) : null}
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
              <DeleteArticleButton article={a} />
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
      {dialog}
    </AdminPage>
  );
}
