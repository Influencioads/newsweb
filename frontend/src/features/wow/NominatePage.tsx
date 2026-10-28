import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Award, CheckCircle2, FileSearch, Megaphone, PenLine, ShieldCheck } from 'lucide-react';

import { api } from '@/api/client';
import { LocationPicker } from '@/components/location/LocationPicker';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, Field, Input, inputClass, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';
import * as creatorApi from '@/features/creator/api';
import * as publicApi from '@/features/public/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

import { HERO_CATEGORIES, LOCAL_HERO_SLUG } from './categories';

/**
 * Nominate Your Local Hero (pitch §4) — "మీ లోకల్ హీరోను ప్రపంచానికి పరిచయం చేయండి!"
 *
 * A nomination is filed as a reader submission in the Local Hero section, so
 * it lands in the existing moderation queue (CMS → Review) and follows the
 * pitch's workflow without a new backend: submit → editorial verification and
 * consent review → story preparation → publication and sharing. Nothing a
 * reader sends is published without an editor's approval.
 *
 * Submissions need a signed-in reader. A guest can fill the whole form; on
 * "Send" the draft is kept in this tab (sessionStorage) while they sign in,
 * and is restored when they come back.
 */

const DRAFT_KEY = 'wow.nomination-draft';
const MIN_REASON = 80;
const MAX_REASON = 3000;
const PHONE = /^[6-9]\d{9}$/;

