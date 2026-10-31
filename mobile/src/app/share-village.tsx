import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { api } from '@/api/client';
import * as publicApi from '@/api/public';
import { ErrorState } from '@/components/Feedback';
import { SignInSheet } from '@/components/SignInSheet';
import { ConsentCheckbox } from '@/components/wow/ConsentCheckbox';
import { WowButton } from '@/components/wow/NominateCta';
import { useI18n } from '@/lib/i18n';
import { MAX_VILLAGE_PHOTOS, MY_VILLAGE_SLUG, PHOTO_KINDS, PUBLISH_STAGES, SPECIALITIES, STORY_PROMPTS } from '@/lib/myVillage';
import { radius, space } from '@/lib/theme';
import { makeStyles, useColors } from '@/lib/useTheme';
import { useAuth } from '@/stores/auth';
import { Button, IconButton } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip, ChipRail } from '@/ui/Chip';
import { Icon } from '@/ui/Icon';
import { Field, Input } from '@/ui/Input';
import { Screen } from '@/ui/Screen';
import { T } from '@/ui/Text';
import { useToast } from '@/ui/Toast';

/**
 * `/share-village` — Share Your Village (website: features/wow/ShareVillagePage.tsx):
 * village details → specialities → the story → photos → your details →
 * preview & submit → thank-you, one step per screen with Back / Next.
 *
 * The story is filed as a reader submission in the my-village-story section
 * (POST /users/me/submissions, the same body the website builds), so it lands
 * in the CMS review queue: Submitted → Under review → Approved → Published.
 * Submitting needs a signed-in reader; a guest's draft (not the photos) is
 * kept for the rest of the app session while they sign in. Photos are
 * uploaded only for verified contributors — the rule for every submission.
 */

const MIN_STORY = 100;
const MAX_STORY = 5000;
const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Draft {
  village: string;
  /** State code (`AP`, `TG`). */
  state: string | null;
  /** District slug. */
  district: string;
  /** Mandal slug. */
  mandal: string;
  /** Typed mandal name, for a district whose mandals are not in the list yet. */
  mandalText: string;
  pin: string;
  specialities: string[];
  story: string;
  name: string;
  phone: string;
  email: string;
  showName: boolean;
  consent: boolean;
}

const EMPTY: Draft = {
  village: '',
  state: null,
  district: '',
  mandal: '',
  mandalText: '',
  pin: '',
  specialities: [],
  story: '',
  name: '',
  phone: '',
  email: '',
  showName: true,
  consent: false,
};

/** The draft outlives the screen for the rest of the app session (a sign-in round trip loses nothing). */
let keptDraft: Draft = EMPTY;

interface Photo {
  uri: string;
  kind: string;
}

const STEPS = [
  { te: 'గ్రామ వివరాలు', en: 'Village details' },
  { te: 'ప్రత్యేకతలు', en: 'Specialities' },
  { te: 'మీ ఊరి కథ', en: 'Your story' },
  { te: 'ఫొటోలు', en: 'Photos' },
  { te: 'మీ వివరాలు', en: 'Your details' },
  { te: 'ప్రివ్యూ', en: 'Preview' },
] as const;

