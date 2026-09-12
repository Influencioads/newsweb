import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, FolderOpen, MessageCircleQuestion, X } from 'lucide-react';

import { api } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { KycPill } from '@/components/admin/StatusPill';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { EmptyState, ErrorState, QueryState, Skeleton } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { KYC_STATUS } from '@/features/cms/status';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { KycDocumentRow, KycProfileRow, KycStatus } from '@/types/cms';
import { cn } from '@/utils/cn';

import { useL } from './useL';

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

const TABS: KycStatus[] = ['submitted', 'more_info', 'approved', 'rejected'];

const TYPE_LABEL: Record<string, { te: string; en: string }> = {
  citizen: { te: 'పౌర విలేకరి', en: 'Citizen' },
  freelance: { te: 'ఫ్రీలాన్స్', en: 'Freelance' },
  student: { te: 'విద్యార్థి', en: 'Student' },
};

type Decision = 'approve' | 'reject' | 'request-more';

/**
 * The document viewer.
 *
 * An `<img src>` cannot carry a bearer token, so the obvious implementation
 * ships a viewer that always 401s. The bytes are fetched as a blob with the
 * axios client's auth header and turned into an object URL, which is revoked
 * when the dialog closes so the image does not linger in memory.
 */
function DocumentDialog({ profileId, document: doc, onClose }: {
  profileId: number;
  document: KycDocumentRow | null;
  onClose: () => void;
}) {
  const L = useL();
  const s = useScript();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const docId = doc?.id;

  useEffect(() => {
    if (docId === undefined) return;
    let revoked = false;
    let url: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    (async () => {
      try {
        const response = await api.get(`/cms/kyc/${profileId}/documents/${docId}/raw`, { responseType: 'blob' });
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
  }, [profileId, docId]);

  return (
    <Dialog open={doc !== null} onClose={onClose} title={doc?.kind ?? ''} description={doc?.number_masked ?? undefined} size="lg">
      {failed ? (
        <ErrorState compact title={L('ఈ పత్రాన్ని తెరవలేకపోయాం.', 'Could not open this document.')} />
      ) : objectUrl && doc ? (
        doc.mime === 'application/pdf' ? (
          <iframe src={objectUrl} title={doc.kind} className="h-[60vh] w-full rounded-xl border border-rule" />
        ) : (
          <img src={objectUrl} alt={`${doc.kind}${doc.number_masked ? ` · ${doc.number_masked}` : ''}`} className="mx-auto max-h-[60vh] w-auto rounded-xl" />
        )
      ) : (
        <Skeleton variant="image" ratio="4/3" />
      )}
      <p className={cn(s.body, 'mt-4 text-meta text-muted')}>
        {L(
          'ఈ వీక్షణ మీ పేరు, IP, సమయంతో ఆడిట్ లాగ్‌లో నమోదవుతుంది.',
          'This view is recorded in the audit log with your name, IP and the time.',
        )}
      </p>
    </Dialog>
  );
}

function ApplicationDialog({ profile, onClose, onChanged }: {
  profile: KycProfileRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const can = useAuth((st) => st.can);
  const mayOpen = can('kyc.view_document');
  const [viewing, setViewing] = useState<KycDocumentRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const open = profile !== null;
  const profileId = profile?.id ?? 0;

  const detail = useQuery({
    queryKey: ['cms', 'kyc', profileId],
    queryFn: () => cmsApi.fetchKycApplication(profileId),
    enabled: open,
  });

  const decide = useMutation({
    mutationFn: ({ action, note }: { action: Decision; note: string }) =>
      cmsApi.decideKyc(profileId, action, { note: note || null }),
    onSuccess: (_row, { action }) => {
      toast.success(
        action === 'approve'
          ? L('ఆమోదించారు', 'Approved')
          : action === 'reject'
            ? L('తిరస్కరించారు', 'Rejected')
            : L('మరింత సమాచారం అడిగారు', 'Asked for more information'),
      );
      setDecision(null);
      onChanged();
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  const type = profile ? TYPE_LABEL[profile.contributor_type ?? 'citizen'] : undefined;
  const notePlaceholder = L(
    'దరఖాస్తుదారుకు కనిపించే గమనిక — ఏమి లేదో చెప్పండి.',
    'A note the applicant will see — say what is missing, not just no.',
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="lg"
        title={<span lang="te" className="th">{profile?.display_name_te}</span>}
        description={
          profile ? (
            <span className="font-sans">
              <span lang="te" className="te">
                {profile.name_te}
              </span>{' '}
              · {profile.phone ?? '—'} · {profile.document_count} {L('పత్రాలు', 'documents')}
              {profile.submitted_at ? ` · ${new Date(profile.submitted_at).toLocaleString('en-IN')}` : ''}
            </span>
          ) : undefined
        }
        footer={
          <>
            <Button variant="danger" icon={X} disabled={decide.isPending} onClick={() => setDecision('reject')}>
              {L('తిరస్కరించండి', 'Reject')}
            </Button>
            <Button variant="secondary" icon={MessageCircleQuestion} disabled={decide.isPending} onClick={() => setDecision('request-more')}>
              {L('మరింత అడగండి', 'Ask for more')}
            </Button>
            <Button icon={Check} disabled={decide.isPending} onClick={() => setDecision('approve')}>
              {L('ఆమోదించండి', 'Approve')}
            </Button>
          </>
        }
      >
        {profile ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <KycPill status={profile.status} />
              {type ? <Badge tone="district" size="xs">{L(type.te, type.en)}</Badge> : null}
              {!profile.phone_verified ? (
                <Badge tone="partial" size="xs">{L('ఫోన్ ధృవీకరించలేదు', 'phone unverified')}</Badge>
              ) : null}
            </div>

            {profile.organisation ? (
              <p lang="te" className="te text-te-body-xs text-ink-soft">
                {profile.organisation}
                {profile.course_year ? ` · ${L('సంవత్సరం', 'year')} ${profile.course_year}` : ''}
              </p>
            ) : null}
            {profile.portfolio_url ? (
              <ButtonLink to={profile.portfolio_url} external variant="link" size="sm" iconRight={ExternalLink} className="-ml-1 break-all">
                {profile.portfolio_url}
              </ButtonLink>
            ) : null}

            <QueryState query={detail} compact isEmpty={() => false} skeleton={<Skeleton lines={3} />}>
              {(data) => (
                <div className="space-y-4">
                  {data.bio_te ? <p lang="te" className="te text-te-body-xs text-ink-soft">{data.bio_te}</p> : null}
                  {data.documents?.length ? (
                    <ul className="divide-y divide-rule-soft rounded-xl border border-rule">
                      {data.documents.map((d) => (
                        <li key={d.id} className="flex min-h-tap flex-wrap items-center gap-3 px-3 py-2">
                          <span className="font-sans text-ui-sm font-semibold text-ink">{d.kind}</span>
                          <span className="font-mono text-meta text-muted">{d.number_masked ?? '—'}</span>
                          <span className="font-sans text-meta tabular-nums text-muted">{Math.round(d.bytes / 1024)} KB</span>
                          {mayOpen ? (
                            <Button variant="secondary" size="sm" icon={FileText} className="ml-auto" onClick={() => setViewing(d)}>
                              {L('తెరవండి', 'Open')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </QueryState>

            {!mayOpen ? (
              <p className={cn(s.body, 'text-meta text-muted')}>
                {L(
                  'గుర్తింపు పత్రం తెరవడానికి ప్రత్యేక అనుమతి కావాలి. మాస్క్ చేసిన నంబర్లతో పరిశీలించండి, లేదా ఎడిటర్-ఇన్-చీఫ్‌ను అడగండి.',
                  'Opening an identity document needs a separate permission. Triage from the declaration and the masked numbers, or ask an editor-in-chief.',
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <DocumentDialog profileId={profileId} document={viewing} onClose={() => setViewing(null)} />

      <ConfirmDialog
        open={decision === 'approve'}
        onClose={() => setDecision(null)}
        title={L('దరఖాస్తును ఆమోదించాలా?', 'Approve this application?')}
        body={L(
          'ఆమోదం వారి గుర్తింపును ధృవీకరిస్తుంది, పంపగలిగే వాటిని పెంచుతుంది — ప్రచురణ హక్కు ఇవ్వదు.',
          'Approval verifies who they are and raises what they may send — it never lets them publish.',
        )}
        confirmLabel={L('ఆమోదించండి', 'Approve')}
        pending={decide.isPending}
        onConfirm={() => decide.mutate({ action: 'approve', note: '' })}
      />

      <PromptDialog
        open={decision === 'reject' || decision === 'request-more'}
        onClose={() => setDecision(null)}
        title={decision === 'reject' ? L('దరఖాస్తును తిరస్కరించాలా?', 'Reject this application?') : L('మరింత సమాచారం అడగండి', 'Ask for more information')}
        fields={[
          {
            name: 'note',
            label: L('గమనిక', 'Note'),
            type: 'textarea',
            placeholder: notePlaceholder,
            hint: L('దరఖాస్తుదారుకు కనిపిస్తుంది', 'The applicant will see this'),
          },
        ]}
        submitLabel={decision === 'reject' ? L('తిరస్కరించండి', 'Reject') : L('మరింత అడగండి', 'Ask for more')}
        pending={decide.isPending}
        onSubmit={(v) => {
          if (decision) decide.mutate({ action: decision, note: v.note ?? '' });
        }}
      />
    </>
  );
}

export default function KycPage() {
  const { t } = useI18n();
  const L = useL();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<KycStatus>('submitted');
  const [selected, setSelected] = useState<KycProfileRow | null>(null);

  const applications = useQuery({
    queryKey: ['cms', 'kyc-queue', tab],
    queryFn: () => cmsApi.fetchKycQueue(tab),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cms', 'kyc-queue'] });
    void queryClient.invalidateQueries({ queryKey: ['cms', 'kyc'] });
  };

  const columns: DataTableColumn<KycProfileRow>[] = [
    {
      key: 'applicant',
      header: L('దరఖాస్తుదారు', 'Applicant'),
      lang: 'te',
      render: (p) => (
        <>
          <span className="block font-bold text-ink">{p.display_name_te}</span>
          <span className="block text-meta text-muted">
            {p.name_te ?? ''}
            {p.phone ? ` · ${p.phone}` : ''}
          </span>
        </>
      ),
    },
    {
      key: 'type',
      header: L('రకం', 'Type'),
      hideBelow: 'md',
      render: (p) => {
        const type = TYPE_LABEL[p.contributor_type ?? 'citizen'];
        return type ? L(type.te, type.en) : (p.contributor_type ?? '—');
      },
    },
    {
      key: 'status',
      header: L('స్థితి', 'Status'),
      render: (p) => (
        <span className="flex flex-wrap gap-1">
          <KycPill status={p.status} />
          {!p.phone_verified ? <Badge tone="partial" size="xs">{L('ఫోన్ ధృవీకరించలేదు', 'phone unverified')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'documents',
      header: L('పత్రాలు', 'Documents'),
      align: 'right',
      hideBelow: 'lg',
      render: (p) => <span className="font-sans tabular-nums">{p.document_count}</span>,
    },
    {
      key: 'submitted',
      header: L('సమర్పించినది', 'Submitted'),
      hideBelow: 'md',
      nowrap: true,
      render: (p) => (
        <span className="font-sans text-meta text-muted">
          {p.submitted_at ? new Date(p.submitted_at).toLocaleString('en-IN') : '—'}
        </span>
      ),
    },
  ];

  const rowKey = (p: KycProfileRow) => p.id;

  return (
    <AdminPage
      title={t('admin.page.kyc')}
      width="page"
      subtitle={L(
        'కథనాలు పంపాలనుకునే పౌరులు, ఫ్రీలాన్స్, విద్యార్థి విలేకరులు. ఆమోదం వారి గుర్తింపును ధృవీకరిస్తుంది — ప్రచురణ హక్కు ఇవ్వదు.',
        'Citizens, freelance and student journalists asking to file stories. Approval verifies who they are and raises what they may send — it never lets them publish.',
      )}
    >
      <Tabs
        ariaLabel={L('స్థితి', 'Status')}
        scrollable
        items={TABS.map((key) => ({ key, label: L(KYC_STATUS[key].te, KYC_STATUS[key].en) }))}
        value={tab}
        onChange={(key) => setTab(key as KycStatus)}
      />

      <div role="tabpanel" aria-label={L(KYC_STATUS[tab].te, KYC_STATUS[tab].en)}>
        <QueryState
          query={applications}
          isEmpty={(data) => data.items.length === 0}
          skeleton={<DataTable rows={[]} columns={columns} rowKey={rowKey} loading />}
          empty={
            <Card padding="none">
              <EmptyState title={L('ఈ క్యూలో ఏమీ లేదు.', 'Nothing in this queue.')} compact />
            </Card>
          }
        >
          {(data) => (
            <DataTable
              rows={data.items}
              columns={columns}
              rowKey={rowKey}
              caption={t('admin.page.kyc')}
              onRowClick={setSelected}
              rowActions={(p) => (
                <Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => setSelected(p)}>
                  {L('దరఖాస్తు తెరవండి', 'Open application')}
                </Button>
              )}
            />
          )}
        </QueryState>
      </div>

      <ApplicationDialog profile={selected} onClose={() => setSelected(null)} onChanged={refresh} />
    </AdminPage>
  );
}
