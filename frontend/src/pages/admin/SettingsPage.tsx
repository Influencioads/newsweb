import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, Save } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { SettingsPayload } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §18 / §20 / §35 — the settings that an editor changes during a news day.
 *
 * Two halves, deliberately separated:
 *   * **Values** are editable and live in `app_settings`.
 *   * **Environment** is deployment config — read-only here, because changing
 *     an API key from a web form is how credentials leak.
 *
 * AI and voice both ship off. Turning them on is an explicit act recorded in
 * the audit log, which is exactly what §18 and §20 ask for.
 */

type Values = Record<string, unknown>;

const RATIO_KEYS = ['personal', 'local', 'trending', 'breaking'] as const;

/** Mirrors the closed key set of `crawl.beat_quota`; the server rejects any other shape. */
const BEAT_KEYS = [
  { key: 'national', te: 'జాతీయం', en: 'National' },
  { key: 'state', te: 'రాష్ట్రం', en: 'State' },
  { key: 'district_local', te: 'జిల్లా / స్థానికం', en: 'District / local' },
  { key: 'breaking', te: 'బ్రేకింగ్', en: 'Breaking' },
  { key: 'sports', te: 'క్రీడలు', en: 'Sports' },
  { key: 'film', te: 'సినిమా', en: 'Film' },
  { key: 'govt_jobs', te: 'ఉద్యోగాలు', en: 'Government jobs' },
  { key: 'general', te: 'సాధారణం', en: 'General' },
] as const;

