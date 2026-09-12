import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileDown, Pencil, Plus, RefreshCw, Send, Sparkles } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { PromptDialog } from '@/components/ui/Dialog';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import type { EpaperEdition } from '@/types/epaper';

import { EpaperPageEditor } from './EpaperPageEditor';
import { EpaperTemplates } from './EpaperTemplates';
import { LAYOUTS, useL } from './shared';

/**
 * E-Paper control panel — generate, preview/edit, approve, publish. Only
 * published articles are eligible for a page; a published edition is locked.
 */

type Vars = { kind: 'generate' } | { kind: 'regenerate' | 'approve' | 'publish' | 'pdf'; id: number };

const varsKey = (v: Vars) => (v.kind === 'generate' ? v.kind : `${v.kind}:${v.id}`);

export function AdminEpaperPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<EpaperEdition | null>(null);
  const [adding, setAdding] = useState(false);
  const editions = useQuery({ queryKey: ['admin-epaper'], queryFn: api.fetchAdminEditions });

  const open = (e: EpaperEdition) => api.fetchAdminEdition(e.edition_date).then(setSelected, toast.error);

  const act = useMutation({
    mutationFn: (v: Vars) => (v.kind === 'generate' ? api.generateEdition() : api.editionAction(v.id, v.kind)),
    onSuccess: (data) => {
      if ('pages' in data) setSelected(data);
      void qc.invalidateQueries({ queryKey: ['admin-epaper'] });
      toast.success(t('state.updated'));
    },
    onError: (e) => toast.error(e),
  });
  const busy = (v: Vars) => act.isPending && act.variables != null && varsKey(act.variables) === varsKey(v);

  const addPage = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const title = v.title?.trim();
      if (!selected || !title) return;
      await api.addPage(selected.id, { title, layout_type: v.layout_type ?? 'lead_grid', article_ids: [], poll_id: null });
      await open(selected);
    },
    onSuccess: () => {
      setAdding(false);
      toast.success(t('state.saved'));
    },
    onError: (e) => toast.error(e),
  });

  const reorder = useMutation({
    mutationFn: ({ edition, ids }: { edition: EpaperEdition; ids: number[] }) => api.orderPages(edition.id, ids),
    onSuccess: (_d, v) => {
      toast.success(t('state.updated'));
      void open(v.edition);
    },
    onError: (e) => toast.error(e),
  });

  const move = (edition: EpaperEdition, index: number, delta: number) => {
    const ids = edition.pages.map((page) => page.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ edition, ids });
  };

  const columns: DataTableColumn<EpaperEdition>[] = [
    {
      key: 'edition_date',
      header: L('తేదీ', 'Date'),
      lang: 'en',
      nowrap: true,
      render: (e) => <span className="font-semibold">{e.edition_date}</span>,
    },
    { key: 'status', header: L('స్థితి', 'Status'), render: (e) => <StatusPill status={e.status} /> },
    { key: 'page_count', header: L('పేజీలు', 'Pages'), align: 'right', lang: 'en', hideBelow: 'md' },
    { key: 'revision', header: L('రివిజన్', 'Revision'), align: 'right', lang: 'en', hideBelow: 'md' },
  ];

  const rowActions = (e: EpaperEdition) => {
    const action = (kind: 'regenerate' | 'approve' | 'publish' | 'pdf') => ({
      pending: busy({ kind, id: e.id }),
      onClick: () => act.mutate({ kind, id: e.id }),
    });
    return (
      <>
        <IconButton icon={Pencil} label={L('ప్రివ్యూ / సవరణ', 'Preview / edit')} onClick={() => void open(e)} />
        <Button size="sm" variant="secondary" icon={RefreshCw} disabled={e.status === 'PUBLISHED'} {...action('regenerate')}>
          {L('మళ్లీ జనరేట్', 'Regenerate')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={Check}
          disabled={!['GENERATED', 'UNDER_REVIEW'].includes(e.status)}
          {...action('approve')}
        >
          {L('ఆమోదించండి', 'Approve')}
        </Button>
        <Button size="sm" variant="secondary" icon={Send} disabled={e.status !== 'APPROVED'} {...action('publish')}>
          {L('ప్రచురించండి', 'Publish')}
        </Button>
        <Button size="sm" variant="secondary" icon={FileDown} {...action('pdf')}>
          PDF
        </Button>
      </>
    );
  };

  return (
    <AdminPage
      title={t('admin.page.epaper')}
      subtitle={L(
        'జనరేట్ చేసి, ప్రివ్యూ/సవరణ చేసి, ఆమోదించి, ప్రచురించండి. ప్రచురించిన కథనాలు మాత్రమే అర్హం.',
        'Generate, preview and edit, approve, then publish. Only published articles are eligible.',
      )}
      actions={
        <Button icon={Sparkles} pending={busy({ kind: 'generate' })} onClick={() => act.mutate({ kind: 'generate' })}>
          {L('నేటి ఈ-పేపర్ జనరేట్ చేయండి', 'Generate today’s E-Paper')}
        </Button>
      }
    >
      {editions.isError ? (
        <ErrorState error={editions.error} onRetry={() => void editions.refetch()} compact />
      ) : (
        <DataTable
          rows={editions.data?.items ?? []}
          columns={columns}
          rowKey={(e) => e.id}
          loading={editions.isLoading}
          caption={t('admin.page.epaper')}
          onRowClick={(e) => void open(e)}
          rowActions={rowActions}
        />
      )}

      {selected ? (
        <section>
          <SectionHeader
            title={selected.title}
            titleLang="en"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={selected.status} size="sm" />
                {selected.status === 'PUBLISHED' ? (
                  <ButtonLink size="sm" variant="secondary" iconRight={ExternalLink} to={`/epaper/${selected.edition_date}`} external>
                    {L('పబ్లిక్ రీడర్ తెరవండి', 'Open public reader')}
                  </ButtonLink>
                ) : (
                  <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
                    {L('పేజీ జోడించండి', 'Add page')}
                  </Button>
                )}
              </div>
            }
          />
          {selected.pages.length === 0 ? (
            <EmptyState compact title={L('ఈ ఎడిషన్‌లో పేజీలు లేవు', 'No pages in this edition')} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {selected.pages.map((p, index) => (
                <EpaperPageEditor
                  key={p.id}
                  edition={selected}
                  page={p}
                  onSaved={() => void open(selected)}
                  onMove={(delta) => move(selected, index, delta)}
                  moving={reorder.isPending}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <EpaperTemplates />

      <PromptDialog
        open={adding}
        onClose={() => setAdding(false)}
        title={L('కొత్త పేజీ', 'New page')}
        fields={[
          { name: 'title', label: L('పేజీ పేరు', 'Page name'), required: true },
          {
            name: 'layout_type',
            label: L('లేఅవుట్', 'Layout'),
            type: 'select',
            options: LAYOUTS.map((l) => ({ value: l, label: l })),
            defaultValue: 'lead_grid',
          },
        ]}
        submitLabel={t('ui.add')}
        pending={addPage.isPending}
        onSubmit={(v) => addPage.mutate(v)}
      />
    </AdminPage>
  );
}
