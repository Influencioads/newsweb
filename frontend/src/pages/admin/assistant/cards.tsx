import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Radio } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '@/api/client';
import { BulletinPill, StatusPill, WorkflowPill } from '@/components/admin/StatusPill';
import { Button, ButtonLink, linkClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { PermissionKey } from '@/types/auth';
import type { AssistantActionCard, AssistantCard, AssistantText } from '@/types/cms';
import { cn } from '@/utils/cn';

import { useL } from '../useL';
import { Markdown, safeHref, scriptOf } from './markdown';

/**
 * The cards Sanjaya's tools ask the page to draw (shapes: CONTRACT "Card
 * shapes"). One component per type; an unknown type draws nothing, so a newer
 * server never breaks an older page.
 */

type Of<K extends AssistantCard['type']> = Extract<AssistantCard, { type: K }>;

/** Pick the interface language out of a tool's `Text` (string, or {te, en}). */
export function useText(): (v: AssistantText | undefined) => string {
  const { language } = useI18n();
  return (v) => (v == null ? '' : typeof v === 'string' ? v : language === 'te' ? v.te || v.en : v.en || v.te);
}

/** Text of unknown script, tagged by reading it. `body` also picks the body size for that script. */
export function T({ text, className, body }: { text: string; className?: string; body?: boolean }) {
  const s = scriptOf(text);
  return (
    <span lang={s.lang} className={cn(s.cls, body && (s.lang === 'te' ? 'text-te-body-xs' : 'text-ui'), className)}>
      {text}
    </span>
  );
}

const count = (n: number) => n.toLocaleString('en-IN');

/**
 * Stop polling on a 4xx: react-query keeps the last good `data` ("running")
 * when a refetch fails, so a deleted thread or a revoked `ai.use` would
 * otherwise be asked for again forever. A 5xx or a lost network keeps trying.
 */
export const gone = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500;

function Shell({ title, children }: { title?: AssistantText; children: ReactNode }) {
  const say = useText();
  const head = say(title);
  return (
    <Card as="section" padding="md" className="min-w-0">
      {head ? (
        <h3 className="mb-3 text-ink">
          <T text={head} className="text-ui font-bold" />
        </h3>
      ) : null}
      {children}
    </Card>
  );
}

function Stats({ card }: { card: Of<'stats'> }) {
  const say = useText();
  return (
    <Shell title={card.title}>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {card.items.map((it, i) => (
          <div key={i} className="min-w-0 rounded-xl bg-paper-sub p-3">
            <dt>
              <T text={say(it.label)} className="text-meta font-semibold text-muted" />
            </dt>
            <dd className="mt-1 break-words text-headline-md font-extrabold tabular-nums text-ink">
              <T text={typeof it.value === 'number' ? count(it.value) : it.value} />
            </dd>
            {it.hint ? (
              <dd>
                <T text={say(it.hint)} className="text-meta text-muted" />
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </Shell>
  );
}

/** Ranked bars in the AnalyticsPage RankTable style; the value is text, so it is read out. */
function Bars({ card }: { card: Of<'bars'> }) {
  const say = useText();
  const max = Math.max(1, ...card.items.map((it) => it.value));
  return (
    <Shell title={card.title}>
      <ol className="space-y-3">
        {card.items.map((it, i) => (
          <li key={i}>
            <div className="flex items-baseline gap-2">
              <T text={say(it.label)} className="te-clamp-2 min-w-0 flex-1 text-ui-sm text-ink" />
              <span className="shrink-0 font-sans text-meta font-semibold tabular-nums text-muted">
                {it.display ?? `${count(it.value)}${card.unit ? ` ${card.unit}` : ''}`}
              </span>
            </div>
            <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-pill bg-rule-soft">
              <div className="h-full rounded-pill bg-brand" style={{ width: `${(Math.max(0, it.value) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </Shell>
  );
}

function Table({ card }: { card: Of<'table'> }) {
  const say = useText();
  return (
    <Shell title={card.title}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {card.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('border-b border-rule px-2 py-2 text-meta font-semibold text-muted', c.align === 'right' && 'text-right')}
                >
                  <T text={say(c.label)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, i) => (
              <tr key={i} className="border-b border-rule-soft last:border-0">
                {card.columns.map((c) => {
                  const v = row[c.key];
                  return (
                    <td key={c.key} className={cn('px-2 py-2 text-ui-sm text-ink', c.align === 'right' && 'text-right tabular-nums')}>
                      {v == null ? '—' : <T text={String(v)} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

function Articles({ card }: { card: Of<'articles'> }) {
  const say = useText();
  return (
    <Shell title={card.title}>
      <ul className="divide-y divide-rule-soft">
        {card.items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 py-1">
            <Link
              to={`/admin/articles/${a.id}/edit`}
              className="flex min-h-tap min-w-0 flex-1 items-center py-1 font-semibold text-ink hover:text-brand"
            >
              <T text={a.title} body className="te-clamp-2" />
            </Link>
            <WorkflowPill status={a.workflow_state} />
            {a.note ? (
              <p className="w-full pb-2">
                <T text={say(a.note)} className="text-meta text-muted" />
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function Sources({ card }: { card: Of<'sources'> }) {
  return (
    <Shell title={card.title}>
      <ol className="space-y-2">
        {card.items.map((src, i) => {
          const href = safeHref(src.url);
          return (
            <li key={i} className="min-w-0">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'inline-flex min-h-tap items-center break-words')}>
                  <T text={src.title || host(src.url)} />
                </a>
              ) : (
                <T text={src.title} className="font-semibold" />
              )}
              <p className="font-sans text-meta text-muted">{[host(src.url), src.date].filter(Boolean).join(' · ')}</p>
              {src.snippet ? (
                <p className="mt-1">
                  <T text={src.snippet} className="te-clamp-3 text-meta text-ink-soft" />
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Shell>
  );
}

/** A background job: polls every 2 s while queued/running, then draws what it made. */
function Job({ card }: { card: Of<'job'> }) {
  const L = useL();
  const say = useText();
  const q = useQuery({
    queryKey: ['cms', 'assistant', 'job', card.job_id],
    queryFn: () => cmsApi.fetchAssistantJob(card.job_id),
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return !gone(query.state.error) && (st === 'queued' || st === 'running') ? 2000 : false;
    },
  });
  const job = q.data;
  if (!job) {
    return (
      <Shell>
        <p role={q.isError ? 'alert' : 'status'} className="text-meta text-muted">
          {q.isError ? L('పని వివరాలు అందలేదు.', 'Could not load this job.') : L('పని వివరాలు వస్తున్నాయి…', 'Loading the job…')}
        </p>
      </Shell>
    );
  }
  const title = job.title || job.kind;
  const err = job.result?.error;
  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 text-ink">
          <T text={title} className="text-ui font-bold" />
        </h3>
        <StatusPill status={job.status} />
      </div>
      {job.status === 'queued' || job.status === 'running' ? (
        <>
          <div
            role="progressbar"
            aria-label={title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
            className="mt-3 h-2 overflow-hidden rounded-pill bg-rule-soft"
          >
            <div className="h-full rounded-pill bg-brand transition-[width] duration-base" style={{ width: `${job.progress}%` }} />
          </div>
          {job.step_text ? (
            <p className="mt-2">
              <T text={job.step_text} className="text-meta text-muted" />
            </p>
          ) : null}
        </>
      ) : null}
      {job.status === 'done' ? (
        <div className="mt-3 space-y-3">
          {job.result?.summary ? <Markdown text={job.result.summary} className={cn(scriptOf(job.result.summary).cls, 'text-ui-sm text-ink')} /> : null}
          {(job.result?.cards ?? []).map((c, i) => (
            <AssistantCardView key={i} id={`job-${card.job_id}:${i}`} card={c} />
          ))}
        </div>
      ) : null}
      {job.status === 'failed' ? (
        <p role="alert" className="mt-2 text-meta text-breaking">
          <T text={err ? say({ te: err.message_te, en: err.message_en }) : job.error || L('ఈ పని విఫలమైంది.', 'This job failed.')} />
        </p>
      ) : null}
    </Shell>
  );
}

const mmss = (sec: number) => {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function Bulletin({ card }: { card: Of<'bulletin'> }) {
  const L = useL();
  const s = useScript();
  const src = safeHref(card.url);
  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-2">
        <Icon icon={Radio} size="sm" className="text-brand" />
        <h3 lang="te" className="te text-te-body-xs font-bold text-ink">
          {card.slot_label_te}
        </h3>
        <BulletinPill status={card.status} />
        <span className="font-sans text-meta tabular-nums text-muted">
          {card.date}
          {card.duration_sec != null ? ` · ${mmss(card.duration_sec)}` : ''}
        </span>
      </div>
      {src ? (
        <audio controls preload="none" src={src} aria-label={card.slot_label_te} className="mt-3 w-full" />
      ) : (
        <p className={cn(s.body, 'mt-2 text-meta text-muted')}>{L('ఆడియో ఇంకా సిద్ధం కాలేదు.', 'The audio is not ready yet.')}</p>
      )}
      <Link to="/admin/bulletins" className={cn(s.body, linkClass, 'mt-1 inline-flex min-h-tap items-center text-ui-sm')}>
        {L('బులెటిన్ల పేజీలో చూడండి', 'Open in Bulletins')}
      </Link>
    </Shell>
  );
}

/** The guard of the route that does the work: permission, then minimum level. */
const ACTION_GUARD: Record<AssistantActionCard['action'], [PermissionKey, number]> = {
  approve_article: ['article.approve', 0],
  publish_article: ['article.publish', 0],
  send_push: ['push.approve', 0],
  publish_bulletin: ['voice.manage', 60],
};

/**
 * Cards that already ran, by `message.id:index`. The button must not come back
 * when the card remounts (another thread, a reload): POST /cms/notifications
 * has no dedupe, so a second click is a second push to every reader.
 * ponytail: per-browser only; a flag on the message payload (lane A) would hold across devices.
 */
const DONE_KEY = 'sanjaya.actions.done';
const doneActions = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);
function markDone(id: string) {
  doneActions.add(id);
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...doneActions].slice(-300)));
  } catch {
    // Storage blocked: the in-memory set still covers this session.
  }
}

const ACTION_REFRESH: Record<AssistantActionCard['action'], string[]> = {
  approve_article: ['cms'],
  publish_article: ['cms'],
  send_push: ['cms', 'campaigns'],
  publish_bulletin: ['cms', 'bulletins'],
};

/** The existing route does the work; Sanjaya only proposed it. */
function runAction(card: AssistantActionCard): Promise<unknown> {
  switch (card.action) {
    case 'approve_article':
      return cmsApi.transitionArticle(card.params.article_id, 'approve');
    case 'publish_article':
      return cmsApi.transitionArticle(card.params.article_id, 'publish');
    case 'send_push':
      return cmsApi.sendCampaign({
        title_te: card.params.title_te,
        body_te: card.params.body_te || null,
        audience: card.params.audience,
        short_id: card.params.short_id || null,
        send_at: card.params.send_at,
      });
    case 'publish_bulletin':
      return cmsApi.publishBulletin(card.params.bulletin_id);
  }
}

function Action({ id, card }: { id: string; card: AssistantActionCard }) {
  const L = useL();
  const say = useText();
  const s = useScript();
  const qc = useQueryClient();
  const [permission, level] = ACTION_GUARD[card.action];
  const allowed = useAuth((st) => st.can(permission) && st.hasLevel(level));
  const { confirm, dialog } = useConfirm();
  const [done, setDone] = useState(() => doneActions.has(id));
  const run = useMutation({
    mutationFn: () => runAction(card),
    onSuccess: () => {
      markDone(id);
      setDone(true);
      void qc.invalidateQueries({ queryKey: ACTION_REFRESH[card.action] });
    },
  });
  const label = say(card.label);
  const summary = say(card.summary);
  const go = async () => {
    if (await confirm({ title: label, body: summary, confirmLabel: label, tone: 'primary' })) run.mutate();
  };
  const error =
    run.error instanceof ApiError
      ? say({ te: run.error.messageTe, en: run.error.messageEn }) || run.error.displayMessage
      : run.error
        ? L('ఇది పూర్తి కాలేదు. మళ్లీ ప్రయత్నించండి.', 'That did not go through. Try again.')
        : null;
  return (
    <Shell>
      <p className="text-ink">
        <T text={summary} body />
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {done ? (
          <p role="status" className={cn(s.body, 'inline-flex items-center gap-1.5 text-ui-sm font-semibold text-success')}>
            <Icon icon={Check} size="sm" />
            {L('పూర్తయింది.', 'Done.')}
          </p>
        ) : (
          <Button pending={run.isPending} disabled={!allowed} onClick={() => void go()}>
            {label}
          </Button>
        )}
        {!allowed ? (
          <p className={cn(s.body, 'text-meta text-muted')}>{L('ఈ పనికి మీకు అనుమతి లేదు.', 'You do not have permission for this.')}</p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-breaking">
          <T text={error} />
        </p>
      ) : null}
      {dialog}
    </Shell>
  );
}

function ImageCard({ card }: { card: Of<'image'> }) {
  const L = useL();
  const src = safeHref(card.url);
  if (!src) return null;
  return (
    <Shell>
      <img src={src} alt={card.alt} loading="lazy" className="max-h-96 w-auto max-w-full rounded-xl border border-rule" />
      <ButtonLink to={src} external download variant="secondary" size="sm" icon={Download} className="mt-3">
        {L('డౌన్‌లోడ్', 'Download')}
      </ButtonLink>
    </Shell>
  );
}

/** `id` is stable per card (`message.id:index`), so an action card remembers it ran. */
export function AssistantCardView({ id, card }: { id: string; card: AssistantCard }) {
  switch (card.type) {
    case 'stats':
      return <Stats card={card} />;
    case 'bars':
      return <Bars card={card} />;
    case 'table':
      return <Table card={card} />;
    case 'articles':
      return <Articles card={card} />;
    case 'sources':
      return <Sources card={card} />;
    case 'job':
      return <Job card={card} />;
    case 'bulletin':
      return <Bulletin card={card} />;
    case 'action':
      return <Action id={id} card={card} />;
    case 'image':
      return <ImageCard card={card} />;
    default:
      return null;
  }
}
