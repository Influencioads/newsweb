import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, MessageCircle, Pin, RefreshCw, Share2, TrendingUp } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { useL } from './shared';

/** §8 / §19 Trending — time-decayed engagement scores; feature stories via Pins. */

type TrendRow = {
  rank: number;
  score: number;
  article_id: number;
  short_id: string;
  title_te: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  is_pinned: boolean;
};

export function TrendingAdminPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const queryClient = useQueryClient();
  const scores = useQuery({
    queryKey: ['cms', 'trending'],
    queryFn: () => cmsApi.fetchTrendingScores<{ items: TrendRow[] }>(),
  });
  const recompute = useMutation({
    mutationFn: cmsApi.recomputeTrending,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cms', 'trending'] });
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });

  const num = { align: 'right' as const, nowrap: true, lang: 'en' as const };

  return (
    <AdminPage
      title={t('admin.page.trending')}
      subtitle={L(
        'సమయ క్షీణతతో ఎంగేజ్‌మెంట్ స్కోర్లు',
        'Time-decayed engagement scores; feature stories via Pins (§8, §19)',
      )}
      actions={
        <Button variant="secondary" icon={RefreshCw} onClick={() => recompute.mutate()} pending={recompute.isPending}>
          {L('ఇప్పుడు లెక్కించండి', 'Recompute now')}
        </Button>
      }
    >
      {scores.isError ? (
        <ErrorState error={scores.error} onRetry={() => void scores.refetch()} compact />
      ) : (
        <DataTable
          rows={scores.data?.items ?? []}
          rowKey={(r) => r.short_id}
          loading={scores.isLoading}
          caption={t('admin.page.trending')}
          dense
          empty={
            <EmptyState
              icon={TrendingUp}
              title={L('ఇంకా స్కోర్ చేసిన కార్యకలాపం లేదు.', 'No reader activity scored yet.')}
              compact
            />
          }
          columns={[
            {
              key: 'rank',
              header: '#',
              lang: 'en',
              nowrap: true,
              render: (r) => <span className="font-extrabold text-brand">{r.rank}</span>,
            },
            {
              key: 'title',
              header: L('కథనం', 'Story'),
              lang: 'te',
              render: (r) => (
                <>
                  <span className="font-semibold">{r.title_te}</span>
                  <span lang="en" className="ml-2 font-mono text-meta text-muted">
                    {r.article_id}
                  </span>
                </>
              ),
            },
            { key: 'score', ...num, header: 'Score', render: (r) => r.score.toFixed(2) },
            { key: 'views', ...num, header: L('వీక్షణలు', 'Views'), render: (r) => r.view_count },
            {
              key: 'likes',
              ...num,
              header: <Icon icon={Heart} size="sm" label={L('ఇష్టాలు', 'Likes')} />,
              hideBelow: 'md',
              render: (r) => r.like_count,
            },
            {
              key: 'comments',
              ...num,
              header: <Icon icon={MessageCircle} size="sm" label={t('ui.comments')} />,
              hideBelow: 'md',
              render: (r) => r.comment_count,
            },
            {
              key: 'shares',
              ...num,
              header: <Icon icon={Share2} size="sm" label={t('ui.share')} />,
              hideBelow: 'md',
              render: (r) => r.share_count,
            },
            {
              key: 'pinned',
              header: L('పిన్', 'Pinned'),
              nowrap: true,
              render: (r) =>
                r.is_pinned ? (
                  <Badge tone="brand" size="xs" icon={Pin}>
                    {L('పిన్', 'Pinned')}
                  </Badge>
                ) : null,
            },
          ]}
        />
      )}
    </AdminPage>
  );
}
