import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCcw, Save } from 'lucide-react';

import { ApiError } from '@/api/client';
import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { SettingsPayload } from '@/types/cms';
import { cn } from '@/utils/cn';

import { BEATS } from './labels';

/**
 * Every crawl.* setting in one place: when it runs, how much, for which
 * districts, and the guards in front of the AI.
 *
 * It shares `['cms','settings']` with the Settings page, and saves only the
 * keys changed *here*: a value is read from the server until it is touched, so
 * a stale copy of this tab can never write back a setting someone else moved.
 */

type Values = Record<string, unknown>;

/** Fallback when the server predates `choices` on the cadence settings. */
const CADENCES = [5, 10, 15, 20, 30, 60, 120];
const STATES = [
  { code: 'AP', te: 'ఆంధ్రప్రదేశ్', en: 'Andhra Pradesh' },
  { code: 'TS', te: 'తెలంగాణ', en: 'Telangana' },
] as const;

const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export function CrawlSettingsTab() {
  const settings = useQuery({ queryKey: ['cms', 'settings'], queryFn: cmsApi.fetchSettings });
  return (
    <div className="space-y-4">
      <StatusStrip />
      <QueryState query={settings} isEmpty={() => false} skeleton={<Skeleton variant="block" />}>
        {(payload) => <CrawlForm payload={payload} />}
      </QueryState>
    </div>
  );
}

