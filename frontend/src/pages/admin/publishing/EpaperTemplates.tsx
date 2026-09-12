import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus, Settings2 } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { StatusPill } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { PromptDialog, useConfirm, type PromptField } from '@/components/ui/Dialog';
import { SectionHeader } from '@/components/ui/Layout';
import { ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';

import { LAYOUTS, useL } from './shared';

/**
 * Page templates for the daily e-paper — name, order, category IDs, story
 * count, layout. One PromptDialog serves both "add" and "configure".
 */

type Editing = api.PageTemplate | 'new' | null;

const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `page-${Date.now()}`;

export function EpaperTemplates() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Editing>(null);
  const templates = useQuery({ queryKey: ['epaper-templates'], queryFn: api.fetchTemplates });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['epaper-templates'] });
  const rows = templates.data?.items ?? [];
  const current = editing && editing !== 'new' ? editing : null;

  const save = useMutation({
    mutationFn: (v: Record<string, string>) => {
      const title = (v.title ?? '').trim();
      const patch = {
        title_te: title,
        sort: Number(v.sort),
        story_count: Number(v.story_count),
        category_ids: (v.category_ids ?? '').split(',').map(Number).filter(Boolean),
        layout_type: v.layout_type ?? 'lead_grid',
      };
      return current
        ? api.updateTemplate({ ...current, ...patch })
        : api.createTemplate({ slug: slugify(title), title_en: title, is_visible: true, ...patch });
    },
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

  const askHide = (row: api.PageTemplate) =>
    void confirm({
      title: L('ఈ టెంప్లేట్‌ను దాచాలా?', 'Hide this template?'),
      body: L('దాచిన టెంప్లేట్ రేపటి ఎడిషన్‌లో పేజీ కాదు.', 'A hidden template no longer becomes a page in tomorrow’s edition.'),
      confirmLabel: L('దాచండి', 'Hide'),
      tone: 'danger',
    }).then((ok) => ok && hide.mutate(row.id));

  const fields: PromptField[] = [
    { name: 'title', label: L('పేజీ పేరు', 'Page name'), required: true, defaultValue: current?.title_te ?? '' },
    {
      name: 'sort',
      label: L('పేజీ క్రమం', 'Page order'),
      type: 'number',
      required: true,
      defaultValue: String(current?.sort ?? rows.length + 1),
    },
    {
      name: 'story_count',
      label: L('కథనాల సంఖ్య', 'Number of stories'),
      type: 'number',
      required: true,
      defaultValue: String(current?.story_count ?? 6),
    },
    {
      name: 'category_ids',
      label: L('వర్గం IDలు', 'Category IDs'),
      hint: L('కామాలతో వేరు చేయండి', 'Comma separated'),
      defaultValue: current?.category_ids.join(',') ?? '',
    },
    {
      name: 'layout_type',
      label: L('లేఅవుట్', 'Layout'),
      type: 'select',
      options: LAYOUTS.map((l) => ({ value: l, label: l })),
      defaultValue: current?.layout_type ?? 'lead_grid',
    },
  ];

  const columns: DataTableColumn<api.PageTemplate>[] = [
    { key: 'sort', header: '#', align: 'right', width: 'w-12', lang: 'en' },
    { key: 'title_te', header: L('పేజీ', 'Page'), lang: 'te' },
    { key: 'title_en', header: 'English', lang: 'en', hideBelow: 'md' },
    { key: 'layout_type', header: L('లేఅవుట్', 'Layout'), lang: 'en', hideBelow: 'md' },
    { key: 'story_count', header: L('కథనాలు', 'Stories'), align: 'right', lang: 'en' },
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
      <PromptDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={current ? L('టెంప్లేట్ కాన్ఫిగర్ చేయండి', 'Configure template') : L('కొత్త టెంప్లేట్', 'New template')}
        description={L(
          'పేర్లు, క్రమం, వర్గం IDలు, కథనాల సంఖ్య, లేఅవుట్ డేటాబేస్‌లో భద్రపరచబడతాయి.',
          'Names, order, category IDs, story count and layout are persisted in the database.',
        )}
        fields={fields}
        submitLabel={current ? t('ui.save') : t('ui.add')}
        pending={save.isPending}
        onSubmit={(v) => save.mutate(v)}
      />
      {dialog}
    </section>
  );
}
