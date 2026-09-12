import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleStop, Megaphone, Pause, Play, Plus } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PromptDialog, useConfirm } from '@/components/ui/Dialog';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { dateTime, useL } from './shared';

/** §26 Ads — house campaigns with impression/click analytics and clear labeling. */

type AdRow = {
  id: number;
  name: string;
  image_url: string;
  target_url: string;
  placement: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  weight: number;
  impressions: number;
  clicks: number;
  ctr_percent: number;
};

type AdStatus = 'live' | 'paused' | 'ended';

const PLACEMENTS: Array<[string, string]> = [
  ['top_banner', 'Top banner'],
  ['in_feed', 'In-feed'],
  ['article', 'Article page'],
  ['category', 'Category page'],
];

function adStatus(ad: AdRow, now: number): AdStatus {
  if (new Date(ad.ends_at).getTime() <= now) return 'ended';
  return ad.is_active ? 'live' : 'paused';
}

export function AdsPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [tab, setTab] = useState('all');
  const list = useQuery({ queryKey: ['cms', 'ads'], queryFn: () => cmsApi.fetchAds<{ items: AdRow[] }>() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'ads'] });
  const create = useMutation({
    mutationFn: (v: Record<string, string>) =>
      cmsApi.createAd({
        name: v.name ?? '',
        image_url: v.image_url ?? '',
        target_url: v.target_url ?? '',
        placement: v.placement ?? 'in_feed',
        duration_days: Number(v.days ?? '7'),
      }),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const toggle = useMutation({
    mutationFn: (ad: AdRow) => cmsApi.patchAd(ad.id, { is_active: !ad.is_active }),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });
  const end = useMutation({
    mutationFn: (id: number) => cmsApi.endAd(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });

  const endNow = async (ad: AdRow) => {
    const ok = await confirm({
      title: L('ప్రచారాన్ని ఇప్పుడే ముగించాలా?', 'End this campaign now?'),
      body: ad.name,
      confirmLabel: L('ముగించండి', 'End now'),
      tone: 'danger',
    });
    if (ok) end.mutate(ad.id);
  };

  const now = Date.now();
  const items = (list.data?.items ?? []).map((ad) => ({ ad, status: adStatus(ad, now) }));
  const rows = tab === 'all' ? items : items.filter((r) => r.status === tab);
  const countOf = (s: AdStatus) => items.filter((r) => r.status === s).length;
  const tabs = [
    { key: 'all', label: t('ui.showAll'), count: items.length },
    { key: 'live', label: t('ui.live'), count: countOf('live') },
    { key: 'paused', label: t('ui.pause'), count: countOf('paused') },
    { key: 'ended', label: L('ముగిసింది', 'Ended'), count: countOf('ended') },
  ];

  return (
    <AdminPage
      title={t('admin.page.ads')}
      subtitle={L(
        'ఇంప్రెషన్/క్లిక్ గణాంకాలతో సొంత ప్రకటనలు',
        'House campaigns with §26 impression/click analytics and clear labeling',
      )}
      actions={
        <Button icon={Plus} onClick={() => setComposing(true)}>
          {L('కొత్త ప్రచారం', 'New campaign')}
        </Button>
      }
    >
      <section>
        <Tabs ariaLabel={t('admin.page.ads')} className="mb-4" value={tab} onChange={setTab} items={tabs} />
        <div role="tabpanel" aria-label={tabs.find((i) => i.key === tab)?.label}>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.ad.id}
            loading={list.isLoading}
            caption={t('admin.page.ads')}
            empty={<EmptyState icon={Megaphone} title={L('ప్రచారాలు లేవు.', 'No campaigns yet.')} compact />}
            columns={[
              {
                key: 'creative',
                header: L('ప్రకటన', 'Creative'),
                width: 'w-32',
                render: ({ ad }) => (
                  <img
                    src={ad.image_url}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-28 rounded-xl border border-rule bg-placeholder object-cover"
                  />
                ),
              },
              {
                key: 'name',
                header: L('పేరు', 'Name'),
                lang: 'en',
                render: ({ ad }) => (
                  <>
                    <span className="font-semibold">{ad.name}</span>
                    <span className="mt-1 block text-meta text-muted">
                      {L('ముగింపు', 'Ends')} {dateTime(ad.ends_at)}
                    </span>
                  </>
                ),
              },
              {
                key: 'placement',
                header: L('స్థానం', 'Placement'),
                hideBelow: 'md',
                nowrap: true,
                render: ({ ad }) => (
                  <Badge size="xs" lang="en" className="font-mono">
                    {ad.placement}
                  </Badge>
                ),
              },
              {
                key: 'stats',
                header: L('గణాంకాలు', 'Stats'),
                lang: 'en',
                nowrap: true,
                hideBelow: 'lg',
                render: ({ ad }) => (
                  <span className="tabular-nums text-muted">
                    {ad.impressions} imp · {ad.clicks} clicks · {ad.ctr_percent}% CTR
                  </span>
                ),
              },
              {
                key: 'status',
                header: L('స్థితి', 'Status'),
                nowrap: true,
                render: ({ status }) => <StatusPill status={status} />,
              },
            ]}
            rowActions={({ ad, status }) =>
              status === 'ended' ? null : (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={status === 'live' ? Pause : Play}
                    onClick={() => toggle.mutate(ad)}
                    pending={toggle.isPending && toggle.variables?.id === ad.id}
                  >
                    {status === 'live' ? L('ఆపండి', 'Pause') : L('కొనసాగించండి', 'Resume')}
                  </Button>
                  {status === 'live' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      icon={CircleStop}
                      onClick={() => void endNow(ad)}
                      pending={end.isPending && end.variables === ad.id}
                    >
                      {L('ముగించండి', 'End now')}
                    </Button>
                  ) : null}
                </>
              )
            }
          />
        )}
        </div>
      </section>

      <PromptDialog
        open={composing}
        onClose={() => setComposing(false)}
        title={L('కొత్త ప్రచారం', 'New campaign')}
        submitLabel={L('ప్రారంభించండి', 'Launch')}
        pending={create.isPending}
        fields={[
          { name: 'name', label: L('పేరు', 'Name'), required: true, placeholder: 'Sankranti sale' },
          { name: 'image_url', label: 'Image URL', type: 'url', required: true, placeholder: 'https://…/banner.png' },
          { name: 'target_url', label: 'Target URL', type: 'url', required: true, placeholder: 'https://…' },
          {
            name: 'placement',
            label: L('స్థానం', 'Placement'),
            type: 'select',
            defaultValue: 'in_feed',
            options: PLACEMENTS.map(([value, label]) => ({ value, label })),
          },
          {
            name: 'days',
            label: L('రోజులు', 'Days'),
            type: 'select',
            defaultValue: '7',
            options: ['1', '7', '14', '30'].map((d) => ({ value: d, label: d })),
          },
        ]}
        onSubmit={(v) => {
          // Failure already toasts via onError; the dialog stays open for a retry.
          create.mutateAsync(v).then(() => setComposing(false), () => undefined);
        }}
      />
      {dialog}
    </AdminPage>
  );
}
