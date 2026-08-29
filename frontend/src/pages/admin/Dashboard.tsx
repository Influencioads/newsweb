import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MonitorSmartphone, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/client';
import * as authApi from '@/features/auth/api';
import { useAuth } from '@/stores/auth';
import type { UserSession } from '@/types/auth';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

/**
 * Newsroom dashboard.
 *
 * Everything rendered here comes from the API. §26 of the brief is explicit —
 * "Do not use fake dashboard numbers" — so this page shows only what the system
 * can currently answer truthfully: the signed-in account, its resolved roles,
 * scope and permissions, and its live sessions.
 *
 * Editorial counters (pending reviews, published today, breaking, AI spend) are
 * added by the phases that create those entities, each backed by a real query.
 */

function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-rule bg-white shadow-card">
      <header className="flex items-start gap-2.5 border-b border-rule-soft px-4 py-3">
        {icon ? <span className="mt-0.5 text-muted-light">{icon}</span> : null}
        <div>
          <h2 className="te text-[13px] font-bold leading-telugu text-ink">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 font-sans text-[11px] text-muted-light">{subtitle}</p>
          ) : null}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function SessionRow({
  session,
  onRevoke,
  revoking,
  english,
}: {
  session: UserSession;
  onRevoke: (id: number) => void;
  revoking: boolean;
  english: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-rule-soft py-3 last:border-0">
      <div className="min-w-0">
        <p className="font-sans text-[12.5px] font-medium text-ink">
          {session.platform}
          {session.is_current ? (
            <span className="ml-2 rounded-chip bg-success-tint px-2 py-0.5 text-[10px] font-bold text-success">
              {english ? 'This device' : 'ఈ పరికరం'}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate font-sans text-[11px] text-muted-light">
          {session.ip ?? 'unknown ip'} · {formatWhen(session.last_used_at ?? session.created_at)}
        </p>
        {session.user_agent ? (
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-light/80">
            {session.user_agent}
          </p>
        ) : null}
      </div>
      {!session.is_current ? (
        <button
          type="button"
          onClick={() => onRevoke(session.id)}
          disabled={revoking}
          className="te shrink-0 rounded-control border border-rule px-3 py-2 text-[11.5px] font-semibold leading-telugu text-breaking hover:bg-breaking-tint disabled:opacity-50"
        >
          {english ? 'Sign out' : 'లాగ్ అవుట్'}
        </button>
      ) : null}
    </li>
  );
}

export default function Dashboard() {
  const { language } = useI18n();
  const en = language === 'en';
  const me = useAuth((s) => s.me);
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: authApi.fetchSessions,
  });
  const stats = useQuery({ queryKey: ['cms', 'dashboard'], queryFn: cmsApi.fetchDashboardStats });

  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });

  if (!me) return null;

  const grouped = me.permissions.reduce<Record<string, string[]>>((acc, key) => {
    const group = key.split('.')[0] ?? 'other';
    (acc[group] ??= []).push(key);
    return acc;
  }, {});

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

      {stats.data ? <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {[
          [en?'Total':'మొత్తం', stats.data.total_articles], [en?'Drafts':'డ్రాఫ్ట్‌లు', stats.data.drafts],
          [en?'In review':'రివ్యూ', stats.data.pending_review], [en?'Approved':'ఆమోదం', stats.data.approved],
          [en?'Published today':'నేడు ప్రచురణ', stats.data.published_today], [en?'Breaking':'బ్రేకింగ్', stats.data.breaking_live],
          [en?'Changes requested':'మార్పులు', stats.data.returned_for_changes],
        ].map(([label, value]) => <div key={String(label)} className="rounded-card border border-rule bg-white p-3 shadow-card"><p className="font-sans text-[24px] font-extrabold text-brand">{value}</p><p className="te mt-1 text-[11px] font-semibold text-muted">{label}</p></div>)}
      </section> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title={en?'Your roles and scope':'మీ పాత్రలు మరియు పరిధి'}
          subtitle={en?'Resolved from user roles; authorization uses permission keys, never role names':'యూజర్ పాత్రల నుంచి పరిష్కరించబడింది; అనుమతి తనిఖీలు పాత్ర పేరును ఉపయోగించవు'}
          icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
        >
          <ul className="flex flex-col gap-2">
            {me.roles.map((role) => (
              <li
                key={`${role.role_key}-${role.scope_type}-${role.scope_id}`}
                className="flex flex-wrap items-center gap-2 rounded-control border border-rule bg-paper px-3 py-2"
              >
                <span className="te text-[13px] font-bold text-ink">{en ? role.role_label_en : role.role_label_te}</span>
                <span className="font-mono text-[10.5px] text-muted-light">{role.role_key}</span>
                <span className="ml-auto rounded-chip bg-info-tint px-2 py-0.5 font-sans text-[10.5px] font-semibold text-info">
                  L{role.level}
                </span>
                <span className="rounded-chip bg-rule-soft px-2 py-0.5 font-sans text-[10.5px] text-muted">
                  {role.scope_type}
                  {role.scope_id !== null ? ` #${role.scope_id}` : ''}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-3 grid grid-cols-2 gap-2 font-sans text-[11.5px]">
            <div className="rounded-control border border-rule px-3 py-2">
              <dt className="text-muted-light">{en?'Scope':'పరిధి'}</dt>
              <dd className="font-semibold text-ink">
                {me.is_global_scope ? (en?'Global':'ప్రపంచవ్యాప్తం') : (en?'Restricted':'పరిమితం')}
              </dd>
            </div>
            <div className="rounded-control border border-rule px-3 py-2">
              <dt className="text-muted-light">{en?'Districts / mandals':'జిల్లాలు / మండలాలు'}</dt>
              <dd className="font-semibold text-ink">
                {me.is_global_scope
                  ? (en?'All':'అన్నీ')
                  : `${me.district_ids.length} / ${me.mandal_ids.length}`}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title={en?'Active sessions':'సక్రియ సెషన్లు'}
          subtitle={en?'Maximum 3 concurrent staff sessions; the oldest is removed on a new login':'గరిష్ఠంగా 3 సిబ్బంది సెషన్లు; కొత్త లాగిన్‌లో పాతది తొలగించబడుతుంది'}
          icon={<MonitorSmartphone className="h-4 w-4" aria-hidden />}
        >
          {sessions.isLoading ? (
            <p className="flex items-center gap-2 font-sans text-[12px] text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {en?'Loading…':'లోడ్ అవుతోంది…'}
            </p>
          ) : sessions.isError ? (
            <div role="alert" className="rounded-control border border-breaking-border bg-breaking-tint px-3 py-2">
              <p className="te text-[12px] text-[#8E2A31]">
                {sessions.error instanceof ApiError
                  ? sessions.error.displayMessage
                  : (en?'Could not load sessions.':'సెషన్లను చదవలేకపోయాం.')}
              </p>
            </div>
          ) : sessions.data && sessions.data.length > 0 ? (
            <ul>
              {sessions.data.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onRevoke={(id) => revoke.mutate(id)}
                  revoking={revoke.isPending}
                  english={en}
                />
              ))}
            </ul>
          ) : (
            <p className="te text-[12.5px] text-muted">{en?'No active sessions.':'సక్రియ సెషన్లు ఏవీ లేవు.'}</p>
          )}
        </Panel>

        <Panel
          title={en?'Your permissions':'మీ అనుమతులు'}
          subtitle={en?`${me.permissions.length} permissions — the API checks every request`:`${me.permissions.length} అనుమతులు — ప్రతి అభ్యర్థనను API తనిఖీ చేస్తుంది`}
        >
          <div className="flex flex-col gap-3">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([group, keys]) => (
                <div key={group}>
                  <p className="mb-1 font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-muted-light">
                    {group}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {keys.sort().map((key) => (
                      <span
                        key={key}
                        className="rounded-chip border border-rule px-2 py-0.5 font-mono text-[10.5px] text-ink-soft"
                      >
                        {key.slice(group.length + 1)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            {me.permissions.length === 0 ? (
              <p className="te text-[12.5px] text-muted">
                {en?'This account has no CMS permissions.':'ఈ ఖాతాకు CMS అనుమతులు ఏవీ లేవు.'}
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
    </main>
  );
}