/** Is it running, how much of the budget is gone, and which feeds gave up. */
function StatusStrip() {
  const { language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canRun = useAuth((st) => st.can)('taxonomy.manage');
  const status = useQuery({ queryKey: ['cms', 'crawl-status'], queryFn: cmsApi.fetchCrawlStatus });
  const run = useMutation({
    // Queued on the ingest worker (202): a pass is minutes of model calls.
    mutationFn: () => cmsApi.runCrawl(),
    onSuccess: () => {
      toast.success(L(
        'క్రాల్ క్యూలో చేరింది — కొన్ని నిమిషాల్లో సమీక్ష క్యూలో కనిపిస్తుంది.',
        'Crawl queued — results reach the review queue within a few minutes.',
      ));
      void queryClient.invalidateQueries({ queryKey: ['cms', 'crawl-status'] });
    },
    onError: (e) => toast.error(e),
  });

  const d = status.data;
  if (!d) return null;
  const stat = (label: string, value: ReactNode) => (
    <div>
      <p className={cn(s.body, 'text-meta text-muted')}>{label}</p>
      <p className="font-sans text-ui font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
  return (
    <Card padding="sm" tone="paper" role="status">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {stat(
          L('స్థితి', 'State'),
          !d.enabled ? (
            <Badge tone="muted">{L('ఆఫ్', 'Off')}</Badge>
          ) : d.active_now ? (
            <Badge tone="success">{L('నడుస్తోంది', 'Running')}</Badge>
          ) : (
            <Badge tone="partial">{L('క్రాల్ వేళలు కావు', 'Outside crawl hours')}</Badge>
          ),
        )}
        {stat(L('ఈ గంట', 'This hour'), `${d.used_this_hour} / ${d.hourly_cap}`)}
        {stat(L('ఈ రోజు', 'Today'), `${d.used_today} / ${d.daily_cap || L('పరిమితి లేదు', 'no limit')}`)}
        {stat(
          L('ఆగిపోయిన మూలాలు', 'Stopped sources'),
          <span className={cn(d.failing_sources > 0 && 'text-breaking')}>{d.failing_sources}</span>,
        )}
        {canRun ? (
          <Button
            variant="secondary"
            icon={Play}
            className="ml-auto"
            pending={run.isPending}
            disabled={!d.enabled}
            title={d.enabled ? undefined : L('ముందు క్రాల్ ఆన్ చేయండి', 'Turn the crawl on first')}
            onClick={() => run.mutate()}
          >
            {L('ఇప్పుడే క్రాల్ చేయండి', 'Run crawl now')}
          </Button>
        ) : null}
      </div>
      {d.failing_sources > 0 ? (
        <p className={cn(s.body, 'mt-2 text-meta text-muted')}>
          {L(
            `${d.failure_limit} సార్లు వరుసగా విఫలమైన మూలాలను క్రాల్ తనిఖీ చేయదు. మూలాలు ట్యాబ్‌లో "ఇప్పుడే తెండి" నొక్కితే మళ్లీ మొదలవుతుంది.`,
            `Sources that failed ${d.failure_limit} times in a row are no longer polled. Press "Fetch now" on one in the Sources tab to start it again.`,
          )}
        </p>
      ) : null}
    </Card>
  );
}

function CrawlForm({ payload }: { payload: SettingsPayload }) {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useAuth((st) => st.can)('settings.manage');
  const options = useQuery({ queryKey: ['cms', 'editor-options'], queryFn: cmsApi.fetchEditorOptions });

  // Only what the admin touched; everything else is read live from the server.
  const [edits, setEdits] = useState<Values>({});
  const value = (key: string) => (key in edits ? edits[key] : payload.values[key]);
  const set = (key: string, next: unknown) => setEdits((e) => ({ ...e, [key]: next }));
  const bool = (key: string) => Boolean(value(key));
  const num = (key: string) => Number(value(key) ?? 0);
  const spec = (key: string) => payload.specs.find((sp) => sp.key === key);
  const changed = Object.fromEntries(
    Object.entries(edits).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(payload.values[k])),
  );
  const dirty = Object.keys(changed).length > 0;

  const save = useMutation({
    mutationFn: () => cmsApi.patchSettings(changed),
    onSuccess: () => {
      setEdits({});
      void queryClient.invalidateQueries({ queryKey: ['cms', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['cms', 'crawl-status'] });
      toast.success(L('క్రాల్ సెట్టింగ్స్ సేవ్ అయ్యాయి.', 'Crawl settings saved.'));
    },
    onError: (e) => toast.error(e),
  });
  const details = save.error instanceof ApiError ? (save.error.details as Record<string, string>) : undefined;
  const errors = details && Object.keys(details).length ? details : undefined;

  const numberField = (key: string, label: string, hint: string, max?: number) => (
    <Field key={key} label={label} hint={hint} error={errors?.[key]}>
      <Input script="en" type="number" inputMode="numeric" disabled={!canManage}
        min={spec(key)?.min ?? 0} max={spec(key)?.max ?? max}
        value={num(key)}
        onChange={(e) => set(key, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
    </Field>
  );
  const toggle = (key: string, label: string, hint: string, disabled = false) => (
    <Switch checked={bool(key)} onChange={(v) => set(key, v)} disabled={!canManage || disabled} label={label} hint={hint} />
  );

  // --- when -----------------------------------------------------------------
  const fromHour = num('crawl.active_from_hour') % 24;
  const toRaw = num('crawl.active_to_hour') || 24;
  const allDay = fromHour === toRaw % 24;
  const hours = allDay ? 24 : (toRaw - fromHour + 24) % 24;
  const wraps = !allDay && toRaw % 24 < fromHour && toRaw !== 24;
  const cadences = (spec('crawl.fetch_every_minutes')?.choices as number[] | null | undefined) ?? CADENCES;
  const cadenceLabel = (m: number) =>
    m < 60 ? L(`ప్రతి ${m} నిమిషాలకు`, `Every ${m} minutes`)
      : m === 60 ? L('ప్రతి గంటకు', 'Every hour')
        : L(`ప్రతి ${m / 60} గంటలకు`, `Every ${m / 60} hours`);

  // --- how many -------------------------------------------------------------
  const beatQuota = (value('crawl.beat_quota') as Record<string, number> | undefined) ?? {};
  const quotaTotal = Object.values(beatQuota).reduce((sum, n) => sum + Number(n || 0), 0);

  // --- where ----------------------------------------------------------------
  const districts = options.data?.districts ?? [];
  const chosen = new Set((value('crawl.districts') as number[] | undefined) ?? []);
  const setDistricts = (ids: Iterable<number>) => set('crawl.districts', [...new Set(ids)].sort((a, b) => a - b));
  const stateIds = (code: string) => districts.filter((d) => d.state === code).map((d) => d.id);

  const terms = (value('crawl.sensitive_extra_terms') as string[] | undefined) ?? [];
  const note = cn(s.body, 'rounded-xl border border-rule bg-canvas p-3 text-meta text-muted');

  return (
    <div className="space-y-7 md:space-y-10">
      {!canManage ? (
        <p className={note}>
          {L(
            'మీరు ఈ సెట్టింగ్స్ చూడగలరు; మార్చడానికి "సెట్టింగ్‌లు మార్చడం" అనుమతి కావాలి.',
            'You can see these settings; changing them needs the “Change settings” permission.',
          )}
        </p>
      ) : null}

      {/* ------------------------------------------------------ switches -- */}
      <Section
        title={L('స్విచ్‌లు', 'Switches')}
        subtitle={L(
          'క్రాల్ తెచ్చినవి సమీక్ష క్యూలోకే వెళ్తాయి — ఇక్కడ ఏదీ ప్రచురించదు.',
          'Everything the crawl brings in lands in the review queue — nothing here publishes.',
        )}
      >
        {toggle('crawl.enabled', L('క్రాల్ నడపండి', 'Run the crawl'),
          L('ఆఫ్ అయితే షెడ్యూల్‌లో ఏ మూలాన్నీ తనిఖీ చేయదు, ఏ ప్రొవైడర్‌నూ పిలవదు.', 'Off means no source is polled on a schedule and no provider is called.'))}
        {toggle('crawl.rewrite_enabled', L('తెచ్చిన వార్తలను తెలుగులో తిరగరాయండి', 'Rewrite crawled stories in Telugu'),
          payload.values['ai.enabled']
            ? L('ఆఫ్ అయితే క్యూలో శీర్షికలు, లింక్‌లు మాత్రమే చేరతాయి.', 'Off means the queue gets headlines and links only.')
            : L('ముందు సెట్టింగ్స్‌లో AI ఆన్ చేయాలి.', 'Switch AI on in Settings first.'),
          !bool('crawl.enabled') || !payload.values['ai.enabled'])}
        {toggle('crawl.breaking_all_day', L('బ్రేకింగ్ వార్తలు రోజంతా', 'Breaking news round the clock'),
          L('క్రాల్ వేళల బయట కూడా బ్రేకింగ్ బీట్‌ను ప్రతి 5 నిమిషాలకు చూస్తుంది.', 'Checks the breaking beat every 5 minutes even outside the crawl hours below.'))}
        {toggle('crawl.html_fallback_enabled', L('చిన్న ఫీడ్‌లకు వ్యాసం పేజీ తేండి', 'Fetch article pages for stub feeds'),
          L('ప్రతి మూలం కూడా అనుమతించాలి, కారణం రాసి ఉండాలి.', 'Each source must also allow it and carry a written note.'))}
        {toggle('crawl.keep_source_for_review', L('సమీక్షకు అసలు పాఠ్యం ఉంచండి', 'Keep the original for the reviewer'),
          L('పునర్లేఖనం పక్కనే అసలు కనిపిస్తుంది; దిగుమతి లేదా తిరస్కరణ తర్వాత తొలగిస్తాం.', 'Shown beside the rewrite; dropped once the item is imported or rejected.'))}
        {toggle('crawl.open_licence_images', L('చిత్రం లేని వార్తకు ఉచిత ఫోటో వెతకండి', 'Find a no-credit photo when a story has none'),
          L('వికీమీడియా కామన్స్ CC0/PDM మాత్రమే. దొరకకపోవడం సాధారణమే.', 'Wikimedia Commons CC0/PDM only. Finding none is normal.'))}
        {toggle('crawl.image_scan', L('వాడే ముందు ప్రతి ఫోటోను AI చూడాలి', 'Have the AI check each crawled photo first'),
          L(
            'వాటర్‌మార్క్, ఛానల్ లోగో, ముద్రించిన శీర్షిక ఉన్నవి, ప్రచురించదగనివి తిరస్కరిస్తాం — ఎప్పుడూ వాడం, ఎప్పుడూ శుభ్రం చేయం. ఒక్కో ఫోటోకు చిన్న AI ఖర్చు. ఆఫ్ అయితే మొదట దిగిన ఫోటోనే వాడతాం.',
            'Rejects any photo the publisher branded — a watermark, a channel logo, a headline burned in — and anything unfit to print. Rejected photos are never used and never cleaned. A small AI call per photo; off means the first photo that downloads is used.',
          ))}
        {toggle('crawl.ai_illustrations', L('ఫోటో దొరకకపోతే AI ప్రతీకాత్మక చిత్రం రూపొందించండి', 'Make a realistic AI picture when no photo is found'),
          payload.values['ai.image_enabled']
            ? L(
              'ఉపయోగపడే ఫోటో, ఉచిత ఫోటో రెండూ లేనప్పుడే. వాస్తవంగా కనిపించే ప్రతీకాత్మక చిత్రం, సైట్‌లో "ప్రతీకాత్మక చిత్రం — AI రూపొందించినది" అని చూపిస్తాం — ఘటన, బాధితులు, నిజమైన వ్యక్తులు ఎప్పుడూ ఉండరు. నేరాలు, మరణాలు, ప్రమాదాలకు సాధారణ దృశ్యం మాత్రమే (అంబులెన్స్, పోలీస్ బారికేడ్, ఆసుపత్రి గేటు); సున్నితమైన వార్తలకు అసలు ఉండదు. ఆఫ్ అయితే డెస్క్ ఫోటో జోడించే వరకు వార్త ఆగుతుంది.',
              'Only when there is no usable photo and no free-licence one. A realistic, representative picture labelled as AI on the site — never the event, a victim or a real person. Crime, death and accident stories get only a generic scene (an ambulance, a police cordon, a hospital gate); sensitive stories get none. Off means the story waits for the desk to add a photo.',
            )
            : L('ముందు సెట్టింగ్స్‌లో AI చిత్రాలు ఆన్ చేయాలి.', 'Switch AI images on in Settings first.'),
          !payload.values['ai.image_enabled'])}
        {toggle('crawl.auto_import', L('తిరగరాసిన వార్తలను నేరుగా సమీక్ష క్యూకు పంపండి', 'Send finished rewrites straight to the review queue'),
          L(
            'AI ముందే విభాగం, ప్రదేశం, ట్యాగ్‌లు, తనిఖీ చేసిన ఫోటో పెడుతుంది. ఎడిటర్ ఆమోదించాలి, మరొకరు ప్రచురించాలి. కీ లేని సారాంశాలు, వేరే లిపి అక్షరాలున్న పాఠ్యం ఎప్పుడూ వెళ్లవు. ఆఫ్ అయితే క్రాల్ క్యూ నుంచి ఒక్కొక్కటిగా పంపాలి.',
            'Already filed by the AI — section, place, tags and a checked photo. An editor still approves and a second person still publishes. Keyless excerpts and copy with stray foreign letters are never sent. Off means an editor sends each one from the crawl queue by hand.',
          ))}
        {toggle('crawl.mandal_autotag', L('వార్త నుంచి మండలాన్ని ఊహించండి', 'Guess the mandal from the story text'),
          L('ఎప్పుడూ ఊహే — ఎడిటర్ మార్చవచ్చు.', 'Always a guess — the editor can change it.'))}
      </Section>

      {/* ---------------------------------------------------------- when -- */}
      <Section
        title={L('ఎప్పుడు', 'When')}
        subtitle={L('భారత కాలమానం (IST) ప్రకారం.', 'All times are India time (IST).')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={L('మొదలయ్యే గంట', 'Starts at')} error={errors?.['crawl.active_from_hour']}>
            <Select value={fromHour} disabled={!canManage} onChange={(e) => set('crawl.active_from_hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
            </Select>
          </Field>
          <Field label={L('ఆగే గంట', 'Stops at')} error={errors?.['crawl.active_to_hour']}>
            <Select value={toRaw} disabled={!canManage} onChange={(e) => set('crawl.active_to_hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </Select>
          </Field>
        </div>
        <p className={note}>
          {allDay
            ? L('రోజంతా — 24 గంటలూ నడుస్తుంది.', 'Round the clock — the crawl runs all 24 hours.')
            : L(
                `${hh(fromHour)} నుంచి ${hh(toRaw)} వరకు${wraps ? ' (అర్ధరాత్రి దాటి)' : ''} — రోజుకు ${hours} గంటలు.`,
                `From ${hh(fromHour)} to ${hh(toRaw)}${wraps ? ' (past midnight)' : ''} — ${hours} hours a day.`,
              )}{' '}
          {allDay ? null : bool('crawl.breaking_all_day')
            ? L('బ్రేకింగ్ బీట్ మిగతా వేళల్లోనూ నడుస్తుంది.', 'The breaking beat still runs outside these hours.')
            : L('ఈ వేళల బయట బ్రేకింగ్ కూడా ఆగుతుంది.', 'Breaking stops outside these hours too.')}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['crawl.fetch_every_minutes', 'crawl.rewrite_every_minutes'] as const).map((key) => (
            <Field
              key={key}
              label={key === 'crawl.fetch_every_minutes' ? L('ఫీడ్‌లు తనిఖీ', 'Check feeds') : L('పునర్లేఖనం', 'Rewrite')}
              hint={key === 'crawl.fetch_every_minutes'
                ? L('ప్రతి మూలం తన సొంత విరామం దాటాకే మళ్లీ తనిఖీ అవుతుంది.', 'A source is still only polled once its own interval has passed.')
                : L('గంట, రోజు పరిమితులు అలాగే వర్తిస్తాయి.', 'The hourly and daily limits still apply.')}
              error={errors?.[key]}
            >
              <Select value={num(key)} disabled={!canManage} onChange={(e) => set(key, Number(e.target.value))}>
                {cadences.map((m) => <option key={m} value={m}>{cadenceLabel(m)}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------ how many -- */}
      <Section
        title={L('ఎన్ని', 'How many')}
        subtitle={L('పునర్లేఖనాలు, ఫోటో తనిఖీలు, AI చిత్రాలే ఖర్చు — ఫీడ్ తనిఖీకి ఖర్చు లేదు.', 'Rewrites, photo checks and AI pictures cost money; checking a feed costs nothing.')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('crawl.hourly_item_cap', L('గంటకు పునర్లేఖనాలు', 'Rewrites per hour'),
            L('అన్ని బీట్లు కలిపి. ఇదే ఖర్చు పరిమితి.', 'All beats together. This is the spend ceiling.'), 500)}
          {numberField('crawl.daily_item_cap', L('రోజుకు పునర్లేఖనాలు', 'Rewrites per day'),
            L('0 అంటే రోజువారీ పరిమితి లేదు.', '0 means no daily limit, only the hourly one.'))}
          {numberField('crawl.per_source_default_cap', L('ఒక మూలానికి గంటకు', 'Per source, per hour'),
            L('సొంత పరిమితి లేని మూలాలకు. ఒకే ఫీడ్ కోటా మొత్తం తినకుండా.', 'For sources without their own limit, so one busy feed cannot take a whole beat.'), 500)}
          {numberField('crawl.breaking_hourly_cap', L('బ్రేకింగ్ గంటకు', 'Breaking per hour'),
            L('బ్రేకింగ్ బీట్ కోటా కూడా వర్తిస్తుంది.', 'The breaking beat quota below applies as well.'), 500)}
          {numberField('crawl.max_entries_per_fetch', L('ఒక్క తనిఖీలో ఎన్ని ఎంట్రీలు', 'Entries read per feed check'),
            L('ఫీడ్‌లో ఎన్ని ఉన్నా ఇన్నే చదువుతాం.', 'However long the feed, only this many are read.'))}
          {numberField('crawl.max_consecutive_failures', L('ఎన్ని వైఫల్యాల తర్వాత ఆపాలి', 'Stop a source after failures'),
            L('వరుసగా ఇన్ని సార్లు విఫలమైతే ఆ మూలాన్ని వదిలేస్తాం.', 'Failed this many times in a row, a source is left alone until fetched by hand.'))}
          {numberField('crawl.max_age_hours', L('ఎంత పాత వార్తలు వదిలేయాలి (గంటలు)', 'Ignore stories older than (hours)'),
            L('ప్రచురణకర్త తేదీ ప్రకారం.', 'By the publisher’s own date.'))}
          {numberField('crawl.rewrite_min_words', L('కనీస పదాలు', 'Minimum words to rewrite'),
            L('ఇంతకంటే తక్కువ పాఠ్యం ఉంటే AI కి పంపం — అది కల్పిస్తుంది.', 'Less source text than this is never sent to the AI — it would invent.'))}
          {numberField('crawl.image_scan_max', L('ఒక వార్తకు AI చూసే ఫోటోలు', 'Photos checked per story'),
            L('ఇన్ని చూశాక ప్రచురణకర్త ఫోటోలను వదిలేస్తాం.', 'After this many, the publisher’s photos are given up on.'), 4)}
          {numberField('crawl.ai_illustration_daily_cap', L('రోజుకు AI చిత్రాలు', 'AI pictures per day'),
            L('ఒక్కొక్కటి చెల్లించే చిత్రం — కామన్స్ ఖాళీగా ఉన్న రోజు నెల బడ్జెట్ ఖర్చవకుండా.', 'Each is a paid image; the cap keeps a quiet Commons day from spending the month.'), 500)}
        </div>
        <fieldset className="rounded-xl border border-rule p-3">
          <legend className={cn(s.body, 'px-1 text-ui-sm font-semibold text-ink')}>
            {L('బీట్ వారీగా గంటకు', 'Per hour, by beat')}
          </legend>
          <p className={cn(s.body, 'mb-3 text-meta text-muted')}>
            {L(
              `మొత్తం ${quotaTotal}; గంట పరిమితి ${num('crawl.hourly_item_cap')} అలాగే వర్తిస్తుంది. 0 ఉన్న బీట్ ఎప్పుడూ తిరగరాయబడదు.`,
              `Adds up to ${quotaTotal}; the hourly limit of ${num('crawl.hourly_item_cap')} still applies. A beat at 0 is never rewritten.`,
            )}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BEATS.map((beat) => (
              <Field key={beat.value} label={L(beat.te, beat.en)}>
                <Input script="en" type="number" min={0} max={500} disabled={!canManage}
                  value={Number(beatQuota[beat.value] ?? 0)}
                  onChange={(e) => set('crawl.beat_quota', { ...beatQuota, [beat.value]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
              </Field>
            ))}
          </div>
        </fieldset>
      </Section>

      {/* ------------------------------------------------- where / cities -- */}
      <Section
        title={L('ఎక్కడ — జిల్లాలు', 'Where — districts')}
        subtitle={L(
          'ఏమీ ఎంచుకోకపోతే అన్ని జిల్లాలు. జిల్లా లేని వార్తలు (జాతీయ, రాష్ట్ర) ఎప్పుడూ ఉంటాయి; వేరే జిల్లాకు కట్టిన మూలాలను తనిఖీ చేయం.',
          'Nothing ticked means every district. Stories with no district (national, state-wide) are always kept; sources pinned to other districts are not fetched.',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {STATES.map((st) => (
            <Button key={st.code} variant="secondary" size="sm" disabled={!canManage}
              onClick={() => setDistricts([...chosen, ...stateIds(st.code)])}>
              {L(`మొత్తం ${st.te}`, `All ${st.en}`)}
            </Button>
          ))}
          <Button variant="ghost" size="sm" disabled={!canManage || chosen.size === 0} onClick={() => setDistricts([])}>
            {L('అన్నీ తీసేయండి', 'Clear')}
          </Button>
          <span className={cn(s.body, 'ml-auto text-meta font-semibold text-ink')}>
            {chosen.size === 0
              ? L('అన్ని జిల్లాలు', 'All districts')
              : L(`${chosen.size} / ${districts.length} జిల్లాలు`, `${chosen.size} of ${districts.length} districts`)}
          </span>
        </div>
        {STATES.map((st) => {
          const rows = districts.filter((d) => d.state === st.code);
          if (!rows.length) return null;
          return (
            <fieldset key={st.code} className="rounded-xl border border-rule p-3">
              <legend className={cn(s.body, 'px-1 text-ui-sm font-semibold text-ink')}>
                {L(st.te, st.en)} ({rows.filter((d) => chosen.has(d.id)).length}/{rows.length})
              </legend>
              <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map((d) => (
                  <Checkbox key={d.id} checked={chosen.has(d.id)} disabled={!canManage}
                    label={L(d.name_te, d.name_en)}
                    onChange={(on) => setDistricts(on ? [...chosen, d.id] : [...chosen].filter((id) => id !== d.id))} />
                ))}
              </div>
            </fieldset>
          );
        })}
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('crawl.mandal_min_name_len', L('మండలం పేరు కనీస పొడవు', 'Shortest mandal name to match'),
            L('చిన్న పేర్లు సాధారణ పదాలుగానూ వస్తాయి — వాటిని పట్టించుకోం.', 'Short names are ordinary words as often as places, so they are ignored.'))}
        </div>
      </Section>

      {/* ---------------------------------------------- quality & safety -- */}
      <Section
        title={L('నాణ్యత & భద్రత', 'Quality & safety')}
        subtitle={L('ఈ తనిఖీలన్నీ AI ని పిలవక ముందే జరుగుతాయి.', 'Every check here runs before the AI is called.')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('crawl.similarity_block_percent', L('పోలిక పరిమితి (%)', 'Similarity block (%)'),
            L('తెలుగు మూలంతో ఇంత శాతం పదాలు ఒకటైతే పునర్లేఖనాన్ని తిరస్కరిస్తాం. 0 అంటే తనిఖీ లేదు.', 'A Telugu rewrite sharing this much wording with its source is refused. 0 turns the check off.'), 100)}
        </div>
        <Field
          label={L('అదనపు సున్నిత పదాలు', 'Extra sensitive words')}
          hint={L(
            `ఒక్కో లైన్‌కు ఒక పదం లేదా పదబంధం (${terms.filter((x) => x.trim()).length}). ఇవి ఉన్న వార్త AI కి వెళ్లదు, ఎడిటర్ చదువుతారు. అంతర్నిర్మిత జాబితాకు జోడిస్తాయి — దాని నుంచి ఏదీ తీసేయవు.`,
            `One word or phrase per line (${terms.filter((x) => x.trim()).length}). A story containing one goes to a person, never the AI. These add to the built-in list — they can never remove from it.`,
          )}
          error={errors?.['crawl.sensitive_extra_terms']}
        >
          <Textarea rows={4} autoGrow disabled={!canManage}
            value={terms.join('\n')}
            onChange={(e) => set('crawl.sensitive_extra_terms', e.target.value.split('\n'))}
            placeholder={L('ఉదా: ఎన్‌కౌంటర్', 'e.g. encounter')} />
        </Field>
      </Section>

      {errors ? (
        <p role="alert" className={cn(s.body, 'rounded-xl border border-rule bg-breaking-tint p-3 text-meta text-breaking')}>
          {Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
      ) : null}

      {canManage ? (
        <div className="sticky bottom-dock z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-surface px-4 py-3 md:-mx-6 md:px-6">
          {dirty ? <Badge tone="partial" className="mr-auto">{t('admin.unsaved')}</Badge> : null}
          <Button variant="secondary" icon={RotateCcw} disabled={!dirty || save.isPending} onClick={() => { setEdits({}); save.reset(); }}>
            {L('రీసెట్', 'Reset')}
          </Button>
          <Button icon={Save} pending={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
            {L('క్రాల్ సెట్టింగ్స్ సేవ్ చేయండి', 'Save crawl settings')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
