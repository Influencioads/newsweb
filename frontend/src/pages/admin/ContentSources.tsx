import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Pencil, Play, Plus, RefreshCw, Rss, Trash2 } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { StatusPill } from '@/components/admin/StatusPill';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/Dialog';
import { EmptyState, QueryState, SkeletonCard } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { statusEntry } from '@/features/cms/status';
import { useI18n } from '@/i18n';
import type { ContentSource, IngestStatus, IngestedItem } from '@/types/cms';
import { useReveal } from '@/utils/motion';

import { CoverageTab } from './sources/CoverageTab';
import { LICENCES } from './sources/labels';
import { LicenceBadge, QueueItem } from './sources/QueueItem';
import { SourceFormDialog } from './sources/SourceFormDialog';

/**
 * §17 — where our content comes from, and what we are allowed to do with it.
 *
 * The licence is not metadata here, it is the control: the server refuses
 * full-text republication unless the source carries an agreement-based licence
 * *and* a note recording which agreement. This screen makes that visible so an
 * editor sees the terms while deciding, rather than discovering them after a
 * takedown notice.
 *
 * Every fetched item lands in a queue and becomes a DRAFT when imported —
 * never a published article. That is the same rule reader submissions and AI
 * drafts follow, for the same reason. There is no auto-publish control here,
 * and there must not be one.
 */

type View = 'queue' | 'sources' | 'coverage';
const QUEUE_STATUSES: IngestStatus[] = ['new', 'imported', 'rejected', 'duplicate'];

