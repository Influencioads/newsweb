import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pencil, RefreshCw, Sparkles } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { StatusPill } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/State';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { EpaperEdition } from '@/types/epaper';

import { EpaperGenerateDialog } from './EpaperGenerateDialog';
import { EpaperTemplates } from './EpaperTemplates';
import { useL } from './shared';

/**
 * E-Paper editions — the list, a generate button, and the page templates.
 * Building, reviewing and publishing happen in the workspace at
 * `/admin/epaper/:date`.
 */
export function AdminEpaperPage() {
  const { t } = useI18n();
  const L = useL();
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const [dialog, setDialog] = useState<'generate' | EpaperEdition | null>(null);
  const editions = useQuery({ queryKey: ['admin-epaper'], queryFn: api.fetchAdminEditions });
  const canUpload = can('epaper.upload');
  const open = (e: EpaperEdition) => navigate(`/admin/epaper/${e.edition_date}`);

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
    {
      key: 'pdf_status',
      header: 'PDF',
      hideBelow: 'md',
      render: (e) => (e.pdf_status ? <StatusPill status={e.pdf_status} /> : <span className="text-muted">—</span>),
    },
  ];

  return (
    <AdminPage
      title={t('admin.page.epaper')}
      subtitle={L(
        'పేజీల సంఖ్య ఇవ్వండి; సరిపోయే కథనాలు స్వయంగా నిండుతాయి. సర్దుబాటు చేసి, ఆమోదించి, ప్రచురించండి.',
        'Set the page count; stories that fit fill the pages. Adjust, approve, then publish.',
      )}
      actions={
        canUpload ? (
          <Button icon={Sparkles} onClick={() => setDialog('generate')}>
            {L('ఈ-పేపర్ జనరేట్ చేయండి', 'Generate E-Paper')}
          </Button>
        ) : undefined
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
          onRowClick={open}
          rowActions={(e) => (
            <>
              <IconButton icon={Pencil} label={L('తెరవండి', 'Open')} onClick={() => open(e)} />
              {canUpload && e.status !== 'PUBLISHED' ? (
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setDialog(e)}>
                  {L('మళ్లీ జనరేట్', 'Regenerate')}
                </Button>
              ) : null}
            </>
          )}
        />
      )}

      <EpaperTemplates />

      <EpaperGenerateDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        edition={dialog === 'generate' ? null : dialog}
        onDone={open}
      />
    </AdminPage>
  );
}