export default function ShareVillageScreen() {
  const styles = useStyles();
  const color = useColors();
  const { pick } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const authed = useAuth((s) => s.status === 'authenticated');

  const [draft, setDraft] = useState<Draft>(() => keptDraft);
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [signIn, setSignIn] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    keptDraft = draft;
  }, [draft]);

  const config = useQuery({ queryKey: ['config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const mandals = useQuery({
    queryKey: ['mandals', draft.district],
    queryFn: () => publicApi.fetchDistrictMandals(draft.district),
    enabled: Boolean(draft.district),
    staleTime: 3_600_000,
  });
  const contributor = useQuery({
    queryKey: ['contributor', 'me'],
    queryFn: async () => (await api.get<{ kyc_status: string }>('/users/me/contributor')).data,
    enabled: authed,
    retry: false,
    staleTime: 300_000,
  });
  const canAttachPhotos = contributor.data?.kyc_status === 'approved';

  const states = config.data?.states ?? [];
  const allDistricts = config.data?.districts ?? [];
  const chosenDistrict = allDistricts.find((d) => d.slug === draft.district);
  const stateCode = draft.state ?? chosenDistrict?.state ?? (states.length === 1 ? states[0]?.code ?? null : null);
  const districts = allDistricts.filter((d) => d.state === stateCode);

  // The place in Telugu, as the desk reads it in the submission.
  const chosenMandal = mandals.data?.find((x) => x.slug === draft.mandal);
  const place = {
    state: states.find((x) => x.code === stateCode)?.name_te ?? stateCode ?? '',
    district: chosenDistrict?.name_te ?? draft.district,
    mandal: chosenMandal?.name_te ?? (draft.mandal || draft.mandalText.trim()),
  };
  // No mandal list for this district yet: the reader types the mandal instead.
  const typeMandal =
    Boolean(draft.district) && !mandals.isFetching && (mandals.isError || (mandals.isSuccess && mandals.data.length === 0));

  const errorsByStep: Record<string, string | null>[] = [
    {
      village: draft.village.trim().length < 2 ? pick('గ్రామం పేరు రాయండి.', 'Enter the village name.') : null,
      district: !draft.district ? pick('రాష్ట్రం, జిల్లా ఎంచుకోండి.', 'Choose the state and district.') : null,
      mandal:
        draft.district && !(typeMandal ? draft.mandalText.trim().length >= 2 : draft.mandal)
          ? pick('మండలం ఎంచుకోండి / రాయండి.', 'Choose or enter the mandal.')
          : null,
      pin: draft.pin.trim() && !PIN.test(draft.pin.trim()) ? pick('6 అంకెల పిన్‌కోడ్ ఇవ్వండి.', 'Enter a 6-digit PIN code.') : null,
    },
    { specialities: !draft.specialities.length ? pick('కనీసం ఒక అంశం ఎంచుకోండి.', 'Choose at least one.') : null },
    {
      story:
        draft.story.trim().length < MIN_STORY
          ? pick(`కనీసం ${MIN_STORY} అక్షరాల్లో రాయండి.`, `Write at least ${MIN_STORY} characters.`)
          : null,
    },
    {},
    {
      name: draft.name.trim().length < 3 ? pick('మీ పూర్తి పేరు రాయండి.', 'Enter your full name.') : null,
      phone: !PHONE.test(draft.phone.trim()) ? pick('10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.', 'Enter a 10-digit mobile number.') : null,
      email: draft.email.trim() && !EMAIL.test(draft.email.trim()) ? pick('సరైన ఇమెయిల్ ఇవ్వండి.', 'Enter a valid email.') : null,
      consent: !draft.consent ? pick('అనుమతి ధృవీకరణ అవసరం.', 'Please confirm.') : null,
    },
    {},
  ];
  const errors = errorsByStep[step] ?? {};
  const stepValid = Object.values(errors).every((e) => e === null);
  const show = (key: string) => (tried ? (errors[key] ?? undefined) : undefined);

  const go = (to: number) => {
    setTried(false);
    setStep(to);
  };
  const next = () => {
    setTried(true);
    if (stepValid) go(step + 1);
  };

  const addPhotos = async () => {
    const room = MAX_VILLAGE_PHOTOS - photos.length;
    if (room <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.8,
    });
    if (result.canceled) return;
    const picked = result.assets.slice(0, room).map((a) => ({ uri: a.uri, kind: PHOTO_KINDS[0]?.value ?? 'village' }));
    setPhotos((list) => [...list, ...picked]);
  };

  const submit = useMutation({
    mutationFn: async () => {
      const specialities = SPECIALITIES.filter((sp) => draft.specialities.includes(sp.value));
      // Line for line the website's body, so the desk reads one format.
      const body = [
        `మై విలేజ్ — గ్రామ కథనం`,
        `గ్రామం: ${draft.village.trim()}`,
        `మండలం: ${place.mandal}`,
        `జిల్లా: ${place.district}`,
        `రాష్ట్రం: ${place.state}`,
        `పిన్‌కోడ్: ${draft.pin.trim() || 'ఇవ్వలేదు'}`,
        '',
        `ప్రత్యేకతలు: ${specialities.map((sp) => sp.te).join(', ')}`,
        '',
        `గ్రామ కథ:`,
        draft.story.trim(),
        '',
        photos.length
          ? `ఫొటోలు: ${photos.map((p, i) => `${i + 1}. ${PHOTO_KINDS.find((k) => k.value === p.kind)?.te ?? ''}`).join('; ')}`
          : `ఫొటోలు: జోడించలేదు`,
        '',
        `పంపినవారు: ${draft.name.trim()}`,
        `మొబైల్: ${draft.phone.trim()}`,
        `ఇమెయిల్: ${draft.email.trim() || 'ఇవ్వలేదు'}`,
        `పేరు ప్రచురించవచ్చు: ${draft.showName ? 'అవును' : 'వద్దు'}`,
      ].join('\n');
      const { data: created } = await api.post<{ id: number }>('/users/me/submissions', {
        title_te: `మై విలేజ్: ${draft.village.trim()} (${place.district})`,
        body_te: body,
        category_slug: MY_VILLAGE_SLUG,
        district_slug: draft.district || null,
        accept_guidelines: true,
      });
      if (canAttachPhotos) {
        let failed = 0;
        for (const [i, p] of photos.entries()) {
          try {
            const form = new FormData();
            // React Native's FormData takes this shape rather than a File.
            form.append('file', { uri: p.uri, name: `village-${i + 1}.jpg`, type: 'image/jpeg' } as unknown as Blob);
            await api.post(`/users/me/submissions/${created.id}/media`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
          } catch {
            failed += 1;
          }
        }
        if (failed) {
          toast.error(
            pick(`${failed} ఫొటో(లు) అప్‌లోడ్ కాలేదు — కథనం మాత్రం అందింది.`, `${failed} photo(s) did not upload — the story itself was received.`),
          );
        }
      }
      return created;
    },
    onSuccess: () => {
      keptDraft = EMPTY;
      setDraft(EMPTY);
      setPhotos([]);
      setStep(0);
      void queryClient.invalidateQueries({ queryKey: ['my-submissions'] });
    },
    onError: (e) => toast.error(e),
  });

  const onSubmit = () => {
    if (submit.isPending) return;
    if (!authed) {
      keptDraft = draft;
      setSignIn(true);
      return;
    }
    submit.mutate();
  };

  const title = pick('మీ ఊరి కథ పంపండి', 'Share Your Village');

  // Thank you.
  if (submit.isSuccess) {
    return (
      <Screen edges={['bottom']} scroll contentContainerStyle={styles.body}>
        <Stack.Screen options={{ title }} />
        <Card padding="lg" style={styles.thanks}>
          <View style={styles.thanksDisc}>
            <Icon name="checkCircle2" size={32} color={color.success} />
          </View>
          <T variant="headlineLg" weight="bold" lang="en" align="center" accessibilityRole="header">
            Thank You for Sharing Your Village Story!
          </T>
          <T variant="body" weight="semibold" lang="te" align="center">
            మీ ఊరి కథను పంపినందుకు ధన్యవాదాలు!
          </T>
          <T variant="bodySmall" color="inkSoft" lang="te" align="center">
            మీ కథనాన్ని మా ఎడిటోరియల్ టీమ్ పరిశీలించిన తర్వాత WOW INDIAN – My Village విభాగంలో ప్రచురిస్తాం.
          </T>
          <View style={styles.stages}>
            {PUBLISH_STAGES.map((stage, i) => (
              <View key={stage.en} style={styles.stage}>
                <View style={[styles.stageDisc, i === 0 ? styles.stageDone : null]}>
                  <Icon name={i === 0 ? 'check' : stage.icon} size={16} color={i === 0 ? color.onWow : color.muted} />
                </View>
                <T variant="ui" weight={i === 0 ? 'semibold' : 'regular'} color={i === 0 ? 'ink' : 'muted'}>
                  {pick(stage.te, stage.en)}
                </T>
              </View>
            ))}
          </View>
          <View style={styles.thanksActions}>
            <Button label={pick('స్థితి చూడండి', 'Track status')} variant="secondary" onPress={() => router.push('/submit')} />
            <WowButton label={pick('మరిన్ని గ్రామాలు చూడండి', 'Explore more villages')} onPress={() => router.replace('/my-village')} />
          </View>
        </Card>
      </Screen>
    );
  }

  const current = STEPS[step] ?? STEPS[0];

  return (
    <Screen edges={['bottom']} scroll keyboard contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title }} />

      <View style={styles.intro}>
        <T variant="headlineLg" weight="bold" accessibilityRole="header">
          {title}
        </T>
        <T variant="bodySmall" color="inkSoft">
          {pick('కొన్ని నిమిషాల్లో మీ ఊరి గొప్పతనాన్ని మాతో పంచుకోండి.', 'Share what makes your village great in a few minutes.')}
        </T>
      </View>

      {/* Progress */}
      <View style={styles.progress}>
        <T variant="ui" color="inkSoft">
          {pick(`దశ ${step + 1} / ${STEPS.length}`, `Step ${step + 1} of ${STEPS.length}`)} ·{' '}
          <T variant="ui" weight="semibold">
            {pick(current.te, current.en)}
          </T>
        </T>
        <View style={styles.bars} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: STEPS.length, now: step + 1 }}>
          {STEPS.map((s, i) => (
            <View key={s.en} style={[styles.bar, i <= step ? styles.barOn : null]} />
          ))}
        </View>
      </View>

      <Card padding="lg" style={styles.form}>
        {step === 0 ? (
          <>
            <Field label={pick('గ్రామం పేరు', 'Village name')} required error={show('village')}>
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
            {config.isError ? <ErrorState error={config.error} fill={false} onRetry={() => void config.refetch()} /> : null}
            <ChoiceRail label={pick('రాష్ట్రం', 'State')} required>
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
                      // Picking another state clears a district (and mandal) from the old one.
                      ...(allDistricts.find((x) => x.slug === d.district)?.state === s.code ? {} : { district: '', mandal: '', mandalText: '' }),
                    }))
                  }
                />
              ))}
            </ChoiceRail>
            {stateCode && districts.length ? (
              <ChoiceRail label={pick('జిల్లా', 'District')} required>
                {districts.map((d) => (
                  <Chip
                    key={d.slug}
                    role="radio"
                    label={pick(d.name_te, d.name_en)}
                    selected={draft.district === d.slug}
                    onPress={() => setDraft((x) => ({ ...x, state: d.state, district: d.slug, mandal: '', mandalText: '' }))}
                  />
                ))}
              </ChoiceRail>
            ) : null}
            {show('district') ? (
              <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                {show('district')}
              </T>
            ) : null}
            {draft.district ? (
              typeMandal ? (
                <Field label={pick('మండలం', 'Mandal')} required error={show('mandal')}>
                  <Input lang="te" value={draft.mandalText} maxLength={120} onChangeText={(v) => set('mandalText', v)} />
                </Field>
              ) : (
                <>
                  <ChoiceRail label={pick('మండలం', 'Mandal')} required>
                    {(mandals.data ?? []).map((m) => (
                      <Chip key={m.slug} role="radio" label={pick(m.name_te, m.name_en)} selected={draft.mandal === m.slug} onPress={() => set('mandal', m.slug)} />
                    ))}
                  </ChoiceRail>
                  {show('mandal') ? (
                    <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                      {show('mandal')}
                    </T>
                  ) : null}
                </>
              )
            ) : null}
            <Field label={`${pick('పిన్‌కోడ్', 'PIN code')} (${pick('ఐచ్ఛికం', 'optional')})`} error={show('pin')}>
              <Input
                lang="en"
                keyboardType="number-pad"
                maxLength={6}
                value={draft.pin}
                onChangeText={(v) => set('pin', v.replace(/\D/g, ''))}
                placeholder="5xxxxx"
              />
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <View style={styles.group}>
            <T variant="headlineSm" weight="bold">
              {pick('మీ గ్రామం ప్రత్యేకత ఏమిటి?', 'What makes your village special?')}
            </T>
            <T variant="bodySmall" color="muted">
              {pick('ఒకటి లేదా అంతకంటే ఎక్కువ ఎంచుకోండి.', 'Choose one or more.')}
            </T>
            <View style={styles.chips}>
              {SPECIALITIES.map((sp) => {
                const on = draft.specialities.includes(sp.value);
                return (
                  <Chip
                    key={sp.value}
                    icon={sp.icon}
                    label={pick(sp.te, sp.en)}
                    selected={on}
                    onPress={() =>
                      setDraft((d) => ({
                        ...d,
                        specialities: d.specialities.includes(sp.value)
                          ? d.specialities.filter((v) => v !== sp.value)
                          : [...d.specialities, sp.value],
                      }))
                    }
                  />
                );
              })}
            </View>
            {show('specialities') ? (
              <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                {show('specialities')}
              </T>
            ) : null}
          </View>
        ) : null}

        {step === 2 ? (
          <>
            <View style={styles.prompts}>
              <T variant="ui" weight="bold" color="wowDeep">
                {pick('ఈ ప్రశ్నలు సహాయపడతాయి', 'These questions can help')}
              </T>
              {STORY_PROMPTS.map((q) => (
                <T key={q.en} variant="bodySmall" color="inkSoft">
                  • {pick(q.te, q.en)}
                </T>
              ))}
            </View>
            <Field
              label={pick('మీ ఊరి కథ', 'Your village story')}
              required
              error={show('story')}
              hint={pick(`కనీసం ${MIN_STORY} అక్షరాలు`, `At least ${MIN_STORY} characters`)}
            >
              <Input
                lang="te"
                multiline
                value={draft.story}
                counter={MAX_STORY}
                onChangeText={(v) => set('story', v.slice(0, MAX_STORY))}
                placeholder={pick('మీ ఊరి గురించి రాయండి…', 'Write about your village…')}
              />
            </Field>
          </>
        ) : null}

        {step === 3 ? (
          <View style={styles.group}>
            <T variant="headlineSm" weight="bold">
              {pick('గ్రామ ఫొటోలు జోడించండి', 'Add village photos')}
            </T>
            <T variant="bodySmall" color="muted">
              {canAttachPhotos
                ? pick(`గరిష్ఠంగా ${MAX_VILLAGE_PHOTOS} ఫొటోలు. ప్రతి ఫొటో దేనిదో ఎంచుకోండి.`, `Up to ${MAX_VILLAGE_PHOTOS} photos. Say what each one shows.`)
                : pick(
                    'ఫొటోలు ధృవీకరించిన రచయితలు మాత్రమే అప్‌లోడ్ చేయగలరు. లేదంటే ఈ దశ దాటవేయండి — మా సంపాదకులు మిమ్మల్ని సంప్రదించి ఫొటోలు తీసుకుంటారు.',
                    'Only verified contributors can upload photos. Otherwise skip this step — an editor will contact you for them.',
                  )}
            </T>
            {canAttachPhotos ? (
              <>
                {photos.map((p, i) => (
                  <View key={p.uri} style={styles.photo}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" accessible={false} />
                    <View style={styles.photoKinds}>
                      <View style={styles.chips}>
                        {PHOTO_KINDS.map((k) => (
                          <Chip
                            key={k.value}
                            role="radio"
                            label={pick(k.te, k.en)}
                            selected={p.kind === k.value}
                            onPress={() => setPhotos((list) => list.map((x, j) => (j === i ? { ...x, kind: k.value } : x)))}
                          />
                        ))}
                      </View>
                    </View>
                    <IconButton
                      name="x"
                      label={pick('ఫొటో తీసేయండి', 'Remove photo')}
                      onPress={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                    />
                  </View>
                ))}
                <Button
                  label={`${pick('ఫొటోలు ఎంచుకోండి', 'Choose photos')} (${photos.length}/${MAX_VILLAGE_PHOTOS})`}
                  variant="secondary"
                  icon="image"
                  disabled={photos.length >= MAX_VILLAGE_PHOTOS}
                  onPress={() => void addPhotos()}
                />
              </>
            ) : null}
          </View>
        ) : null}

        {step === 4 ? (
          <>
            <Field label={pick('పూర్తి పేరు', 'Full name')} required error={show('name')}>
              <Input lang="te" leading="user" value={draft.name} maxLength={120} autoCapitalize="words" onChangeText={(v) => set('name', v)} />
            </Field>
            <Field label={pick('మొబైల్ నంబర్', 'Mobile number')} required error={show('phone')}>
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
            <Field label={`${pick('ఇమెయిల్', 'Email')} (${pick('ఐచ్ఛికం', 'optional')})`} error={show('email')}>
              <Input
                lang="en"
                leading="mail"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                value={draft.email}
                onChangeText={(v) => set('email', v)}
              />
            </Field>
            <View style={styles.group}>
              <ConsentCheckbox
                checked={draft.showName}
                onChange={(v) => set('showName', v)}
                label={pick('కథనంతో నా పేరు ప్రచురించవచ్చు.', 'My name may be published with the story.')}
              />
              <ConsentCheckbox
                checked={draft.consent}
                onChange={(v) => set('consent', v)}
                invalid={Boolean(show('consent'))}
                label={pick(
                  'ఈ వివరాలు, ఫొటోలు నిజమైనవి; వాటిని ప్రచురించే హక్కు నాకు ఉంది.',
                  'These details and photos are true, and I have the right to share them.',
                )}
              />
              {show('consent') ? (
                <T variant="meta" color="breaking" accessibilityLiveRegion="polite">
                  {show('consent')}
                </T>
              ) : null}
            </View>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <PreviewBlock title={pick('గ్రామం', 'Village')} onEdit={() => go(0)}>
              <T variant="body" weight="semibold">
                {draft.village}
              </T>
              <T variant="bodySmall" color="inkSoft">
                {[place.mandal, place.district, place.state, draft.pin.trim()].filter(Boolean).join(', ')}
              </T>
            </PreviewBlock>
            <PreviewBlock title={pick('ప్రత్యేకతలు', 'Specialities')} onEdit={() => go(1)}>
              <View style={styles.chips}>
                {SPECIALITIES.filter((sp) => draft.specialities.includes(sp.value)).map((sp) => (
                  <Chip key={sp.value} icon={sp.icon} label={pick(sp.te, sp.en)} selected />
                ))}
              </View>
            </PreviewBlock>
            <PreviewBlock title={pick('గ్రామ కథ', 'Village story')} onEdit={() => go(2)}>
              <T variant="bodySmall" lang="auto">
                {draft.story.trim()}
              </T>
            </PreviewBlock>
            <PreviewBlock title={pick('ఫొటోలు', 'Photos')} onEdit={() => go(3)}>
              {photos.length && canAttachPhotos ? (
                <View style={styles.thumbs}>
                  {photos.map((p) => (
                    <Image key={p.uri} source={{ uri: p.uri }} style={styles.thumbSmall} contentFit="cover" accessible={false} />
                  ))}
                </View>
              ) : (
                <T variant="bodySmall" color="muted">
                  {pick('ఫొటోలు జోడించలేదు.', 'No photos added.')}
                </T>
              )}
            </PreviewBlock>
            <PreviewBlock title={pick('పంపినవారు', 'Submitted by')} onEdit={() => go(4)}>
              <T variant="bodySmall">{[draft.name.trim(), draft.phone.trim(), draft.email.trim()].filter(Boolean).join(' · ')}</T>
            </PreviewBlock>
          </>
        ) : null}

        <View style={styles.nav}>
          {step > 0 ? (
            <Button label={pick('వెనక్కి', 'Back')} variant="secondary" icon="arrowLeft" onPress={() => go(step - 1)} />
          ) : (
            <View />
          )}
          {step < STEPS.length - 1 ? (
            <WowButton
              label={step === STEPS.length - 2 ? pick('ప్రివ్యూ', 'Preview') : pick('తర్వాత', 'Next')}
              iconRight="arrowRight"
              onPress={next}
            />
          ) : (
            <WowButton
              label={authed ? pick('కథనం పంపండి', 'Submit story') : pick('సైన్ ఇన్ చేసి పంపండి', 'Sign in and submit')}
              icon="send"
              pending={submit.isPending}
              onPress={onSubmit}
            />
          )}
        </View>
        {step === STEPS.length - 1 && !authed ? (
          <T variant="meta" color="muted" align="center">
            {pick('మీరు రాసింది సేవ్ అవుతుంది; ఫొటోలు మళ్లీ జోడించాలి.', 'What you wrote is kept; photos need adding again.')}
          </T>
        ) : null}
      </Card>

      <SignInSheet open={signIn} onClose={() => setSignIn(false)} />
    </Screen>
  );
}

