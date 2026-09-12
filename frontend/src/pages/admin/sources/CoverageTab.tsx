import { useQuery } from '@tanstack/react-query';

import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { Card } from '@/components/ui/Card';
import { QueryState, Skeleton } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { CrawlBeatStatus } from '@/types/cms';
import { cn } from '@/utils/cn';

import { BEATS } from './labels';

/**
 * Quota used this hour, and whether the crawl worker is actually alive.
 *
 * `stale` is the field that matters: crawl tasks route to their own Celery
 * queue, so a deployment missing the `worker-ingest` container queues them in
 * Redis forever and nothing else anywhere reports a failure.
 */
export function CoverageTab() {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const status = useQuery({ queryKey: ['cms', 'crawl-status'], queryFn: cmsApi.fetchCrawlStatus });
  const body = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm');

  const columns: DataTableColumn<CrawlBeatStatus>[] = [
    {
      key: 'beat',
      header: L('బీట్', 'Beat'),
      render: (row) => {
        const beat = BEATS.find((b) => b.value === row.beat);
        return beat ? L(beat.te, beat.en) : row.beat;
      },
    },
    {
      key: 'sources',
      header: L('మూలాలు', 'Sources'),
      align: 'right',
      render: (row) => <span className="font-sans tabular-nums">{row.sources}</span>,
    },
    {
      key: 'quota',
      header: L('వాడినవి / కోటా', 'Used / quota'),
      align: 'right',
      render: (row) => (
        <span className="font-sans tabular-nums">
          <span className={cn(row.quota > 0 && row.used >= row.quota && 'font-bold text-partial')}>{row.used}</span>
          {' / '}
          {row.quota}
        </span>
      ),
    },
  ];
  const rowKey = (row: CrawlBeatStatus) => row.beat;

  return (
    <QueryState
      query={status}
      isEmpty={() => false}
      skeleton={
        <div className="space-y-4">
          <Skeleton variant="block" />
          <DataTable rows={[]} columns={columns} rowKey={rowKey} loading skeletonRows={4} />
        </div>
      }
    >
      {(data) => (
        <div className="space-y-4">
          {!data.enabled ? (
            <Card padding="sm" tone="paper" role="status">
              <p className={cn(body, 'text-ink-soft')}>
                {L(
                  'గంటవారీ క్రాల్ ఆఫ్‌లో ఉంది. సెట్టింగ్స్‌లో ఆన్ చేయండి — అప్పటివరకు షెడ్యూల్‌లో ఏమీ జరగదు.',
                  'The hourly crawl is switched off. Turn it on in Settings — nothing is fetched or rewritten on a schedule until you do.',
                )}
              </p>
            </Card>
          ) : null}

          {data.enabled && data.stale ? (
            <p role="alert" className={cn(body, 'rounded-xl border border-breaking-border bg-breaking-tint p-4 text-breaking')}>
              {L(
                'రెండు గంటలుగా ఏ మూలం నుంచీ విజయవంతంగా తేలేదు. worker-ingest కంటైనర్ నడుస్తోందో చూడండి.',
                'No source has been fetched successfully for over two hours. Check that the worker-ingest container is running — crawl tasks go to their own queue and pile up silently without it.',
              )}
            </p>
          ) : null}

          <Card>
            <p className={cn(s.body, 'text-ui-sm text-muted')}>{L('ఈ గంటలో పునర్లేఖనాలు', 'Rewrites this hour')}</p>
            <p className="font-sans text-headline-lg font-extrabold tabular-nums text-ink">
              {data.used_this_hour}
              <span className="text-headline-xs font-semibold text-muted"> / {data.hourly_cap}</span>
            </p>
            <p className={cn(s.body, 'mt-2 text-meta text-muted')}>
              {data.last_fetch_at
                ? `${L('చివరి ఫెచ్', 'Last fetch')}: ${new Date(data.last_fetch_at).toLocaleString('en-IN')}`
                : L('ఎప్పుడూ తేలేదు', 'Never fetched')}
            </p>
          </Card>

          <DataTable rows={data.beats} columns={columns} rowKey={rowKey} caption={L('బీట్ కోటాలు', 'Beat quotas')} dense />
        </div>
      )}
    </QueryState>
  );
}
