import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ImagePlus, LogIn, Mail, Pencil, Phone, Send, ShieldCheck, UserRound, X } from 'lucide-react';

import { LocationPicker } from '@/components/location/LocationPicker';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PageContainer } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import * as authApi from '@/features/auth/api';
import * as creatorApi from '@/features/creator/api';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import {
  MAX_VILLAGE_PHOTOS,
  MY_VILLAGE_PATH,
  MY_VILLAGE_SLUG,
  PHOTO_KINDS,
  PUBLISH_STAGES,
  SPECIALITIES,
  STORY_PROMPTS,
} from './myVillage';

/**
 * `/my-village/share` — Share Your Village, the process document's Steps 2–8:
 * village details → specialities → the story → photos → your details →
 * preview & submit → thank-you. One step per screen with Back / Next and a
 * progress bar, so it is quick on a phone.
 *
 * The story is filed as a reader submission in the my-village-story section,
 * so it lands in the existing review queue (CMS → Review) and follows Step 9:
 * Submitted → Under review → Approved → Published. Submitting needs a signed-in
 * reader; a guest fills everything in and the draft (not the photos) is kept
 * in this tab while they sign in. Photos are uploaded only for verified
 * contributors — the same rule as every reader submission.
 */

const DRAFT_KEY = 'wow.village-draft';
const MIN_STORY = 100;
/** The profile-picture route takes up to 4 MB (users.py upload_avatar). */
const MAX_WRITER_PHOTO_BYTES = 4 * 1024 * 1024;
/** Village photos: the submission photo route takes up to 15 MB (UPLOAD_IMAGE_MAX_BYTES). */
const MAX_VILLAGE_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_STORY = 5000;
const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Draft {
  village: string;
  state: string | null;
  district: string;
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

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The step to come back to after signing in (sessionStorage, read once). */
const STEP_KEY = 'wow.village-step';
function takeSavedStep(): number {
  try {
    const raw = sessionStorage.getItem(STEP_KEY);
    sessionStorage.removeItem(STEP_KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
  } catch {
    return 0;
  }
}
function saveStep(step: number): void {
  try {
    sessionStorage.setItem(STEP_KEY, String(step));
  } catch {
    /* private mode */
  }
}

function saveDraft(draft: Draft | null): void {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode: the draft just isn't kept */
  }
}

interface Photo {
  file: File;
  kind: string;
  preview: string;
}

const STEPS = [
  { te: 'గ్రామ వివరాలు', en: 'Village details' },
  { te: 'ప్రత్యేకతలు', en: 'Specialities' },
  { te: 'మీ ఊరి కథ', en: 'Your story' },
  { te: 'ఫొటోలు', en: 'Photos' },
  { te: 'మీ వివరాలు', en: 'Your details' },
  { te: 'ప్రివ్యూ', en: 'Preview' },
] as const;

export default function ShareVillagePage() {
  const { language } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const L = (teText: string, enText: string) => (te ? teText : enText);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');
  useDocumentTitle(L('మీ ఊరి కథ పంపండి · మై విలేజ్', 'Share Your Village · My Village'));

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const status = useAuth((auth) => auth.status);
  const me = useAuth((auth) => auth.me);
  const bootstrap = useAuth((auth) => auth.bootstrap);

  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [step, setStep] = useState(takeSavedStep);
  const [tried, setTried] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  // The writer's own photo: becomes their profile picture on submit, shown
  // with the story's byline. An existing profile picture counts.
  const [writerPhoto, setWriterPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [writerPhotoError, setWriterPhotoError] = useState<string | null>(null);
  const savedAvatar = me?.user.avatar_url ?? null;
  const writerPicture = writerPhoto?.preview ?? savedAvatar;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Keep the draft while the reader types, so a sign-in round trip loses nothing.
  useEffect(() => saveDraft(draft), [draft]);
  // Free the photo previews when they go.
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), [photos]);
  useEffect(() => () => (writerPhoto ? URL.revokeObjectURL(writerPhoto.preview) : undefined), [writerPhoto]);
  // A signed-in reader starts with the name on their account.
  const accountName = me?.user.name_te || me?.user.name_en || '';
  useEffect(() => {
    if (accountName) setDraft((d) => (d.name.trim() ? d : { ...d, name: accountName }));
  }, [accountName]);

  const config = useQuery({ queryKey: ['public', 'config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const mandals = useQuery({
    queryKey: ['public', 'mandals', draft.district],
    queryFn: () => publicApi.fetchDistrictMandals(draft.district),
    enabled: Boolean(draft.district),
    staleTime: 3_600_000,
  });
  // Any signed-in reader may add village photos (backend
  // submission_service.OPEN_PHOTO_CATEGORIES); a guest signs in first so the
  // photos are not lost on the way to the login page.
  const canAttachPhotos = status === 'authenticated';
  const [photoError, setPhotoError] = useState<string | null>(null);

  const place = useMemo(() => {
    const state = config.data?.states.find((x) => x.code === draft.state);
    const district = config.data?.districts.find((x) => x.slug === draft.district);
    const mandal = mandals.data?.find((x) => x.slug === draft.mandal);
    return {
      state: state?.name_te ?? draft.state ?? '',
      district: district?.name_te ?? draft.district,
      mandal: mandal?.name_te ?? (draft.mandal || draft.mandalText.trim()),
    };
  }, [config.data, mandals.data, draft.state, draft.district, draft.mandal, draft.mandalText]);
  // No mandal list for this district yet: the reader types the mandal instead.
  const typeMandal =
    Boolean(draft.district) && !mandals.isFetching && (mandals.isError || (mandals.isSuccess && mandals.data.length === 0));

  const errorsByStep: Array<Record<string, string | null>> = [
    {
      village: draft.village.trim().length < 2 ? L('గ్రామం పేరు రాయండి.', 'Enter the village name.') : null,
      district: !draft.district ? L('రాష్ట్రం, జిల్లా ఎంచుకోండి.', 'Choose the state and district.') : null,
      mandal:
        draft.district && !(typeMandal ? draft.mandalText.trim().length >= 2 : draft.mandal)
          ? L('మండలం ఎంచుకోండి / రాయండి.', 'Choose or enter the mandal.')
          : null,
      pin: draft.pin.trim() && !PIN.test(draft.pin.trim()) ? L('6 అంకెల పిన్‌కోడ్ ఇవ్వండి.', 'Enter a 6-digit PIN code.') : null,
    },
    {
      specialities: !draft.specialities.length ? L('కనీసం ఒక అంశం ఎంచుకోండి.', 'Choose at least one.') : null,
    },
    {
      story:
        draft.story.trim().length < MIN_STORY
          ? L(`కనీసం ${MIN_STORY} అక్షరాల్లో రాయండి.`, `Write at least ${MIN_STORY} characters.`)
          : null,
    },
    {},
    {
      name: draft.name.trim().length < 3 ? L('మీ పూర్తి పేరు రాయండి.', 'Enter your full name.') : null,
      writerPhoto: !writerPicture ? L('మీ ఫొటో జోడించండి.', 'Add your photo.') : null,
      phone: !PHONE.test(draft.phone.trim()) ? L('10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.', 'Enter a 10-digit mobile number.') : null,
      email: draft.email.trim() && !EMAIL.test(draft.email.trim()) ? L('సరైన ఇమెయిల్ ఇవ్వండి.', 'Enter a valid email.') : null,
      consent: !draft.consent ? L('అనుమతి ధృవీకరణ అవసరం.', 'Please confirm.') : null,
    },
    {},
  ];
  const errors = errorsByStep[step] ?? {};
  const stepValid = Object.values(errors).every((e) => e === null);
  const show = (key: string) => (tried ? (errors[key] ?? null) : null);

  const go = (to: number) => {
    setTried(false);
    setStep(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const next = () => {
    setTried(true);
    if (stepValid) go(step + 1);
  };

  const submit = useMutation({
    mutationFn: async () => {
      const specialities = SPECIALITIES.filter((sp) => draft.specialities.includes(sp.value));
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
        `రచయిత ఫొటో: ${writerPhoto ? 'కొత్తగా జోడించారు (ప్రొఫైల్ ఫొటో)' : savedAvatar ? 'ప్రొఫైల్ ఫొటో' : 'లేదు'}`,
        `మొబైల్: ${draft.phone.trim()}`,
        `ఇమెయిల్: ${draft.email.trim() || 'ఇవ్వలేదు'}`,
        `పేరు ప్రచురించవచ్చు: ${draft.showName ? 'అవును' : 'వద్దు'}`,
      ].join('\n');
      const created = await creatorApi.submitArticle({
        title_te: `మై విలేజ్: ${draft.village.trim()} (${place.district})`,
        body_te: body,
        category_slug: MY_VILLAGE_SLUG,
        district_slug: draft.district || null,
        accept_guidelines: true,
      });
      if (writerPhoto) {
        try {
          await authApi.uploadAvatar(writerPhoto.file);
          void bootstrap();
        } catch {
          toast.error(L('మీ ఫొటో అప్‌లోడ్ కాలేదు — కథనం మాత్రం అందింది.', 'Your photo did not upload — the story itself was received.'));
        }
      }
      if (canAttachPhotos) {
        let failed = 0;
        for (const p of photos) {
          try {
            await creatorApi.attachSubmissionPhoto(created.id, p.file);
          } catch {
            failed += 1;
          }
        }
        if (failed) {
          toast.error(
            L(`${failed} ఫొటో(లు) అప్‌లోడ్ కాలేదు — కథనం మాత్రం అందింది.`, `${failed} photo(s) did not upload — the story itself was received.`),
          );
        }
      }
      return created;
    },
    onSuccess: () => {
      saveDraft(null);
      setDraft(EMPTY);
      setPhotos([]);
      setWriterPhoto(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => toast.error(e),
  });

  const onSubmit = () => {
    if (submit.isPending) return;
    if (status !== 'authenticated') {
      saveDraft(draft);
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    submit.mutate();
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_VILLAGE_PHOTOS - photos.length;
    const all = Array.from(files);
    const ok = all.filter((f) => f.type.startsWith('image/') && f.size <= MAX_VILLAGE_PHOTO_BYTES);
    setPhotoError(
      ok.length < all.length
        ? L('కొన్ని ఫైళ్లు వదిలేశాం — ఫొటోలు (JPG/PNG/WebP) 15 MB లోపు మాత్రమే.', 'Some files were skipped — photos (JPG/PNG/WebP) under 15 MB only.')
        : all.length > room
          ? L(`గరిష్ఠంగా ${MAX_VILLAGE_PHOTOS} ఫొటోలు మాత్రమే.`, `At most ${MAX_VILLAGE_PHOTOS} photos.`)
          : null,
    );
    const added = ok.slice(0, room).map((file) => ({ file, kind: PHOTO_KINDS[0]!.value, preview: URL.createObjectURL(file) }));
    setPhotos((list) => [...list, ...added]);
  };

  const signInForPhotos = () => {
    saveDraft(draft);
    saveStep(3);
    navigate('/login', { state: { from: location.pathname } });
  };

  const pickWriterPhoto = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setWriterPhotoError(L('ఫొటో (JPG/PNG) మాత్రమే ఎంచుకోండి.', 'Choose a photo (JPG/PNG).'));
      return;
    }
    if (file.size > MAX_WRITER_PHOTO_BYTES) {
      setWriterPhotoError(L('ఫొటో 4 MB లోపు ఉండాలి.', 'The photo must be under 4 MB.'));
      return;
    }
    setWriterPhotoError(null);
    setWriterPhoto({ file, preview: URL.createObjectURL(file) });
  };

  // Step 8 — thank you.
  if (submit.isSuccess) {
    return (
      <PageContainer width="page" className="py-8 md:py-12">
        <Card padding="lg" className="space-y-5 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-pill bg-success-tint text-success">
            <Icon icon={CheckCircle2} size="lg" />
          </span>
          <h1 lang="en" className="font-serif text-headline-lg font-bold text-ink">
            Thank You for Sharing Your Village Story!
          </h1>
          <p lang="te" className="te text-te-body-sm font-semibold text-ink">
            మీ ఊరి కథను పంపినందుకు ధన్యవాదాలు!
          </p>
          <p lang="te" className="te mx-auto max-w-prose text-te-body-xs text-ink-soft">
            మీ కథనాన్ని మా ఎడిటోరియల్ టీమ్ పరిశీలించిన తర్వాత WOW INDIAN – My Village విభాగంలో ప్రచురిస్తాం.
          </p>
          <ol className="mx-auto grid max-w-2xl gap-3 pt-2 text-left sm:grid-cols-2">
            {PUBLISH_STAGES.map((stage, i) => (
              <li key={stage.en} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-pill',
                    i === 0 ? 'bg-gradient-to-br from-wow to-wow-deep text-on-wow' : 'bg-paper-sub text-muted',
                  )}
                >
                  <Icon icon={i === 0 ? Check : stage.icon} size="xs" />
                </span>
                <span className={cn(bodyCls, i === 0 ? 'font-semibold text-ink' : 'text-muted')}>
                  {te ? stage.te : stage.en}
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <ButtonLink to="/submit" variant="secondary">
              {L('స్థితి చూడండి', 'Track status')}
            </ButtonLink>
            <ButtonLink to={MY_VILLAGE_PATH} variant="wow">
              {L('మరిన్ని గ్రామాలు చూడండి', 'Explore more villages')}
            </ButtonLink>
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="page" className="space-y-6 py-6 md:py-10">
      <Link
        to={MY_VILLAGE_PATH}
        className={cn(s.body, 'inline-flex min-h-tap items-center gap-1.5 rounded-pill pr-3 text-ui-sm font-semibold text-ink-soft hover:text-ink')}
      >
        <Icon icon={ArrowLeft} size="sm" />
        {L('మై విలేజ్', 'My Village')}
      </Link>

      <header className="space-y-1">
        <h1 lang={s.language} className={cn(s.head, 'text-headline-lg font-bold text-ink')}>
          {L('మీ ఊరి కథ పంపండి', 'Share Your Village')}
        </h1>
        <p className={cn(bodyCls, 'text-ink-soft')}>
          {L('కొన్ని నిమిషాల్లో మీ ఊరి గొప్పతనాన్ని మాతో పంచుకోండి.', 'Share what makes your village great in a few minutes.')}
        </p>
      </header>

      {/* Progress */}
      <nav aria-label={L('దశలు', 'Steps')}>
        <p className={cn(s.body, 'mb-2 text-ui-sm font-semibold text-ink-soft')}>
          {L(`దశ ${step + 1} / ${STEPS.length}`, `Step ${step + 1} of ${STEPS.length}`)} ·{' '}
          <span className="text-ink">{te ? STEPS[step]!.te : STEPS[step]!.en}</span>
        </p>
        <ol className="grid grid-cols-6 gap-1.5">
          {STEPS.map((st, i) => (
            <li key={st.en} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">{te ? st.te : st.en}</span>
              <span
                aria-hidden
                className={cn(
                  'block h-1.5 rounded-pill transition-colors duration-base',
                  i < step ? 'bg-wow-deep' : i === step ? 'bg-gradient-to-r from-wow to-wow-deep' : 'bg-paper-sub',
                )}
              />
            </li>
          ))}
        </ol>
      </nav>

      <Card as="section" padding="lg" className="space-y-5">
        {step === 0 ? (
          <>
            <Field label={L('గ్రామం పేరు', 'Village name')} required error={show('village')}>
              <Input
                id="village-name"
                script="te"
                value={draft.village}
                maxLength={120}
                onChange={(e) => set('village', e.target.value)}
                placeholder={L('ఉదా: పెదపూడి', 'e.g. Pedapudi')}
              />
            </Field>
            <div>
              <LocationPicker
                levels="mandal"
                layout="stack"
                required
                value={{ state: draft.state, district: draft.district, mandal: draft.mandal }}
                onChange={(next) =>
                  setDraft((d) => ({
                    ...d,
                    state: next.state ?? null,
                    district: next.district ?? '',
                    mandal: next.mandal ?? '',
                  }))
                }
              />
              {typeMandal ? (
                <Field label={L('మండలం', 'Mandal')} required className="mt-4">
                  <Input
                    id="village-mandal"
                    script="te"
                    value={draft.mandalText}
                    maxLength={120}
                    onChange={(e) => set('mandalText', e.target.value)}
                  />
                </Field>
              ) : null}
              {show('district') || show('mandal') ? (
                <p role="alert" className={cn(s.body, 'mt-1 text-ui-sm text-breaking')}>
                  {show('district') ?? show('mandal')}
                </p>
              ) : null}
            </div>
            <Field label={L('పిన్‌కోడ్', 'PIN code')} error={show('pin')} hint={L('ఐచ్ఛికం', 'Optional')}>
              <Input
                id="village-pin"
                inputMode="numeric"
                maxLength={6}
                value={draft.pin}
                onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))}
                placeholder="5xxxxx"
              />
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <fieldset>
            <legend className={cn(s.head, 'mb-1 text-headline-xs font-bold text-ink')}>
              {L('మీ గ్రామం ప్రత్యేకత ఏమిటి?', 'What makes your village special?')}
            </legend>
            <p className={cn(bodyCls, 'mb-4 text-muted')}>{L('ఒకటి లేదా అంతకంటే ఎక్కువ ఎంచుకోండి.', 'Choose one or more.')}</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {SPECIALITIES.map((sp) => {
                const on = draft.specialities.includes(sp.value);
                return (
                  <button
                    key={sp.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set('specialities', on ? draft.specialities.filter((v) => v !== sp.value) : [...draft.specialities, sp.value])
                    }
                    className={cn(
                      'flex min-h-tap items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors duration-base',
                      on ? 'border-wow-deep bg-wow-tint' : 'border-rule bg-surface hover:border-wow',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                        on ? 'bg-gradient-to-br from-wow to-wow-deep text-on-wow' : 'bg-paper-sub text-ink-soft',
                      )}
                    >
                      <Icon icon={on ? Check : sp.icon} size="sm" />
                    </span>
                    <span className="min-w-0">
                      <span lang="te" className="te block text-te-body-xs font-bold text-ink">
                        {sp.te}
                      </span>
                      <span className="block font-sans text-meta text-muted">{sp.en}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {show('specialities') ? (
              <p role="alert" className={cn(s.body, 'mt-2 text-ui-sm text-breaking')}>
                {show('specialities')}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {step === 2 ? (
          <>
            <div className="rounded-xl border-l-4 border-wow bg-wow-tint/60 p-4">
              <p className={cn(s.body, 'mb-2 text-ui-sm font-bold text-wow-deep')}>{L('ఈ ప్రశ్నలు సహాయపడతాయి', 'These questions can help')}</p>
              <ul className="list-disc space-y-1 pl-5">
                {STORY_PROMPTS.map((q) => (
                  <li key={q.en} className={cn(bodyCls, 'text-ink')}>
                    {te ? q.te : q.en}
                  </li>
                ))}
              </ul>
            </div>
            <Field
              label={L('మీ ఊరి కథ', 'Your village story')}
              required
              error={show('story')}
              hint={L(`కనీసం ${MIN_STORY} అక్షరాలు`, `At least ${MIN_STORY} characters`)}
            >
              <Textarea
                id="village-story"
                script="te"
                rows={10}
                value={draft.story}
                counter={MAX_STORY}
                onChange={(e) => set('story', e.target.value.slice(0, MAX_STORY))}
                placeholder={L('మీ ఊరి గురించి రాయండి…', 'Write about your village…')}
              />
            </Field>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div>
              <h2 className={cn(s.head, 'text-headline-xs font-bold text-ink')}>{L('గ్రామ ఫొటోలు జోడించండి', 'Add village photos')}</h2>
              <p className={cn(bodyCls, 'text-muted')}>
                {L(
                  `గరిష్ఠంగా ${MAX_VILLAGE_PHOTOS} ఫొటోలు. ప్రతి ఫొటో దేనిదో ఎంచుకోండి. ఫొటోలు లేకపోతే ఈ దశ దాటవేయవచ్చు.`,
                  `Up to ${MAX_VILLAGE_PHOTOS} photos. Say what each one shows. No photos? You can skip this step.`,
                )}
              </p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {PHOTO_KINDS.map((k) => (
                <li key={k.value} className={cn(s.body, 'inline-flex items-center gap-1.5 rounded-pill bg-paper-sub px-3 py-1 text-meta text-ink-soft')}>
                  <Icon icon={k.icon} size="xs" />
                  {te ? k.te : k.en}
                </li>
              ))}
            </ul>
            {photos.length ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((p, i) => (
                  <li key={p.preview} className="space-y-2 rounded-xl border border-rule bg-surface p-2">
                    <div className="relative overflow-hidden rounded-lg">
                      <img src={p.preview} alt="" className="aspect-[4/3] w-full object-cover" />
                      <button
                        type="button"
                        aria-label={L('ఫొటో తీసేయండి', 'Remove photo')}
                        onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                        className="absolute right-1 top-1 flex h-tap w-tap items-center justify-center rounded-pill bg-overlay/70 text-on-ink"
                      >
                        <Icon icon={X} size="sm" />
                      </button>
                    </div>
                    <Select
                      aria-label={L('ఈ ఫొటో దేనిది?', 'What does this photo show?')}
                      value={p.kind}
                      onChange={(e) => setPhotos((list) => list.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                    >
                      {PHOTO_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {te ? k.te : k.en}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            ) : null}
            {!canAttachPhotos ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-wow/50 bg-wow-tint p-6 text-center">
                <Icon icon={ImagePlus} size="lg" className="text-wow-deep" />
                <p className={cn(bodyCls, 'font-semibold text-ink')}>
                  {L('ఫొటోలు జోడించడానికి సైన్ ఇన్ చేయండి.', 'Sign in to add photos.')}
                </p>
                <p className={cn(bodyCls, 'text-ink-soft')}>
                  {L('మీరు రాసింది సేవ్ అవుతుంది — సైన్ ఇన్ తర్వాత ఇక్కడికే తిరిగి వస్తారు.', 'What you wrote is kept — you come back right here after signing in.')}
                </p>
                <Button variant="wow" icon={LogIn} onClick={signInForPhotos}>
                  {L('సైన్ ఇన్ చేసి ఫొటోలు జోడించండి', 'Sign in and add photos')}
                </Button>
              </div>
            ) : photos.length < MAX_VILLAGE_PHOTOS ? (
              <label className="group flex min-h-tap cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-wow/50 bg-wow-tint p-6 text-center transition-colors duration-base hover:border-wow focus-within:border-wow">
                <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep text-on-wow shadow-card">
                  <Icon icon={ImagePlus} size="md" />
                </span>
                <span className={cn(bodyCls, 'font-semibold text-ink')}>
                  {L('ఫొటోలు ఎంచుకోండి', 'Choose photos')} ({photos.length}/{MAX_VILLAGE_PHOTOS})
                </span>
                <span className={cn(s.body, 'text-ui-sm text-muted')}>{L('JPG, PNG, WebP · 15 MB లోపు', 'JPG, PNG, WebP · under 15 MB')}</span>
                <input
                  id="village-photos"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            ) : null}
            {photoError ? (
              <p role="alert" className={cn(s.body, 'text-ui-sm text-breaking')}>
                {photoError}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 4 ? (
          <>
            {/* About you: the writer's photo and name, as they appear with the story. */}
            <section
              aria-labelledby="writer-heading"
              className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-brand-deep to-brand-dark p-5 text-on-ink shadow-raised md:p-6"
            >
              <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 -z-10 h-48 w-48 rounded-full bg-wow/30 blur-3xl" />
              <h2 id="writer-heading" className={cn(s.head, 'text-headline-xs font-bold')}>
                {L('ఈ కథ రాస్తున్నది ఎవరు?', 'Who is writing this story?')}
              </h2>
              <p className={cn(bodyCls, 'mt-1 text-on-ink/80')}>
                {L('మీ పేరు, ఫొటో కథనంతో పాటు కనిపిస్తాయి.', 'Your name and photo appear with the story.')}
              </p>

              <div className="mt-5 flex flex-col items-center gap-5 md:flex-row md:items-center">
                <label
                  htmlFor="writer-photo"
                  className="group relative block h-28 w-28 shrink-0 cursor-pointer rounded-pill ring-4 ring-wow/70 ring-offset-4 ring-offset-brand-deep transition-transform duration-base hover:scale-[1.02] motion-reduce:transform-none"
                >
                  {writerPicture ? (
                    <img src={writerPicture} alt={L('మీ ఫొటో', 'Your photo')} className="h-full w-full rounded-pill object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center rounded-pill bg-on-ink/10 text-on-ink/70">
                      <Icon icon={UserRound} size="lg" />
                    </span>
                  )}
                  <span className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-pill bg-gradient-to-br from-wow to-wow-deep text-on-wow shadow-card">
                    <Icon icon={Camera} size="sm" />
                  </span>
                  <span className="sr-only">{writerPicture ? L('ఫొటో మార్చండి', 'Change photo') : L('ఫొటో జోడించండి', 'Add photo')}</span>
                </label>
                <input
                  id="writer-photo"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    pickWriterPhoto(e.target.files);
                    e.target.value = '';
                  }}
                />

                <div className="w-full min-w-0 flex-1 space-y-3">
                  <Field label={L('మీ పూర్తి పేరు', 'Your full name')} required error={show('name')} className="[&_label]:text-on-ink">
                    <Input
                      id="sender-name"
                      script="te"
                      value={draft.name}
                      maxLength={120}
                      onChange={(e) => set('name', e.target.value)}
                      placeholder={L('ఉదా: రాముడు కొండా', 'e.g. Ramudu Konda')}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor="writer-photo"
                      className={cn(
                        s.body,
                        'inline-flex min-h-tap cursor-pointer items-center gap-1.5 rounded-pill bg-on-ink/15 px-4 text-ui-sm font-semibold text-on-ink transition-colors duration-base hover:bg-on-ink/25',
                      )}
                    >
                      <Icon icon={Camera} size="sm" />
                      {writerPicture ? L('ఫొటో మార్చండి', 'Change photo') : L('మీ ఫొటో జోడించండి', 'Add your photo')}
                    </label>
                    {writerPhoto ? (
                      <Button variant="ghost" size="sm" icon={X} className="text-on-ink hover:bg-on-ink/15" onClick={() => setWriterPhoto(null)}>
                        {L('తీసివేయండి', 'Remove')}
                      </Button>
                    ) : null}
                  </div>
                  {writerPhotoError || show('writerPhoto') ? (
                    <p role="alert" className={cn(s.body, 'text-ui-sm font-semibold text-wow')}>
                      {writerPhotoError ?? show('writerPhoto')}
                    </p>
                  ) : (
                    <p className={cn(s.body, 'text-ui-sm text-on-ink/70')}>
                      {L('ముఖం స్పష్టంగా కనిపించే ఫొటో, 4 MB లోపు.', 'A clear photo of your face, under 4 MB.')}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* How we reach you (never published). */}
            <div className="space-y-3">
              <h2 className={cn(s.head, 'text-headline-xs font-bold text-ink')}>{L('మిమ్మల్ని సంప్రదించడానికి', 'How we reach you')}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={L('మొబైల్ నంబర్', 'Mobile number')} required error={show('phone')}>
                  <div className="relative">
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
                      <Icon icon={Phone} size="sm" />
                    </span>
                    <Input
                      id="sender-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={10}
                      value={draft.phone}
                      onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
                      placeholder="98xxxxxxxx"
                      className="pl-10"
                    />
                  </div>
                </Field>
                <Field label={L('ఇమెయిల్', 'Email')} error={show('email')} hint={L('ఐచ్ఛికం', 'Optional')}>
                  <div className="relative">
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
                      <Icon icon={Mail} size="sm" />
                    </span>
                    <Input
                      id="sender-email"
                      type="email"
                      autoComplete="email"
                      value={draft.email}
                      onChange={(e) => set('email', e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </Field>
              </div>
              <p className={cn(s.body, 'flex items-center gap-1.5 text-ui-sm text-muted')}>
                <Icon icon={ShieldCheck} size="xs" />
                {L('మీ ఫోన్, ఇమెయిల్ ప్రచురించం — సంపాదకులు మాత్రమే చూస్తారు.', 'Your phone and email are never published — only editors see them.')}
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-wow/30 bg-wow-tint p-4">
              <Checkbox
                checked={draft.showName}
                onChange={(v) => set('showName', v)}
                label={L('కథనంతో నా పేరు, ఫొటో ప్రచురించవచ్చు.', 'My name and photo may be published with the story.')}
              />
              <Checkbox
                checked={draft.consent}
                onChange={(v) => set('consent', v)}
                label={L(
                  'ఈ వివరాలు, ఫొటోలు నిజమైనవి; వాటిని ప్రచురించే హక్కు నాకు ఉంది.',
                  'These details and photos are true, and I have the right to share them.',
                )}
              />
              {show('consent') ? (
                <p role="alert" className={cn(s.body, 'text-ui-sm text-breaking')}>
                  {show('consent')}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <div className="space-y-5">
            <PreviewBlock title={L('గ్రామం', 'Village')} onEdit={() => go(0)} editLabel={L('మార్చండి', 'Edit')}>
              <p lang="te" className="te text-te-body-sm font-bold text-ink">
                {draft.village}
              </p>
              <p className={cn(bodyCls, 'text-ink-soft')}>
                {[place.mandal, place.district, place.state].filter(Boolean).join(', ')}
                {draft.pin ? ` · ${draft.pin}` : ''}
              </p>
            </PreviewBlock>
            <PreviewBlock title={L('ప్రత్యేకతలు', 'Specialities')} onEdit={() => go(1)} editLabel={L('మార్చండి', 'Edit')}>
              <ul className="flex flex-wrap gap-2">
                {SPECIALITIES.filter((sp) => draft.specialities.includes(sp.value)).map((sp) => (
                  <li key={sp.value} className={cn(s.body, 'rounded-pill bg-wow-tint px-3 py-1 text-meta font-semibold text-wow-deep')}>
                    {te ? sp.te : sp.en}
                  </li>
                ))}
              </ul>
            </PreviewBlock>
            <PreviewBlock title={L('గ్రామ కథ', 'Village story')} onEdit={() => go(2)} editLabel={L('కథ మార్చండి', 'Edit story')}>
              <p lang="te" className="te whitespace-pre-line text-te-body-xs text-ink">
                {draft.story}
              </p>
            </PreviewBlock>
            <PreviewBlock title={L('ఫొటోలు', 'Photos')} onEdit={() => go(3)} editLabel={L('మార్చండి', 'Edit')}>
              {photos.length ? (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {photos.map((p) => (
                    <li key={p.preview}>
                      <img src={p.preview} alt="" className="aspect-square w-full rounded-lg object-cover" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={cn(bodyCls, 'text-muted')}>{L('ఫొటోలు జోడించలేదు.', 'No photos added.')}</p>
              )}
            </PreviewBlock>
            <PreviewBlock title={L('పంపినవారు', 'Submitted by')} onEdit={() => go(4)} editLabel={L('మార్చండి', 'Edit')}>
              <div className="flex items-center gap-3">
                {writerPicture ? (
                  <img src={writerPicture} alt="" className="h-14 w-14 shrink-0 rounded-pill object-cover ring-2 ring-wow/60" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-pill bg-paper-sub text-muted">
                    <Icon icon={UserRound} size="md" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className={cn(bodyCls, 'font-semibold text-ink')}>{draft.name}</p>
                  <p className={cn(bodyCls, 'text-ink-soft')}>
                    {draft.phone}
                    {draft.email ? ` · ${draft.email}` : ''}
                  </p>
                </div>
              </div>
            </PreviewBlock>
          </div>
        ) : null}

        {/* Back / Next */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
          {step > 0 ? (
            <Button variant="secondary" icon={ArrowLeft} onClick={() => go(step - 1)}>
              {L('వెనక్కి', 'Back')}
            </Button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="wow" iconRight={ArrowRight} onClick={next}>
              {step === STEPS.length - 2 ? L('ప్రివ్యూ', 'Preview') : L('తర్వాత', 'Next')}
            </Button>
          ) : (
            <Button variant="wow" icon={Send} pending={submit.isPending} onClick={onSubmit}>
              {status === 'authenticated' ? L('కథనం పంపండి', 'Submit story') : L('సైన్ ఇన్ చేసి పంపండి', 'Sign in and submit')}
            </Button>
          )}
        </div>
        {step === STEPS.length - 1 && status !== 'authenticated' ? (
          <p className={cn(bodyCls, 'text-muted')}>
            {L('మీరు రాసింది సేవ్ అవుతుంది; సైన్ ఇన్ తర్వాత ఫొటోలు జోడించి పంపవచ్చు.', 'What you wrote is kept; after signing in you can add photos and send.')}
          </p>
        ) : null}
      </Card>
    </PageContainer>
  );
}

function PreviewBlock({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  onEdit: () => void;
  editLabel: string;
  children: React.ReactNode;
}) {
  const s = useScript();
  return (
    <section className="space-y-2 rounded-xl border border-rule p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn(s.head, 'text-headline-xs font-bold text-ink')}>{title}</h2>
        <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
          {editLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}
