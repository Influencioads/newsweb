import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, PenLine, XCircle } from 'lucide-react';

import { ApiError } from '@/api/client';
import * as creatorApi from '@/features/creator/api';
import * as publicApi from '@/features/public/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { relativeTime } from '@/utils/time';

/**
 * Creator submissions (updated doc §17): write → accept guidelines → submit
 * for moderation. The status list below the form is the creator's window into
 * the §17 moderation history — pending, approved (with a link once the
 * newsroom publishes), or rejected with the moderator's note.
 */
export default function SubmitPage() {
  const { language, pick } = useI18n();
  const te = language === 'te';
  const teCls = te ? 'te' : 'font-sans';
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [districtSlug, setDistrictSlug] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'anonymous') navigate('/login', { replace: true, state: { from: '/submit' } });
  }, [status, navigate]);

  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: publicApi.fetchSiteConfig,
    staleTime: 300_000,
  });
  const mine = useQuery({
    queryKey: ['reader', 'submissions'],
    queryFn: creatorApi.fetchMySubmissions,
    enabled: status === 'authenticated',
  });

  const submit = useMutation({
    mutationFn: () =>
      creatorApi.submitArticle({
        title_te: title.trim(),
        body_te: body.trim(),
        category_slug: categorySlug || null,
        district_slug: districtSlug || null,
        accept_guidelines: accepted,
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setAccepted(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['reader', 'submissions'] });
    },
    onError: (e) => setError(e instanceof ApiError ? (te ? e.messageTe : e.messageEn) : String(e)),
  });

  if (status !== 'authenticated') return null;

  const canSubmit = title.trim().length >= 10 && body.trim().length >= 100 && accepted;
  const inputCls =
    'w-full rounded-control border border-rule-input bg-white px-3 py-2.5 text-[15px] text-ink';

  const STATUS_UI: Record<creatorApi.SubmissionStatus, { icon: React.ReactNode; cls: string; te: string; en: string }> = {
    pending: { icon: <Clock3 className="h-3.5 w-3.5" aria-hidden />, cls: 'bg-exclusive-tint text-exclusive-text', te: 'సమీక్షలో', en: 'In review' },
    approved: { icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />, cls: 'bg-success-tint text-success', te: 'ఆమోదించబడింది', en: 'Approved' },
    rejected: { icon: <XCircle className="h-3.5 w-3.5" aria-hidden />, cls: 'bg-breaking-tint text-breaking', te: 'తిరస్కరించబడింది', en: 'Rejected' },
  };

  return (
    <main className="mx-auto max-w-[760px] px-4 py-7 sm:py-10">
      <div className="mb-6 border-b-2 border-ink pb-4">
        <p className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-brand">
          <PenLine className="h-3.5 w-3.5" aria-hidden />
          {te ? 'పాఠక రచయిత' : 'READER CONTRIBUTOR'}
        </p>
        <h1 className={`${te ? 'th' : 'font-sans'} mt-1 text-[27px] font-extrabold text-ink sm:text-[32px]`}>
          {te ? 'మీ కథనం పంపండి' : 'Submit your story'}
        </h1>
        <p className={`${teCls} mt-1 text-[13px] leading-telugu text-muted`}>
          {te
            ? 'మీ ప్రాంత విశేషాలు, విజయగాథలు రాయండి. మోడరేషన్, సంపాదకీయ సమీక్ష తర్వాత మీ పేరుతో ప్రచురిస్తాం.'
            : 'Write what is happening around you. After moderation and editorial review it publishes with your name.'}
        </p>
        <p className={`${teCls} mt-2 text-[12.5px] leading-telugu text-muted`}>
          {te
            ? 'క్రమం తప్పకుండా రాస్తారా? '
            : 'Filing regularly? '}
          <Link to="/contributor" className="font-semibold text-brand underline">
            {te ? 'విలేకరిగా ధృవీకరించుకోండి' : 'Get verified as a contributor'}
          </Link>
          {te
            ? ' — ఎక్కువ కథనాలు పంపవచ్చు, ఫోటోలు జోడించవచ్చు, మీ పేరుపై ధృవీకరణ గుర్తు.'
            : ' — send more stories, attach photographs, and carry a verified byline.'}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit.mutate();
        }}
        className="rounded-card border border-rule bg-paper p-5 sm:p-6"
      >
        <label className={`${teCls} mb-1 block text-[12.5px] font-semibold text-ink`}>
          {te ? 'శీర్షిక' : 'Headline'} <span className="text-breaking">*</span>
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={te ? 'ఉదా: మా ఊరి యువత కట్టిన గ్రంథాలయం' : 'e.g. The library our village youth built'}
          className={`te ${inputCls}`}
        />
        <p className="mt-0.5 text-right font-sans text-[10px] text-muted-light">{title.length}/200</p>

        <label className={`${teCls} mb-1 mt-3 block text-[12.5px] font-semibold text-ink`}>
          {te ? 'కథనం (కనీసం 100 అక్షరాలు)' : 'Story (at least 100 characters)'}{' '}
          <span className="text-breaking">*</span>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          maxLength={20000}
          placeholder={te ? 'పూర్తి వివరాలతో రాయండి. పేరాల మధ్య ఖాళీ లైన్ వదలండి…' : 'Write in full. Leave a blank line between paragraphs…'}
          className={`te ${inputCls} leading-telugu`}
        />
        <p className="mt-0.5 text-right font-sans text-[10px] text-muted-light">{body.length}/20000</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
              {te ? 'విభాగం' : 'Section'}
            </span>
            <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={`${teCls} ${inputCls}`}>
              <option value="">{te ? '— ఎంచుకోండి —' : '— choose —'}</option>
              {config.data?.categories.filter((c) => c.show_in_nav).map((c) => (
                <option key={c.slug} value={c.slug}>{pick(c.name_te, c.name_en)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`${teCls} mb-1 block text-[12px] font-semibold text-muted`}>
              {te ? 'జిల్లా' : 'District'}
            </span>
            <select value={districtSlug} onChange={(e) => setDistrictSlug(e.target.value)} className={`${teCls} ${inputCls}`}>
              <option value="">{te ? '— ఎంచుకోండి —' : '— choose —'}</option>
              {config.data?.districts.map((d) => (
                <option key={d.slug} value={d.slug}>{pick(d.name_te, d.name_en)}</option>
              ))}
            </select>
          </label>
        </div>

        <label className={`${teCls} mt-4 flex cursor-pointer items-start gap-2 text-[13px] leading-telugu text-ink`}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-4 w-4 accent-brand"
          />
          <span>
            {te
              ? 'ఇది నా సొంత రచన; వాస్తవాలు నిర్ధారించుకున్నాను. '
              : 'This is my own writing and I have verified the facts. '}
            <Link to="/editorial-policy" className="text-info hover:underline">
              {te ? 'కంటెంట్ మార్గదర్శకాలను' : 'The content guidelines'}
            </Link>
            {te ? ' అంగీకరిస్తున్నాను.' : ' are accepted.'}
          </span>
        </label>

        <button
          type="submit"
          disabled={!canSubmit || submit.isPending}
          className={`${teCls} mt-4 w-full rounded-control bg-brand py-3 text-[15px] font-bold text-white hover:bg-brand-dark disabled:opacity-50`}
        >
          {submit.isPending
            ? te ? 'పంపుతోంది…' : 'Submitting…'
            : te ? 'మోడరేషన్‌కు పంపండి' : 'Send for moderation'}
        </button>
        {submit.isSuccess ? (
          <p className={`${teCls} mt-2 text-center text-[12.5px] font-semibold text-success`}>
            {te ? '✓ అందింది! సమీక్ష తర్వాత తెలియజేస్తాం.' : '✓ Received! We will update you after review.'}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className={`${teCls} mt-2 rounded bg-breaking-tint px-3 py-2 text-[13px] text-breaking`}>
            {error}
          </p>
        ) : null}
      </form>

      {/* ------------------------------------------- my submissions -------- */}
      <section className="mt-8">
        <h2 className={`${te ? 'th' : 'font-sans'} mb-3 border-b-2 border-ink pb-1.5 text-[18px] font-extrabold text-brand`}>
          {te ? 'నా సమర్పణలు' : 'My submissions'}
        </h2>
        {mine.data?.length === 0 ? (
          <p className={`${teCls} rounded border border-rule bg-paper px-4 py-5 text-center text-[13.5px] text-muted`}>
            {te ? 'ఇంకా సమర్పణలు లేవు.' : 'Nothing submitted yet.'}
          </p>
        ) : (
          <div className="divide-y divide-rule">
            {mine.data?.map((s) => {
              const ui = STATUS_UI[s.status];
              return (
                <div key={s.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    {s.article_url ? (
                      <Link to={s.article_url} lang="te" className="te block text-[14.5px] font-semibold text-ink hover:text-brand">
                        {s.title_te}
                      </Link>
                    ) : (
                      <p lang="te" className="te text-[14.5px] font-semibold text-ink">{s.title_te}</p>
                    )}
                    {s.review_note ? (
                      <p lang="te" className="te mt-0.5 text-[12.5px] text-muted">
                        {te ? 'గమనిక: ' : 'Note: '}{s.review_note}
                      </p>
                    ) : null}
                    <p className="mt-0.5 font-sans text-[10.5px] text-muted-light">
                      {relativeTime(s.created_at, language)}
                    </p>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1 rounded-chip px-2.5 py-1 text-[11px] font-bold ${ui.cls} ${teCls}`}>
                    {ui.icon}
                    {te ? ui.te : ui.en}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
