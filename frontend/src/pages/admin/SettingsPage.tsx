import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, RotateCcw, Save } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { Section } from '@/components/admin/FormControls';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select, Switch } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { SettingSpec, SettingsPayload } from '@/types/cms';
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

/** The `brand.*` colour settings; derivation and dark mode live in utils/brand.ts. */
const BRAND_KEYS = [
  { key: 'brand.primary', te: 'ప్రధాన రంగు', en: 'Primary', hintTe: 'మాస్ట్‌హెడ్, బటన్లు, లింకులు', hintEn: 'Masthead, buttons, links' },
  { key: 'brand.breaking', te: 'బ్రేకింగ్', en: 'Breaking', hintTe: 'టిక్కర్, లైవ్ బ్యాడ్జ్', hintEn: 'Ticker, Live and Breaking badges' },
  { key: 'brand.accent', te: 'యాక్సెంట్', en: 'Accent', hintTe: 'ఎక్స్‌క్లూజివ్ బ్యాడ్జ్', hintEn: 'Exclusive badges' },
] as const;

/**
 * One entry of the measured shortlist `settings_service.describe()` hangs on a
 * model setting.
 *
 * `usd_per_call` is what one real call cost on the day the catalogue was
 * measured — not a rate card, and `0` means the vendor reported no spend at
 * all, which is unknown rather than free.
 */
interface ModelChoice {
  id: string;
  label: string;
  tier: string;
  usd_per_call: number;
  note: string;
  /** TTS only: the voices this model accepts. Empty means it takes none. */
  voices?: string[];
  /** TTS only: named starting points for a bulletin read. */
  presets?: VoicePreset[];
}

/** A speaker and a pace under one label. `pace` is the part that carries the
 *  house style; the speaker is a first pick to audition, not a likeness. */
interface VoicePreset {
  label: string;
  speaker: string;
  pace: number;
  note: string;
}

/** `choices` is new and only the model settings carry it, so it is widened
 *  here rather than pushed onto the `SettingSpec` every other screen shares. */
type SpecWithChoices = SettingSpec & { choices?: Array<ModelChoice | string> | null };

/** The measured price of one call, in the dollars it actually cost. */
const usdPerCall = (value: number, en: boolean) =>
  value > 0
    ? `$${value.toFixed(value < 0.001 ? 6 : 4)}`
    : en
      ? 'cost not reported'
      : 'ఖర్చు నివేదించలేదు';

/**
 * One model dropdown, priced.
 *
 * The cost sits on the option rather than in a help line because the choice
 * being made here spans 29x — an admin comparing two models is reading the
 * list, not the text under it. The note below the field is the catalogue's own
 * sentence about the selected model, shown verbatim: it was written for
 * whoever is choosing, and paraphrasing it would lose the measurement.
 *
 * A stored model that is not on the shortlist keeps its own option. The
 * catalogue is a shortlist, not a whitelist, and a screen that quietly showed
 * "adapter default" for a configured model would change it on the next save.
 */
