import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api/client';
import * as publicApi from '@/api/public';
import { ErrorState } from '@/components/Feedback';
import { SignInSheet } from '@/components/SignInSheet';
import { WowButton } from '@/components/wow/NominateCta';
import { useI18n } from '@/lib/i18n';
import { radius, space, TAP } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useSiteContent } from '@/lib/siteContent';
import { LOCAL_HERO_SLUG } from '@/lib/wow';
import { useAuth } from '@/stores/auth';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip, ChipRail } from '@/ui/Chip';
import { Icon, type IconName } from '@/ui/Icon';
import { Field, Input } from '@/ui/Input';
import { PressableScale } from '@/ui/PressableScale';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * Nominate Your Local Hero (pitch §4) — the app's copy of the website's
 * frontend/src/features/wow/NominatePage.tsx.
 *
 * A nomination is filed as a reader submission in the Local Hero section
 * (POST /users/me/submissions, the same body the website builds), so it lands
 * in the existing CMS → Review queue: submit → editorial verification and
 * consent review → story preparation → publication. Nothing is published
 * without an editor's approval.
 *
 * Submissions need a signed-in reader. A guest can fill the whole form; on
 * "Send" the draft is kept in memory (the website keeps it in sessionStorage)
 * while the sign-in sheet takes them to Profile, and is restored if this
 * screen is opened again.
 *
 * Not ported: the website's optional hero photo upload, which only
 * KYC-approved contributors can use — editors collect a photo otherwise.
 */

const MIN_REASON = 80;
const MAX_REASON = 3000;
const PHONE = /^[6-9]\d{9}$/;

interface Draft {
  name: string;
  village: string;
  /** State code (`AP`, `TG`). */
  state: string | null;
  /** District slug. */
  district: string;
  category: string;
  reason: string;
  phone: string;
  consent: boolean;
}

const EMPTY: Draft = {
  name: '',
  village: '',
  state: null,
  district: '',
  category: '',
  reason: '',
  phone: '',
  consent: false,
};

/** The draft outlives the screen for the rest of the app session (a sign-in round trip loses nothing). */
let keptDraft: Draft = EMPTY;

const STEPS: readonly { icon: IconName; te: string; en: string }[] = [
  { icon: 'pencil', te: 'నామినేషన్ పంపండి', en: 'Submit nomination' },
  { icon: 'search', te: 'సంపాదకీయ ధృవీకరణ, అనుమతి సమీక్ష', en: 'Editorial verification and consent review' },
  { icon: 'award', te: 'కథనం సిద్ధం', en: 'Story preparation' },
  { icon: 'megaphone', te: 'ప్రచురణ, షేరింగ్', en: 'Publication and sharing' },
];

