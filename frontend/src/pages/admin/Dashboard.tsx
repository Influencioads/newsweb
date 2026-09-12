import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { AdminPage } from '@/components/admin/AdminPage';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { DashboardStats } from '@/types/cms';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

/**
 * Newsroom dashboard.
 *
 * Everything rendered here comes from the API. §26 of the brief is explicit —
 * "Do not use fake dashboard numbers" — so this page shows only what the system
 * can currently answer truthfully.
 *
 * §24 — fourteen stat cards split into the two things a desk actually tracks
 * (what is moving through the workflow, and who is reading), then the three
 * seven-day "top" breakdowns. Each stat card links to the screen that acts on it.
 */

type Stat = readonly [label: string, value: number, href: string];
type TopRow = DashboardStats['top_categories'][number];

const WORKFLOW_COLS = 'grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8';
const AUDIENCE_COLS = 'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6';
const TOP_COLS = 'grid gap-3 md:grid-cols-3';

function StatGrid({ stats, cols, tone }: { stats: Stat[]; cols: string; tone: 'brand' | 'ink' }) {
  const s = useScript();
  const reveal = useReveal<HTMLLIElement>();
  return (
    <ul className={cols}>
      {stats.map(([label, value, href]) => (
        <li key={label} ref={reveal}>
          <Card interactive padding="none" className="h-full">
            <Link to={href} aria-label={`${label}: ${value}`} className="block min-h-tap rounded-xl p-3 md:p-4">
              <p
                className={cn(
                  'font-sans text-headline-lg font-extrabold tabular-nums',
                  tone === 'brand' ? 'text-brand' : 'text-ink',
                )}
              >
                {value}
              </p>
              <p className={cn(s.body, 'mt-1 text-meta font-semibold text-muted')}>{label}</p>
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function StatSkeleton({ count, cols }: { count: number; cols: string }) {
  return (
    <div className={cols}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} padding="sm">
          <Skeleton variant="headline" />
          <Skeleton className="mt-2 w-2/3" />
        </Card>
      ))}
    </div>
  );
}

function TopCard({ label, rows }: { label: string; rows?: TopRow[] }) {
  const { language } = useI18n();
  const s = useScript();
  return (
    <Card>
      <SectionHeader level={3} tone="ink" title={label} />
      {!rows ? (
        <Skeleton lines={4} />
      ) : rows.length ? (
        <ol className="space-y-2">
          {rows.map((row) => {
            const name = s.text(row.name_te, row.name_en);
            return (
              <li key={row.id} className="flex items-baseline justify-between gap-3">
                <span
                  lang={name.lang}
                  className={cn(name.cls, name.telugu ? 'text-te-body-xs' : 'text-ui-sm', 'min-w-0 text-ink-soft te-clamp-1')}
                >
                  {name.text}
                </span>
                <span className="font-sans text-ui-sm font-bold tabular-nums text-brand">{row.count}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          compact
          title={language === 'te' ? 'గత 7 రోజుల్లో ప్రచురణ లేదు.' : 'Nothing published in the last 7 days.'}
        />
      )}
    </Card>
  );
}

/** The three sections; without `data` every grid renders its skeleton in place, so nothing jumps on load. */
function Sections({ data }: { data?: DashboardStats }) {
  const { t, language } = useI18n();
  const en = language === 'en';
  const L = (te: string, en_: string) => (en ? en_ : te);

  const workflow: Stat[] | undefined = data && [
    [L('మొత్తం', 'Total'), data.total_articles, '/admin/articles'],
    [L('డ్రాఫ్ట్‌లు', 'Drafts'), data.drafts, '/admin/articles'],
    [L('రివ్యూ', 'In review'), data.pending_review, '/admin/review'],
    [L('ఆమోదం', 'Approved'), data.approved, '/admin/review'],
    [L('నేడు ప్రచురణ', 'Published today'), data.published_today, '/admin/articles'],
    [L('బ్రేకింగ్', 'Breaking'), data.breaking_live, '/admin/articles'],
    [L('మార్పులు', 'Changes requested'), data.returned_for_changes, '/admin/review'],
    [L('షెడ్యూల్', 'Scheduled'), data.scheduled, '/admin/articles'],
  ];
  const audience: Stat[] | undefined = data && [
    [L('పాఠకులు', 'Readers'), data.total_users, '/admin/users'],
    [L('క్రియాశీలం (7రో)', 'Active (7d)'), data.active_users_7d, '/admin/analytics'],
    [L('నేటి వీక్షణలు', 'Views today'), data.views_today, '/admin/analytics'],
    [L('పాఠకుల రచనలు', 'Submissions'), data.submissions_pending, '/admin/moderation'],
    [L('AI సూచనలు', 'AI suggestions'), data.ai_suggestions_new, '/admin/ai'],
    [L('AI డ్రాఫ్ట్‌లు', 'AI drafts'), data.ai_drafts_pending, '/admin/ai'],
  ];
  const tops: Array<[string, TopRow[] | undefined]> = [
    [L('టాప్ విభాగాలు (7రో)', 'Top categories (7d)'), data?.top_categories],
    [L('టాప్ జిల్లాలు (7రో)', 'Top districts (7d)'), data?.top_districts],
    [L('టాప్ మండలాలు (7రో)', 'Top mandals (7d)'), data?.top_mandals],
  ];

  // A fragment: the sections become direct children of AdminPage and inherit its rhythm.
  return (
    <>
      <section>
        <SectionHeader title={t('admin.group.newsroom')} />
        {workflow ? <StatGrid stats={workflow} cols={WORKFLOW_COLS} tone="brand" /> : <StatSkeleton count={8} cols={WORKFLOW_COLS} />}
      </section>
      <section>
        <SectionHeader title={t('admin.group.audience')} />
        {audience ? <StatGrid stats={audience} cols={AUDIENCE_COLS} tone="ink" /> : <StatSkeleton count={6} cols={AUDIENCE_COLS} />}
      </section>
      <section>
        <SectionHeader title={t('admin.page.analytics')} to="/admin/analytics" />
        <div className={TOP_COLS}>
          {tops.map(([label, rows]) => (
            <TopCard key={label} label={label} rows={rows} />
          ))}
        </div>
      </section>
    </>
  );
}

export default function Dashboard() {
  const { t, language } = useI18n();
  const en = language === 'en';
  const me = useAuth((s) => s.me);
  const stats = useQuery({ queryKey: ['cms', 'dashboard'], queryFn: cmsApi.fetchDashboardStats });

  if (!me) return null;

  const role = en ? (me.roles[0]?.role_label_en ?? me.user.name_en) : (me.user.designation_te ?? me.roles[0]?.role_label_te);

  return (
    <AdminPage
      title={t('admin.page.dashboard')}
      subtitle={
        <>
          {en ? 'Welcome' : 'నమస్కారం'}, {en ? me.user.name_en : me.user.name_te} · {role} · {en ? 'level' : 'స్థాయి'} {me.level}
        </>
      }
    >
      <QueryState query={stats} skeleton={<Sections />}>
        {(data) => <Sections data={data} />}
      </QueryState>
    </AdminPage>
  );
}
