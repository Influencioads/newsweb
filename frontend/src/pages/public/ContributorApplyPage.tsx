import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { ApiError } from '@/api/client';

/**
 * Becoming a contributor — the reader's side of citizen journalism.
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

const STATUS_TEXT: Record<Status, { te: string; en: string; tone: string }> = {
  not_started: { te: '', en: '', tone: '' },
  draft: {
    te: 'మీ దరఖాస్తు ఇంకా పంపలేదు. అవసరమైన పత్రాలు జోడించి పంపండి.',
    en: 'Your application is not sent yet. Add the documents and submit.',
    tone: 'border-rule bg-canvas text-ink-soft',
  },
  submitted: {
    te: 'మీ దరఖాస్తు అందింది. మా బృందం త్వరలో పరిశీలిస్తుంది.',
    en: 'We have your application. Our team will review it shortly.',
    tone: 'border-info/40 bg-info/8 text-ink-soft',
  },
  in_review: {
    te: 'మీ దరఖాస్తు సమీక్షలో ఉంది.',
    en: 'Your application is being reviewed.',
    tone: 'border-info/40 bg-info/8 text-ink-soft',
  },
  more_info: {
    te: 'మరికొంత సమాచారం కావాలి — కింది గమనిక చూడండి.',
    en: 'We need a little more — see the note below.',
    tone: 'border-partial bg-partial/10 text-ink-soft',
  },
  approved: {
    te: 'మీరు ధృవీకరించబడ్డారు. ఇప్పుడు మీరు కథనాలు పంపవచ్చు.',
    en: 'You are verified. You can file stories now.',
    tone: 'border-success bg-success/10 text-ink-soft',
  },
  rejected: {
    te: 'ఈసారి ఆమోదించలేకపోయాం. కారణం కింద ఉంది.',
    en: 'We could not approve this. The reason is below.',
    tone: 'border-breaking-border bg-breaking-tint text-breaking',
  },
  expired: {
    te: 'మీ ధృవీకరణ గడువు ముగిసింది. మళ్లీ దరఖాస్తు చేయండి.',
    en: 'Your verification has lapsed. Please apply again.',
    tone: 'border-rule bg-canvas text-ink-soft',
  },
};

export default function ContributorApplyPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.me);

  const [type, setType] = useState<string>('citizen');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [portfolio, setPortfolio] = useState('');

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
    onSuccess: refresh,
  });

  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: string; file: File }) => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      return (await api.post('/users/me/contributor/documents', form)).data;
    },
    onSuccess: refresh,
  });

  const submit = useMutation({
    mutationFn: async () => (await api.post('/users/me/contributor/submit')).data,
    onSuccess: refresh,
  });

  if (!me) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="te text-[14px] leading-telugu text-ink">
          {en ? 'Please sign in to apply.' : 'దరఖాస్తు చేయడానికి సైన్ ఇన్ చేయండి.'}
        </p>
      </main>
    );
  }

  const data = application.data;
  const status = data?.status ?? 'not_started';
  const canEdit = data?.can_edit ?? true;
  const submitError = (submit.error as ApiError | undefined)?.displayMessage;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-5">
        <h1 className="th text-[26px] font-extrabold text-ink">
          {en ? 'Write for us' : 'మాతో కలిసి రాయండి'}
        </h1>
        <p className="te mt-1 text-[13.5px] leading-telugu text-ink-soft">
          {en
            ? 'Citizens, freelance and student journalists can file stories from their own area. Verify who you are once, and your byline carries it.'
            : 'పౌరులు, ఫ్రీలాన్స్, విద్యార్థి జర్నలిస్టులు తమ ప్రాంతం నుంచి కథనాలు పంపవచ్చు. ఒకసారి మీ గుర్తింపు ధృవీకరించుకుంటే, మీ పేరుపై అది కనిపిస్తుంది.'}
        </p>
      </header>

      {status !== 'not_started' ? (
        <div className={`te mb-5 rounded-card border p-3.5 text-[13px] leading-telugu ${STATUS_TEXT[status].tone}`}>
          {en ? STATUS_TEXT[status].en : STATUS_TEXT[status].te}
          {data?.review_note ? (
            <p className="mt-1.5 font-semibold">{data.review_note}</p>
          ) : null}
          {status === 'approved' ? (
            <Link to="/submit" className="mt-2 inline-block font-semibold text-brand underline">
              {en ? 'File a story' : 'కథనం పంపండి'}
            </Link>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <form
          onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}
          className="space-y-4 rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface"
        >
          <fieldset>
            <legend className="te mb-2 text-[13px] font-bold text-ink">
              {en ? 'You are applying as' : 'మీరు ఎవరిగా దరఖాస్తు చేస్తున్నారు'}
            </legend>
            <div className="space-y-2">
              {TYPES.map((option) => (
                <label key={option.value}
                  className="te flex min-h-tap cursor-pointer items-start gap-2.5 rounded-control border border-rule p-2.5">
                  <input type="radio" name="contributor_type" value={option.value}
                    checked={type === option.value}
                    onChange={() => setType(option.value)} className="mt-1" />
                  <span>
                    <span className="block text-[13.5px] font-bold text-ink">
                      {en ? option.en : option.te}
                    </span>
                    <span className="block text-[12px] leading-telugu text-muted">
                      {en ? option.hintEn : option.hintTe}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="te mb-1 block text-[13px] font-bold text-ink">
              {en ? 'The name to print on your stories' : 'మీ కథనాలపై కనిపించే పేరు'}
            </span>
            <input required value={name} onChange={(e) => setName(e.target.value)}
              className="te min-h-tap w-full rounded-control border border-rule px-3 text-[14px]" />
          </label>

          <label className="block">
            <span className="te mb-1 block text-[13px] font-bold text-ink">
              {en ? 'About you' : 'మీ గురించి'}
            </span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)}
              className="te min-h-20 w-full rounded-control border border-rule px-3 py-2 text-[14px] leading-telugu" />
          </label>

          {type !== 'citizen' ? (
            <label className="block">
              <span className="te mb-1 block text-[13px] font-bold text-ink">
                {type === 'student'
                  ? (en ? 'Your college' : 'మీ కళాశాల')
                  : (en ? 'Outlet you write for' : 'మీరు రాసే సంస్థ')}
              </span>
              <input value={organisation} onChange={(e) => setOrganisation(e.target.value)}
                className="te min-h-tap w-full rounded-control border border-rule px-3 text-[14px]" />
            </label>
          ) : null}

          {type === 'freelance' ? (
            <label className="block">
              <span className="te mb-1 block text-[13px] font-bold text-ink">
                {en ? 'A link to your work' : 'మీ రచనల లింక్'}
              </span>
              <input type="url" value={portfolio} onChange={(e) => setPortfolio(e.target.value)}
                className="min-h-tap w-full rounded-control border border-rule px-3 font-sans text-[13px]" />
            </label>
          ) : null}

          <button disabled={save.isPending}
            className="te min-h-tap rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
            {save.isPending ? (en ? 'Saving…' : 'సేవ్ అవుతోంది…') : (en ? 'Save' : 'సేవ్ చేయండి')}
          </button>
        </form>
      ) : null}

      {data?.id ? (
        <section className="mt-5 rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
          <h2 className="te text-[15px] font-bold text-ink">
            {en ? 'Your documents' : 'మీ పత్రాలు'}
          </h2>

          <p className="te mt-1.5 rounded-control border border-rule bg-canvas p-2.5 text-[12px] leading-telugu text-ink-soft">
            {en
              ? 'Your ID is stored privately, never on a public link. Only senior editors can open it, every time one does it is recorded, and it is deleted when your verification lapses.'
              : 'మీ గుర్తింపు పత్రం ప్రైవేటుగా భద్రపరుస్తాం — బహిరంగ లింక్ ఉండదు. సీనియర్ ఎడిటర్లు మాత్రమే చూడగలరు, ప్రతిసారీ అది నమోదవుతుంది, మీ ధృవీకరణ గడువు ముగిశాక తొలగిస్తాం.'}
          </p>

          <ul className="mt-3 space-y-1.5">
            {data.documents.map((doc) => (
              <li key={doc.id} className="te flex items-center gap-2 text-[13px] text-ink-soft">
                <span className="text-success">✓</span>
                {en ? DOC_LABELS[doc.kind]?.en ?? doc.kind : DOC_LABELS[doc.kind]?.te ?? doc.kind}
                {doc.number_masked ? (
                  <span className="font-mono text-[11.5px] text-muted">{doc.number_masked}</span>
                ) : null}
              </li>
            ))}
          </ul>

          {canEdit && data.missing.length ? (
            <div className="mt-3 space-y-3">
              {data.missing.map((group) => (
                <label key={group.join('-')} className="block">
                  <span className="te mb-1 block text-[13px] font-bold text-ink">
                    {group
                      .map((k) => (en ? DOC_LABELS[k]?.en ?? k : DOC_LABELS[k]?.te ?? k))
                      .join(en ? ' or ' : ' లేదా ')}
                  </span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // `group` is a non-empty list of alternatives from the
                      // server; the first is what we upload as.
                      const kind = group[0];
                      if (file && kind) upload.mutate({ kind, file });
                    }}
                    className="te w-full text-[12.5px]" />
                </label>
              ))}
            </div>
          ) : null}

          {canEdit && data.missing.length === 0 ? (
            <button type="button" disabled={submit.isPending} onClick={() => submit.mutate()}
              className="te mt-4 min-h-tap rounded-control bg-brand px-5 font-bold text-white disabled:opacity-60">
              {submit.isPending
                ? (en ? 'Sending…' : 'పంపుతోంది…')
                : (en ? 'Send for verification' : 'ధృవీకరణకు పంపండి')}
            </button>
          ) : null}

          {submitError ? (
            <p role="alert" className="te mt-3 rounded-control border border-breaking-border bg-breaking-tint p-2.5 text-[12.5px] leading-telugu text-breaking">
              {submitError}
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="te mt-5 text-[12px] leading-telugu text-muted">
        {en
          ? 'Verification raises how much you can send and puts a verified name on your byline. Every story is still read by an editor before it is published — that does not change.'
          : 'ధృవీకరణ వల్ల మీరు ఎక్కువ కథనాలు పంపవచ్చు, మీ పేరుపై ధృవీకరణ గుర్తు కనిపిస్తుంది. ప్రతి కథనాన్ని ఎడిటర్ చదివాకే ప్రచురిస్తాం — అది మారదు.'}
      </p>
    </main>
  );
}
