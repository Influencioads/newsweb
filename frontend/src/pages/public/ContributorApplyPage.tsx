import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, IdCard, LogIn, ShieldCheck } from 'lucide-react';

import { api } from '@/api/client';
import { StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, FileDrop, Input, Radio, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import { KYC_STATUS } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

/**
 * Becoming a contributor — the reader's side of citizen journalism, as a
 * three-step KYC stepper (who you are → documents → send for verification).
 *
 * Two things this page has to be honest about, because people are being asked
 * to hand over a government ID:
 *
 *  1. **Where the document goes.** Said in plain Telugu, above the upload, not
 *     buried in a policy page: it is stored privately, only senior editors can
 *     open it, every open is logged, and it is deleted when verification
 *     lapses.
 *  2. **What they get.** Verification raises how much they can send and puts a
 *     verified name on their byline. It does not publish anything — an editor
 *     still reads every story, exactly as before.
 */

type Status =
  | 'not_started' | 'draft' | 'submitted' | 'in_review'
  | 'more_info' | 'approved' | 'rejected' | 'expired';

interface DocumentRow {
  id: number;
  kind: string;
  number_masked: string | null;
  uploaded_at: string | null;
}

interface Application {
  id?: number;
  status: Status;
  contributor_type: string | null;
  display_name_te?: string;
  organisation?: string | null;
  portfolio_url?: string | null;
  course_year?: number | null;
  review_note?: string | null;
  verified_badge?: boolean;
  documents: DocumentRow[];
  missing: string[][];
  can_edit: boolean;
  pending_limit?: number;
}

const TYPES = [
  { value: 'citizen', te: 'పౌర విలేకరి', en: 'Citizen journalist',
    hintTe: 'మీ ప్రాంతంలో జరిగేది రాయాలనుకుంటున్నారా',
    hintEn: 'You want to report what happens where you live' },
  { value: 'freelance', te: 'ఫ్రీలాన్స్ జర్నలిస్ట్', en: 'Freelance journalist',
    hintTe: 'ప్రెస్ అక్రిడిటేషన్ లేదా పోర్ట్‌ఫోలియో అవసరం',
    hintEn: 'Needs press accreditation or a portfolio' },
  { value: 'student', te: 'విద్యార్థి జర్నలిస్ట్', en: 'Student journalist',
    hintTe: 'కళాశాల గుర్తింపు కార్డు అవసరం',
    hintEn: 'Needs a college ID' },
] as const;

const DOC_LABELS: Record<string, { te: string; en: string }> = {
  pan: { te: 'పాన్ కార్డు', en: 'PAN card' },
  voter_id: { te: 'ఓటరు గుర్తింపు కార్డు', en: 'Voter ID' },
  driving_licence: { te: 'డ్రైవింగ్ లైసెన్స్', en: 'Driving licence' },
  passport: { te: 'పాస్‌పోర్ట్', en: 'Passport' },
  selfie: { te: 'మీ ఫోటో', en: 'A photo of you' },
  press_accreditation: { te: 'ప్రెస్ అక్రిడిటేషన్', en: 'Press accreditation' },
  student_id: { te: 'కళాశాల గుర్తింపు కార్డు', en: 'College ID' },
  college_bonafide: { te: 'బోనఫైడ్ సర్టిఫికెట్', en: 'Bonafide certificate' },
};

/** What the status means for the applicant; the colour comes from KYC_STATUS. */
const STATUS_TEXT: Record<Status, { te: string; en: string }> = {
  not_started: { te: '', en: '' },
  draft: {
    te: 'మీ దరఖాస్తు ఇంకా పంపలేదు. అవసరమైన పత్రాలు జోడించి పంపండి.',
    en: 'Your application is not sent yet. Add the documents and submit.',
  },
  submitted: {
    te: 'మీ దరఖాస్తు అందింది. మా బృందం త్వరలో పరిశీలిస్తుంది.',
    en: 'We have your application. Our team will review it shortly.',
  },
  in_review: { te: 'మీ దరఖాస్తు సమీక్షలో ఉంది.', en: 'Your application is being reviewed.' },
  more_info: {
    te: 'మరికొంత సమాచారం కావాలి — కింది గమనిక చూడండి.',
    en: 'We need a little more — see the note below.',
  },
  approved: {
    te: 'మీరు ధృవీకరించబడ్డారు. ఇప్పుడు మీరు కథనాలు పంపవచ్చు.',
    en: 'You are verified. You can file stories now.',
  },
  rejected: { te: 'ఈసారి ఆమోదించలేకపోయాం. కారణం కింద ఉంది.', en: 'We could not approve this. The reason is below.' },
  expired: {
    te: 'మీ ధృవీకరణ గడువు ముగిసింది. మళ్లీ దరఖాస్తు చేయండి.',
    en: 'Your verification has lapsed. Please apply again.',
  },
};

const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/** One numbered KYC step. `done` marks it complete, `active` is where the work is. */
function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children: ReactNode }) {
  const s = useScript();
  return (
    <li>
      <Card as="section" padding="lg" className={cn(!active && !done && 'opacity-70')}>
        <div className="mb-4 flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-pill font-sans text-ui font-bold',
              done ? 'bg-success-tint text-success' : active ? 'bg-brand text-on-brand' : 'bg-rule-soft text-muted',
            )}
          >
            {done ? <Icon icon={Check} size="sm" strokeWidth={3} /> : n}
          </span>
          <h2 className={cn(s.head, 'text-headline-xs font-bold text-ink')}>{title}</h2>
        </div>
        {children}
      </Card>
    </li>
  );
}