export default function ContentSourcesPage() {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const reveal = useReveal<HTMLLIElement>();
  const [view, setView] = useState<View>('queue');
  const [queueStatus, setQueueStatus] = useState<IngestStatus>('new');
  const [form, setForm] = useState<{ open: boolean; source: ContentSource | null }>({ open: false, source: null });

  const sources = useQuery({ queryKey: ['cms', 'sources'], queryFn: cmsApi.fetchSources });
  const queue = useQuery({
    queryKey: ['cms', 'ingest-queue', queueStatus],
    queryFn: () => cmsApi.fetchIngestQueue(queueStatus),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'sources'] });
    void queryClient.invalidateQueries({ queryKey: ['cms', 'ingest-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['cms', 'crawl-status'] });
  };
  const done = (msg: string) => () => {
    toast.success(msg);
    refresh();
  };
  const fail = (e: unknown) => toast.error(e);

  const run = useMutation({ mutationFn: cmsApi.runIngestion, onSuccess: done(L('ఫెచ్ పూర్తయింది', 'Fetch finished')), onError: fail });
  const rewriteOne = useMutation({
    mutationFn: (id: number) => cmsApi.rewriteIngestedItem(id),
    onSuccess: done(L('పునర్లేఖనం ప్రారంభమైంది', 'Rewrite started')),
    onError: fail,
  });
  const importItem = useMutation({
    mutationFn: ({ id, useRewrite }: { id: number; useRewrite: boolean }) =>
      cmsApi.importIngestedItem(id, { use_rewrite: useRewrite }),
    onSuccess: done(L('డ్రాఫ్ట్‌గా తీసుకున్నాం — సమీక్ష క్యూలో ఉంది', 'Imported as a draft — it is in the review queue')),
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: (id: number) => cmsApi.rejectIngestedItem(id),
    onSuccess: done(L('తిరస్కరించారు', 'Rejected')),
    onError: fail,
  });
  const fetchOne = useMutation({
    mutationFn: (id: number) => cmsApi.fetchSourceNow(id),
    onSuccess: done(L('ఫెచ్ పూర్తయింది', 'Fetch finished')),
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => cmsApi.patchSource(id, { is_active: active }),
    onSuccess: (_row, { active }) => done(active ? L('కొనసాగుతోంది', 'Resumed') : L('ఆపారు', 'Paused'))(),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: number) => cmsApi.deleteSource(id),
    onSuccess: done(t('state.deleted')),
    onError: fail,
  });

  const rejectItem = async (item: IngestedItem) => {
    const ok = await confirm({
      title: L('ఈ అంశాన్ని తిరస్కరించాలా?', 'Reject this item?'),
      body: <span lang="te" className="te">{item.title}</span>,
      confirmLabel: L('తిరస్కరించండి', 'Reject'),
      tone: 'danger',
    });
    if (ok) reject.mutate(item.id);
  };
  const toggleSource = async (source: ContentSource) => {
    if (source.is_active) {
      const ok = await confirm({
        title: L(`${source.name} ఆపాలా?`, `Pause ${source.name}?`),
        body: L('ఆపిన మూలం నుంచి కొత్తవి తేరు; క్యూలో ఉన్నవి అలాగే ఉంటాయి.', 'Nothing new is fetched from a paused source; items already in the queue stay.'),
        confirmLabel: L('ఆపండి', 'Pause'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    toggle.mutate({ id: source.id, active: !source.is_active });
  };
  const removeSource = async (source: ContentSource) => {
    const ok = await confirm({
      title: L(`${source.name} తొలగించాలా?`, `Delete ${source.name}?`),
      body: t('state.confirmDelete'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    });
    if (ok) remove.mutate(source.id);
  };

  const counts = queue.data?.queue ?? sources.data?.queue;
  const queueBusy = importItem.isPending || reject.isPending || rewriteOne.isPending;
  const runSummary = run.data
    ? (run.data.results as Array<Record<string, unknown>>)
        .map((r) => `${r.source}: ${r.status}${r.new != null ? ` (+${r.new})` : ''}`)
        .join(' · ')
    : null;

  const columns: DataTableColumn<ContentSource>[] = [
    {
      key: 'publisher',
      header: L('ప్రచురణకర్త', 'Publisher'),
      lang: 'en',
      render: (source) => (
        <>
          <span className="block font-semibold text-ink">{source.name}</span>
          <span className="block break-all font-mono text-meta text-muted">{source.feed_url}</span>
        </>
      ),
    },
    {
      key: 'licence',
      header: L('లైసెన్స్', 'Licence'),
      hideBelow: 'md',
      render: (source) => {
        const licence = LICENCES.find((l) => l.value === source.licence);
        return licence ? L(licence.te, licence.en) : source.licence;
      },
    },
    { key: 'keeps', header: L('భద్రపరచేది', 'Keeps'), render: (source) => <LicenceBadge source={source} /> },
    {
      key: 'checked',
      header: L('చివరి తనిఖీ', 'Last checked'),
      hideBelow: 'lg',
      render: (source) => (
        <span className="font-sans text-meta text-muted">
          {source.last_fetched_at ? new Date(source.last_fetched_at).toLocaleString('en-IN') : '—'}
          {source.last_status && source.last_status !== 'ok' ? <span className="block text-breaking">{source.last_status}</span> : null}
        </span>
      ),
    },
    {
      key: 'pending',
      header: L('పెండింగ్', 'Pending'),
      align: 'right',
      render: (source) => <span className="font-sans font-bold tabular-nums text-brand">{source.pending_items}</span>,
    },
    {
      key: 'active',
      header: L('స్థితి', 'Status'),
      render: (source) => <StatusPill status={source.is_active ? 'active' : 'paused'} />,
    },
  ];
  const rowKey = (source: ContentSource) => source.id;

  return (
    <AdminPage
      title={t('admin.page.sources')}
      subtitle={L(
        'మనం తీసుకునే ఫీడ్‌లు, ప్రతి లైసెన్స్ ఏమి అనుమతిస్తుందో. తీసుకున్నవి డ్రాఫ్ట్‌లుగా వస్తాయి — ఎడిటర్ ఆమోదం, మరో ఎడిటర్ ప్రచురణ తప్పనిసరి.',
        'Feeds we pull from, and what each licence permits. Imported items become drafts — an editor still approves, and a different editor still publishes.',
      )}
      actions={
        <>
          <Button variant="secondary" icon={RefreshCw} pending={run.isPending} onClick={() => run.mutate()}>
            {L('ఇప్పుడే తెండి', 'Fetch now')}
          </Button>
          <Button icon={Plus} onClick={() => setForm({ open: true, source: null })}>
            {L('కొత్త మూలం', 'Add a source')}
          </Button>
        </>
      }
    >
      <Tabs
        ariaLabel={t('ui.sections')}
        scrollable
        items={[
          { key: 'queue', label: L('క్యూ', 'Queue'), count: counts?.new ?? 0 },
          { key: 'sources', label: L('మూలాలు', 'Sources'), count: sources.data?.total ?? 0 },
          { key: 'coverage', label: L('కవరేజ్', 'Coverage') },
        ]}
        value={view}
        onChange={(key) => setView(key as View)}
      />

      {runSummary !== null ? (
        <Card padding="sm" tone="paper" role="status">
          <p className="font-sans text-ui-sm text-ink-soft">{runSummary || L('ఏ మూలం కూడా షెడ్యూల్‌లో లేదు.', 'No sources were due.')}</p>
        </Card>
      ) : null}

      {view === 'queue' ? (
        <div role="tabpanel" aria-label={L('క్యూ', 'Queue')} className="space-y-4">
          <ChipRail ariaLabel={L('స్థితి', 'Status')}>
            {QUEUE_STATUSES.map((st) => {
              const entry = statusEntry(st);
              return (
                <Chip key={st} selected={queueStatus === st} count={counts?.[st]} onClick={() => setQueueStatus(st)}>
                  {L(entry?.te ?? st, entry?.en ?? st)}
                </Chip>
              );
            })}
          </ChipRail>
          <QueryState
            query={queue}
            isEmpty={(data) => data.items.length === 0}
            skeleton={
              <div className="space-y-4">
                <SkeletonCard variant="row" />
                <SkeletonCard variant="row" />
                <SkeletonCard variant="row" />
              </div>
            }
            empty={
              <Card padding="none">
                <EmptyState
                  icon={Rss}
                  compact
                  title={queueStatus === 'new' ? L('ఏమీ లేదు. మూలం జోడించి తెప్పించండి.', 'Nothing waiting. Add a source and fetch.') : t('state.emptyTitle')}
                  action={
                    queueStatus === 'new' ? (
                      <Button variant="secondary" icon={Plus} onClick={() => setForm({ open: true, source: null })}>
                        {L('కొత్త మూలం', 'Add a source')}
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            }
          >
            {(data) => (
              <ul className="space-y-4">
                {data.items.map((item) => (
                  <li key={item.id} ref={reveal}>
                    <QueueItem
                      item={item}
                      busy={queueBusy}
                      onImport={(useRewrite) => importItem.mutate({ id: item.id, useRewrite })}
                      onRewrite={() => rewriteOne.mutate(item.id)}
                      onReject={() => void rejectItem(item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </div>
      ) : view === 'coverage' ? (
        <div role="tabpanel" aria-label={L('కవరేజ్', 'Coverage')}>
          <CoverageTab />
        </div>
      ) : (
        <div role="tabpanel" aria-label={L('మూలాలు', 'Sources')}>
          <QueryState
            query={sources}
            isEmpty={(data) => data.items.length === 0}
            skeleton={<DataTable rows={[]} columns={columns} rowKey={rowKey} loading />}
            empty={
              <Card padding="none">
                <EmptyState
                  icon={Rss}
                  compact
                  title={L('ఇంకా మూలాలు లేవు.', 'No sources configured yet.')}
                  action={
                    <Button icon={Plus} onClick={() => setForm({ open: true, source: null })}>
                      {L('కొత్త మూలం', 'Add a source')}
                    </Button>
                  }
                />
              </Card>
            }
          >
            {(data) => (
              <DataTable
                rows={data.items}
                columns={columns}
                rowKey={rowKey}
                caption={t('admin.page.sources')}
                rowActions={(source) => (
                  <>
                    <IconButton icon={RefreshCw} label={L('ఇప్పుడే తెండి', 'Fetch now')} disabled={fetchOne.isPending} onClick={() => fetchOne.mutate(source.id)} />
                    <IconButton icon={Pencil} label={t('ui.edit')} onClick={() => setForm({ open: true, source })} />
                    <IconButton
                      icon={source.is_active ? Pause : Play}
                      label={source.is_active ? L('ఆపండి', 'Pause') : L('కొనసాగించండి', 'Resume')}
                      disabled={toggle.isPending}
                      onClick={() => void toggleSource(source)}
                    />
                    <IconButton icon={Trash2} label={t('ui.delete')} className="hover:text-breaking" disabled={remove.isPending} onClick={() => void removeSource(source)} />
                  </>
                )}
              />
            )}
          </QueryState>
        </div>
      )}

      <SourceFormDialog
        open={form.open}
        source={form.source}
        onClose={() => setForm({ open: false, source: null })}
        onSaved={() => {
          setForm({ open: false, source: null });
          refresh();
        }}
      />
      {dialog}
    </AdminPage>
  );
}