function ModelField({
  label,
  hint,
  choices,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  choices: ModelChoice[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { language } = useI18n();
  const en = language === 'en';
  const selected = choices.find((c) => c.id === value);
  return (
    <Field label={label} hint={selected ? selected.note : hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{en ? 'Adapter default' : 'అడాప్టర్ డిఫాల్ట్'}</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label} — {usdPerCall(c.usd_per_call, en)}
          </option>
        ))}
        {value && !selected ? <option value={value}>{value}</option> : null}
      </Select>
    </Field>
  );
}

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
      // Brand colours ride on /public/config; refetch so this screen repaints now.
      void queryClient.invalidateQueries({ queryKey: ['public', 'config'] });
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

  const renderForm = (payload: SettingsPayload) => {
    const env = payload.environment;
    const usage = payload.voice_usage;
    const aiUsage = payload.ai_usage;
    const aiBlocked = !env.ai_available;
    // A secret comes back from the API as a mask, never as its value, so the
    // only thing the screen can honestly say is whether one is stored.
    const keySet = Boolean(payload.values['ai.api_key']);
    // aimlapi is ready when a key is stored on this screen — either its own or
    // the AI one it shares — rather than when the deployment set an env var.
    const voiceKeySet = Boolean(payload.values['voice.api_key'] || payload.values['ai.api_key']);
    // Sarvam bills on its own account, so only its own box counts — the AI key
    // belongs to aimlapi, and reusing it here is a 403, not a shortcut.
    const sarvamKeySet = Boolean(payload.values['voice.api_key']);
    const voiceProvider = str('voice.provider');
    const voiceProviderReady =
      voiceProvider === 'local' ||
      (voiceProvider === 'google' && env.tts_google_configured) ||
      (voiceProvider === 'bhashini' && env.tts_bhashini_configured) ||
      (voiceProvider === 'aimlapi' && voiceKeySet) ||
      (voiceProvider === 'sarvam' && sarvamKeySet);
    //: Both providers take their key and model from this screen rather than
    //  from the deploy environment, so they share one block of fields.
    const configuredProvider = voiceProvider === 'aimlapi' || voiceProvider === 'sarvam';

    const choicesOf = (key: string) => (payload.specs as SpecWithChoices[]).find((sp) => sp.key === key)?.choices ?? [];
    const models = (key: string) => choicesOf(key).filter((c): c is ModelChoice => typeof c === 'object' && c !== null);
    // The voices belong to the chosen model — `alloy` left behind on an
    // ElevenLabs model is a 400 nobody can read — so the model's own list wins.
    // The flat `voice.voice_name` list is the default model's and is only the
    // fallback for an install whose backend does not send per-model voices yet.
    const voicesFor = (model: string) =>
      models('voice.model').find((c) => c.id === model)?.voices ??
      choicesOf('voice.voice_name').filter((c): c is string => typeof c === 'string');
    // Google and Bhashini name their voices themselves; offering them the
    // aimlapi catalogue would be confidently wrong, so they keep the text box.
    // The two vendors share the `voice.model` row and the `sarvam/` prefix is
    // what tells them apart. Offering one provider the other's models is how a
    // saved setting turns into a 4xx nobody can read.
    const speechModels = models('voice.model').filter(
      (c) => c.id.startsWith('sarvam/') === (voiceProvider === 'sarvam'),
    );
    // A model left behind by the other provider resolves to this provider's
    // first one — the same fallback the adapters make server-side.
    const speechModel = speechModels.find((c) => c.id === str('voice.model')) ?? speechModels[0];
    const voiceOptions = configuredProvider ? voicesFor(speechModel?.id ?? '') : null;
    const presets = speechModel?.presets ?? [];

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
                <option value="aimlapi">aimlapi</option>
              </Select>
            </Field>
            <Field label={en ? 'Suggestions per day' : 'రోజుకు సూచనలు'}>
              <Input script="en" type="number" min={1} max={50}
                value={num('ai.daily_suggestion_limit')}
                onChange={(e) => set('ai.daily_suggestion_limit', Number(e.target.value))} />
            </Field>
          </div>

          {/* §7.1 — the spend ceiling was declared in config for months and
              enforced by nothing. Now that it bites, it has to be visible:
              an editor blocked by AI_BUDGET_EXCEEDED needs somewhere to see
              why, and a desk needs to see it coming before it does. */}
          <div className="rounded-xl border border-rule bg-canvas p-3">
            <p className={cn(s.body, 'text-meta font-semibold text-muted')}>
              {en ? 'AI spend this month' : 'ఈ నెల AI ఖర్చు'}
            </p>
            <p className={cn(s.body, 'mt-1 text-ink', s.te ? 'text-te-body-xs' : 'text-ui')}>
              {aiUsage.budget_inr ? (
                <>
                  <span className="font-sans tabular-nums">
                    ₹{aiUsage.spent_inr.toLocaleString('en-IN')} / ₹{aiUsage.budget_inr.toLocaleString('en-IN')}
                  </span>{' '}
                  <span
                    className={cn(
                      'font-sans font-bold tabular-nums',
                      aiUsage.percent_used >= 100
                        ? 'text-breaking'
                        : aiUsage.percent_used >= aiUsage.alert_percent
                          ? 'text-partial'
                          : undefined,
                    )}
                  >
                    ({aiUsage.percent_used}%)
                  </span>
                </>
              ) : (
                <span className="font-sans">
                  {en ? 'No monthly ceiling set' : 'నెలవారీ పరిమితి పెట్టలేదు'}
                </span>
              )}
              {' · '}{en ? 'calls' : 'కాల్స్'}: <span className="font-sans tabular-nums">{aiUsage.calls_this_month}</span>
              {aiUsage.calls_failed ? ` · ${en ? 'failed' : 'విఫలం'}: ${aiUsage.calls_failed}` : ''}
            </p>
            {aiUsage.budget_inr && aiUsage.percent_used >= 100 ? (
              <p className={cn(s.body, 'mt-2 text-meta text-breaking')}>
                {en
                  ? 'The month’s budget is spent. Drafts and rewrites will refuse until it resets or the ceiling is raised.'
                  : 'ఈ నెల బడ్జెట్ పూర్తయింది. పరిమితి పెంచేవరకు డ్రాఫ్ట్‌లు, రీరైట్‌లు ఆగిపోతాయి.'}
              </p>
            ) : null}
          </div>

          {/* The key is write-only: the API returns a mask, never the value, so
              what lands here is a mask the admin can overwrite but not read. */}
          {str('ai.provider') !== 'heuristic' ? (
            <>
              <Field
                className="sm:max-w-md"
                label={en ? 'API key' : 'API కీ'}
                hint={keySet
                  ? (en ? 'A key is saved. Type a new one to replace it, or clear the box to remove it.'
                        : 'కీ సేవ్ అయ్యింది. మార్చాలంటే కొత్తది టైప్ చేయండి, తీసేయాలంటే ఖాళీ చేయండి.')
                  : (en ? 'Stored encrypted. Falls back to the deployment environment when empty.'
                        : 'ఎన్‌క్రిప్ట్ చేసి భద్రపరుస్తాం. ఖాళీగా ఉంటే డిప్లాయ్‌మెంట్ విలువ వాడతాం.')}
              >
                <Input script="en" type="password" autoComplete="off" spellCheck={false}
                  placeholder={keySet ? '••••••••' : 'sk-…'}
                  value={str('ai.api_key')}
                  onChange={(e) => set('ai.api_key', e.target.value)} />
              </Field>

              {/* The whole reason there are two model settings is the bill.
                  An admin who cannot see that will set both to the best model
                  and find out at the end of the month. */}
              <p className={note}>
                {en
                  ? 'Two models, because the volumes are not comparable: the editorial model writes the eight or ten pieces a day a human reads every word of, while the bulk model runs the hourly crawl at sixty rewrites an hour. At crawl volume the cheapest good model costs about ₹6,000 a month and the best one about ₹34,000 — same story, same prompt.'
                  : 'రెండు మోడల్స్ ఎందుకంటే పని పరిమాణం ఒకటి కాదు: ఎడిటోరియల్ మోడల్ రోజుకు ఎనిమిది–పది కథనాలు రాస్తుంది, ప్రతి పదాన్నీ మనిషి చదువుతాడు. బల్క్ మోడల్ గంటకు అరవై పునర్లేఖనాల క్రాల్‌ను నడుపుతుంది. ఆ స్థాయిలో చవకైన మంచి మోడల్ నెలకు దాదాపు ₹6,000, అత్యుత్తమమైనది దాదాపు ₹34,000 — ఒకే కథనం, ఒకే ప్రాంప్ట్.'}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <ModelField
                  label={en ? 'Editorial model — a human reads every word' : 'ఎడిటోరియల్ మోడల్ — ప్రతి పదాన్నీ మనిషి చదువుతాడు'}
                  hint={en ? 'Drafts and bulletin scripts. Blank uses the adapter default.'
                           : 'డ్రాఫ్ట్‌లు, బులెటిన్ స్క్రిప్ట్‌లు. ఖాళీ అయితే అడాప్టర్ డిఫాల్ట్.'}
                  choices={models('ai.model')}
                  value={str('ai.model')}
                  onChange={(id) => set('ai.model', id)}
                />
                <ModelField
                  label={en ? 'Bulk model — the hourly crawl, sixty an hour' : 'బల్క్ మోడల్ — గంటవారీ క్రాల్, గంటకు అరవై'}
                  hint={en ? 'Crawl rewrites and topic discovery. Blank uses the adapter default.'
                           : 'క్రాల్ పునర్లేఖనాలు, అంశ సూచనలు. ఖాళీ అయితే అడాప్టర్ డిఫాల్ట్.'}
                  choices={models('ai.bulk_model')}
                  value={str('ai.bulk_model')}
                  onChange={(id) => set('ai.bulk_model', id)}
                />
              </div>
            </>
          ) : null}

          {/* --------------------------------------------- §17 AI images -- */}
          <Switch checked={bool('ai.image_enabled')} onChange={(v) => set('ai.image_enabled', v)}
            disabled={!bool('ai.enabled') || !keySet}
            label={en ? 'Make a realistic AI picture when there is no photograph' : 'ఫోటో లేనప్పుడు AI చిత్రం రూపొందించండి'}
            hint={en
              ? 'Needs AI on and a key saved above. Sensitive stories — communal, sexual violence, a named minor, suicide — are refused before any call is made, and every generated image carries a visible label.'
              : 'పైన AI ఆన్ కావాలి, కీ సేవ్ కావాలి. సున్నితమైన కథనాలు — మతపరమైనవి, లైంగిక హింస, మైనర్లు, ఆత్మహత్య — కాల్ చేయకముందే తిరస్కరించబడతాయి. తయారైన ప్రతి చిత్రంపై లేబుల్ కనిపిస్తుంది.'} />
          {bool('ai.image_enabled') ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ModelField
                label={en ? 'Image model' : 'ఇమేజ్ మోడల్'}
                hint={en ? 'Blank uses the adapter default.' : 'ఖాళీ అయితే అడాప్టర్ డిఫాల్ట్.'}
                choices={models('ai.image_model')}
                value={str('ai.image_model')}
                onChange={(id) => set('ai.image_model', id)}
                disabled={!bool('ai.enabled') || !keySet}
              />
            </div>
          ) : null}
        </Section>

        {/* ------------------------------------------------ hourly crawl -- */}
        {/* Every crawl.* setting lives on its own tab beside the sources it
            governs. Save below sends only what changed on this page, so it
            cannot overwrite a crawl value set there. */}
        <Section
          title={en ? 'Crawl' : 'క్రాల్'}
          subtitle={en
            ? 'Crawl hours, how often, how many, which districts and the safety checks are set with the content sources.'
            : 'క్రాల్ వేళలు, ఎంత తరచుగా, ఎన్ని, ఏ జిల్లాలు, భద్రతా తనిఖీలు — ఇవన్నీ కంటెంట్ మూలాల పేజీలో.'}
        >
          <ButtonLink to="/admin/sources?tab=crawl" variant="secondary" iconRight={ChevronRight}>
            {t('admin.page.crawlSettings')}
          </ButtonLink>
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
                <option value="aimlapi">aimlapi — {keyState(voiceKeySet)}</option>
                <option value="sarvam">sarvam — {keyState(sarvamKeySet)}</option>
              </Select>
            </Field>
            <Field label={en ? 'Monthly character budget' : 'నెలవారీ అక్షరాల బడ్జెట్'}>
              <Input script="en" type="number" min={0} step={100000}
                value={num('voice.monthly_char_budget')}
                onChange={(e) => set('voice.monthly_char_budget', Number(e.target.value))} />
            </Field>
          </div>
          {/* aimlapi bills one key for text and speech, so leaving this blank
              deliberately reuses the AI key rather than demanding it twice.
              Sarvam is a separate account and has no such fallback: blank
              there means no audio, which is why the hint differs. */}
          {configuredProvider ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={voiceProvider === 'sarvam'
                  ? (en ? 'Sarvam AI API key' : 'Sarvam AI API కీ')
                  : (en ? 'Voice API key' : 'వాయిస్ API కీ')}
                hint={voiceProvider === 'sarvam'
                  ? (en
                      ? 'From the Sarvam AI dashboard. Required — it is a separate account from the AI key above. Stored encrypted; never shown again.'
                      : 'Sarvam AI డాష్‌బోర్డ్ నుండి. తప్పనిసరి — ఇది పైన ఇచ్చిన AI కీ కంటే వేరే ఖాతా. ఎన్‌క్రిప్ట్ చేసి భద్రపరుస్తాం.')
                  : (en
                      ? 'Blank reuses the AI key above. Stored encrypted; never shown again.'
                      : 'ఖాళీగా ఉంటే పైన ఇచ్చిన AI కీనే వాడుతుంది. ఎన్‌క్రిప్ట్ చేసి భద్రపరుస్తాం.')}
              >
                <Input script="en" type="password" autoComplete="off" spellCheck={false}
                  placeholder={voiceProvider === 'sarvam'
                    ? (sarvamKeySet ? '••••••••' : 'sk_…')
                    : (voiceKeySet ? '••••••••' : (en ? 'reuses the AI key' : 'AI కీనే వాడుతుంది'))}
                  value={str('voice.api_key')}
                  onChange={(e) => set('voice.api_key', e.target.value)} />
              </Field>
              <ModelField
                label={en ? 'Speech model' : 'స్పీచ్ మోడల్'}
                hint={voiceProvider === 'sarvam'
                  ? (en ? 'Blank uses bulbul:v2.' : 'ఖాళీ అయితే bulbul:v2.')
                  : (en ? 'Blank uses openai/gpt-4o-mini-tts.' : 'ఖాళీ అయితే openai/gpt-4o-mini-tts.')}
                choices={speechModels}
                value={speechModel?.id ?? ''}
                onChange={(id) => set('voice.model', id)}
              />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={en ? 'Synthesis language' : 'సంశ్లేషణ భాష'}>
              <Input script="en" autoComplete="off" placeholder="te-IN"
                value={str('voice.language')}
                onChange={(e) => set('voice.language', e.target.value)} />
            </Field>
            {/* A model that takes no voice — minimax, hume — 400s when sent
                one, so the field goes away rather than sitting there dead. */}
            {voiceOptions && voiceOptions.length === 0 ? null : (
              <Field
                label={en ? 'Voice name' : 'వాయిస్ పేరు'}
                hint={voiceOptions
                  ? (en ? 'Only the voices the chosen speech model accepts. Another vendor’s voice is rejected outright.'
                        : 'ఎంచుకున్న స్పీచ్ మోడల్ అంగీకరించే వాయిస్‌లు మాత్రమే. వేరే వెండర్ వాయిస్ తిరస్కరించబడుతుంది.')
                  : (en ? 'Provider-specific, e.g. alloy for aimlapi.' : 'ప్రొవైడర్‌ను బట్టి మారుతుంది, ఉదా: alloy.')}
              >
                {voiceOptions ? (
                  <Select value={str('voice.voice_name')} onChange={(e) => set('voice.voice_name', e.target.value)}>
                    {voiceOptions.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                    {str('voice.voice_name') && !voiceOptions.includes(str('voice.voice_name')) ? (
                      <option value={str('voice.voice_name')}>{str('voice.voice_name')}</option>
                    ) : null}
                  </Select>
                ) : (
                  <Input script="en" autoComplete="off" placeholder="alloy"
                    value={str('voice.voice_name')}
                    onChange={(e) => set('voice.voice_name', e.target.value)} />
                )}
              </Field>
            )}
          </div>
          {/* Telugu bulletin references. What these carry is the PACE — the
              difference between ETV's measured read and TV9's headline read is
              real and it is the part worth copying. The speaker attached to
              each is a first pick to audition, not a likeness, and no preset
              reproduces a named journalist's voice. Audition on the Voice
              screen, then change the speaker and keep the pace. */}
          {presets.length ? (
            <div className="rounded-xl border border-rule bg-canvas p-3">
              <p className={cn(s.body, 'text-meta font-semibold text-muted')}>
                {en ? 'Telugu bulletin references' : 'తెలుగు బులెటిన్ రిఫరెన్స్‌లు'}
              </p>
              <p className={cn(s.body, 'mt-1 text-muted', s.te ? 'text-te-body-xs' : 'text-ui')}>
                {en
                  ? 'A starting point for the read, not an imitation of any presenter. Each sets the article voice and the pace below; bulletins read in their slot’s own anchor voice.'
                  : 'ఇవి చదివే శైలికి ప్రారంభ బిందువు మాత్రమే — ఏ యాంకర్‌నూ అనుకరించవు. ప్రతి ఎంపిక కింది వార్తల వాయిస్‌ను, వేగాన్ని సెట్ చేస్తుంది; బులెటిన్లు ఆ స్లాట్ సొంత వాయిస్‌లో వినిపిస్తాయి.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {presets.map((p) => {
                  const active = str('voice.voice_name') === p.speaker && num('voice.speed') === p.pace;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      title={`${p.note} (${p.speaker}, ${p.pace}x)`}
                      onClick={() => {
                        set('voice.voice_name', p.speaker);
                        set('voice.speed', p.pace);
                      }}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-ui font-sans',
                        active ? 'border-ink bg-ink text-canvas' : 'border-rule text-ink hover:bg-rule/30',
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={en ? 'Speaking pace' : 'మాట్లాడే వేగం'}
              hint={en
                ? '1.0 is the voice’s own. Around 0.9 reads as a bulletin; above 1.1 reads as a headline block.'
                : '1.0 అంటే వాయిస్ సహజ వేగం. 0.9 దగ్గర బులెటిన్‌లా, 1.1 పైన హెడ్‌లైన్‌లా వినిపిస్తుంది.'}
            >
              <Input script="en" type="number" min={0.25} max={4} step={0.01}
                value={num('voice.speed')}
                onChange={(e) => set('voice.speed', Number(e.target.value))} />
            </Field>
          </div>
          <Switch checked={bool('voice.article_tts_enabled')} onChange={(v) => set('voice.article_tts_enabled', v)}
            disabled={!bool('voice.enabled')}
            label={en ? 'Read full articles aloud' : 'కథనాలను పూర్తిగా చదవండి'} />
          <Switch checked={bool('voice.backfill_enabled')} onChange={(v) => set('voice.backfill_enabled', v)}
            disabled={!bool('voice.enabled')}
            label={en ? 'Nightly backfill of older stories' : 'పాత కథనాలకు రాత్రిపూట ఆడియో'}
            hint={en
              ? 'Spends the character budget on the archive. Leave off unless the budget allows it.'
              : 'ఇది ఆర్కైవ్‌పై బడ్జెట్ ఖర్చు చేస్తుంది. బడ్జెట్ ఉంటేనే ఆన్ చేయండి.'} />
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
          <Field label={en ? 'Pages per edition' : 'ఎడిషన్‌కు పేజీలు'} hint={en ? '1–24. A generate can override it for the day.' : '1–24. జనరేట్ చేసేటప్పుడు ఆ రోజుకు మార్చవచ్చు.'} className="max-w-xs">
            <Input script="en" type="number" min={1} max={24} value={num('epaper.page_count')} onChange={(e) => set('epaper.page_count', Number(e.target.value))} />
          </Field>
          <Switch checked={bool('epaper.audio_enabled')} onChange={(v) => set('epaper.audio_enabled', v)} label={en ? 'Audio edition' : 'ఆడియో ఎడిషన్'} />
          <Switch checked={bool('voice.article_tts_enabled')} onChange={(v) => set('voice.article_tts_enabled', v)} label={en ? 'Article TTS' : 'కథనం TTS'} />
          <Switch checked={bool('epaper.personalized_enabled')} onChange={(v) => set('epaper.personalized_enabled', v)} label={en ? 'Personalized E-Paper' : 'వ్యక్తిగత ఈ-పేపర్'} />
          <Switch checked={bool('polls.enabled')} onChange={(v) => set('polls.enabled', v)} label={en ? 'Polls and Big Question' : 'పోల్స్ మరియు బిగ్ క్వశ్చన్'} />
          <Switch checked={bool('ai.research_enabled')} onChange={(v) => set('ai.research_enabled', v)} disabled={!bool('ai.enabled')} label={en ? 'AI web research' : 'AI వెబ్ పరిశోధన'} hint={en ? 'Lets Sanjaya search the web and write deal and research articles (Perplexity Sonar, about ₹0.6 per search).' : 'సంజయ వెబ్‌లో వెతికి, డీల్స్ మరియు పరిశోధన కథనాలు రాయడానికి (Perplexity Sonar, ఒక్కో శోధనకు సుమారు ₹0.6).'} />
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

        {/* ----------------------------------------------- audio bulletins -- */}
        <Section
          title={en ? 'Audio bulletins' : 'ఆడియో బులెటిన్లు'}
          subtitle={en
            ? 'A short spoken round-up built from the top stories, on a schedule.'
            : 'ప్రధాన వార్తలతో తయారయ్యే చిన్న ఆడియో సమాహారం, నిర్ణీత వేళల్లో.'}
        >
          {bool('bulletin.enabled') && str('voice.provider') === 'local' ? (
            <p className={note}>
              {en
                ? 'The voice provider is set to “local”, which cannot synthesise — bulletins will fail until a real TTS provider is chosen above.'
                : 'వాయిస్ ప్రొవైడర్ “local” — ఇది ఆడియో తయారు చేయలేదు.'}
            </p>
          ) : null}
          <Switch checked={bool('bulletin.enabled')} onChange={(v) => set('bulletin.enabled', v)}
            label={en ? 'Enable audio bulletins' : 'ఆడియో బులెటిన్లు ఆన్'}
            hint={en
              ? 'Each is recorded 15 minutes early in its slot’s anchor voice and airs on the hour, no approval. Off means none is built or aired.'
              : 'ప్రతి బులెటిన్ 15 నిమిషాల ముందే ఆ స్లాట్ వాయిస్‌లో రికార్డై, సమయానికి ఆమోదం లేకుండా ప్రసారమవుతుంది. ఆఫ్ అయితే బులెటిన్ తయారు కాదు.'} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={en ? 'Target length (seconds)' : 'లక్ష్య నిడివి (సెకన్లు)'}>
              <Input script="en" type="number" min={30} max={900}
                value={num('bulletin.target_seconds')}
                onChange={(e) => set('bulletin.target_seconds', Number(e.target.value))} />
            </Field>
            <Field label={en ? 'Stories per bulletin' : 'బులెటిన్కు కథనాలు'}>
              <Input script="en" type="number" min={1} max={30}
                value={num('bulletin.story_limit')}
                onChange={(e) => set('bulletin.story_limit', Number(e.target.value))} />
            </Field>
          </div>
        </Section>

        {/* ---------------------------------------------------- branding -- */}
        <Section
          title={en ? 'Branding' : 'బ్రాండింగ్'}
          subtitle={en
            ? 'Site colours for readers and this panel. Lighter and darker shades and dark mode are worked out automatically. Keep Primary and Breaking dark enough for white text on them.'
            : 'పాఠకులకు, ఈ ప్యానెల్‌కు రంగులు. తేలిక/ముదురు షేడ్‌లు, డార్క్ మోడ్ ఆటోమేటిక్‌గా వస్తాయి. ప్రధాన, బ్రేకింగ్ రంగులపై తెల్లని అక్షరాలు కనబడేంత ముదురుగా ఉంచండి.'}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {BRAND_KEYS.map((b) => {
              const fallback = String(payload.specs.find((sp) => sp.key === b.key)?.default ?? '');
              return (
                <Field key={b.key} label={en ? b.en : b.te} hint={en ? b.hintEn : b.hintTe}>
                  <div className="flex items-center gap-2">
                    <Input script="en" type="color" className="w-14 shrink-0 cursor-pointer p-1"
                      value={str(b.key) || fallback} onChange={(e) => set(b.key, e.target.value)} />
                    <span className="font-mono text-meta text-muted">{str(b.key)}</span>
                    {str(b.key) !== fallback ? (
                      <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => set(b.key, fallback)}>
                        {en ? 'Default' : 'డిఫాల్ట్'}
                      </Button>
                    ) : null}
                  </div>
                </Field>
              );
            })}
          </div>
        </Section>

        {/* ------------------------------------------------ §13 push ------ */}
        <Section
          title={en ? 'Push notifications' : 'పుష్ నోటిఫికేషన్లు'}
          subtitle={en
            ? 'Alerts on readers’ phones through Expo. Compose and see delivery under Notifications.'
            : 'Expo ద్వారా పాఠకుల ఫోన్లకు అలర్ట్‌లు. నోటిఫికేషన్ల పేజీలో పంపండి, ఫలితం చూడండి.'}
        >
          <Switch checked={bool('push.enabled')} onChange={(v) => set('push.enabled', v)}
            label={en ? 'Send push notifications' : 'పుష్ నోటిఫికేషన్లు పంపండి'}
            hint={en
              ? 'Off keeps the in-app inbox and holds scheduled pushes; anything sent meanwhile stays inbox-only.'
              : 'ఆఫ్ అయితే యాప్ ఇన్‌బాక్స్‌కే; షెడ్యూల్ చేసినవి ఆగుతాయి.'} />
          <Field
            label={en ? 'Expo access token' : 'Expo యాక్సెస్ టోకెన్'}
            optionalLabel
            className="max-w-md"
            hint={en
              ? 'Only if “Enhanced push security” is on in the Expo project. Stored encrypted; never shown again.'
              : 'Expo ప్రాజెక్ట్‌లో “Enhanced push security” ఆన్ అయితేనే. ఎన్‌క్రిప్ట్ చేసి భద్రపరుస్తాం.'}
          >
            <Input script="en" type="password" autoComplete="off" spellCheck={false}
              placeholder={payload.values['push.expo_access_token'] ? '••••••••' : (en ? 'not needed by default' : 'సాధారణంగా అవసరం లేదు')}
              value={str('push.expo_access_token')}
              onChange={(e) => set('push.expo_access_token', e.target.value)} />
          </Field>
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

        <div className="sticky bottom-dock z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-surface px-4 py-3 md:-mx-6 md:px-6">
          {dirty ? <Badge tone="partial" className="mr-auto">{t('admin.unsaved')}</Badge> : null}
          <Button variant="secondary" icon={RotateCcw} disabled={!dirty || save.isPending} onClick={() => setDraft(payload.values)}>
            {en ? 'Reset' : 'రీసెట్'}
          </Button>
          {/* Only the keys changed here: sending the whole draft let a stale
              copy of this page write back values moved elsewhere since. */}
          <Button icon={Save} pending={save.isPending} onClick={() => save.mutate(
            Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(payload.values[k]))),
          )}>
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
