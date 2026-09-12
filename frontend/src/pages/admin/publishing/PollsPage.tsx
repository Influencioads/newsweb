import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Play, Plus, Square } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { PromptDialog } from '@/components/ui/Dialog';
import { ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as api from '@/features/epaper/adminApi';
import { useI18n } from '@/i18n';
import type { Poll } from '@/types/epaper';

import { useL } from './shared';

/**
 * Polls & the Big Question — draft in a dialog, start / stop from the list,
 * export votes as CSV.
 */
export function AdminPollsPage() {
  const { t, language } = useI18n();
  const L = useL();
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const polls = useQuery({ queryKey: ['admin-polls'], queryFn: api.fetchAdminPolls });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-polls'] });

  const create = useMutation({
    mutationFn: ({ question, options, big }: { question: string; options: string[]; big: boolean }) =>
      api.createPoll({
        question_te: question,
        question_en: null,
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + 7 * 864e5).toISOString(),
        category_id: null,
        district_id: null,
        article_id: null,
        is_big_question: big,
        options: options.map((x) => ({ option_text_te: x, option_text_en: null })),
      }),
    onSuccess: () => {
      setCreating(false);
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (e) => toast.error(e),
  });
  const status = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patchPoll(id, { status }),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (e) => toast.error(e),
  });
  const changing = (id: number) => status.isPending && status.variables?.id === id;

  const submit = (v: Record<string, string>) => {
    const question = (v.question ?? '').trim();
    const options = (v.options ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    if (question.length < 3 || options.length < 2) {
      toast.error(L('ప్రశ్న కనీసం 3 అక్షరాలు, కనీసం 2 ఎంపికలు కావాలి.', 'The question needs at least 3 characters and 2 options.'));
      return;
    }
    create.mutate({ question, options, big: v.big === '1' });
  };

  const columns: DataTableColumn<Poll>[] = [
    {
      key: 'question_te',
      header: L('ప్రశ్న', 'Question'),
      lang: 'te',
      render: (p) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{p.question_te}</span>
          {p.is_big_question ? (
            <Badge tone="brand" size="xs" lang={language}>
              {L('బిగ్ క్వశ్చన్', 'Big Question')}
            </Badge>
          ) : null}
        </span>
      ),
    },
    { key: 'status', header: L('స్థితి', 'Status'), render: (p) => <StatusPill status={p.status} /> },
    { key: 'total_votes', header: L('ఓట్లు', 'Votes'), align: 'right', lang: 'en', hideBelow: 'md' },
    {
      key: 'end_time',
      header: L('ముగింపు', 'Ends'),
      lang: 'en',
      nowrap: true,
      hideBelow: 'md',
      render: (p) => new Date(p.end_time).toLocaleString(),
    },
  ];

  return (
    <AdminPage
      width="page"
      title={t('admin.page.polls')}
      subtitle={L('పోల్స్ & బిగ్ క్వశ్చన్ — డ్రాఫ్ట్ సృష్టించి, ప్రారంభించి, ఆపి, ఫలితాలు ఎగుమతి చేయండి.', 'Polls & Big Question — draft, start, stop and export results.')}
      actions={
        <Button icon={Plus} onClick={() => setCreating(true)}>
          {L('కొత్త పోల్', 'New poll')}
        </Button>
      }
    >
      {polls.isError ? (
        <ErrorState error={polls.error} onRetry={() => void polls.refetch()} compact />
      ) : (
        <DataTable
          rows={polls.data?.items ?? []}
          columns={columns}
          rowKey={(p) => p.id}
          loading={polls.isLoading}
          caption={t('admin.page.polls')}
          rowActions={(p) => (
            <>
              <IconButton
                icon={Play}
                label={L('ప్రారంభించండి', 'Start')}
                disabled={changing(p.id)}
                onClick={() => status.mutate({ id: p.id, status: 'ACTIVE' })}
              />
              <IconButton
                icon={Square}
                label={L('ఆపండి', 'Stop')}
                disabled={changing(p.id)}
                onClick={() => status.mutate({ id: p.id, status: 'STOPPED' })}
              />
              <IconButton
                icon={Download}
                label={L('ఎగుమతి (CSV)', 'Export (CSV)')}
                onClick={() => void api.downloadPollExport(p.id).catch(toast.error)}
              />
            </>
          )}
        />
      )}

      <PromptDialog
        open={creating}
        onClose={() => setCreating(false)}
        title={L('కొత్త పోల్', 'New poll')}
        fields={[
          { name: 'question', label: L('ప్రశ్న (తెలుగులో)', 'Question in Telugu'), required: true },
          {
            name: 'options',
            label: L('ఎంపికలు', 'Options'),
            type: 'textarea',
            required: true,
            defaultValue: 'అవును\nకాదు',
            hint: L('ఒక్కో పంక్తికి ఒక ఎంపిక', 'One option per line'),
          },
          {
            name: 'big',
            label: L('బిగ్ క్వశ్చన్', 'Big Question'),
            type: 'select',
            defaultValue: '1',
            options: [
              { value: '1', label: t('ui.yes') },
              { value: '0', label: t('ui.no') },
            ],
          },
        ]}
        submitLabel={L('డ్రాఫ్ట్ సృష్టించండి', 'Create draft')}
        pending={create.isPending}
        onSubmit={submit}
      />
    </AdminPage>
  );
}