interface Draft {
  name: string;
  village: string;
  state: string | null;
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

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
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

const STEPS = [
  { icon: PenLine, te: 'నామినేషన్ పంపండి', en: 'Submit nomination' },
  { icon: FileSearch, te: 'సంపాదకీయ ధృవీకరణ, అనుమతి సమీక్ష', en: 'Editorial verification and consent review' },
  { icon: Award, te: 'కథనం సిద్ధం', en: 'Story preparation' },
  { icon: Megaphone, te: 'ప్రచురణ, షేరింగ్', en: 'Publication and sharing' },
];

export default function NominatePage() {
  const { language, pick } = useI18n();
  const s = useScript();
  const te = language === 'te';
  const L = (teText: string, enText: string) => (te ? teText : enText);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');
  useDocumentTitle(L('మీ లోకల్ హీరోని నామినేట్ చేయండి', 'Nominate Your Local Hero'));

  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const status = useAuth((auth) => auth.status);

  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [photo, setPhoto] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Keep the draft while the reader types, so a sign-in round trip loses nothing.
  useEffect(() => saveDraft(draft), [draft]);

  const config = useQuery({ queryKey: ['public', 'config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
  const contributor = useQuery({
    queryKey: ['contributor', 'me'],
    queryFn: async () => (await api.get<{ kyc_status: string }>('/users/me/contributor')).data,
    enabled: status === 'authenticated',
    staleTime: 300_000,
  });
  const canAttachPhoto = contributor.data?.kyc_status === 'approved';

  const districtName = (() => {
    const d = config.data?.districts.find((x) => x.slug === draft.district);
    return d ? d.name_te : draft.district;
  })();
  const heroCategory = HERO_CATEGORIES.find((c) => c.value === draft.category);

  const errors = {
    name: draft.name.trim().length < 3 ? L('హీరో పూర్తి పేరు రాయండి.', "Enter the hero's full name.") : null,
    village: draft.village.trim().length < 2 ? L('ఊరు / పట్టణం రాయండి.', 'Enter the village or town.') : null,
    district: !draft.district ? L('జిల్లా ఎంచుకోండి.', 'Choose the district.') : null,
    category: !draft.category ? L('హీరో విభాగం ఎంచుకోండి.', 'Choose a hero category.') : null,
    reason:
      draft.reason.trim().length < MIN_REASON
        ? L(`కనీసం ${MIN_REASON} అక్షరాల్లో వివరించండి.`, `Explain in at least ${MIN_REASON} characters.`)
        : null,
    phone:
      draft.phone.trim() && !PHONE.test(draft.phone.trim())
        ? L('10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.', 'Enter a 10-digit mobile number.')
        : null,
    consent: !draft.consent ? L('అనుమతి ధృవీకరణ అవసరం.', 'Please confirm consent.') : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (e: string | null) => (tried ? e : null);

  const submit = useMutation({
    mutationFn: async () => {
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
      const created = await creatorApi.submitArticle({
        title_te: `లోకల్ హీరో: ${draft.name.trim()} (${draft.village.trim()})`,
        body_te: body,
        category_slug: LOCAL_HERO_SLUG,
        district_slug: draft.district || null,
        accept_guidelines: true,
      });
      if (photo) {
        try {
          await creatorApi.attachSubmissionPhoto(created.id, photo);
        } catch {
          toast.error(L('ఫోటో అప్‌లోడ్ కాలేదు — నామినేషన్ మాత్రం అందింది.', 'The photo did not upload — the nomination itself was received.'));
        }
      }
      return created;
    },
    onSuccess: () => {
      saveDraft(null);
      setDraft(EMPTY);
      setPhoto(null);
      setTried(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => toast.error(e),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid || submit.isPending) return;
    if (status !== 'authenticated') {
      saveDraft(draft);
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    submit.mutate();
  };

  return (
    <PageContainer width="site" className="py-7 md:py-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-7">
          <PageHeader
            icon={Award}
            eyebrow={L('సిగ్నేచర్ ఫీచర్', 'Signature feature')}
            title={L('మీ లోకల్ హీరోని నామినేట్ చేయండి', 'Nominate Your Local Hero')}
            subtitle={L(
              'మీ లోకల్ హీరోను ప్రపంచానికి పరిచయం చేయండి! ఉపాధ్యాయులు, రైతులు, ఆవిష్కర్తలు, సామాజిక సేవకులు, విద్యార్థులు, గ్రామ వాలంటీర్లు — మంచి మార్పు తెస్తున్న ఎవరినైనా నామినేట్ చేయవచ్చు.',
              'Introduce your village hero to the world! Nominate teachers, farmers, innovators, social workers, students, village volunteers — anyone making a positive impact.',
            )}
            spacing="none"
          />

          {submit.isSuccess ? (
            <Card tone="paper" padding="lg" className="border-success">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-success-tint text-success">
                  <Icon icon={CheckCircle2} size="md" />
                </span>
                <div className="min-w-0 space-y-2">
                  <h2 className={cn(s.head, 'text-headline-xs font-bold text-ink')}>
                    {L('నామినేషన్ అందింది. ధన్యవాదాలు!', 'Nomination received. Thank you!')}
                  </h2>
                  <p className={cn(bodyCls, 'text-muted')}>
                    {L(
                      'మా సంపాదకులు వివరాలు ధృవీకరించి, అనుమతి తీసుకున్న తర్వాతే కథనం ప్రచురిస్తారు. స్థితిని "మీ కథనం పంపండి" పేజీలో చూడవచ్చు.',
                      'Our editors verify the details and confirm consent before any story is published. Track it on the Submit page.',
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <ButtonLink to="/submit" variant="secondary" size="sm">
                      {L('స్థితి చూడండి', 'Track status')}
                    </ButtonLink>
                    <Button variant="ghost" size="sm" onClick={() => submit.reset()}>
                      {L('మరొకరిని నామినేట్ చేయండి', 'Nominate someone else')}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          <Card as="section" padding="lg">
            <form className="space-y-5" onSubmit={onSubmit} noValidate>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={L('హీరో పూర్తి పేరు', "Hero's full name")} required error={show(errors.name)}>
                  <Input
                    id="nominee-name"
                    script="te"
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder={L('ఉదా: కె. లక్ష్మి', 'e.g. K. Lakshmi')}
                  />
                </Field>
                <Field label={L('ఊరు / పట్టణం', 'Village / Town')} required error={show(errors.village)}>
                  <Input
                    id="nominee-village"
                    script="te"
                    value={draft.village}
                    maxLength={120}
                    onChange={(e) => set('village', e.target.value)}
                    placeholder={L('ఉదా: పెదపూడి', 'e.g. Pedapudi')}
                  />
                </Field>
              </div>

              <div>
                <LocationPicker
                  levels="district"
                  required
                  value={{ state: draft.state, district: draft.district }}
                  onChange={(next) => setDraft((d) => ({ ...d, state: next.state ?? null, district: next.district ?? '' }))}
                />
                {show(errors.district) ? (
                  <p role="alert" className={cn(s.body, 'mt-1 text-ui-sm text-breaking')}>
                    {errors.district}
                  </p>
                ) : null}
              </div>

              <Field label={L('హీరో విభాగం', 'Hero category')} required error={show(errors.category)}>
                <Select id="nominee-category" value={draft.category} onChange={(e) => set('category', e.target.value)}>
                  <option value="">{L('— ఎంచుకోండి —', '— choose —')}</option>
                  {HERO_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {pick(c.te, c.en)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label={L('ఈ వ్యక్తి ఎందుకు గుర్తింపు పొందాలి?', 'Why does this person deserve recognition?')}
                required
                error={show(errors.reason)}
                hint={L(`కనీసం ${MIN_REASON} అక్షరాలు`, `At least ${MIN_REASON} characters`)}
              >
                <Textarea
                  id="nominee-reason"
                  script="te"
                  rows={6}
                  value={draft.reason}
                  counter={MAX_REASON}
                  onChange={(e) => set('reason', e.target.value.slice(0, MAX_REASON))}
                  placeholder={L(
                    'వారు ఏం చేశారు, ఎంతమందికి సహాయపడ్డారు, ఎన్నాళ్లుగా చేస్తున్నారు…',
                    'What they did, how many people it helped, for how long…',
                  )}
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={L('మీ ఫోన్ నంబర్', 'Your contact number')}
                  optionalLabel
                  error={show(errors.phone)}
                  hint={L('సంపాదకులు ధృవీకరణ కోసం మాత్రమే వాడతారు.', 'Used only by editors to verify.')}
                >
                  <Input
                    id="nominator-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    value={draft.phone}
                    onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
                    placeholder="98xxxxxxxx"
                  />
                </Field>

                <Field
                  label={L('హీరో ఫోటో', 'Hero photo')}
                  optionalLabel
                  hint={
                    canAttachPhoto
                      ? L('JPG / PNG / WebP, హీరో అనుమతితో మాత్రమే.', 'JPG / PNG / WebP, only with the hero’s permission.')
                      : L(
                          'ఫోటోలు ధృవీకరించిన రచయితలు మాత్రమే పంపగలరు. లేదంటే మా సంపాదకులు మిమ్మల్ని సంప్రదిస్తారు.',
                          'Only verified contributors can upload photos. Otherwise an editor will collect it from you.',
                        )
                  }
                >
                  <input
                    id="nominee-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!canAttachPhoto}
                    className={cn(inputClass, 'disabled:cursor-not-allowed disabled:opacity-60')}
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </Field>
              </div>

              <fieldset className="pt-1">
                <legend className={cn(s.body, 'mb-1.5 text-ui-sm font-semibold text-ink')}>
                  {L('అనుమతి', 'Consent')}
                </legend>
                <Checkbox
                  checked={draft.consent}
                  onChange={(v) => set('consent', v)}
                  label={L(
                    'ఈ వివరాలు నిజమైనవి. హీరో పేరు, ఫోటో, కథనం ప్రచురించడానికి వారి అనుమతి ఉంది (లేదా సంపాదకులు తీసుకోవడానికి అంగీకరిస్తున్నాను).',
                    'These details are true, and the hero agrees to their name, photo and story being published (or I agree that editors will ask them).',
                  )}
                />
                {show(errors.consent) ? (
                  <p role="alert" className={cn(s.body, 'mt-1 text-ui-sm text-breaking')}>
                    {errors.consent}
                  </p>
                ) : null}
              </fieldset>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button type="submit" variant="wow" size="lg" icon={Award} pending={submit.isPending}>
                  {status === 'authenticated'
                    ? L('నామినేషన్ పంపండి', 'Send nomination')
                    : L('సైన్ ఇన్ చేసి పంపండి', 'Sign in and send')}
                </Button>
                {status !== 'authenticated' ? (
                  <p className={cn(bodyCls, 'text-muted')}>
                    {L('మీరు రాసింది సేవ్ అవుతుంది.', 'What you have written is kept.')}
                  </p>
                ) : null}
              </div>
            </form>
          </Card>
        </div>

        {/* How it works */}
        <aside className="min-w-0 space-y-5 lg:pt-2">
          <Card tone="paper" padding="lg">
            <h2 className={cn(s.head, 'text-headline-sm font-bold text-ink')}>
              {L('ఎలా పనిచేస్తుంది', 'How it works')}
            </h2>
            <ol className="mt-4 space-y-4">
              {STEPS.map((step, i) => (
                <li key={step.en} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-wow-tint text-wow-deep">
                    <Icon icon={step.icon} size="sm" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-sans text-meta font-bold tabular-nums text-wow-deep">{L(`దశ ${i + 1}`, `Step ${i + 1}`)}</p>
                    <p className={cn(bodyCls, 'font-semibold text-ink')}>{te ? step.te : step.en}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card tone="paper" padding="lg">
            <div className="flex items-start gap-3">
              <Icon icon={ShieldCheck} size="md" className="mt-0.5 shrink-0 text-success" />
              <p className={cn(bodyCls, 'text-ink-soft')}>
                {L(
                  'ప్రతి నామినేషన్‌ను సంపాదకులు ధృవీకరిస్తారు. హీరో అనుమతి లేకుండా ఏదీ ప్రచురించం. మీ ఫోన్ నంబర్ ఎప్పుడూ ప్రచురించబడదు.',
                  'Editors verify every nomination. Nothing is published without the hero’s consent, and your phone number is never published.',
                )}{' '}
                <Link to="/privacy" className="font-semibold text-brand underline-offset-4 hover:underline">
                  {L('గోప్యతా విధానం', 'Privacy policy')}
                </Link>
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </PageContainer>
  );
}
