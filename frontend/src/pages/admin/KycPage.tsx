import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import { inputClass } from '@/components/admin/FormControls';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { KycDocumentRow, KycProfileRow, KycStatus } from '@/types/cms';

/**
 * Contributor applications — citizens, freelance and student journalists.
 *
 * The screen is built around a deliberate split. Triaging works from the
 * applicant's own declaration and **masked** document numbers, which anyone
 * with `kyc.review` can see. Opening the actual government ID needs
 * `kyc.view_document`, which only editor-in-chief and above hold, and every
 * open is written to the audit log. So the document viewer is not shown at all
 * to a desk editor — not disabled, absent, because offering a button that 403s
 * teaches people to ignore permission errors.
 */

const STATUS: Record<KycStatus, { te: string; en: string; tone: string }> = {
  not_started: { te: 'ప్రారంభం కాలేదు', en: 'Not started', tone: 'bg-canvas text-muted' },
  draft: { te: 'డ్రాఫ్ట్', en: 'Draft', tone: 'bg-canvas text-muted' },
  submitted: { te: 'సమర్పించారు', en: 'Submitted', tone: 'bg-info/12 text-info' },
  in_review: { te: 'సమీక్షలో', en: 'In review', tone: 'bg-info/12 text-info' },
  more_info: { te: 'మరింత సమాచారం', en: 'More info asked', tone: 'bg-partial/15 text-partial' },
  approved: { te: 'ఆమోదించారు', en: 'Approved', tone: 'bg-success/12 text-success' },
  rejected: { te: 'తిరస్కరించారు', en: 'Rejected', tone: 'bg-breaking-tint text-breaking' },
  expired: { te: 'గడువు ముగిసింది', en: 'Expired', tone: 'bg-canvas text-muted' },
};

const TABS: KycStatus[] = ['submitted', 'more_info', 'approved', 'rejected'];

const TYPE_LABEL: Record<string, { te: string; en: string }> = {
  citizen: { te: 'పౌర విలేకరి', en: 'Citizen' },
  freelance: { te: 'ఫ్రీలాన్స్', en: 'Freelance' },
  student: { te: 'విద్యార్థి', en: 'Student' },
};

/**
 * The document viewer.
 *
 * An `<img src>` cannot carry a bearer token, so the obvious implementation
 * ships a viewer that always 401s. The bytes are fetched as a blob with the
 * axios client's auth header and turned into an object URL, which is revoked
 * on unmount so the image does not linger in memory after the reviewer closes
 * it.
 */
