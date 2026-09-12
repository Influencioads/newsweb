import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Section } from '@/components/admin/FormControls';
import { StatusPill } from '@/components/admin/StatusPill';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { EmptyState, QueryState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { AUDIO_STATUS } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import type { AudioAssetRow, AudioStatus } from '@/types/cms';
import { cn } from '@/utils/cn';

import { useL } from './useL';

/**
 * §19–21 — every rendition the platform has paid for, and why the failed ones
 * failed.
 *
 * Turning voice on for a single story lives in the article editor, with
 * whoever owns the story. What lives here is the spending: a backfill makes
 * many provider calls at once, and a retry is a deliberate decision to pay
 * again for something that already failed. Both need `voice.manage`.
 *
 * The month's character budget is at the top because it is the number that
 * silently causes everything else to stop working.
 */

const SCOPES = [
  { value: 'missing', te: 'ఆడియో లేని కథనాలు', en: 'Published stories with no audio' },
  { value: 'failed', te: 'విఫలమైనవి', en: 'Previously failed' },
] as const;

const FILTERS: Array<AudioStatus | ''> = ['', 'ready', 'failed', 'pending'];

function UsageMeter({ usage }: { usage: Record<string, number> | undefined }) {
  const L = useL();
  const s = useScript();
  if (!usage) return null;
  const percent = Number(usage.percent_used ?? 0);
  const tone = percent >= 100 ? 'bg-breaking' : percent >= 80 ? 'bg-partial' : 'bg-success';
  const label = L('ఈ నెలలో తయారైన అక్షరాలు', 'Characters synthesised this month');
  return (
    <Card>
      <p className={cn(s.body, 'text-ui-sm text-muted')}>{label}</p>
      <p className="font-sans text-headline-lg font-extrabold tabular-nums text-ink">
        {Number(usage.chars_this_month ?? 0).toLocaleString('en-IN')}
        <span className="text-headline-xs font-semibold text-muted">
          {' / '}
          {Number(usage.monthly_budget ?? 0).toLocaleString('en-IN')}
        </span>
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(percent))}
        className="mt-3 h-2 overflow-hidden rounded-pill bg-rule-soft"
      >
        <div className={cn('h-full rounded-pill transition-[width] duration-base ease-standard', tone)} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className={cn(s.body, 'mt-3 text-meta text-muted')}>
        {L(
          `${usage.assets_ready ?? 0} సిద్ధం · ${usage.assets_failed ?? 0} విఫలం. పరిమితి చేరాక తయారీ ఆగిపోతుంది.`,
          `${usage.assets_ready ?? 0} ready · ${usage.assets_failed ?? 0} failed. Generation stops at the budget — it does not queue.`,
        )}
      </p>
    </Card>
  );
}

