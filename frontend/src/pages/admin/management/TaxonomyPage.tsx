import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Choice';
import { useConfirm } from '@/components/ui/Dialog';
import { SectionHeader } from '@/components/ui/Layout';
import { PromptDialog, type PromptField } from '@/components/ui/PromptDialog';
import { QueryState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';

import { rowKey, useColumn, useL, type Row } from './shared';

/**
 * Taxonomy — categories are managed here (add, edit, nest one level, reorder,
 * hide, delete); districts and tags stay a read-only catalogue.
 */

type CategoryRow = {
  id: number;
  slug: string;
  name_te: string;
  name_en: string;
  parent_id: number | null;
  description_te: string | null;
  sort: number;
  is_active: boolean;
  show_in_nav: boolean;
  article_count: number;
};
type TaxonomyPayload = { categories: CategoryRow[]; districts: Row[]; tags: Row[] };

/** Self-published panchayat copy is filed under this slug; the server refuses to rename, move or delete it. */
const SYSTEM_SLUG = 'panchayat';

/** What a 409 on delete counts, in the server's keys. */
const COUNT_LABELS: Record<string, [string, string]> = {
  articles: ['కథనాలు', 'stories'],
  videos: ['వీడియోలు', 'videos'],
  sources: ['ఫీడ్ మూలాలు', 'feed sources'],
  submissions: ['పాఠకుల సమర్పణలు', 'reader submissions'],
  ad_campaigns: ['ప్రకటనలు', 'ad campaigns'],
};

/** Top-level categories by sort, each followed by its sub-categories. */
function toTree(rows: CategoryRow[]) {
  const bySort = [...rows].sort((a, b) => a.sort - b.sort || a.id - b.id);
  return bySort
    .filter((c) => c.parent_id == null)
    .map((cat) => ({ cat, kids: bySort.filter((k) => k.parent_id === cat.id) }));
}

function swapped<T>(list: T[], i: number, j: number): T[] | null {
  const a = list[i];
  const b = list[j];
  if (a === undefined || b === undefined) return null;
  const next = [...list];
  next[i] = b;
  next[j] = a;
  return next;
}

export function TaxonomyPage() {
  const { t, pick } = useI18n();
  const { forText } = useScript();
  const L = useL();
  const col = useColumn();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const canManage = useAuth((st) => st.can)('taxonomy.manage');
  const [editing, setEditing] = useState<{ cat: CategoryRow | null } | null>(null);
  const [moving, setMoving] = useState<{ cat: CategoryRow; counts: Record<string, number> } | null>(null);
  const q = useQuery({ queryKey: ['cms', 'taxonomy'], queryFn: () => cmsApi.fetchManagement<TaxonomyPayload>('taxonomy') });

  const tree = useMemo(() => toTree(q.data?.categories ?? []), [q.data]);
  const flat = tree.flatMap((n) => [n.cat, ...n.kids]);

  // The article editor's pickers, the homepage section list and both readers'
  // nav and home all read categories.
  const invalidate = () => {
    for (const queryKey of [['cms', 'taxonomy'], ['cms', 'editor-options'], ['cms', 'home-sections'], ['public', 'config'], ['public', 'home']])
      void queryClient.invalidateQueries({ queryKey });
  };
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Record<string, unknown> }) =>
      id == null ? cmsApi.createCategory(body) : cmsApi.patchCategory(id, body),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => cmsApi.reorderCategories(ids),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });
  const remove = useMutation({
    mutationFn: ({ cat, moveTo }: { cat: CategoryRow; moveTo?: number }) => cmsApi.deleteCategory(cat.id, moveTo),
    onSuccess: () => {
      invalidate();
      setMoving(null);
      toast.success(t('state.deleted'));
    },
    onError: (err, { cat, moveTo }) => {
      // Content still filed here: ask where it goes, then retry with move_to.
      const counts = err instanceof ApiError && err.status === 409 ? err.details.counts : undefined;
      if (counts && moveTo == null) setMoving({ cat, counts: counts as Record<string, number> });
      else toast.error(err);
    },
  });

  const label = (c: CategoryRow) => pick(c.name_te, c.name_en) || c.slug;
  const nameOf = (c: CategoryRow) => {
    const a = forText(c.name_te, c.name_en);
    return (
      <span lang={a.lang} className={a.cls}>
        {label(c)}
      </span>
    );
  };
  const countsText = (counts: Record<string, number>) =>
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => {
        const [te, en] = COUNT_LABELS[k] ?? [k, k];
        return `${n} ${L(te, en)}`;
      })
      .join(', ');

  const siblingsOf = (c: CategoryRow) =>
    c.parent_id == null ? tree.map((n) => n.cat) : (tree.find((n) => n.cat.id === c.parent_id)?.kids ?? []);

  /** Swap with the neighbouring sibling; a top-level move carries its sub-categories along. */
  function move(c: CategoryRow, delta: -1 | 1) {
    let next: typeof tree | null;
    if (c.parent_id == null) {
      const i = tree.findIndex((n) => n.cat.id === c.id);
      next = swapped(tree, i, i + delta);
    } else {
      next = tree.map((n) => {
        if (n.cat.id !== c.parent_id) return n;
        const i = n.kids.findIndex((k) => k.id === c.id);
        return { ...n, kids: swapped(n.kids, i, i + delta) ?? n.kids };
      });
    }
    if (next) reorder.mutate(next.flatMap((n) => [n.cat.id, ...n.kids.map((k) => k.id)]));
  }

  const removeCategory = async (c: CategoryRow) => {
    const ok = await confirm({
      title: L('ఈ విభాగాన్ని తొలగించాలా?', 'Delete this category?'),
      body: (
        <>
          {nameOf(c)} — {t('state.confirmDelete')}
        </>
      ),
      tone: 'danger',
      confirmLabel: t('ui.delete'),
    });
    if (ok) remove.mutate({ cat: c });
  };

  const yesNo = [
    { value: 'true', label: t('ui.yes') },
    { value: 'false', label: t('ui.no') },
  ];
  const editFields = (c: CategoryRow | null): PromptField[] => {
    const hasKids = c != null && flat.some((k) => k.parent_id === c.id);
    return [
      { name: 'name_te', label: L('పేరు (తెలుగు)', 'Name (Telugu)'), required: true, defaultValue: c?.name_te ?? '' },
      { name: 'name_en', label: L('పేరు (ఇంగ్లీష్)', 'Name (English)'), required: true, defaultValue: c?.name_en ?? '' },
      {
        name: 'slug',
        label: 'Slug',
        required: true,
        defaultValue: c?.slug ?? '',
        placeholder: 'agriculture',
        hint: L('ఆంగ్ల చిన్న అక్షరాలు, అంకెలు, "-" మాత్రమే — లింకుల్లో కనిపిస్తుంది', 'Lowercase a–z, 0–9 and "-" only — it appears in links'),
      },
      {
        name: 'parent_id',
        label: L('ప్రధాన విభాగం', 'Parent category'),
        type: 'select',
        defaultValue: String(c?.parent_id ?? ''),
        options: [
          { value: '', label: L('ఏదీ లేదు — ప్రధాన విభాగం', 'None — top level') },
          ...(hasKids ? [] : tree.filter((n) => n.cat.id !== c?.id).map((n) => ({ value: String(n.cat.id), label: label(n.cat) }))),
        ],
        hint: hasKids ? L('దీనికి ఉప-విభాగాలు ఉన్నాయి, కాబట్టి ఇది ప్రధాన విభాగంగానే ఉంటుంది', 'It has sub-categories, so it stays top level') : undefined,
      },
      { name: 'description_te', label: L('వివరణ', 'Description'), type: 'textarea', defaultValue: c?.description_te ?? '' },
      // A new one is left to the server: top level joins the nav, a sub-category doesn't.
      ...(c
        ? [
            {
              name: 'show_in_nav',
              label: L('నావిగేషన్‌లో చూపించాలా?', 'Show in navigation?'),
              type: 'select' as const,
              defaultValue: String(c.show_in_nav),
              options: yesNo,
              hint: L('ప్రధాన విభాగానికి హోమ్ పేజీ బ్లాక్ కూడా వస్తుంది', 'A top-level category also gets a home-page block'),
            },
          ]
        : []),
      {
        name: 'is_active',
        label: L('క్రియాశీలమా?', 'Active?'),
        type: 'select',
        defaultValue: String(c?.is_active ?? true),
        options: yesNo,
        hint: L('ఆపితే పాఠకులకు కనిపించదు; కథనాలు అలాగే ఉంటాయి', 'Inactive hides it from readers; its stories stay'),
      },
    ];
  };

  const flag = (c: CategoryRow, key: 'show_in_nav' | 'is_active', title: string) =>
    canManage ? (
      <Switch
        checked={c[key]}
        onChange={(v) => save.mutate({ id: c.id, body: { [key]: v } })}
        disabled={save.isPending}
        label={<span className="sr-only">{title}</span>}
        className="py-0"
      />
    ) : (
      <Badge tone={c[key] ? 'success' : 'muted'} size="xs">
        {t(c[key] ? 'ui.yes' : 'ui.no')}
      </Badge>
    );

  const categoryColumns: DataTableColumn<CategoryRow>[] = [
    ...(canManage
      ? [
          {
            key: 'order',
            header: '#',
            lang: 'en' as const,
            nowrap: true,
            render: (c: CategoryRow) => {
              const sibs = siblingsOf(c);
              const i = sibs.findIndex((s) => s.id === c.id);
              return (
                <span className={cn('flex items-center gap-1', c.parent_id != null && 'ps-6')}>
                  <IconButton icon={ArrowUp} label={L('పైకి', 'Move up')} onClick={() => move(c, -1)} disabled={i <= 0 || reorder.isPending} />
                  <IconButton
                    icon={ArrowDown}
                    label={L('కిందకు', 'Move down')}
                    onClick={() => move(c, 1)}
                    disabled={i === sibs.length - 1 || reorder.isPending}
                  />
                </span>
              );
            },
          },
        ]
      : []),
    {
      key: 'name_te',
      header: L('పేరు (తెలుగు)', 'Name (Telugu)'),
      lang: 'te',
      render: (c) => (
        <span className={cn('font-semibold', c.parent_id != null && 'ps-6 font-normal', !c.is_active && 'text-muted')}>
          {c.parent_id != null && <span aria-hidden>↳ </span>}
          {c.name_te}
        </span>
      ),
    },
    { key: 'name_en', header: L('పేరు (ఇంగ్లీష్)', 'Name (English)'), lang: 'en', hideBelow: 'md', render: (c) => c.name_en },
    { key: 'slug', header: 'Slug', lang: 'en', hideBelow: 'md', render: (c) => <span className="font-mono text-meta">{c.slug}</span> },
    {
      key: 'article_count',
      header: L('కథనాలు', 'Stories'),
      lang: 'en',
      align: 'right',
      nowrap: true,
      render: (c) => <span className="tabular-nums">{c.article_count}</span>,
    },
    { key: 'show_in_nav', header: L('నావిగేషన్', 'In nav'), nowrap: true, render: (c) => flag(c, 'show_in_nav', L('నావిగేషన్', 'In nav')) },
    { key: 'is_active', header: L('క్రియాశీలం', 'Active'), nowrap: true, render: (c) => flag(c, 'is_active', L('క్రియాశీలం', 'Active')) },
  ];

  const name = col('name_te', L('పేరు', 'Name'));
  const active = col('active', L('క్రియాశీలం', 'Active'));
  const groups: Array<{ key: 'districts' | 'tags'; title: string; columns: Array<typeof name> }> = [
    { key: 'districts', title: L('జిల్లాలు', 'Districts'), columns: [name, col('state', L('రాష్ట్రం', 'State')), col('slug', 'Slug'), active] },
    {
      key: 'tags',
      title: L('ట్యాగ్‌లు', 'Tags'),
      columns: [name, col('type', L('రకం', 'Type')), col('usage_count', L('వినియోగం', 'Usage'), { align: 'right' }), active],
    },
  ];
  const categoriesTitle = L('విభాగాలు', 'Categories');

  return (
    <AdminPage
      title={t('admin.page.taxonomy')}
      subtitle={L('విభాగాలు, జిల్లాలు మరియు ట్యాగ్‌ల కేంద్ర జాబితా', 'Central catalogue of sections, districts, and tags')}
    >
      <QueryState query={q} skeleton={<DataTable rows={[]} columns={categoryColumns} rowKey={(c) => c.id} loading />}>
        {(data) => (
          <>
            <section aria-label={categoriesTitle}>
              <SectionHeader
                title={categoriesTitle}
                tone="ink"
                action={
                  <span className="flex items-center gap-2">
                    <Badge lang="en" className="tabular-nums">
                      {data.categories.length}
                    </Badge>
                    {canManage && (
                      <Button size="sm" icon={Plus} onClick={() => setEditing({ cat: null })}>
                        {t('ui.add')}
                      </Button>
                    )}
                  </span>
                }
              />
              <DataTable
                rows={flat}
                columns={categoryColumns}
                rowKey={(c) => c.id}
                caption={categoriesTitle}
                rowActions={
                  canManage
                    ? (c) => (
                        <>
                          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing({ cat: c })}>
                            {t('ui.edit')}
                          </Button>
                          {c.slug !== SYSTEM_SLUG && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Trash2}
                              onClick={() => void removeCategory(c)}
                              pending={remove.isPending && remove.variables?.cat.id === c.id}
                            >
                              {t('ui.delete')}
                            </Button>
                          )}
                        </>
                      )
                    : undefined
                }
              />
            </section>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.title}>
                <SectionHeader
                  title={g.title}
                  tone="ink"
                  action={
                    <Badge lang="en" className="tabular-nums">
                      {data[g.key].length}
                    </Badge>
                  }
                />
                <DataTable rows={data[g.key]} columns={g.columns} rowKey={rowKey} caption={g.title} />
              </section>
            ))}
          </>
        )}
      </QueryState>

      <PromptDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.cat ? nameOf(editing.cat) : L('కొత్త విభాగం', 'New category')}
        fields={editing ? editFields(editing.cat) : []}
        pending={save.isPending}
        onSubmit={(v) => {
          if (!editing) return;
          const text = (k: string) => (v[k] ?? '').trim();
          const body = {
            name_te: text('name_te'),
            name_en: text('name_en'),
            slug: text('slug').toLowerCase(),
            parent_id: text('parent_id') ? Number(text('parent_id')) : null,
            description_te: text('description_te') || null,
            ...(editing.cat ? { show_in_nav: v.show_in_nav === 'true' } : {}),
            is_active: v.is_active === 'true',
          };
          // Failure already toasts via onError; the dialog stays open for a retry.
          save.mutateAsync({ id: editing.cat?.id, body }).then(
            () => setEditing(null),
            () => undefined,
          );
        }}
      />
      <PromptDialog
        open={moving !== null}
        onClose={() => setMoving(null)}
        title={L('కంటెంట్‌ను ఎక్కడికి మార్చాలి?', 'Move its content where?')}
        description={
          moving
            ? `${L('ఈ విభాగంలో ఇంకా ఉన్నాయి', 'This category still holds')}: ${countsText(moving.counts)}. ${L(
                'అవన్నీ మీరు ఎంచుకున్న విభాగానికి వెళ్తాయి, తర్వాత ఇది తొలగించబడుతుంది.',
                'Everything moves to the category you pick, then this one is deleted.',
              )}`
            : undefined
        }
        fields={[
          {
            name: 'move_to',
            label: L('అన్నింటినీ ఇక్కడికి మార్చండి', 'Move everything to'),
            type: 'select',
            required: true,
            options: flat
              .filter((c) => c.id !== moving?.cat.id)
              .map((c) => ({ value: String(c.id), label: `${c.parent_id != null ? '↳ ' : ''}${label(c)}` })),
          },
        ]}
        submitLabel={L('మార్చి తొలగించండి', 'Move and delete')}
        pending={remove.isPending}
        onSubmit={(v) => {
          if (moving && v.move_to) remove.mutate({ cat: moving.cat, moveTo: Number(v.move_to) });
        }}
      />
      {dialog}
    </AdminPage>
  );
}