/** A label over a sideways rail of chips that runs to the card's edges. */
function ChoiceRail({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <T variant="ui" weight="semibold">
        {label}
        {required ? (
          <T variant="ui" weight="semibold" color="breaking" lang="en">
            {' *'}
          </T>
        ) : null}
      </T>
      <ChipRail style={styles.bleed} contentContainerStyle={styles.railPad}>
        {children}
      </ChipRail>
    </View>
  );
}

function PreviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  const styles = useStyles();
  const { pick } = useI18n();
  return (
    <View style={styles.preview}>
      <View style={styles.previewHead}>
        <T variant="ui" weight="bold" color="wowDeep" style={styles.flex}>
          {title}
        </T>
        <Button label={pick('మార్చండి', 'Edit')} variant="ghost" icon="pencil" onPress={onEdit} />
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  body: { padding: space.lg, paddingBottom: space.xxl, gap: space.lg },
  intro: { gap: space.xs },
  progress: { gap: space.sm },
  bars: { flexDirection: 'row', gap: space.xs },
  bar: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: color.rule },
  barOn: { backgroundColor: color.wowDeep },
  form: { gap: space.lg },
  group: { gap: space.sm },
  /** Lets a chip rail run to the card's edges while its first chip lines up with the fields. */
  bleed: { marginHorizontal: -space.xl },
  railPad: { paddingHorizontal: space.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  prompts: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: color.wowTint },
  photo: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: color.rule },
  thumb: { width: 72, height: 72, borderRadius: radius.sm },
  photoKinds: { flex: 1, minWidth: 0 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumbSmall: { width: 64, height: 64, borderRadius: radius.sm },
  preview: { gap: space.xs, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: color.rule },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md },
  thanks: { gap: space.md, alignItems: 'stretch' },
  thanksDisc: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.successTint,
  },
  stages: { gap: space.sm, paddingTop: space.sm },
  stage: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stageDisc: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.paperSub },
  stageDone: { backgroundColor: color.wowDeep },
  thanksActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, paddingTop: space.sm },
}));