function DocumentViewer({ profileId, document: doc, onClose }: {
  profileId: number;
  document: KycDocumentRow;
  onClose: () => void;
}) {
  const { language } = useI18n();
  const en = language === 'en';
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    (async () => {
      try {
        const response = await api.get(
          `/cms/kyc/${profileId}/documents/${doc.id}/raw`,
          { responseType: 'blob' },
        );
        if (revoked) return;
        url = URL.createObjectURL(response.data as Blob);
        setObjectUrl(url);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profileId, doc.id]);

  return (
    <div className="mt-2 rounded-control border border-rule bg-canvas p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-sans text-[12px] font-bold text-ink">{doc.kind}</span>
        {doc.number_masked ? (
          <span className="font-mono text-[11.5px] text-muted">{doc.number_masked}</span>
        ) : null}
        <button type="button" onClick={onClose}
          className="te ml-auto text-[12px] font-semibold text-muted underline">
          {en ? 'Close' : 'మూసివేయండి'}
        </button>
      </div>
      {failed ? (
        <p className="te text-[12.5px] text-breaking">
          {en ? 'Could not open this document.' : 'ఈ పత్రాన్ని తెరవలేకపోయాం.'}
        </p>
      ) : objectUrl ? (
        doc.mime === 'application/pdf' ? (
          <iframe src={objectUrl} title={doc.kind} className="h-[520px] w-full border-0" />
        ) : (
          <img src={objectUrl} alt="" className="max-h-[520px] w-auto rounded" />
        )
      ) : (
        <p className="te text-[12.5px] text-muted">{en ? 'Opening…' : 'తెరుస్తోంది…'}</p>
      )}
      <p className="te mt-2 text-[11px] text-muted">
        {en
          ? 'This view is recorded in the audit log with your name, IP and the time.'
          : 'ఈ వీక్షణ మీ పేరు, IP, సమయంతో ఆడిట్ లాగ్‌లో నమోదవుతుంది.'}
      </p>
    </div>
  );
}

function ApplicationCard({ profile, onChanged }: {
  profile: KycProfileRow;
  onChanged: () => void;
}) {
  const { language } = useI18n();
  const en = language === 'en';
  const can = useAuth((s) => s.can);
  const mayOpen = can('kyc.view_document');
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<KycDocumentRow | null>(null);
  const [note, setNote] = useState('');

  const detail = useQuery({
    queryKey: ['cms', 'kyc', profile.id],
    queryFn: () => cmsApi.fetchKycApplication(profile.id),
    enabled: open,
  });

  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'request-more') =>
      cmsApi.decideKyc(profile.id, action, { note: note || null }),
    onSuccess: () => { setNote(''); onChanged(); },
  });

  const label = STATUS[profile.status];
  const type = TYPE_LABEL[profile.contributor_type ?? 'citizen'];

  return (
    <article className="rounded-card border border-rule bg-white p-4 shadow-card dark:bg-surface">
      <div className="flex flex-wrap items-center gap-2">
        <span className="te text-[15px] font-bold text-ink">{profile.display_name_te}</span>
        <span className={`inline-block rounded-chip px-2 py-0.5 font-sans text-[10.5px] font-bold ${label.tone}`}>
          {en ? label.en : label.te}
        </span>
        <span className="te rounded-chip bg-canvas px-2 py-0.5 text-[11px] text-ink-soft">
          {en ? type?.en : type?.te}
        </span>
        {!profile.phone_verified ? (
          <span className="te rounded-chip bg-breaking-tint px-2 py-0.5 text-[11px] font-semibold text-breaking">
            {en ? 'phone unverified' : 'ఫోన్ ధృవీకరించలేదు'}
          </span>
        ) : null}
      </div>

      <p className="mt-1 font-sans text-[11.5px] text-muted">
        {profile.name_te} · {profile.phone ?? '—'} · {profile.document_count}{' '}
        {en ? 'documents' : 'పత్రాలు'}
        {profile.submitted_at
          ? ` · ${new Date(profile.submitted_at).toLocaleString('en-IN')}`
          : ''}
      </p>

      {profile.organisation ? (
        <p className="te mt-1 text-[12.5px] leading-telugu text-ink-soft">
          {profile.organisation}
          {profile.course_year ? ` · ${en ? 'year' : 'సంవత్సరం'} ${profile.course_year}` : ''}
        </p>
      ) : null}
      {profile.portfolio_url ? (
        <a href={profile.portfolio_url} target="_blank" rel="noreferrer noopener"
          className="mt-1 block font-sans text-[12px] text-info underline">
          {profile.portfolio_url}
        </a>
      ) : null}

      <button type="button" onClick={() => setOpen((v) => !v)}
        className="te mt-2 text-[12px] font-semibold text-info underline">
        {open ? (en ? 'Hide details' : 'వివరాలు దాచండి') : (en ? 'Open application' : 'దరఖాస్తు తెరవండి')}
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          {detail.data?.bio_te ? (
            <p className="te text-[12.5px] leading-telugu text-ink-soft">{detail.data.bio_te}</p>
          ) : null}

          <ul className="space-y-1">
            {(detail.data?.documents ?? []).map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-2">
                <span className="font-sans text-[12px] text-ink">{doc.kind}</span>
                <span className="font-mono text-[11px] text-muted">
                  {doc.number_masked ?? '—'}
                </span>
                <span className="font-sans text-[11px] text-muted">
                  {Math.round(doc.bytes / 1024)} KB
                </span>
                {mayOpen ? (
                  <button type="button" onClick={() => setViewing(doc)}
                    className="te text-[11.5px] font-semibold text-brand underline">
                    {en ? 'Open' : 'తెరవండి'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          {!mayOpen ? (
            <p className="te text-[11.5px] leading-telugu text-muted">
              {en
                ? 'Opening an identity document needs a separate permission. Triage from the declaration and the masked numbers, or ask an editor-in-chief.'
                : 'గుర్తింపు పత్రం తెరవడానికి ప్రత్యేక అనుమతి కావాలి. మాస్క్ చేసిన నంబర్లతో పరిశీలించండి, లేదా ఎడిటర్-ఇన్-చీఫ్‌ను అడగండి.'}
            </p>
          ) : null}

          {viewing ? (
            <DocumentViewer profileId={profile.id} document={viewing}
              onClose={() => setViewing(null)} />
          ) : null}

          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={en
              ? 'A note the applicant will see — say what is missing, not just no.'
              : 'దరఖాస్తుదారుకు కనిపించే గమనిక — ఏమి లేదో చెప్పండి.'}
            className={`te ${inputClass} min-h-16`} />

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={decide.isPending}
              onClick={() => decide.mutate('approve')}
              className="te min-h-[32px] rounded-control bg-brand px-3 text-[12px] font-bold text-white disabled:opacity-50">
              {en ? 'Approve' : 'ఆమోదించండి'}
            </button>
            <button type="button" disabled={decide.isPending}
              onClick={() => decide.mutate('request-more')}
              className="te min-h-[32px] rounded-control border border-rule px-3 text-[12px] font-semibold text-ink-soft disabled:opacity-50">
              {en ? 'Ask for more' : 'మరింత అడగండి'}
            </button>
            <button type="button" disabled={decide.isPending}
              onClick={() => decide.mutate('reject')}
              className="te min-h-[32px] rounded-control border border-breaking-border px-3 text-[12px] font-semibold text-breaking disabled:opacity-50">
              {en ? 'Reject' : 'తిరస్కరించండి'}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function KycPage() {
  const { language } = useI18n();
  const en = language === 'en';
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<KycStatus>('submitted');

  const applications = useQuery({
    queryKey: ['cms', 'kyc-queue', tab],
    queryFn: () => cmsApi.fetchKycQueue(tab),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'kyc-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['cms', 'kyc'] });
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="th text-[25px] font-extrabold text-ink">
          {en ? 'Contributor applications' : 'విలేకరి దరఖాస్తులు'}
        </h1>
        <p className="te mt-1 max-w-[70ch] text-[12px] leading-telugu text-muted">
          {en
            ? 'Citizens, freelance and student journalists asking to file stories. Approval verifies who they are and raises what they may send — it never lets them publish.'
            : 'కథనాలు పంపాలనుకునే పౌరులు, ఫ్రీలాన్స్, విద్యార్థి విలేకరులు. ఆమోదం వారి గుర్తింపును ధృవీకరిస్తుంది — ప్రచురణ హక్కు ఇవ్వదు.'}
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
            className={`te min-h-[34px] rounded-chip border px-3.5 text-[12.5px] font-semibold ${
              tab === key ? 'border-brand bg-brand text-white' : 'border-rule bg-white text-ink dark:bg-surface'
            }`}>
            {en ? STATUS[key].en : STATUS[key].te}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {(applications.data?.items ?? []).map((profile) => (
          <ApplicationCard key={profile.id} profile={profile} onChanged={refresh} />
        ))}
        {applications.data && applications.data.items.length === 0 ? (
          <p className="te rounded-card border border-rule bg-white p-8 text-center text-[13px] text-muted dark:bg-surface">
            {en ? 'Nothing in this queue.' : 'ఈ క్యూలో ఏమీ లేదు.'}
          </p>
        ) : null}
      </div>
    </main>
  );
}