export default function VoicePage() {
  const { t } = useI18n();
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AudioStatus | ''>('');
  const [scope, setScope] = useState<'missing' | 'failed'>('missing');
  const [limit, setLimit] = useState(20);

  const assets = useQuery({
    queryKey: ['cms', 'audio-assets', status],
    queryFn: () => cmsApi.fetchAudioAssets(status ? { status } : {}),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'audio-assets'] });

  const retry = useMutation({
    mutationFn: (id: number) => cmsApi.retryAudioAsset(id),
    onSuccess: () => {
      toast.success(L('మళ్లీ తయారవుతోంది', 'Regenerating'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });
  const backfill = useMutation({
    mutationFn: () => cmsApi.runAudioBackfill({ scope, limit }),
    onSuccess: (d) => {
      toast.success(`${d.generated} ${L('తయారయ్యాయి', 'generated')}`);
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const body = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm');

  const columns: DataTableColumn<AudioAssetRow>[] = [
    {
      key: 'story',
      header: L('కథనం', 'Story'),
      lang: 'te',
      render: (row) => (
        <>
          <span className="te-clamp-1 block font-semibold text-ink">{row.title_te ?? `#${row.article_id}`}</span>
          <span className="block font-mono text-meta text-muted">{row.short_id}</span>
        </>
      ),
    },
    {
      key: 'status',
      header: L('స్థితి', 'Status'),
      render: (row) => (
        <>
          <StatusPill status={row.status} registry={AUDIO_STATUS} />
          {row.error ? <span className="mt-1 block max-w-xs break-words font-sans text-meta text-breaking">{row.error}</span> : null}
        </>
      ),
    },
    {
      key: 'provider',
      header: L('ప్రొవైడర్', 'Provider'),
      hideBelow: 'md',
      render: (row) => (
        <span className="font-sans">
          {row.provider}
          {row.segment_count > 1 ? (
            <span
              className="block text-meta text-muted"
              title={L('పొడవైన కథనం ముక్కలుగా తయారై కలుపుతారు — ఇది సాధారణం.', 'Long copy is synthesised in pieces and joined — normal, not a fault.')}
            >
              {row.segment_count} {L('ముక్కలు', 'parts')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'length',
      header: L('నిడివి', 'Length'),
      align: 'right',
      hideBelow: 'md',
      render: (row) => <span className="font-sans tabular-nums">{row.duration_sec ? `${row.duration_sec}s` : '—'}</span>,
    },
    {
      key: 'chars',
      header: L('అక్షరాలు', 'Chars'),
      align: 'right',
      hideBelow: 'lg',
      render: (row) => <span className="font-sans tabular-nums text-muted">{row.char_count.toLocaleString('en-IN')}</span>,
    },
  ];
  const rowKey = (row: AudioAssetRow) => row.id;

  return (
    <AdminPage
      title={t('admin.page.voice')}
      subtitle={L(
        'తయారైన ఆడియో, నెలవారీ పరిమితి, ఆడియో లేని కథనాలకు తయారీ. ఒక కథనానికి వాయిస్ ఆన్/ఆఫ్ ఆ కథనం ఎడిటర్‌లో ఉంటుంది.',
        'Generated readings, the monthly budget, and a way to fill in the stories that have none. Whether a single story may be read aloud is set in that story’s editor.',
      )}
    >
      <UsageMeter usage={assets.data?.usage} />

      <Section
        title={L('గుంపుగా తయారు చేయండి', 'Generate in bulk')}
        subtitle={L(
          'వెంటనే నడుస్తుంది, గరిష్ఠం 50 కథనాలు. మిగిలినవి రాత్రి పని చూసుకుంటుంది, 90% వద్ద ఆగుతుంది.',
          'Runs immediately, capped at 50 stories. The overnight job picks up the rest and stops at 90% of the budget.',
        )}
      >
        <div className="flex flex-wrap items-end gap-4">
          <Field label={L('ఏ కథనాలు', 'Which stories')} className="min-w-64 flex-1">
            <Select value={scope} onChange={(e) => setScope(e.target.value as 'missing' | 'failed')}>
              {SCOPES.map((sc) => (
                <option key={sc.value} value={sc.value}>
                  {L(sc.te, sc.en)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L('ఎన్ని', 'How many')} className="w-28">
            <Input type="number" script="en" min={1} max={50} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </Field>
          <Button icon={Play} pending={backfill.isPending} onClick={() => backfill.mutate()}>
            {L('నడపండి', 'Run')}
          </Button>
        </div>

        {backfill.data ? (
          <Card padding="sm" tone="paper" role="status">
            <p className={cn(body, 'text-ink-soft')}>
              {L(
                `${backfill.data.candidates} పరిశీలించాం · ${backfill.data.generated} తయారయ్యాయి · ${backfill.data.skipped} వదిలేశాం.`,
                `${backfill.data.candidates} considered · ${backfill.data.generated} generated · ${backfill.data.skipped} skipped.`,
              )}
              {backfill.data.skipped > 0 ? (
                <span className="block text-muted">
                  {L(
                    'వదిలేసినవి: ఆ కథనానికి వాయిస్ ఆఫ్, ప్రొవైడర్ లేదు, లేదా నెలవారీ పరిమితి అయిపోయింది.',
                    'Skipped means not possible: voice off for that story, no provider, or the monthly budget is spent.',
                  )}
                </span>
              ) : null}
            </p>
          </Card>
        ) : null}
      </Section>

      <section aria-label={L('ఆడియో ఆస్తులు', 'Audio assets')} className="space-y-4">
        <Tabs
          ariaLabel={L('స్థితి', 'Status')}
          scrollable
          items={FILTERS.map((key) => ({
            key: key || 'all',
            label: key === '' ? t('ui.showAll') : L(AUDIO_STATUS[key].te, AUDIO_STATUS[key].en),
          }))}
          value={status || 'all'}
          onChange={(key) => setStatus(key === 'all' ? '' : (key as AudioStatus))}
        />

        <div role="tabpanel" aria-label={status === '' ? t('ui.showAll') : L(AUDIO_STATUS[status].te, AUDIO_STATUS[status].en)}>
          <QueryState
            query={assets}
            isEmpty={(data) => data.items.length === 0}
            skeleton={<DataTable rows={[]} columns={columns} rowKey={rowKey} loading />}
            empty={
              <Card padding="none">
                <EmptyState title={L('ఇంకా ఆడియో ఏదీ తయారు కాలేదు.', 'No audio has been generated yet.')} compact />
              </Card>
            }
          >
            {(data) => (
              <DataTable
                rows={data.items}
                columns={columns}
                rowKey={rowKey}
                caption={t('admin.page.voice')}
                rowActions={(row) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={RefreshCw}
                    pending={retry.isPending && retry.variables === row.id}
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(row.id)}
                  >
                    {L('మళ్లీ తయారు చేయండి', 'Regenerate')}
                  </Button>
                )}
              />
            )}
          </QueryState>
        </div>
      </section>
    </AdminPage>
  );
}