export default function ContributorApplyPage() {
  const { language, t } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const bodyCls = cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui');
  useDocumentTitle(t('page.contributor'));

  const queryClient = useQueryClient();
  const me = useAuth((auth) => auth.me);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();

  const [type, setType] = useState<string>('citizen');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [portfolio, setPortfolio] = useState('');
  /** The one in-flight upload: preview URL for images, percentage for everything. */
  const [uploading, setUploading] = useState<{ kind: string; name: string; url: string | null; progress: number } | null>(null);

  const application = useQuery({
    queryKey: ['contributor', 'me'],
    queryFn: async () => (await api.get<Application>('/users/me/contributor')).data,
    enabled: Boolean(me),
    retry: false,
  });

  useEffect(() => {
    const data = application.data;
    if (!data) return;
    if (data.contributor_type) setType(data.contributor_type);
    if (data.display_name_te) setName(data.display_name_te);
    if (data.organisation) setOrganisation(data.organisation);
    if (data.portfolio_url) setPortfolio(data.portfolio_url);
  }, [application.data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['contributor'] });

  const save = useMutation({
    mutationFn: async () =>
      (await api.post('/users/me/contributor', {
        contributor_type: type,
        display_name_te: name,
        bio_te: bio || null,
        organisation: organisation || null,
        portfolio_url: portfolio || null,
      })).data,
    onSuccess: () => {
      toast.success(t('ui.saved'));
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  const clearUpload = () => {
    setUploading((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: string; file: File }) => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      return (
        await api.post('/users/me/contributor/documents', form, {
          onUploadProgress: (e) =>
            setUploading((current) =>
              current && e.total ? { ...current, progress: Math.round((e.loaded * 100) / e.total) } : current,
            ),
        })
      ).data;
    },
    onSuccess: () => {
      clearUpload();
      toast.success(L('పత్రం జోడించాం.', 'Document added.'));
      refresh();
    },
    onError: (e) => {
      clearUpload();
      toast.error(e);
    },
  });

  const submit = useMutation({
    mutationFn: async () => (await api.post('/users/me/contributor/submit')).data,
    onSuccess: () => {
      toast.success(L('ధృవీకరణకు పంపాం.', 'Sent for verification.'));
      refresh();
    },
    // No toast here: the failure is reported in place, next to the button.
  });

  if (!me) {
    return (
      <PageContainer width="form" className="py-7 md:py-10">
        <PageHeader icon={ShieldCheck} title={L('మాతో కలిసి రాయండి', 'Write for us')} />
        <EmptyState
          icon={LogIn}
          title={t('ui.signInToContinue')}
          body={L('దరఖాస్తు చేయడానికి సైన్ ఇన్ చేయండి.', 'Please sign in to apply.')}
          action={<ButtonLink to="/login">{t('ui.signInToContinue')}</ButtonLink>}
        />
      </PageContainer>
    );
  }

  const data = application.data;
  const status = data?.status ?? 'not_started';
  const canEdit = data?.can_edit ?? true;
  const detailsDone = Boolean(data?.id);
  const docsDone = detailsDone && data?.missing.length === 0;
  const sent = status !== 'not_started' && status !== 'draft';

  const startUpload = (kind: string, file: File | undefined) => {
    if (!file || upload.isPending) return;
    clearUpload();
    setUploading({
      kind,
      name: file.name,
      url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      progress: 0,
    });
    upload.mutate({ kind, file });
  };

  const askAndSubmit = async () => {
    const ok = await confirm({
      title: L('ధృవీకరణకు పంపాలా?', 'Send for verification?'),
      body: L(
        'పంపిన తర్వాత సమీక్ష పూర్తయ్యే వరకు మీ వివరాలు, పత్రాలు మార్చలేరు.',
        'Once sent, your details and documents are locked until the review finishes.',
      ),
      confirmLabel: L('పంపండి', 'Send'),
    });
    if (ok) submit.mutate();
  };

  return (
    <PageContainer width="form" className="space-y-7 py-7 md:space-y-10 md:py-10">
      <PageHeader
        icon={ShieldCheck}
        title={L('మాతో కలిసి రాయండి', 'Write for us')}
        subtitle={L(
          'పౌరులు, ఫ్రీలాన్స్, విద్యార్థి జర్నలిస్టులు తమ ప్రాంతం నుంచి కథనాలు పంపవచ్చు. ఒకసారి మీ గుర్తింపు ధృవీకరించుకుంటే, మీ పేరుపై అది కనిపిస్తుంది.',
          'Citizens, freelance and student journalists can file stories from their own area. Verify who you are once, and your byline carries it.',
        )}
        spacing="none"
      />

      {status !== 'not_started' ? (
        <Card tone="paper" padding="md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className={cn(bodyCls, 'min-w-0 text-ink-soft')}>{L(STATUS_TEXT[status].te, STATUS_TEXT[status].en)}</p>
            <StatusPill status={status} registry={KYC_STATUS} size="sm" />
          </div>
          {data?.review_note ? (
            <p lang="te" className="te mt-3 rounded-xl bg-paper-sub p-3 text-te-body-xs font-semibold text-ink">
              {data.review_note}
            </p>
          ) : null}
          {status === 'approved' ? (
            <ButtonLink to="/submit" size="sm" className="mt-3">
              {L('కథనం పంపండి', 'File a story')}
            </ButtonLink>
          ) : null}
        </Card>
      ) : null}

      <ol className="flex flex-col gap-5">
        <Step n={1} title={L('మీ వివరాలు', 'Your details')} done={detailsDone && !canEdit} active={canEdit}>
          {canEdit ? (
            <form className="space-y-5" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
              <fieldset>
                <legend className={cn(s.body, 'mb-2 text-ui-sm font-semibold text-ink')}>
                  {L('మీరు ఎవరిగా దరఖాస్తు చేస్తున్నారు', 'You are applying as')}
                </legend>
                <div className="flex flex-col gap-1">
                  {TYPES.map((option) => (
                    <Radio
                      key={option.value}
                      name="contributor_type"
                      value={option.value}
                      checked={type === option.value}
                      onChange={() => setType(option.value)}
                      label={L(option.te, option.en)}
                      hint={L(option.hintTe, option.hintEn)}
                    />
                  ))}
                </div>
              </fieldset>

              <Field label={L('మీ కథనాలపై కనిపించే పేరు', 'The name to print on your stories')} required>
                <Input script="te" required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>

              <Field label={L('మీ గురించి', 'About you')} optionalLabel>
                <Textarea script="te" autoGrow counter={600} value={bio} onChange={(e) => setBio(e.target.value)} />
              </Field>

              {type !== 'citizen' ? (
                <Field
                  label={
                    type === 'student'
                      ? L('మీ కళాశాల', 'Your college')
                      : L('మీరు రాసే సంస్థ', 'Outlet you write for')
                  }
                >
                  <Input script="te" value={organisation} onChange={(e) => setOrganisation(e.target.value)} />
                </Field>
              ) : null}

              {type === 'freelance' ? (
                <Field label={L('మీ రచనల లింక్', 'A link to your work')} optionalLabel>
                  <Input script="en" type="url" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} />
                </Field>
              ) : null}

              <Button type="submit" pending={save.isPending}>
                {t('ui.save')}
              </Button>
            </form>
          ) : (
            <p className={cn(bodyCls, 'text-ink-soft')}>
              {L('సమీక్ష పూర్తయ్యే వరకు వివరాలు మార్చలేరు.', 'Your details are locked while the review runs.')}
            </p>
          )}
        </Step>

        <Step n={2} title={L('మీ పత్రాలు', 'Your documents')} done={Boolean(docsDone)} active={detailsDone && !docsDone}>
          {data?.id ? (
            <div className="space-y-4">
              <p className={cn(bodyCls, 'rounded-xl border border-rule bg-paper-sub p-3 text-ink-soft')}>
                {L(
                  'మీ గుర్తింపు పత్రం ప్రైవేటుగా భద్రపరుస్తాం — బహిరంగ లింక్ ఉండదు. సీనియర్ ఎడిటర్లు మాత్రమే చూడగలరు, ప్రతిసారీ అది నమోదవుతుంది, మీ ధృవీకరణ గడువు ముగిశాక తొలగిస్తాం.',
                  'Your ID is stored privately, never on a public link. Only senior editors can open it, every time one does it is recorded, and it is deleted when your verification lapses.',
                )}
              </p>

              {data.documents.length ? (
                <ul className="flex flex-col gap-2">
                  {data.documents.map((doc) => (
                    <li key={doc.id} className={cn(bodyCls, 'flex items-center gap-2 text-ink-soft')}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-success-tint text-success">
                        <Icon icon={Check} size="xs" strokeWidth={3} />
                      </span>
                      {L(DOC_LABELS[doc.kind]?.te ?? doc.kind, DOC_LABELS[doc.kind]?.en ?? doc.kind)}
                      {doc.number_masked ? (
                        <span className="font-mono text-meta text-muted">{doc.number_masked}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {canEdit && data.missing.length ? (
                <div className="space-y-4">
                  {data.missing.map((group) => {
                    // `group` is a non-empty list of alternatives from the
                    // server; the first is what we upload as.
                    const kind = group[0];
                    if (!kind) return null;
                    const live = uploading?.kind === kind ? uploading : null;
                    return (
                      <FileDrop
                        key={group.join('-')}
                        accept={UPLOAD_ACCEPT}
                        disabled={upload.isPending}
                        onFiles={(files) => startUpload(kind, files[0])}
                        label={group
                          .map((k) => L(DOC_LABELS[k]?.te ?? k, DOC_LABELS[k]?.en ?? k))
                          .join(L(' లేదా ', ' or '))}
                        hint={L('JPG, PNG లేదా PDF', 'JPG, PNG or PDF')}
                        progress={live && !live.url ? live.progress : undefined}
                        previews={
                          live?.url ? [{ url: live.url, name: live.name, progress: live.progress }] : undefined
                        }
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <p className={cn(bodyCls, 'text-ink-soft')}>
              {L('ముందుగా మీ వివరాలు సేవ్ చేయండి.', 'Save your details first.')}
            </p>
          )}
        </Step>

        <Step n={3} title={L('ధృవీకరణకు పంపండి', 'Send for verification')} done={sent} active={Boolean(docsDone) && canEdit}>
          {canEdit && docsDone ? (
            <div className="space-y-3">
              <p className={cn(bodyCls, 'text-ink-soft')}>
                {L(
                  'అన్నీ సిద్ధం. పంపిన తర్వాత సమీక్ష పూర్తయ్యే వరకు మార్పులు చేయలేరు.',
                  'Everything is ready. After you send, nothing can be changed until the review finishes.',
                )}
              </p>
              <Button icon={IdCard} pending={submit.isPending} onClick={() => void askAndSubmit()}>
                {L('ధృవీకరణకు పంపండి', 'Send for verification')}
              </Button>
            </div>
          ) : (
            <p className={cn(bodyCls, 'text-ink-soft')}>
              {sent
                ? L('మీ దరఖాస్తు మా దగ్గర ఉంది.', 'Your application is with us.')
                : L('పైన అడిగిన పత్రాలు జోడించాక ఇది తెరుచుకుంటుంది.', 'This opens once the documents above are in.')}
            </p>
          )}
          {submit.isError ? <ErrorState compact error={submit.error} className="mt-3" /> : null}
        </Step>
      </ol>

      <p className={cn(bodyCls, 'text-muted')}>
        {L(
          'ధృవీకరణ వల్ల మీరు ఎక్కువ కథనాలు పంపవచ్చు, మీ పేరుపై ధృవీకరణ గుర్తు కనిపిస్తుంది. ప్రతి కథనాన్ని ఎడిటర్ చదివాకే ప్రచురిస్తాం — అది మారదు.',
          'Verification raises how much you can send and puts a verified name on your byline. Every story is still read by an editor before it is published — that does not change.',
        )}
      </p>

      {dialog}
    </PageContainer>
  );
}
