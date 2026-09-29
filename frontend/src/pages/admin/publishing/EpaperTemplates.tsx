import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus, Settings2 } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { StatusPill } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dialog, useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { SectionHeader } from '@/components/ui/Layout';
import { ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import * as api from '@/features/epaper/adminApi';
import { useI18n, useScript } from '@/i18n';
import type { CmsCategoryOption } from '@/types/cms';
import type { PageTemplate } from '@/types/epaper';
import { cn } from '@/utils/cn';

import { layoutOptions, useL } from './shared';

/**
 * Page templates for the daily e-paper — name, order, layout (which fixes the
 * slot count) and the categories a page draws from. One Dialog serves both
 * "add" and "configure".
 */

type Editing = PageTemplate | 'new' | null;

interface TemplateValues {
  title_te: string;
  sort: number;
  layout_type: string;
  category_ids: number[];
}

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `page-${Date.now()}`;

/** Roots in their own order, then every child as "Parent › Child". */
function categoryChoices(categories: CmsCategoryOption[]) {
  const roots = categories.filter((c) => c.parent_id == null);
  const children = categories.filter((c) => c.parent_id != null);
  const parent = (c: CmsCategoryOption) => categories.find((p) => p.id === c.parent_id);
  return [
    ...roots.map((c) => ({ c, te: c.name_te, en: c.name_en })),
    ...children.map((c) => ({ c, te: `${parent(c)?.name_te ?? ''} › ${c.name_te}`, en: `${parent(c)?.name_en ?? ''} › ${c.name_en}` })),
  ];
}

function TemplateForm({
  id,
  current,
  sortDefault,
  categories,
  onSubmit,
}: {
  id: string;
  current: PageTemplate | null;
  sortDefault: number;
  categories: CmsCategoryOption[];
  onSubmit: (values: TemplateValues) => void;
}) {
  const L = useL();
  const s = useScript();
  const [title, setTitle] = useState(current?.title_te ?? '');
  const [sort, setSort] = useState(String(current?.sort ?? sortDefault));
  const [layout, setLayout] = useState(current?.layout_type ?? 'lead_grid');
  const [ids, setIds] = useState<number[]>(current?.category_ids ?? []);
  const toggle = (cid: number) => setIds((x) => (x.includes(cid) ? x.filter((i) => i !== cid) : [...x, cid]));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ title_te: title.trim(), sort: Number(sort), layout_type: layout, category_ids: ids });
  };
  return (
    <form id={id} onSubmit={submit} className="flex flex-col gap-4">
      <Field label={L('పేజీ పేరు', 'Page name')} required>
        <Input script="te" required minLength={2} value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus="" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L('పేజీ క్రమం', 'Page order')} required>
          <Input script="en" type="number" min={0} max={200} required value={sort} onChange={(e) => setSort(e.target.value)} />
        </Field>
        <Field label={L('లేఅవుట్', 'Layout')}>
          <Select script="en" value={layout} onChange={(e) => setLayout(e.target.value)}>
            {layoutOptions(L).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="min-w-0">
        <legend className={cn(s.body, 'mb-1.5 text-ui-sm font-semibold text-ink')}>
          {L('వర్గాలు', 'Categories')}{' '}
          <span className="font-normal text-muted">({L('ఏదీ ఎంచుకోకపోతే ఏ వర్గమైనా', 'none = any category')})</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {categoryChoices(categories).map(({ c, te, en }) => (
            <Chip key={c.id} as="button" selected={ids.includes(c.id)} lang={s.forText(te, en).lang} onClick={() => toggle(c.id)}>
              {s.pick(te, en)}
            </Chip>
          ))}
        </div>
      </fieldset>
    </form>
  );
}