function SettingsSkeleton() {
  return (
    <div className="space-y-7 md:space-y-10">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <Skeleton variant="headline" />
          <Skeleton variant="block" className="mt-4" />
        </Card>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { t, language } = useI18n();
  const s = useScript();
  const en = language === 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['cms', 'settings'], queryFn: cmsApi.fetchSettings });
  const data = settings.data;

  const [draft, setDraft] = useState<Values>({});
  useEffect(() => {
    if (data) setDraft(data.values);
  }, [data]);
  const dirty = data != null && JSON.stringify(draft) !== JSON.stringify(data.values);

  const save = useMutation({
    mutationFn: (values: Values) => cmsApi.patchSettings(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cms', 'settings'] });
      toast.success(en ? 'Settings saved.' : 'సెట్టింగ్‌లు సేవ్ అయ్యాయి.');
    },
    onError: (e) => toast.error(e),
  });
  const details = save.error instanceof ApiError ? (save.error.details as Record<string, string>) : undefined;
  const errors = details && Object.keys(details).length ? details : undefined;

  const bool = (key: string) => Boolean(draft[key]);
  const num = (key: string) => Number(draft[key] ?? 0);
  const str = (key: string) => String(draft[key] ?? '');
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));
  const keyState = (configured: unknown) =>
    configured ? (en ? 'configured' : 'కీ ఉంది') : (en ? 'key missing' : 'కీ లేదు');
  const note = cn(s.body, 'rounded-xl border border-rule bg-canvas p-3 text-meta text-muted');

  const ratios = (draft['feed.ratios'] as Record<string, number> | undefined) ?? {
    personal: 40, local: 25, trending: 25, breaking: 10,
  };
  const ratioTotal = RATIO_KEYS.reduce((sum, k) => sum + (ratios[k] ?? 0), 0);
  const beatQuota = (draft['crawl.beat_quota'] as Record<string, number> | undefined) ?? {};

  const renderForm = (payload: SettingsPayload) => {
    const env = payload.environment;
    const usage = payload.voice_usage;
    const aiBlocked = !env.ai_available;
    const voiceProviderReady =
      str('voice.provider') === 'local' ||
      (str('voice.provider') === 'google' && env.tts_google_configured) ||
      (str('voice.provider') === 'bhashini' && env.tts_bhashini_configured);

    return (
      <>
        {/* ------------------------------------------------------ §18 AI -- */}
        <Section
          title={en ? 'AI assistance (§15–18)' : 'AI సహాయం (§15–18)'}
          subtitle={en
            ? 'AI never publishes. Drafts enter the review queue like any other copy.'
            : 'AI స్వయంగా ప్రచురించదు. డ్రాఫ్ట్‌లు సాధారణ కథనాల్లాగే సమీక్ష క్యూలోకి వెళ్తాయి.'}
        >
          {aiBlocked ? (
            <p className={note}>
              {en
                ? 'AI_ENABLED is off in the environment, so this switch has no effect until a deployment turns it on.'
                : 'పర్యావరణంలో AI_ENABLED ఆఫ్‌లో ఉంది — డిప్లాయ్‌మెంట్‌లో ఆన్ చేసేవరకు ఈ స్విచ్ పనిచేయదు.'}
            </p>
          ) : null}
          <Switch checked={bool('ai.enabled')} onChange={(v) => set('ai.enabled', v)}
            label={en ? 'Enable AI features' : 'AI ఫీచర్లు ఆన్ చేయండి'}
            hint={en ? 'Master switch. Off means no provider is ever called.' : 'ప్రధాన స్విచ్. ఆఫ్ అయితే ఏ ప్రొవైడర్‌నూ పిలవదు.'} />
          <Switch checked={bool('ai.auto_suggest')} onChange={(v) => set('ai.auto_suggest', v)}
            disabled={!bool('ai.enabled')}
            label={en ? 'Daily topic discovery' : 'రోజువారీ అంశ సూచనలు'}
            hint={en ? 'Suggestions still need an editor to accept them.' : 'సూచనలను ఎడిటర్ ఆమోదించాల్సిందే.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={en ? 'Provider' : 'ప్రొవైడర్'}>
              <Select value={str('ai.provider')} onChange={(e) => set('ai.provider', e.target.value)}>
                <option value="heuristic">heuristic — {en ? 'no key needed' : 'కీ అవసరం లేదు'}</option>
                <option value="gemini">gemini</option>
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
              </Select>
            </Field>
            <Field label={en ? 'Suggestions per day' : 'రోజుకు సూచనలు'}>
              <Input script="en" type="number" min={1} max={50}
                value={num('ai.daily_suggestion_limit')}
                onChange={(e) => set('ai.daily_suggestion_limit', Number(e.target.value))} />
            </Field>
          </div>
        </Section>

        {/* ------------------------------------------------ hourly crawl -- */}
        <Section
          title={en ? 'Hourly crawl' : 'గంటవారీ క్రాల్'}
          subtitle={en
            ? 'How many stories are pulled and rewritten each hour, and from which beats. Rewrites still land in the review queue — nothing here publishes.'
            : 'ప్రతి గంటకు ఎన్ని వార్తలు తేవాలి, ఏ బీట్ల నుంచి. పునర్లేఖనాలు సమీక్ష క్యూలోకే వెళ్తాయి — ఇక్కడ ఏదీ ప్రచురించదు.'}
        >
          <Switch checked={bool('crawl.enabled')} onChange={(v) => set('crawl.enabled', v)}
            label={en ? 'Run the hourly crawl' : 'గంటవారీ క్రాల్ నడపండి'}
            hint={en
              ? 'Off means no source is polled on a schedule and no provider is called.'
              : 'ఆఫ్ అయితే షెడ్యూల్‌లో ఏ మూలాన్నీ తనిఖీ చేయదు, ఏ ప్రొవైడర్‌నూ పిలవదు.'} />
          <Switch checked={bool('crawl.rewrite_enabled')} onChange={(v) => set('crawl.rewrite_enabled', v)}
            disabled={!bool('crawl.enabled') || !bool('ai.enabled')}
            label={en ? 'Rewrite crawled stories in Telugu' : 'తెచ్చిన వార్తలను తెలుగులో తిరగరాయండి'}
            hint={en
              ? 'Needs AI switched on above. Off means the crawl only fills the queue with headlines and links.'
              : 'పైన AI ఆన్ కావాలి. ఆఫ్ అయితే క్యూలో శీర్షికలు, లింక్‌లు మాత్రమే చేరతాయి.'} />
          <Switch checked={bool('crawl.html_fallback_enabled')} onChange={(v) => set('crawl.html_fallback_enabled', v)}
            disabled={!bool('crawl.enabled')}
            label={en ? 'Fetch article pages for stub feeds' : 'చిన్న ఫీడ్‌లకు వ్యాసం పేజీ తేండి'}
            hint={en
              ? 'Each source must also permit it and carry a written note. Text from an unlicensed source is used to build the prompt and then discarded — it is never stored.'
              : 'ప్రతి మూలం కూడా అనుమతించాలి, కారణం రాసి ఉండాలి. లైసెన్స్ లేని మూలం పాఠ్యం భద్రపరచబడదు.'} />
          <Switch checked={bool('crawl.mandal_autotag')} onChange={(v) => set('crawl.mandal_autotag', v)}
            label={en ? 'Guess the mandal from the story text' : 'వార్త నుంచి మండలాన్ని ఊహించండి'}
            hint={en
              ? 'Always a guess. The editor sees it with a confidence score and can change it in one click.'
              : 'ఇది ఎప్పుడూ ఊహే. ఎడిటర్‌కు నమ్మకపు స్థాయితో కనిపిస్తుంది, ఒక్క క్లిక్‌లో మార్చవచ్చు.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={en ? 'Stories rewritten per hour (all beats)' : 'గంటకు పునర్లేఖనాలు (అన్ని బీట్లు)'}>
              <Input script="en" type="number" min={0} max={500}
                value={num('crawl.hourly_item_cap')}
                onChange={(e) => set('crawl.hourly_item_cap', Number(e.target.value))} />
            </Field>
            <Field label={en ? 'Per-source hourly default' : 'మూలానికి గంటవారీ డిఫాల్ట్'}>
              <Input script="en" type="number" min={0} max={500}
                value={num('crawl.per_source_default_cap')}
                onChange={(e) => set('crawl.per_source_default_cap', Number(e.target.value))} />
            </Field>
          </div>
          <fieldset className="rounded-xl border border-rule p-3">
            <legend className={cn(s.body, 'px-1 text-ui-sm font-semibold text-ink')}>
              {en ? 'Stories per hour, by beat' : 'బీట్ వారీగా గంటకు వార్తలు'}
            </legend>
            <p className={cn(s.body, 'mb-3 text-meta text-muted')}>
              {en
                ? 'Absolute counts, not shares — these need not add up to anything. Their total is capped by the hourly limit above.'
                : 'ఇవి శాతాలు కావు, సంఖ్యలు — మొత్తం ఎంతైనా కావచ్చు. పైన ఉన్న గంటవారీ పరిమితి వర్తిస్తుంది.'}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BEAT_KEYS.map((beat) => (
                <Field key={beat.key} label={en ? beat.en : beat.te}>
                  <Input script="en" type="number" min={0} max={500}
                    value={Number(beatQuota[beat.key] ?? 0)}
                    onChange={(e) => set('crawl.beat_quota', { ...beatQuota, [beat.key]: Number(e.target.value) })} />
                </Field>
              ))}
            </div>
          </fieldset>
        </Section>

        {/* --------------------------------------------------- §20 voice -- */}
        <Section
          title={en ? 'Voice / listen (§19–21)' : 'వాయిస్ / వినండి (§19–21)'}
          subtitle={en
            ? 'With no provider configured, readers still get the on-device voice.'
            : 'ప్రొవైడర్ లేకపోయినా పాఠకులకు పరికరంలోని వాయిస్ అందుబాటులో ఉంటుంది.'}
        >
          <Switch checked={bool('voice.enabled')} onChange={(v) => set('voice.enabled', v)}
            label={en ? 'Enable voice site-wide' : 'సైట్ అంతటా వాయిస్ ఆన్'}
            hint={en ? 'Off hides the Listen button everywhere.' : 'ఆఫ్ చేస్తే ప్రతిచోటా "వినండి" బటన్ కనిపించదు.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={en ? 'TTS provider' : 'TTS ప్రొవైడర్'}
              hint={!voiceProviderReady ? (
                <span className="text-partial">
                  {en ? 'That provider has no API key configured.' : 'ఆ ప్రొవైడర్‌కు API కీ సెట్ చేయలేదు.'}
                </span>
              ) : undefined}
            >
              <Select value={str('voice.provider')} onChange={(e) => set('voice.provider', e.target.value)}>
                <option value="local">local — {en ? 'device voice only' : 'పరికర వాయిస్ మాత్రమే'}</option>
                <option value="google">google — {keyState(env.tts_google_configured)}</option>
                <option value="bhashini">bhashini — {keyState(env.tts_bhashini_configured)}</option>
              </Select>
            </Field>
            <Field label={en ? 'Monthly character budget' : 'నెలవారీ అక్షరాల బడ్జెట్'}>
              <Input script="en" type="number" min={0} step={100000}
                value={num('voice.monthly_char_budget')}
                onChange={(e) => set('voice.monthly_char_budget', Number(e.target.value))} />
            </Field>
          </div>
          <Switch checked={bool('voice.auto_generate_on_publish')} onChange={(v) => set('voice.auto_generate_on_publish', v)}
            label={en ? 'Generate audio when a story publishes' : 'ప్రచురణ సమయంలోనే ఆడియో తయారు చేయండి'}
            hint={en
              ? 'Off is cheaper: audio is made on the first listener request instead.'
              : 'ఆఫ్ అయితే తక్కువ ఖర్చు — మొదటి శ్రోత అడిగినప్పుడు మాత్రమే తయారవుతుంది.'} />
          <div className="rounded-xl border border-rule bg-canvas p-3">
            <p className={cn(s.body, 'text-meta font-semibold text-muted')}>{en ? 'This month' : 'ఈ నెల'}</p>
            <p className={cn(s.body, 'mt-1 text-ink', s.te ? 'text-te-body-xs' : 'text-ui')}>
              <span className="font-sans tabular-nums">
                {usage.chars_this_month.toLocaleString('en-IN')} / {usage.monthly_budget.toLocaleString('en-IN')}
              </span>{' '}
              <span className="font-sans font-bold tabular-nums">({usage.percent_used}%)</span>
              {' · '}{en ? 'ready' : 'సిద్ధం'}: {usage.assets_ready}
              {usage.assets_failed ? ` · ${en ? 'failed' : 'విఫలం'}: ${usage.assets_failed}` : ''}
            </p>
          </div>
        </Section>

        <Section
          title={en ? 'E-Paper & polls' : 'ఈ-పేపర్ & పోల్స్'}
          subtitle={en ? 'Daily generation creates a reviewable draft; it never publishes automatically.' : 'రోజువారీ జనరేషన్ సమీక్షించదగిన డ్రాఫ్ట్‌ను మాత్రమే సృష్టిస్తుంది; స్వయంగా ప్రచురించదు.'}
        >
          <Switch checked={bool('epaper.enabled')} onChange={(v) => set('epaper.enabled', v)} label={en ? 'Enable public E-Paper' : 'పబ్లిక్ ఈ-పేపర్ ఆన్'} />
          <Switch checked={bool('epaper.auto_generate')} onChange={(v) => set('epaper.auto_generate', v)} label={en ? 'Auto-generate daily draft' : 'రోజువారీ డ్రాఫ్ట్ ఆటో జనరేట్'} />
          <Field label={en ? 'Generation time (IST)' : 'జనరేషన్ సమయం (IST)'} className="max-w-xs">
            <Input script="en" type="time" value={str('epaper.auto_generate_time')} onChange={(e) => set('epaper.auto_generate_time', e.target.value)} />
          </Field>
          <Switch checked={bool('epaper.audio_enabled')} onChange={(v) => set('epaper.audio_enabled', v)} label={en ? 'Audio edition' : 'ఆడియో ఎడిషన్'} />
          <Switch checked={bool('voice.article_tts_enabled')} onChange={(v) => set('voice.article_tts_enabled', v)} label={en ? 'Article TTS' : 'కథనం TTS'} />
          <Switch checked={bool('epaper.personalized_enabled')} onChange={(v) => set('epaper.personalized_enabled', v)} label={en ? 'Personalized E-Paper' : 'వ్యక్తిగత ఈ-పేపర్'} />
          <Switch checked={bool('polls.enabled')} onChange={(v) => set('polls.enabled', v)} label={en ? 'Polls and Big Question' : 'పోల్స్ మరియు బిగ్ క్వశ్చన్'} />
          <Switch checked={bool('ai.research_enabled')} onChange={(v) => set('ai.research_enabled', v)} disabled={!bool('ai.enabled')} label={en ? 'AI multiple-source research' : 'AI బహుళ మూలాల పరిశోధన'} />
        </Section>

        {/* --------------------------------------------------- §35 mix ---- */}
        <Section
          title={en ? 'Feed balance (§34–35)' : 'ఫీడ్ సమతుల్యత (§34–35)'}
          subtitle={en
            ? 'How much of a reader’s feed is reserved for each kind. Must total 100.'
            : 'పాఠకుడి ఫీడ్‌లో ఏ రకానికి ఎంత వాటా. మొత్తం 100 కావాలి.'}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            {RATIO_KEYS.map((key) => (
              <Field key={key} label={<span className="capitalize">{key}</span>}>
                <Input script="en" type="number" min={0} max={100} value={ratios[key] ?? 0}
                  onChange={(e) => set('feed.ratios', { ...ratios, [key]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
          <p className={cn(s.body, 'flex items-center gap-1 text-meta', ratioTotal === 100 ? 'text-success' : 'text-breaking')}>
            {en ? 'Total' : 'మొత్తం'}: {ratioTotal}%
            {ratioTotal === 100 ? <Icon icon={Check} size="xs" /> : <span>— {en ? 'must be 100' : '100 కావాలి'}</span>}
          </p>
        </Section>

        {/* ------------------------------------------------ §9 / §6 misc -- */}
        <Section title={en ? 'Newsroom' : 'న్యూస్‌రూమ్'} subtitle={en ? 'Breaking window and reader submissions' : 'బ్రేకింగ్ వ్యవధి, పాఠకుల రచనలు'}>
          <Field label={en ? 'Default breaking duration (minutes)' : 'బ్రేకింగ్ డిఫాల్ట్ వ్యవధి (నిమిషాలు)'} className="max-w-xs">
            <Input script="en" type="number" min={1} value={num('breaking.default_duration_minutes')}
              onChange={(e) => set('breaking.default_duration_minutes', Number(e.target.value))} />
          </Field>
          <Switch checked={bool('submissions.enabled')} onChange={(v) => set('submissions.enabled', v)}
            label={en ? 'Accept reader submissions' : 'పాఠకుల రచనలు స్వీకరించండి'} />
        </Section>

        {errors ? (
          <p role="alert" className={cn(s.body, 'rounded-xl border border-rule bg-breaking-tint p-3 text-meta text-breaking')}>
            {Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </p>
        ) : null}

        {/* ------------------------------------------------- environment -- */}
        <Section title={en ? 'Deployment (read-only)' : 'డిప్లాయ్‌మెంట్ (చదవడానికి మాత్రమే)'}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(env).map(([key, val]) => (
              <div key={key} className="rounded-xl border border-rule bg-canvas p-3">
                <dt className="font-mono text-meta text-muted">{key.replaceAll('_', ' ')}</dt>
                <dd className="mt-1 break-words font-sans text-ui-sm font-semibold text-ink">
                  {typeof val === 'boolean' ? (
                    <Badge tone={val ? 'success' : 'muted'} size="xs" lang={language}>
                      {val ? t('ui.on') : t('ui.off')}
                    </Badge>
                  ) : (
                    String(val)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-surface px-4 py-3 md:-mx-6 md:px-6">
          {dirty ? <Badge tone="partial" className="mr-auto">{t('admin.unsaved')}</Badge> : null}
          <Button variant="secondary" icon={RotateCcw} disabled={!dirty || save.isPending} onClick={() => setDraft(payload.values)}>
            {en ? 'Reset' : 'రీసెట్'}
          </Button>
          <Button icon={Save} pending={save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending ? (en ? 'Saving…' : 'సేవ్ అవుతోంది…') : (en ? 'Save settings' : 'సెట్టింగ్‌లు సేవ్ చేయండి')}
          </Button>
        </div>
      </>
    );
  };

  return (
    <AdminPage
      width="page"
      title={t('admin.page.settings')}
      subtitle={en
        ? 'Editorial switches take effect immediately. Deployment configuration is read-only.'
        : 'ఎడిటోరియల్ స్విచ్‌లు వెంటనే అమలవుతాయి. డిప్లాయ్‌మెంట్ కాన్ఫిగరేషన్ చదవడానికి మాత్రమే.'}
    >
      <QueryState query={settings} isEmpty={() => false} skeleton={<SettingsSkeleton />}>
        {renderForm}
      </QueryState>
    </AdminPage>
  );
}
