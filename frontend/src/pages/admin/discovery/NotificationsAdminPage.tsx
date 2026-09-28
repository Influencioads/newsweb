import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarClock, ChevronLeft, ChevronRight, Send, Smartphone, X } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog, useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Radio, Select, Textarea } from '@/components/ui/Field';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { fetchArticle } from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import type { CmsOption } from '@/types/cms';
import { cn } from '@/utils/cn';

import { dateTime, useL } from './shared';

/**
 * §13 Notifications — compose, send or schedule reader alerts; level-60
 * approval enforced by the API. A send writes the in-app inbox at once; the
 * worker (a 30-second tick) pushes it to phones and the log fills in
 * devices / delivered / failed / opened. Publish-time alerts appear as `auto:*`
 * under their own tab; scheduled campaigns are always listed first.
 */

type CampaignStatus = 'scheduled' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
type CampaignRow = {
  id: number;
  title_te: string;
  audience: string;
  status: CampaignStatus;
  sent_count: number;
  devices: number;
  push_ok: number;
  push_failed: number;
  opened: number;
  send_at: string | null;
  sent_at: string | null;
  created_at: string;
};
type CampaignLog = {
  items: CampaignRow[];
  next_offset: number | null;
  devices_registered: { total: number; android: number; ios: number; anonymous: number };
  push_enabled: boolean;
};
type Target = 'all' | 'district' | 'category' | 'tag';
type Source = 'manual' | 'auto' | 'all';

const PAGE = 25;
const TITLE_MAX = 120;
const BODY_MAX = 500;
const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  scheduled: 'info',
  queued: 'partial',
  sending: 'partial',
  sent: 'success',
  failed: 'breaking',
  cancelled: 'muted',
};

