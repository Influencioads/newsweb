import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Section, Toggle, inputClass } from '@/components/admin/FormControls';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import type { ApiError } from '@/api/client';

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

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <Section title={title} subtitle={hint}>{children}</Section>;
}

export default function SettingsPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['cms', 'settings'], queryFn: cmsApi.fetchSettings });

  const [draft, setDraft] = useState<Values>({});
  useEffect(() => { if (settings.data) setDraft(settings.data.values); }, [settings.data]);

  const save = useMutation({
    mutationFn: (values: Values) => cmsApi.patchSettings(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cms', 'settings'] }),
  });

  if (settings.isLoading) {
    return <main className="mx-auto max-w-4xl px-4 py-6"><p className="te text-muted">{en ? 'Loading…' : 'లోడ్ అవుతోంది…'}</p></main>;
  }
  if (settings.isError || !settings.data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6">
        <p role="alert" className="te rounded-card border border-breaking-border bg-breaking-tint p-5 text-breaking">
          {en ? 'Could not load settings. Check your permissions.' : 'సెట్టింగ్‌లు లోడ్ కాలేదు. అనుమతులు తనిఖీ చేయండి.'}
        </p>
      </main>
    );
  }

  const env = settings.data.environment as Record<string, unknown>;
  const usage = settings.data.voice_usage;
  const bool = (key: string) => Boolean(draft[key]);
  const num = (key: string) => Number(draft[key] ?? 0);
  const str = (key: string) => String(draft[key] ?? '');
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));

  const ratios = (draft['feed.ratios'] as Record<string, number> | undefined) ?? {
    personal: 40, local: 25, trending: 25, breaking: 10,
  };
  const ratioTotal = RATIO_KEYS.reduce((sum, k) => sum + (ratios[k] ?? 0), 0);
  const errors = (save.error as ApiError | undefined)?.details as Record<string, string> | undefined;

  const aiBlocked = !env.ai_available;
  const voiceProviderReady =
    str('voice.provider') === 'local' ||
    (str('voice.provider') === 'google' && env.tts_google_configured) ||
    (str('voice.provider') === 'bhashini' && env.tts_bhashini_configured);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5">
        <h1 className="th text-[25px] font-extrabold text-ink">{en ? 'Settings' : 'సెట్టింగ్‌లు'}</h1>
        <p className="te mt-1 text-[12px] text-muted">
          {en
            ? 'Editorial switches take effect immediately. Deployment configuration is read-only.'
            : 'ఎడిటోరియల్ స్విచ్‌లు వెంటనే అమలవుతాయి. డిప్లాయ్‌మెంట్ కాన్ఫిగరేషన్ చదవడానికి మాత్రమే.'}
        </p>
      </header>

      <div className="space-y-5">
        {/* ------------------------------------------------------ §18 AI -- */}
        <Group
          title={en ? 'AI assistance (§15–18)' : 'AI సహాయం (§15–18)'}
          hint={en
            ? 'AI never publishes. Drafts enter the review queue like any other copy.'
            : 'AI స్వయంగా ప్రచురించదు. డ్రాఫ్ట్‌లు సాధారణ కథనాల్లాగే సమీక్ష క్యూలోకి వెళ్తాయి.'}
        >
          {aiBlocked ? (
            <p className="te rounded-control border border-rule bg-canvas p-2.5 text-[12px] text-muted">
              {en
                ? 'AI_ENABLED is off in the environment, so this switch has no effect until a deployment turns it on.'
                : 'పర్యావరణంలో AI_ENABLED ఆఫ్‌లో ఉంది — డిప్లాయ్‌మెంట్‌లో ఆన్ చేసేవరకు ఈ స్విచ్ పనిచేయదు.'}
            </p>
          ) : null}
          <Toggle checked={bool('ai.enabled')} onChange={(v) => set('ai.enabled', v)}
            label={en ? 'Enable AI features' : 'AI ఫీచర్లు ఆన్ చేయండి'}
            hint={en ? 'Master switch. Off means no provider is ever called.' : 'ప్రధాన స్విచ్. ఆఫ్ అయితే ఏ ప్రొవైడర్‌నూ పిలవదు.'} />
          <Toggle checked={bool('ai.auto_suggest')} onChange={(v) => set('ai.auto_suggest', v)}
            disabled={!bool('ai.enabled')}
            label={en ? 'Daily topic discovery' : 'రోజువారీ అంశ సూచనలు'}
            hint={en ? 'Suggestions still need an editor to accept them.' : 'సూచనలను ఎడిటర్ ఆమోదించాల్సిందే.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="te mb-1 block text-[12px] font-bold text-ink">{en ? 'Provider' : 'ప్రొవైడర్'}</span>
              <select className={inputClass} value={str('ai.provider')} onChange={(e) => set('ai.provider', e.target.value)}>
                <option value="heuristic">heuristic — {en ? 'no key needed' : 'కీ అవసరం లేదు'}</option>
                <option value="gemini">gemini</option>
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
              </select>
            </label>
            <label className="block">
              <span className="te mb-1 block text-[12px] font-bold text-ink">{en ? 'Suggestions per day' : 'రోజుకు సూచనలు'}</span>
              <input type="number" min={1} max={50} className={inputClass}
                value={num('ai.daily_suggestion_limit')}
                onChange={(e) => set('ai.daily_suggestion_limit', Number(e.target.value))} />
            </label>
          </div>
        </Group>

        {/* ------------------------------------------------ hourly crawl -- */}
        <Group
          title={en ? 'Hourly crawl' : 'గంటవారీ క్రాల్'}
          hint={en
            ? 'How many stories are pulled and rewritten each hour, and from which beats. Rewrites still land in the review queue — nothing here publishes.'
            : 'ప్రతి గంటకు ఎన్ని వార్తలు తేవాలి, ఏ బీట్ల నుంచి. పునర్లేఖనాలు సమీక్ష క్యూలోకే వెళ్తాయి — ఇక్కడ ఏదీ ప్రచురించదు.'}
        >
          <Toggle checked={bool('crawl.enabled')} onChange={(v) => set('crawl.enabled', v)}
            label={en ? 'Run the hourly crawl' : 'గంటవారీ క్రాల్ నడపండి'}
            hint={en
              ? 'Off means no source is polled on a schedule and no provider is called.'
              : 'ఆఫ్ అయితే షెడ్యూల్‌లో ఏ మూలాన్నీ తనిఖీ చేయదు, ఏ ప్రొవైడర్‌నూ పిలవదు.'} />

          <Toggle checked={bool('crawl.rewrite_enabled')} onChange={(v) => set('crawl.rewrite_enabled', v)}
            disabled={!bool('crawl.enabled') || !bool('ai.enabled')}
            label={en ? 'Rewrite crawled stories in Telugu' : 'తెచ్చిన వార్తలను తెలుగులో తిరగరాయండి'}
            hint={en
              ? 'Needs AI switched on above. Off means the crawl only fills the queue with headlines and links.'
              : 'పైన AI ఆన్ కావాలి. ఆఫ్ అయితే క్యూలో శీర్షికలు, లింక్‌లు మాత్రమే చేరతాయి.'} />

          <Toggle checked={bool('crawl.html_fallback_enabled')} onChange={(v) => set('crawl.html_fallback_enabled', v)}
            disabled={!bool('crawl.enabled')}
            label={en ? 'Fetch article pages for stub feeds' : 'చిన్న ఫీడ్‌లకు వ్యాసం పేజీ తేండి'}
            hint={en
              ? 'Each source must also permit it and carry a written note. Text from an unlicensed source is used to build the prompt and then discarded — it is never stored.'
              : 'ప్రతి మూలం కూడా అనుమతించాలి, కారణం రాసి ఉండాలి. లైసెన్స్ లేని మూలం పాఠ్యం భద్రపరచబడదు.'} />

          <Toggle checked={bool('crawl.mandal_autotag')} onChange={(v) => set('crawl.mandal_autotag', v)}
            label={en ? 'Guess the mandal from the story text' : 'వార్త నుంచి మండలాన్ని ఊహించండి'}
            hint={en
              ? 'Always a guess. The editor sees it with a confidence score and can change it in one click.'
              : 'ఇది ఎప్పుడూ ఊహే. ఎడిటర్‌కు నమ్మకపు స్థాయితో కనిపిస్తుంది, ఒక్క క్లిక్‌లో మార్చవచ్చు.'} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="te mb-1 block text-[12px] font-bold text-ink">
                {en ? 'Stories rewritten per hour (all beats)' : 'గంటకు పునర్లేఖనాలు (అన్ని బీట్లు)'}
              </span>
              <input type="number" min={0} max={500} className={inputClass}
                value={num('crawl.hourly_item_cap')}
                onChange={(e) => set('crawl.hourly_item_cap', Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="te mb-1 block text-[12px] font-bold text-ink">
                {en ? 'Per-source hourly default' : 'మూలానికి గంటవారీ డిఫాల్ట్'}
              </span>
              <input type="number" min={0} max={500} className={inputClass}
                value={num('crawl.per_source_default_cap')}
                onChange={(e) => set('crawl.per_source_default_cap', Number(e.target.value))} />
            </label>
          </div>

          <fieldset className="rounded-control border border-rule p-3">
            <legend className="te px-1 text-[12px] font-bold text-ink">
              {en ? 'Stories per hour, by beat' : 'బీట్ వారీగా గంటకు వార్తలు'}
            </legend>
            <p className="te mb-2 text-[11.5px] leading-telugu text-muted">
              {en
                ? 'Absolute counts, not shares — these need not add up to anything. Their total is capped by the hourly limit above.'
                : 'ఇవి శాతాలు కావు, సంఖ్యలు — మొత్తం ఎంతైనా కావచ్చు. పైన ఉన్న గంటవారీ పరిమితి వర్తిస్తుంది.'}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BEAT_KEYS.map((beat) => (
                <label key={beat.key} className="block">
                  <span className="te mb-1 block text-[11.5px] font-semibold text-ink-soft">
                    {en ? beat.en : beat.te}
                  </span>
                  <input type="number" min={0} max={500} className={inputClass}
                    value={Number((draft['crawl.beat_quota'] as Record<string, number> | undefined)?.[beat.key] ?? 0)}
                    onChange={(e) => set('crawl.beat_quota', {
                      ...(draft['crawl.beat_quota'] as Record<string, number> ?? {}),
                      [beat.key]: Number(e.target.value),
                    })} />
                </label>
              ))}
            </div>
          </fieldset>
        </Group>

        {/* --------------------------------------------------- §20 voice -- */}
        <Group
          title={en ? 'Voice / listen (§19–21)' : 'వాయిస్ / వినండి (§19–21)'}
          hint={en
            ? 'With no provider configured, readers still get the on-device voice.'
            : 'ప్రొవైడర్ లేకపోయినా పాఠకులకు పరికరంలోని వాయిస్ అందుబాటులో ఉంటుంది.'}
        >
          <Toggle checked={bool('voice.enabled')} onChange={(v) => set('voice.enabled', v)}
            label={en ? 'Enable voice site-wide' : 'సైట్ అంతటా వాయిస్ ఆన్'}
            hint={en ? 'Off hides the Listen button everywhere.' : 'ఆఫ్ చేస్తే ప్రతిచోటా "వినండి" బటన్ కనిపించదు.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="te mb-1 block text-[12px] font-bold text-ink">{en ? 'TTS provider' : 'TTS ప్రొవైడర్'}</span>
              <select className={inputClass} value={str('voice.provider')} onChange={(e) => set('voice.provider', e.target.value)}>
                <option value="local">local — {en ? 'device voice only' : 'పరికర వాయిస్ మాత్రమే'}</option>
                <option value="google">google {env.tts_google_configured ? '✓' : '(key missing)'}</option>
                <option value="bhashini">bhashini {env.tts_bhashini_configured ? '✓' : '(key missing)'}</option>
              </select>
              {!voiceProviderReady ? (
                <span className="te mt-1 block text-[11.5px] text-partial">
                  {en ? 'That provider has no API key configured.' : 'ఆ ప్రొవైడర్‌కు API కీ సెట్ చేయలేదు.'}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="te mb-1 block text-[12px] font-bold text-ink">{en ? 'Monthly character budget' : 'నెలవారీ అక్షరాల బడ్జెట్'}</span>
              <input type="number" min={0} step={100000} className={inputClass}
                value={num('voice.monthly_char_budget')}
                onChange={(e) => set('voice.monthly_char_budget', Number(e.target.value))} />
            </label>
          </div>
          <Toggle checked={bool('voice.auto_generate_on_publish')} onChange={(v) => set('voice.auto_generate_on_publish', v)}
            label={en ? 'Generate audio when a story publishes' : 'ప్రచురణ సమయంలోనే ఆడియో తయారు చేయండి'}
            hint={en
              ? 'Off is cheaper: audio is made on the first listener request instead.'
              : 'ఆఫ్ అయితే తక్కువ ఖర్చు — మొదటి శ్రోత అడిగినప్పుడు మాత్రమే తయారవుతుంది.'} />
          <div className="rounded-control border border-rule bg-canvas p-3">
            <p className="font-sans text-[11px] uppercase tracking-wide text-muted">
              {en ? 'This month' : 'ఈ నెల'}
            </p>
            <p className="te mt-1 text-[13px] text-ink">
              {usage.chars_this_month.toLocaleString('en-IN')} / {usage.monthly_budget.toLocaleString('en-IN')}{' '}
              <span className="font-sans font-bold">({usage.percent_used}%)</span>
              {' · '}{en ? 'ready' : 'సిద్ధం'}: {usage.assets_ready}
              {usage.assets_failed ? ` · ${en ? 'failed' : 'విఫలం'}: ${usage.assets_failed}` : ''}
            </p>
          </div>
        </Group>

        <Group
          title={en ? 'E-Paper & polls' : 'ఈ-పేపర్ & పోల్స్'}
          hint={en ? 'Daily generation creates a reviewable draft; it never publishes automatically.' : 'రోజువారీ జనరేషన్ సమీక్షించదగిన డ్రాఫ్ట్‌ను మాత్రమే సృష్టిస్తుంది; స్వయంగా ప్రచురించదు.'}
        >
          <Toggle checked={bool('epaper.enabled')} onChange={(v) => set('epaper.enabled', v)} label={en ? 'Enable public E-Paper' : 'పబ్లిక్ ఈ-పేపర్ ఆన్'} />
          <Toggle checked={bool('epaper.auto_generate')} onChange={(v) => set('epaper.auto_generate', v)} label={en ? 'Auto-generate daily draft' : 'రోజువారీ డ్రాఫ్ట్ ఆటో జనరేట్'} />
          <label className="block max-w-xs"><span className="te mb-1 block text-[12px] font-bold">{en ? 'Generation time (IST)' : 'జనరేషన్ సమయం (IST)'}</span><input type="time" className={inputClass} value={str('epaper.auto_generate_time')} onChange={(e) => set('epaper.auto_generate_time', e.target.value)} /></label>
          <Toggle checked={bool('epaper.audio_enabled')} onChange={(v) => set('epaper.audio_enabled', v)} label={en ? 'Audio edition' : 'ఆడియో ఎడిషన్'} />
          <Toggle checked={bool('voice.article_tts_enabled')} onChange={(v) => set('voice.article_tts_enabled', v)} label={en ? 'Article TTS' : 'కథనం TTS'} />
          <Toggle checked={bool('epaper.personalized_enabled')} onChange={(v) => set('epaper.personalized_enabled', v)} label={en ? 'Personalized E-Paper' : 'వ్యక్తిగత ఈ-పేపర్'} />
          <Toggle checked={bool('polls.enabled')} onChange={(v) => set('polls.enabled', v)} label={en ? 'Polls and Big Question' : 'పోల్స్ మరియు బిగ్ క్వశ్చన్'} />
          <Toggle checked={bool('ai.research_enabled')} onChange={(v) => set('ai.research_enabled', v)} disabled={!bool('ai.enabled')} label={en ? 'AI multiple-source research' : 'AI బహుళ మూలాల పరిశోధన'} />
        </Group>

        {/* --------------------------------------------------- §35 mix ---- */}
        <Group
          title={en ? 'Feed balance (§34–35)' : 'ఫీడ్ సమతుల్యత (§34–35)'}
          hint={en
            ? 'How much of a reader’s feed is reserved for each kind. Must total 100.'
            : 'పాఠకుడి ఫీడ్‌లో ఏ రకానికి ఎంత వాటా. మొత్తం 100 కావాలి.'}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            {RATIO_KEYS.map((key) => (
              <label key={key} className="block">
                <span className="te mb-1 block text-[12px] font-bold capitalize text-ink">{key}</span>
                <input type="number" min={0} max={100} className={inputClass} value={ratios[key] ?? 0}
                  onChange={(e) => set('feed.ratios', { ...ratios, [key]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <p className={`te text-[12px] ${ratioTotal === 100 ? 'text-success' : 'text-breaking'}`}>
            {en ? 'Total' : 'మొత్తం'}: {ratioTotal}%
            {ratioTotal !== 100 ? ` — ${en ? 'must be 100' : '100 కావాలి'}` : ' ✓'}
          </p>
        </Group>

        {/* ------------------------------------------------ §9 / §6 misc -- */}
        <Group title={en ? 'Newsroom' : 'న్యూస్‌రూమ్'} hint={en ? 'Breaking window and reader submissions' : 'బ్రేకింగ్ వ్యవధి, పాఠకుల రచనలు'}>
          <label className="block max-w-xs">
            <span className="te mb-1 block text-[12px] font-bold text-ink">
              {en ? 'Default breaking duration (minutes)' : 'బ్రేకింగ్ డిఫాల్ట్ వ్యవధి (నిమిషాలు)'}
            </span>
            <input type="number" min={1} className={inputClass} value={num('breaking.default_duration_minutes')}
              onChange={(e) => set('breaking.default_duration_minutes', Number(e.target.value))} />
          </label>
          <Toggle checked={bool('submissions.enabled')} onChange={(v) => set('submissions.enabled', v)}
            label={en ? 'Accept reader submissions' : 'పాఠకుల రచనలు స్వీకరించండి'} />
        </Group>

        {errors ? (
          <p role="alert" className="te rounded-control border border-breaking-border bg-breaking-tint p-3 text-[13px] text-breaking">
            {Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </p>
        ) : null}
        {save.isSuccess ? (
          <p className="te rounded-control border border-success/40 bg-success/10 p-3 text-[13px] text-success">
            {en ? 'Settings saved.' : 'సెట్టింగ్‌లు సేవ్ అయ్యాయి.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button type="button" disabled={save.isPending} onClick={() => save.mutate(draft)}
            className="te min-h-tap rounded-control bg-brand px-6 font-bold text-white disabled:opacity-60">
            {save.isPending ? (en ? 'Saving…' : 'సేవ్ అవుతోంది…') : (en ? 'Save settings' : 'సెట్టింగ్‌లు సేవ్ చేయండి')}
          </button>
          <button type="button" onClick={() => setDraft(settings.data.values)}
            className="te min-h-tap rounded-control border border-rule px-4 font-semibold text-ink">
            {en ? 'Reset' : 'రీసెట్'}
          </button>
        </div>

        {/* ------------------------------------------------- environment -- */}
        <Section title={en ? 'Deployment (read-only)' : 'డిప్లాయ్‌మెంట్ (చదవడానికి మాత్రమే)'}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(env).map(([key, val]) => (
              <div key={key} className="rounded-control border border-rule bg-canvas p-3">
                <dt className="font-mono text-[10px] uppercase text-muted">{key.replaceAll('_', ' ')}</dt>
                <dd className="mt-0.5 break-words font-sans text-[13px] font-semibold text-ink">
                  {typeof val === 'boolean' ? (val ? '✓' : '—') : String(val)}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </main>
  );
}
