import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAuth } from '@/stores/auth';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

/**
 * Newsroom dashboard.
 *
 * Everything rendered here comes from the API. §26 of the brief is explicit —
 * "Do not use fake dashboard numbers" — so this page shows only what the system
 * can currently answer truthfully.
 *
 * Editorial counters (pending reviews, published today, breaking, AI spend) are
 * added by the phases that create those entities, each backed by a real query.
 */

export default function Dashboard() {
  const { language } = useI18n();
  const en = language === 'en';
  const me = useAuth((s) => s.me);
  const stats = useQuery({ queryKey: ['cms', 'dashboard'], queryFn: cmsApi.fetchDashboardStats });

  if (!me) return null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-[18px]">
      <header className="mb-5">
        <h1 className="th text-[22px] font-extrabold text-ink">
          {en ? 'Welcome' : 'నమస్కారం'}, {en ? me.user.name_en : me.user.name_te}
        </h1>
        <p className="mt-1 font-sans text-[12px] text-muted">
          {en ? (me.roles[0]?.role_label_en ?? me.user.name_en) : (me.user.designation_te ?? me.roles[0]?.role_label_te)} · {en ? 'level' : 'స్థాయి'} {me.level}
        </p>
      </header>

      {/* §24 — fourteen cards, split into the two things a desk actually
          tracks: what is moving through the workflow, and who is reading. */}
      {stats.data ? <>
        <section className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          {[
            [en?'Total':'మొత్తం', stats.data.total_articles, '/admin/articles'], [en?'Drafts':'డ్రాఫ్ట్‌లు', stats.data.drafts, '/admin/articles'],
            [en?'In review':'రివ్యూ', stats.data.pending_review, '/admin/review'], [en?'Approved':'ఆమోదం', stats.data.approved, '/admin/review'],
            [en?'Published today':'నేడు ప్రచురణ', stats.data.published_today, '/admin/articles'], [en?'Breaking':'బ్రేకింగ్', stats.data.breaking_live, '/admin/articles'],
            [en?'Changes requested':'మార్పులు', stats.data.returned_for_changes, '/admin/review'],
            [en?'Scheduled':'షెడ్యూల్', stats.data.scheduled, '/admin/articles'],
          ].map(([label, value, href]) => <Link key={String(label)} to={href as string} aria-label={`${label}: ${value}`} className="rounded-card border border-rule bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:bg-surface"><p className="font-sans text-[24px] font-extrabold text-brand">{value}</p><p className="te mt-1 text-[11px] font-semibold text-muted">{label}</p></Link>)}
        </section>
        <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            [en?'Readers':'పాఠకులు', stats.data.total_users, '/admin/users'],
            [en?'Active (7d)':'క్రియాశీలం (7రో)', stats.data.active_users_7d, '/admin/analytics'],
            [en?'Views today':'నేటి వీక్షణలు', stats.data.views_today, '/admin/analytics'],
            [en?'Submissions':'పాఠకుల రచనలు', stats.data.submissions_pending, '/admin/moderation'],
            [en?'AI suggestions':'AI సూచనలు', stats.data.ai_suggestions_new, '/admin/ai'],
            [en?'AI drafts':'AI డ్రాఫ్ట్‌లు', stats.data.ai_drafts_pending, '/admin/ai'],
          ].map(([label, value, href]) => {
            const card = <><p className="font-sans text-[22px] font-extrabold text-ink">{value as number}</p><p className="te mt-1 text-[11px] font-semibold text-muted">{label as string}</p></>;
            return <Link key={String(label)} to={href as string} aria-label={`${label}: ${value}`} className="rounded-card border border-rule bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:bg-surface">{card}</Link>;
          })}
        </section>
        <section className="mb-4 grid gap-3 md:grid-cols-3">
          {([
            [en?'Top categories (7d)':'టాప్ విభాగాలు (7రో)', stats.data.top_categories],
            [en?'Top districts (7d)':'టాప్ జిల్లాలు (7రో)', stats.data.top_districts],
            [en?'Top mandals (7d)':'టాప్ మండలాలు (7రో)', stats.data.top_mandals],
          ] as const).map(([label, rows]) => (
            <Link key={label} to="/admin/analytics" className="rounded-card border border-rule bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:bg-surface">
              <h3 className="te mb-2 border-b border-rule-soft pb-1.5 text-[12px] font-bold text-ink">{label}</h3>
              {rows.length ? (
                <ol className="space-y-1">
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-baseline justify-between gap-2">
                      <span className="te truncate text-[12.5px] text-ink-soft">{en ? row.name_en : row.name_te}</span>
                      <span className="font-sans text-[12px] font-bold tabular-nums text-brand">{row.count}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="te text-[12px] text-muted">{en ? 'Nothing published in the last 7 days.' : 'గత 7 రోజుల్లో ప్రచురణ లేదు.'}</p>
              )}
            </Link>
          ))}
        </section>
      </> : null}

    </main>
  );
}