export default function NominateScreen() {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const authed = useAuth((s) => s.status === 'authenticated');

  const [draft, setDraft] = useState<Draft>(() => keptDraft);
  const [tried, setTried] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    keptDraft = draft;
  }, [draft]);

  // Same cache key as LocationRails, so the place cascade shares a warm cache.
  const config = useQuery({ queryKey: ['config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const states = config.data?.states ?? [];
  const allDistricts = config.data?.districts ?? [];
  const chosenDistrict = allDistricts.find((d) => d.slug === draft.district);
  const stateCode = draft.state ?? chosenDistrict?.state ?? (states.length === 1 ? states[0].code : null);
  const districts = allDistricts.filter((d) => d.state === stateCode);
  const districtName = chosenDistrict ? chosenDistrict.name_te : draft.district;
  // The choices the desk set in CMS → Site content → Nominate form.
  const heroCategories = useSiteContent().nominate.categories;
  const heroCategory = heroCategories.find((c) => c.value === draft.category);

  const errors = {
    name: draft.name.trim().length < 3 ? pick('హీరో పూర్తి పేరు రాయండి.', "Enter the hero's full name.") : null,
    village: draft.village.trim().length < 2 ? pick('ఊరు / పట్టణం రాయండి.', 'Enter the village or town.') : null,
    district: !draft.district ? pick('జిల్లా ఎంచుకోండి.', 'Choose the district.') : null,
    category: !draft.category ? pick('హీరో విభాగం ఎంచుకోండి.', 'Choose a hero category.') : null,
    reason:
      draft.reason.trim().length < MIN_REASON
        ? pick(`కనీసం ${MIN_REASON} అక్షరాల్లో వివరించండి.`, `Explain in at least ${MIN_REASON} characters.`)
        : null,
    phone:
      draft.phone.trim() && !PHONE.test(draft.phone.trim())
        ? pick('10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.', 'Enter a 10-digit mobile number.')
        : null,
    consent: !draft.consent ? pick('అనుమతి ధృవీకరణ అవసరం.', 'Please confirm consent.') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (e: string | null) => (tried && e ? e : undefined);

  const submit = useMutation({
    mutationFn: async () => {
      // Line for line the website's body, so the desk reads one format.
      const body = [
        `లోకల్ హీరో నామినేషన్`,
        `హీరో పేరు: ${draft.name.trim()}`,
        `ఊరు / పట్టణం: ${draft.village.trim()}`,
        `జిల్లా: ${districtName}`,
        `విభాగం: ${heroCategory ? `${heroCategory.te} (${heroCategory.en})` : draft.category}`,
        '',
        `ఎందుకు గుర్తింపు పొందాలి:`,
        draft.reason.trim(),
        '',
        `నామినేట్ చేసినవారి ఫోన్: ${draft.phone.trim() || 'ఇవ్వలేదు'}`,
        `అనుమతి: హీరో అనుమతితో ఫోటో, వివరాలు పంపినట్లు నామినేటర్ ధృవీకరించారు.`,
      ].join('\n');
      const { data } = await api.post<{ id: number }>('/users/me/submissions', {
        title_te: `లోకల్ హీరో: ${draft.name.trim()} (${draft.village.trim()})`,
        body_te: body,
        category_slug: LOCAL_HERO_SLUG,
        district_slug: draft.district || null,
        accept_guidelines: true,
      });
      return data;
    },
    onSuccess: () => {
      keptDraft = EMPTY;
      setDraft(EMPTY);
      setTried(false);
      toast.success(pick('నామినేషన్ అందింది. ధన్యవాదాలు!', 'Nomination received. Thank you!'));
      void queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
    },
    onError: (e) => toast.error(e),
  });

  const onSend = () => {
    setTried(true);
    if (submit.isPending) return;
    if (!valid) {
      toast.error(pick('గుర్తించిన వివరాలను సరిచేయండి.', 'Please fix the highlighted fields.'));
      return;
    }
    if (!authed) {
      keptDraft = draft;
      setSignIn(true);
      return;
    }
    submit.mutate();
  };

  const title = pick('లోకల్ హీరోను నామినేట్ చేయండి', 'Nominate Your Local Hero');

  return (
    <Screen edges={['bottom']} scroll keyboard contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title }} />

      <View style={styles.intro}>
        <View style={styles.eyebrow}>
          <Icon name="award" size={16} color={color.wowDeep} />
          <T variant="eyebrow" color="wowDeep">
            {pick('సిగ్నేచర్ ఫీచర్', 'Signature feature')}
          </T>
        </View>
        <T variant="headlineLg" weight="bold" accessibilityRole="header">
          {title}
        </T>
        <T variant="bodySmall" color="inkSoft" scaled>
          {pick(
            'మీ ఊరి హీరోను ప్రపంచానికి పరిచయం చేయండి! ఉపాధ్యాయులు, రైతులు, ఆవిష్కర్తలు, సామాజిక సేవకులు, విద్యార్థులు, గ్రామ వాలంటీర్లు — మంచి మార్పు తెస్తున్న ఎవరినైనా నామినేట్ చేయవచ్చు.',
            'Introduce your village hero to the world! Nominate teachers, farmers, innovators, social workers, students, village volunteers — anyone making a positive impact.',
          )}
        </T>
      </View>

      {submit.isSuccess ? (
        <Card tone="paper" padding="lg" style={styles.success}>
          <View style={styles.row}>
            <View style={styles.successDisc}>
              <Icon name="checkCircle2" size={24} color={color.success} />
            </View>
            <View style={styles.rowText}>
              <T variant="headlineSm" weight="bold" accessibilityRole="header">
                {pick('నామినేషన్ అందింది. ధన్యవాదాలు!', 'Nomination received. Thank you!')}
              </T>
              <T variant="bodySmall" color="muted">
                {pick(
                  'మా సంపాదకులు వివరాలు ధృవీకరించి, అనుమతి తీసుకున్న తర్వాతే కథనం ప్రచురిస్తారు. స్థితిని "మీ కథనం పంపండి" పేజీలో చూడవచ్చు.',
                  'Our editors verify the details and confirm consent before any story is published. Track it on the Submit page.',
                )}
              </T>
              <View style={styles.successActions}>
                <Button
                  label={pick('స్థితి చూడండి', 'Track status')}
                  variant="secondary"
                  icon="fileText"
                  onPress={() => router.push('/submit')}
                />
                <Button
                  label={pick('మరొకరిని నామినేట్ చేయండి', 'Nominate someone else')}
                  variant="ghost"
                  icon="plus"
                  onPress={() => submit.reset()}
                />
              </View>
            </View>
          </View>
        </Card>
      ) : (
        <Card padding="lg" style={styles.form}>
          <Field label={pick('హీరో పూర్తి పేరు', "Hero's full name")} required error={show(errors.name)}>
            <Input
              lang="te"
              leading="user"
              value={draft.name}
              maxLength={120}
              autoCapitalize="words"
              onChangeText={(v) => set('name', v)}
              placeholder={pick('ఉదా: కె. లక్ష్మి', 'e.g. K. Lakshmi')}
            />
          </Field>

          <Field label={pick('ఊరు / పట్టణం', 'Village / Town')} required error={show(errors.village)}>
            <Input
              lang="te"
              leading="mapPin"
              value={draft.village}
              maxLength={120}
              autoCapitalize="words"
              onChangeText={(v) => set('village', v)}
              placeholder={pick('ఉదా: పెదపూడి', 'e.g. Pedapudi')}
            />
          </Field>

          {/* State → district, the website's LocationPicker at levels="district". */}
          <View style={styles.group}>
            {config.isError ? (
              <ErrorState error={config.error} fill={false} onRetry={() => void config.refetch()} />
            ) : null}
            <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={pick('రాష్ట్రం', 'State')}>
              <T variant="ui" weight="semibold">
                {pick('రాష్ట్రం', 'State')}
                <T variant="ui" weight="semibold" color="breaking" lang="en">
                  {' *'}
                </T>
              </T>
              <ChipRail style={styles.bleed} contentContainerStyle={styles.railPad}>
                {states.map((s) => (
                  <Chip
                    key={s.code}
                    role="radio"
                    label={pick(s.name_te, s.name_en)}
                    selected={stateCode === s.code}
                    onPress={() =>
                      setDraft((d) => ({
                        ...d,
                        state: s.code,
                        // Picking another state clears a district from the old one.
                        district: allDistricts.find((x) => x.slug === d.district)?.state === s.code ? d.district : '',
                      }))
                    }
                  />
                ))}
              </ChipRail>
            </View>
            {stateCode && districts.length ? (
              <View
                style={styles.group}
                accessibilityRole="radiogroup"
                accessibilityLabel={pick('జిల్లా', 'District')}
              >
                <T variant="ui" weight="semibold">
                  {pick('జిల్లా', 'District')}
                  <T variant="ui" weight="semibold" color="breaking" lang="en">
                    {' *'}
                  </T>
                </T>
                <ChipRail style={styles.bleed} contentContainerStyle={styles.railPad}>
                  {districts.map((d) => (
                    <Chip
                      key={d.slug}
                      role="radio"
                      label={pick(d.name_te, d.name_en)}
                      selected={draft.district === d.slug}
                      onPress={() => setDraft((x) => ({ ...x, state: d.state, district: d.slug }))}
                    />
                  ))}
                </ChipRail>
              </View>
            ) : null}
            {show(errors.district) ? (
              <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                {errors.district}
              </T>
            ) : null}
          </View>

          <View
            style={styles.group}
            accessibilityRole="radiogroup"
            accessibilityLabel={pick('హీరో విభాగం', 'Hero category')}
          >
            <T variant="ui" weight="semibold">
              {pick('హీరో విభాగం', 'Hero category')}
              <T variant="ui" weight="semibold" color="breaking" lang="en">
                {' *'}
              </T>
            </T>
            <View style={styles.chips}>
              {heroCategories.map((c) => (
                <Chip
                  key={c.value}
                  role="radio"
                  label={pick(c.te, c.en)}
                  selected={draft.category === c.value}
                  onPress={() => set('category', c.value)}
                />
              ))}
            </View>
            {show(errors.category) ? (
              <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                {errors.category}
              </T>
            ) : null}
          </View>

          <Field
            label={pick('ఈ వ్యక్తి ఎందుకు గుర్తింపు పొందాలి?', 'Why does this person deserve recognition?')}
            required
            error={show(errors.reason)}
            hint={pick(`కనీసం ${MIN_REASON} అక్షరాలు`, `At least ${MIN_REASON} characters`)}
          >
            <Input
              lang="te"
              multiline
              value={draft.reason}
              counter={MAX_REASON}
              onChangeText={(v) => set('reason', v.slice(0, MAX_REASON))}
              placeholder={pick(
                'వారు ఏం చేశారు, ఎంతమందికి సహాయపడ్డారు, ఎన్నాళ్లుగా చేస్తున్నారు…',
                'What they did, how many people it helped, for how long…',
              )}
            />
          </Field>

          <Field
            label={`${pick('మీ ఫోన్ నంబర్', 'Your contact number')} (${pick('ఐచ్ఛికం', 'optional')})`}
            error={show(errors.phone)}
            hint={pick(
              'సంపాదకులు ధృవీకరణ కోసం మాత్రమే వాడతారు. ఫోటో ఉంటే సంపాదకులు మిమ్మల్ని సంప్రదిస్తారు.',
              'Used only by editors to verify. If you have a photo, an editor will collect it from you.',
            )}
          >
            <Input
              lang="en"
              leading="phone"
              keyboardType="number-pad"
              autoComplete="tel-national"
              textContentType="telephoneNumber"
              maxLength={10}
              value={draft.phone}
              onChangeText={(v) => set('phone', v.replace(/\D/g, ''))}
              placeholder="98xxxxxxxx"
            />
          </Field>

          <View style={styles.group}>
            <T variant="ui" weight="semibold">
              {pick('అనుమతి', 'Consent')}
            </T>
            <ConsentCheckbox
              checked={draft.consent}
              onChange={(v) => set('consent', v)}
              invalid={Boolean(show(errors.consent))}
              label={pick(
                'ఈ వివరాలు నిజమైనవి. హీరో పేరు, ఫోటో, కథనం ప్రచురించడానికి వారి అనుమతి ఉంది (లేదా సంపాదకులు తీసుకోవడానికి అంగీకరిస్తున్నాను).',
                'These details are true, and the hero agrees to their name, photo and story being published (or I agree that editors will ask them).',
              )}
            />
            {show(errors.consent) ? (
              <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                {errors.consent}
              </T>
            ) : null}
          </View>

          <View style={styles.send}>
            <WowButton
              full
              icon="award"
              pending={submit.isPending}
              label={
                authed
                  ? pick('నామినేషన్ పంపండి', 'Send nomination')
                  : pick('సైన్ ఇన్ చేసి పంపండి', 'Sign in and send')
              }
              onPress={onSend}
            />
            {!authed ? (
              <T variant="meta" color="muted" align="center">
                {pick('మీరు రాసింది సేవ్ అవుతుంది.', 'What you have written is kept.')}
              </T>
            ) : null}
          </View>
        </Card>
      )}

      <Card tone="paper" padding="lg" style={styles.steps}>
        <T variant="headlineSm" weight="bold" accessibilityRole="header">
          {pick('ఎలా పనిచేస్తుంది', 'How it works')}
        </T>
        {STEPS.map((step, i) => (
          <View key={step.en} style={styles.row}>
            <View style={styles.stepDisc}>
              <Icon name={step.icon} size={20} color={color.wowDeep} />
            </View>
            <View style={styles.rowText}>
              <T variant="meta" weight="bold" color="wowDeep">
                {pick(`దశ ${i + 1}`, `Step ${i + 1}`)}
              </T>
              <T variant="bodySmall" weight="semibold">
                {pick(step.te, step.en)}
              </T>
            </View>
          </View>
        ))}
      </Card>

      <Card tone="paper" padding="lg">
        <View style={styles.row}>
          <Icon name="shield" size={20} color={color.success} />
          <T variant="bodySmall" color="inkSoft" style={styles.rowText}>
            {pick(
              'ప్రతి నామినేషన్‌ను సంపాదకులు ధృవీకరిస్తారు. హీరో అనుమతి లేకుండా ఏదీ ప్రచురించం. మీ ఫోన్ నంబర్ ఎప్పుడూ ప్రచురించబడదు.',
              'Editors verify every nomination. Nothing is published without the hero’s consent, and your phone number is never published.',
            )}
          </T>
        </View>
      </Card>

      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
    </Screen>
  );
}

/** The website's `Checkbox`: a WOW-filled box with a check, the whole row tappable. */
function ConsentCheckbox({
  checked,
  onChange,
  label,
  invalid,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  invalid: boolean;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <PressableScale
      onPress={() => onChange(!checked)}
      haptic="select"
      scaleTo={0.99}
      minHeight={TAP}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={styles.check}
    >
      <View
        style={[
          styles.box,
          checked ? styles.boxOn : invalid ? { borderColor: color.breaking } : null,
        ]}
      >
        {checked ? <Icon name="check" size={16} color={color.onWow} strokeWidth={2.5} /> : null}
      </View>
      <T variant="bodySmall" color="ink" style={styles.rowText}>
        {label}
      </T>
    </PressableScale>
  );
}

const useStyles = makeStyles((color) => ({
  body: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg },
  intro: { gap: space.sm },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  form: { gap: space.lg },
  group: { gap: space.sm },
  /** Lets a chip rail run to the card's edges while its first chip lines up with the fields. */
  bleed: { marginHorizontal: -space.xl },
  railPad: { paddingHorizontal: space.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  box: {
    width: 24,
    height: 24,
    marginTop: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm - 2,
    borderWidth: 2,
    borderColor: color.ruleStrong,
    backgroundColor: color.field,
  },
  boxOn: { backgroundColor: color.wowDeep, borderColor: color.wowDeep },
  send: { gap: space.sm, marginTop: space.xs },
  success: { borderColor: color.success, borderWidth: 1 },
  successDisc: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.successTint,
  },
  successActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  steps: { gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  rowText: { flex: 1, minWidth: 0, gap: space.xs },
  stepDisc: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.wowTint,
  },
}));
