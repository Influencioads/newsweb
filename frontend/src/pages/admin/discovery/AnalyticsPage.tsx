import { useQuery } from '@tanstack/react-query';

import { AdminPage } from '@/components/admin/AdminPage';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/Layout';
import { QueryState, Skeleton } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

import { useL } from './shared';

/** §25 Analytics — reader behaviour from the event stream. */

type Analytics = {
  dau: number;
  wau: number;
  mau: number;
  reads_7d: number;
  avg_read_seconds_7d: number;
  avg_scroll_pct_7d: number;
  registered_readers: number;
  likes_total: number;
  bookmarks_total: number;
  comments_total: number;
  follows_total: number;
  top_articles_7d: Array<{ title_te: string; short_id: string; reads: number }>;
  top_categories_7d: Array<{ name_te: string; slug: string; reads: number }>;
  top_districts_7d: Array<{ name_te: string; slug: string; reads: number }>;
  top_searches_7d: Array<{ query: string; count: number }>;
};

type Stat = [label: string, value: number];
type RankRow = { label: string; n: number };

function StatGrid({ stats, cols }: { stats: Stat[]; cols: string }) {
  const s = useScript();
  const reveal = useReveal<HTMLElement>();
  return (
    <dl className={cn('grid gap-3', cols)}>
      {stats.map(([label, value]) => (
        <Card key={label} ref={reveal} padding="sm">
          <dt className={cn(s.body, 'text-meta font-semibold text-muted')}>{label}</dt>
          <dd className="mt-1 font-sans text-headline-md font-extrabold tabular-nums text-ink">{value}</dd>
        </Card>
      ))}
    </dl>
  );
}

/** Ranked list with a proportional bar (widest = the top row). */
function RankTable({ title, rows }: { title: string; rows: RankRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card as="section">
      <SectionHeader title={title} level={3} />
      {rows.length === 0 ? (
        <p className="font-sans text-meta text-muted">—</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={i}>
              <div className="flex items-baseline gap-2">
                <span className="w-5 shrink-0 font-sans text-meta font-bold tabular-nums text-muted">{i + 1}</span>
                <span lang="te" className="te te-clamp-1 min-w-0 flex-1 text-te-body-xs">
                  {r.label}
                </span>
                <span className="font-sans text-meta font-semibold tabular-nums text-muted">{r.n}</span>
              </div>
              <div aria-hidden className="ml-7 mt-1 h-1.5 overflow-hidden rounded-pill bg-rule-soft">
                <div className="h-full rounded-pill bg-brand" style={{ width: `${(r.n / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function AnalyticsPage() {
  const { t } = useI18n();
  const L = useL();
  const q = useQuery({ queryKey: ['cms', 'analytics'], queryFn: () => cmsApi.fetchAnalytics<Analytics>() });

  return (
    <AdminPage
      title={t('admin.page.analytics')}
      subtitle={L('ఈవెంట్ స్ట్రీమ్ నుంచి పాఠకుల ప్రవర్తన', 'Reader behaviour from the event stream (§25)')}
    >
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} variant="block" />
            ))}
          </div>
        }
      >
        {(d) => (
          <>
            <StatGrid
              cols="sm:grid-cols-3 lg:grid-cols-6"
              stats={[
                ['DAU', d.dau],
                ['WAU', d.wau],
                ['MAU', d.mau],
                [L('పఠనాలు 7రో', 'Reads 7d'), d.reads_7d],
                [L('సగటు పఠనం (సె)', 'Avg read (s)'), d.avg_read_seconds_7d],
                [L('సగటు స్క్రోల్ %', 'Avg scroll %'), d.avg_scroll_pct_7d],
              ]}
            />
            <StatGrid
              cols="sm:grid-cols-2 lg:grid-cols-5"
              stats={[
                [L('పాఠకులు', 'Readers'), d.registered_readers],
                [L('ఇష్టాలు', 'Likes'), d.likes_total],
                [L('సేవ్‌లు', 'Bookmarks'), d.bookmarks_total],
                [L('వ్యాఖ్యలు', 'Comments'), d.comments_total],
                [L('ఫాలోలు', 'Follows'), d.follows_total],
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <RankTable
                title={L('టాప్ కథనాలు (7 రోజులు)', 'Top stories (7d)')}
                rows={d.top_articles_7d.map((a) => ({ label: a.title_te, n: a.reads }))}
              />
              <RankTable
                title={L('టాప్ విభాగాలు', 'Top sections (7d)')}
                rows={d.top_categories_7d.map((c) => ({ label: c.name_te, n: c.reads }))}
              />
              <RankTable
                title={L('టాప్ జిల్లాలు', 'Top districts (7d)')}
                rows={d.top_districts_7d.map((x) => ({ label: x.name_te, n: x.reads }))}
              />
              <RankTable
                title={L('టాప్ శోధనలు', 'Top searches (7d)')}
                rows={d.top_searches_7d.map((x) => ({ label: x.query, n: x.count }))}
              />
            </div>
          </>
        )}
      </QueryState>
    </AdminPage>
  );
}