/** The newsroom works in IST whatever the editor's laptop says. */
function ist(iso: string): string {
  return `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;
}

/** `datetime-local` wants local wall-clock time without a zone. */
function localInputValue(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function NotificationsAdminPage() {
  const { t } = useI18n();
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<Target>('all');
  const [slug, setSlug] = useState('');
  const [shortId, setShortId] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [sendAt, setSendAt] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Every publish can log auto:* alerts, so an editor's own campaigns get their own tab.
  const [source, setSource] = useState<Source>('manual');
  const [page, setPage] = useState(0);

  const log = useQuery({
    queryKey: ['cms', 'campaigns', { source, page }],
    queryFn: () =>
      cmsApi.fetchCampaigns<CampaignLog>({
        source: source === 'all' ? undefined : source,
        offset: page * PAGE,
        limit: PAGE,
      }),
    placeholderData: keepPreviousData,
    // Stats land a few seconds after a send; keep polling only while something is in flight.
    refetchInterval: (q) =>
      q.state.data?.items.some((c) => c.status === 'queued' || c.status === 'sending') ? 10_000 : false,
  });
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });
  const sid = shortId.trim();
  // The server refuses unknown and unpublished stories; the public endpoint
  // answers exactly that question, so the editor sees the headline first.
  const story = useQuery({
    queryKey: ['public', 'article', sid],
    queryFn: () => fetchArticle(sid),
    enabled: sid.length >= 6,
    retry: false,
  });

  const send = useMutation({
    mutationFn: () =>
      cmsApi.sendCampaign({
        title_te: title,
        body_te: body || null,
        audience: target === 'all' ? 'all' : `${target}:${slug}`,
        // Without this the push is a dead end: it says something happened and
        // gives the reader nowhere to read it. The server resolves the short id
        // to the story's url for the notification inbox.
        short_id: sid || null,
        send_at: when === 'later' ? new Date(sendAt).toISOString() : null,
      }) as Promise<{ id: number; sent_count: number; status: CampaignStatus }>,
    onSuccess: (res) => {
      setTitle('');
      setBody('');
      setShortId('');
      setSendAt('');
      setWhen('now');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['cms', 'campaigns'] });
      toast.success(
        res.status === 'scheduled'
          ? L('షెడ్యూల్ అయింది.', 'Scheduled.')
          : L(
              `${res.sent_count} ఇన్‌బాక్స్‌లకు చేరింది; ఫోన్లకు వర్కర్ తర్వాతి రన్‌లో.`,
              `In ${res.sent_count} inboxes now; phones on the worker's next run.`,
            ),
      );
    },
    onError: (err) => toast.error(err),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => cmsApi.cancelCampaign(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cms', 'campaigns'] });
      toast.success(L('రద్దు చేశాం.', 'Cancelled.'));
    },
    onError: (err) => toast.error(err),
  });

  const choices: CmsOption[] | undefined =
    target === 'district'
      ? options.data?.districts
      : target === 'category'
        ? options.data?.categories
        : target === 'tag'
          ? options.data?.tags
          : undefined;
  const chosen = choices?.find((o) => o.slug === slug);
  const targetLabel: Record<Target, string> = {
    all: L('అందరు పాఠకులు (యాప్ ఉన్న ప్రతి ఫోన్)', 'Everyone (every phone with the app)'),
    district: L('జిల్లా', 'District'),
    category: L('విభాగ ఫాలోవర్లు', 'Category followers'),
    tag: L('ట్యాగ్ ఫాలోవర్లు', 'Tag followers'),
  };
  const audienceLabel = chosen ? `${targetLabel[target]}: ${L(chosen.name_te, chosen.name_en)}` : targetLabel[target];
  const future = when === 'later' && Boolean(sendAt) && new Date(sendAt).getTime() > Date.now();
  const ready =
    Boolean(title.trim()) &&
    (target === 'all' || Boolean(slug)) &&
    (when === 'now' || future) &&
    !(sid && story.isError);
  const devices = log.data?.devices_registered;
  const note = cn(s.body, 'rounded-xl border p-3 text-ui-sm');

  return (
    <AdminPage
      title={t('admin.page.notifications')}
      subtitle={L('పాఠకులకు ప్రకటనలు పంపండి', 'Compose and send reader alerts (§13); level-60 approval enforced by the API')}
      actions={
        devices ? (
          <Badge tone="info" icon={Smartphone} lang="en" className="tabular-nums">
            {devices.total} {L('ఫోన్లు', 'phones')}
          </Badge>
        ) : null
      }
    >
      {log.data && !log.data.push_enabled ? (
        <p role="alert" className={cn(note, 'border-partial-border bg-partial-tint text-partial')}>
          {L(
            'పుష్ సెట్టింగ్స్‌లో ఆఫ్ ఉంది: ప్రకటనలు యాప్ ఇన్‌బాక్స్‌కే చేరుతాయి, ఫోన్లకు రావు. షెడ్యూల్ చేసినవి ఆగుతాయి.',
            'Push is switched off in Settings: campaigns reach the in-app inbox only, not phones, and scheduled ones wait.',
          )}
        </p>
      ) : null}
      {devices ? (
        <p role="status" className={cn(note, 'border-rule bg-canvas text-muted')}>
          {devices.total
            ? L(
                `నమోదైన ఫోన్లు: ${devices.total} (Android ${devices.android} · iOS ${devices.ios}) · సైన్ ఇన్ చేయనివి ${devices.anonymous}.`,
                `Registered phones: ${devices.total} (Android ${devices.android} · iOS ${devices.ios}) · ${devices.anonymous} not signed in.`,
              )
            : L(
                'ఇంకా ఏ ఫోన్ నమోదు కాలేదు. పుష్ ఉన్న యాప్ బిల్డ్ ఇన్‌స్టాల్ చేసి తెరిచాక ఇక్కడ కనిపిస్తుంది (docs/DEPLOYMENT.md).',
                'No phone has registered yet. One appears here once a push-enabled app build is installed and opened (docs/DEPLOYMENT.md).',
              )}
        </p>
      ) : null}

      <section>
        <SectionHeader title={L('కొత్త నోటిఫికేషన్', 'Compose')} tone="ink" />
        {/* No submit-on-Enter: the only way to send is the button, then the confirm. */}
        <Card>
          <div className="space-y-4">
            <Field
              label={L('శీర్షిక', 'Title (Telugu)')}
              required
              hint={L(
                `${title.length}/${TITLE_MAX} · లాక్ స్క్రీన్‌పై దాదాపు 50 అక్షరాలే కనిపిస్తాయి`,
                `${title.length}/${TITLE_MAX} · about 50 characters show on a lock screen`,
              )}
            >
              <Input
                script="te"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX}
                placeholder="ముఖ్యమైన ప్రకటన…"
              />
            </Field>
            <Field
              label={L('వివరము', 'Body')}
              optionalLabel
              hint={L('మొదటి ~100 అక్షరాలే మడవకుండా కనిపిస్తాయి.', 'Only the first ~100 characters show before it folds.')}
            >
              <Textarea script="te" value={body} onChange={(e) => setBody(e.target.value)} rows={2} counter={BODY_MAX} autoGrow />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={L('శ్రోతలు', 'Audience')}>
                <Select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value as Target);
                    setSlug('');
                  }}
                >
                  <option value="all">{targetLabel.all}</option>
                  <option value="district">{L('జిల్లా (ఎంచుకున్న/ఫాలో చేసే పాఠకులు)', 'District (readers who chose or follow it)')}</option>
                  <option value="category">{targetLabel.category}</option>
                  <option value="tag">{targetLabel.tag}</option>
                </Select>
              </Field>
              {target !== 'all' ? (
                <Field label={targetLabel[target]} required>
                  <Select value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!choices}>
                    <option value="">{L('ఎంచుకోండి…', 'Choose…')}</option>
                    {choices?.map((o) => (
                      <option key={o.slug} value={o.slug}>
                        {L(o.name_te, o.name_en)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field
                label={L('కథనం (షార్ట్ ఐడీ)', 'Story (short id)')}
                optionalLabel
                error={
                  sid && story.isError
                    ? L('ఈ ఐడీతో ప్రచురించిన కథనం లేదు.', 'No published story has this id.')
                    : null
                }
                hint={
                  story.data ? (
                    <span lang="te" className="te">
                      → {story.data.title_te}
                    </span>
                  ) : sid && story.isFetching ? (
                    L('వెతుకుతున్నాం…', 'Looking it up…')
                  ) : (
                    L('ఇచ్చినట్టయితే నోటిఫికేషన్ ఆ కథనాన్ని తెరుస్తుంది.', 'Given one, the notification opens that story.')
                  )
                }
              >
                <Input script="en" value={shortId} onChange={(e) => setShortId(e.target.value)} placeholder="bd3Mn1" />
              </Field>
              <fieldset className="space-y-1">
                <legend className={cn(s.body, 'text-ui-sm font-semibold text-ink')}>{L('ఎప్పుడు', 'When')}</legend>
                <Radio name="push-when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} label={L('ఇప్పుడే పంపండి', 'Send now')} />
                <Radio
                  name="push-when"
                  value="later"
                  checked={when === 'later'}
                  onChange={() => setWhen('later')}
                  label={L('తర్వాత, ఈ సమయానికి', 'Schedule for later')}
                />
                {when === 'later' ? (
                  <Field
                    label={L('పంపే సమయం', 'Send at')}
                    required
                    hint={sendAt ? ist(new Date(sendAt).toISOString()) : L('భారత కాలమానం (IST)', 'India time (IST)')}
                    error={sendAt && !future ? L('భవిష్యత్ సమయం ఇవ్వండి.', 'Pick a time in the future.') : null}
                  >
                    <Input
                      script="en"
                      type="datetime-local"
                      value={sendAt}
                      min={localInputValue(new Date())}
                      onChange={(e) => setSendAt(e.target.value)}
                    />
                  </Field>
                ) : null}
              </fieldset>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              icon={when === 'later' ? CalendarClock : Send}
              disabled={!ready}
              pending={send.isPending}
              onClick={() => setConfirming(true)}
            >
              {when === 'later' ? L('షెడ్యూల్ చేయండి', 'Schedule') : L('పంపండి', 'Send now')}
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title={L('ప్రకటనల లాగ్', 'Campaign log')} tone="ink" />
        <Tabs
          ariaLabel={L('ప్రకటనల లాగ్', 'Campaign log')}
          className="mb-4"
          value={source}
          onChange={(key) => {
            setSource(key as Source);
            setPage(0);
          }}
          items={[
            { key: 'manual', label: L('ఎడిటర్ పంపినవి', 'Editor campaigns') },
            { key: 'auto', label: L('ఆటో (ప్రచురణ)', 'Auto (on publish)') },
            { key: 'all', label: t('ui.showAll') },
          ]}
        />
        <div role="tabpanel" aria-label={L('ప్రకటనల లాగ్', 'Campaign log')} className="space-y-4">
        {log.isError ? (
          <ErrorState error={log.error} onRetry={() => void log.refetch()} compact />
        ) : (
          <DataTable
            rows={log.data?.items ?? []}
            rowKey={(c) => c.id}
            loading={log.isLoading}
            caption={t('admin.page.notifications')}
            empty={<EmptyState icon={Bell} title={t('state.emptyTitle')} compact />}
            rowActions={(c) =>
              c.status === 'scheduled' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  pending={cancel.isPending && cancel.variables === c.id}
                  onClick={async () => {
                    const ok = await confirm({
                      title: L('ఈ షెడ్యూల్‌ను రద్దు చేయాలా?', 'Cancel this scheduled push?'),
                      body: c.title_te,
                      confirmLabel: L('రద్దు చేయండి', 'Cancel push'),
                      tone: 'danger',
                    });
                    if (ok) cancel.mutate(c.id);
                  }}
                >
                  {L('రద్దు', 'Cancel')}
                </Button>
              ) : null
            }
            columns={[
              {
                key: 'title',
                header: L('శీర్షిక', 'Title'),
                lang: 'te',
                render: (c) => <span className="font-semibold">{c.title_te}</span>,
              },
              {
                key: 'audience',
                header: L('శ్రోతలు', 'Audience'),
                nowrap: true,
                render: (c) =>
                  c.audience.startsWith('auto:') ? (
                    <Badge tone="brand" size="xs" lang="en">
                      {L('ఆటో', 'Auto')} · {c.audience.slice(5)}
                    </Badge>
                  ) : (
                    <Badge size="xs" lang="en" className="font-mono">
                      {c.audience}
                    </Badge>
                  ),
              },
              {
                key: 'status',
                header: L('స్థితి', 'Status'),
                nowrap: true,
                render: (c) => (
                  <Badge tone={STATUS_TONE[c.status] ?? 'muted'} size="xs" lang="en">
                    {c.status}
                  </Badge>
                ),
              },
              {
                key: 'inbox',
                header: L('ఇన్‌బాక్స్', 'Inbox'),
                align: 'right',
                nowrap: true,
                hideBelow: 'lg',
                render: (c) => <span className="tabular-nums">{c.sent_count}</span>,
              },
              {
                key: 'devices',
                header: L('ఫోన్లు', 'Phones'),
                align: 'right',
                nowrap: true,
                render: (c) => <span className="tabular-nums">{c.devices}</span>,
              },
              {
                key: 'ok',
                header: L('చేరినవి', 'Delivered'),
                align: 'right',
                nowrap: true,
                render: (c) => <span className="tabular-nums text-success">{c.push_ok}</span>,
              },
              {
                key: 'failed',
                header: L('విఫలం', 'Failed'),
                align: 'right',
                nowrap: true,
                hideBelow: 'md',
                render: (c) => <span className={cn('tabular-nums', c.push_failed ? 'text-breaking' : 'text-muted')}>{c.push_failed}</span>,
              },
              {
                key: 'opened',
                header: L('తెరిచినవి', 'Opened'),
                align: 'right',
                nowrap: true,
                hideBelow: 'md',
                render: (c) => <span className="tabular-nums">{c.opened}</span>,
              },
              {
                key: 'when',
                header: L('సమయం', 'When'),
                lang: 'en',
                nowrap: true,
                hideBelow: 'md',
                render: (c) => (
                  <span className="text-muted">
                    {c.status === 'scheduled' && c.send_at ? ist(c.send_at) : dateTime(c.sent_at ?? c.created_at)}
                  </span>
                ),
              },
            ]}
          />
        )}
        {page > 0 || log.data?.next_offset != null ? (
          <nav aria-label={L('పేజీ నావిగేషన్', 'Pagination')} className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              {t('ui.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconRight={ChevronRight}
              disabled={log.data?.next_offset == null}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('ui.next')}
            </Button>
          </nav>
        ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={
          when === 'later'
            ? L('పుష్ నోటిఫికేషన్ షెడ్యూల్ చేయాలా?', 'Schedule this push notification?')
            : L('పుష్ నోటిఫికేషన్ పంపాలా?', 'Send this push notification?')
        }
        body={
          <>
            <strong>{audienceLabel}</strong>
            {when === 'later' && sendAt ? ` · ${ist(new Date(sendAt).toISOString())}` : ''} —{' '}
            <span lang="te" className="te">
              {title}
            </span>
          </>
        }
        confirmLabel={when === 'later' ? L('షెడ్యూల్ చేయండి', 'Schedule') : L('పంపండి', 'Send now')}
        tone="primary"
        pending={send.isPending}
        onConfirm={() => {
          // The chosen time can pass while this dialog sits open; the server
          // refuses one well past, but a scheduled push must never go out now.
          if (when === 'later' && new Date(sendAt).getTime() <= Date.now()) {
            setConfirming(false);
            toast.error(L('భవిష్యత్ సమయం ఇవ్వండి.', 'Pick a time in the future.'));
            return;
          }
          send.mutate();
        }}
      />
      {dialog}
    </AdminPage>
  );
}