export function EpaperTemplates() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const formId = `${useId()}-template`;
  const [editing, setEditing] = useState<Editing>(null);
  const templates = useQuery({ queryKey: ['epaper-templates'], queryFn: api.fetchTemplates });
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions, enabled: editing !== null });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['epaper-templates'] });
  const rows = templates.data?.items ?? [];
  const current = editing && editing !== 'new' ? editing : null;

  const save = useMutation({
    mutationFn: (v: TemplateValues) =>
      current
        ? api.updateTemplate(current.id, { slug: current.slug, title_en: current.title_en, is_visible: current.is_visible, ...v })
        : api.createTemplate({ slug: slugify(v.title_te), title_en: v.title_te, is_visible: true, ...v }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (e) => toast.error(e),
  });
  const hide = useMutation({
    mutationFn: (id: number) => api.hideTemplate(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (e) => toast.error(e),
  });

  const askHide = (row: PageTemplate) =>
    void confirm({
      title: L('ఈ టెంప్లేట్‌ను దాచాలా?', 'Hide this template?'),
      body: L('దాచిన టెంప్లేట్ రేపటి ఎడిషన్‌లో పేజీ కాదు.', 'A hidden template no longer becomes a page in tomorrow’s edition.'),
      confirmLabel: L('దాచండి', 'Hide'),
      tone: 'danger',
    }).then((ok) => ok && hide.mutate(row.id));

  const columns: DataTableColumn<PageTemplate>[] = [
    { key: 'sort', header: '#', align: 'right', width: 'w-12', lang: 'en' },
    { key: 'title_te', header: L('పేజీ', 'Page'), lang: 'te' },
    { key: 'title_en', header: 'English', lang: 'en', hideBelow: 'md' },
    { key: 'layout_type', header: L('లేఅవుట్', 'Layout'), lang: 'en', hideBelow: 'md' },
    { key: 'slot_count', header: L('స్లాట్‌లు', 'Slots'), align: 'right', lang: 'en' },
    {
      key: 'is_visible',
      header: L('స్థితి', 'Status'),
      render: (r) => <StatusPill status={r.is_visible ? 'visible' : 'hidden'} />,
    },
  ];

  return (
    <section>
      <SectionHeader
        title={L('పేజీ టెంప్లేట్‌లు', 'Page templates')}
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing('new')}>
            {L('టెంప్లేట్ జోడించండి', 'Add template')}
          </Button>
        }
      />
      {templates.isError ? (
        <ErrorState error={templates.error} onRetry={() => void templates.refetch()} compact />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          loading={templates.isLoading}
          caption={L('పేజీ టెంప్లేట్‌లు', 'Page templates')}
          onRowClick={(r) => setEditing(r)}
          rowActions={(r) => (
            <>
              <IconButton icon={Settings2} label={L('కాన్ఫిగర్ చేయండి', 'Configure')} onClick={() => setEditing(r)} />
              <IconButton
                icon={EyeOff}
                label={L('దాచండి', 'Hide')}
                disabled={hide.isPending && hide.variables === r.id}
                onClick={() => askHide(r)}
              />
            </>
          )}
        />
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={current ? L('టెంప్లేట్ కాన్ఫిగర్ చేయండి', 'Configure template') : L('కొత్త టెంప్లేట్', 'New template')}
        description={L(
          'లేఅవుట్ స్లాట్‌ల సంఖ్యను నిర్ణయిస్తుంది; ఎంచుకున్న వర్గాల కథనాలు ముందుగా నిండుతాయి.',
          'The layout fixes the slot count; stories from the chosen categories fill the page first.',
        )}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.isPending}>
              {t('ui.cancel')}
            </Button>
            <Button type="submit" form={formId} pending={save.isPending}>
              {current ? t('ui.save') : t('ui.add')}
            </Button>
          </>
        }
      >
        <TemplateForm
          key={current?.id ?? 'new'}
          id={formId}
          current={current}
          sortDefault={rows.length + 1}
          categories={options.data?.categories ?? []}
          onSubmit={(v) => save.mutate(v)}
        />
      </Dialog>
      {dialog}
    </section>
  );
}
