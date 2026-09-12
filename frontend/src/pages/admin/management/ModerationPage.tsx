import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Inbox, MessageSquare, ShieldCheck } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { useConfirm } from '@/components/ui/Dialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { EmptyState, QueryState } from '@/components/ui/State';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { CommentCard, ReportCard, SubmissionCard, type CommentRow, type ReportRow, type SubmissionRow } from './ModerationCards';
import { useL } from './shared';

/**
 * §19 Moderation — the report queue, the comment control room and the reader
 * submission inbox, one tab each. Hiding a comment asks first; rejecting a
 * submission collects the optional note in a PromptDialog.
 */

type Tab = 'reports' | 'comments' | 'submissions';

export function ModerationPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('reports');
  const [rejecting, setRejecting] = useState<SubmissionRow | null>(null);

  const reports = useQuery({
    queryKey: ['cms', 'moderation', 'reports'],
    queryFn: () => cmsApi.fetchModeration<{ items: ReportRow[]; total: number }>('reports', 'open'),
  });
  const comments = useQuery({
    queryKey: ['cms', 'moderation', 'comments'],
    queryFn: () => cmsApi.fetchModeration<{ items: CommentRow[]; total: number }>('comments'),
    enabled: tab === 'comments',
  });
  const submissions = useQuery({
    queryKey: ['cms', 'moderation', 'submissions'],
    queryFn: () => cmsApi.fetchSubmissions<{ items: SubmissionRow[] }>(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['cms', 'moderation'] });
  };
  const onError = (e: unknown) => toast.error(e);

  const close = useMutation({
    mutationFn: ({ id, dismiss }: { id: number; dismiss: boolean }) => cmsApi.closeReport(id, dismiss),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(v.dismiss ? L('నివేదిక తోసిపుచ్చారు', 'Report dismissed') : L('నివేదిక పరిష్కరించారు', 'Report resolved'));
    },
    onError,
  });
  const moderate = useMutation({
    mutationFn: ({ id, hide }: { id: number; hide: boolean }) => cmsApi.moderateComment(id, hide),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(v.hide ? L('వ్యాఖ్య దాచారు', 'Comment hidden') : L('వ్యాఖ్య పునరుద్ధరించారు', 'Comment restored'));
    },
    onError,
  });
  const approveSub = useMutation({
    mutationFn: (id: number) => cmsApi.approveSubmission(id),
    onSuccess: () => {
      invalidate();
      toast.success(L('సమర్పణ ఆమోదించారు. సమీక్ష క్యూకు వెళ్లింది.', 'Submission approved and sent to the review queue'));
    },
    onError,
  });
  const rejectSub = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string | null }) => cmsApi.rejectSubmission(id, note),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      toast.success(L('సమర్పణ తిరస్కరించారు', 'Submission rejected'));
    },
    onError,
  });

  const hideComment = async (id: number) => {
    const ok = await confirm({
      title: L('వ్యాఖ్య దాచాలా?', 'Hide this comment?'),
      body: L('పాఠకులకు ఈ వ్యాఖ్య ఇక కనిపించదు. తర్వాత పునరుద్ధరించవచ్చు.', 'Readers will no longer see it. You can restore it later.'),
      confirmLabel: L('దాచండి', 'Hide'),
      tone: 'danger',
    });
    if (ok) moderate.mutate({ id, hide: true });
  };

  const reportBusy = (r: ReportRow) => {
    if (moderate.isPending && moderate.variables?.id === r.target.id) return 'hide';
    const v = close.variables;
    if (close.isPending && v && v.id === r.id) return v.dismiss ? 'dismiss' : 'resolve';
    return null;
  };

  const items: TabItem[] = [
    { key: 'reports', label: L('నివేదికలు', 'Reports'), icon: Flag, count: reports.data?.total },
    { key: 'comments', label: t('ui.comments'), icon: MessageSquare },
    { key: 'submissions', label: L('సమర్పణలు', 'Submissions'), icon: Inbox, count: submissions.data?.items.length },
  ];
  const label = items.find((i) => i.key === tab)?.label;

  return (
    <AdminPage title={t('admin.page.moderation')} subtitle={L('పాఠకుల నివేదికలు మరియు వ్యాఖ్యల నియంత్రణ', 'Reader reports and comment control')}>
      <div className="space-y-6">
        <Tabs ariaLabel={t('admin.page.moderation')} items={items} value={tab} onChange={(k) => setTab(k as Tab)} scrollable />
        <div role="tabpanel" aria-label={typeof label === 'string' ? label : undefined}>
          {tab === 'reports' ? (
            <QueryState
              query={reports}
              isEmpty={(d) => d.items.length === 0}
              empty={<EmptyState icon={ShieldCheck} title={L('తెరిచిన నివేదికలు లేవు.', 'No open reports. All clear.')} />}
            >
              {(d) => (
                <div className="space-y-3">
                  {d.items.map((r) => (
                    <ReportCard
                      key={r.id}
                      report={r}
                      busy={reportBusy(r)}
                      onHide={() => void hideComment(r.target.id)}
                      onResolve={() => close.mutate({ id: r.id, dismiss: false })}
                      onDismiss={() => close.mutate({ id: r.id, dismiss: true })}
                    />
                  ))}
                </div>
              )}
            </QueryState>
          ) : tab === 'comments' ? (
            <QueryState
              query={comments}
              isEmpty={(d) => d.items.length === 0}
              empty={<EmptyState icon={MessageSquare} title={L('ఇంకా వ్యాఖ్యలు లేవు.', 'No comments yet.')} />}
            >
              {(d) => (
                <div className="space-y-3">
                  {d.items.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      busy={moderate.isPending && moderate.variables?.id === c.id}
                      onHide={() => void hideComment(c.id)}
                      onRestore={() => moderate.mutate({ id: c.id, hide: false })}
                    />
                  ))}
                </div>
              )}
            </QueryState>
          ) : (
            <QueryState
              query={submissions}
              isEmpty={(d) => d.items.length === 0}
              empty={<EmptyState icon={Inbox} title={L('సమీక్ష కోసం సమర్పణలు లేవు.', 'No submissions awaiting review.')} />}
            >
              {(d) => (
                <div className="space-y-3">
                  {d.items.map((s) => (
                    <SubmissionCard
                      key={s.id}
                      submission={s}
                      busy={
                        approveSub.isPending && approveSub.variables === s.id
                          ? 'approve'
                          : rejectSub.isPending && rejectSub.variables?.id === s.id
                            ? 'reject'
                            : null
                      }
                      onApprove={() => approveSub.mutate(s.id)}
                      onReject={() => setRejecting(s)}
                    />
                  ))}
                </div>
              )}
            </QueryState>
          )}
        </div>
      </div>

      <PromptDialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={L('సమర్పణ తిరస్కరించండి', 'Reject submission')}
        description={
          rejecting ? (
            <span lang="te" className="te">
              {rejecting.title_te}
            </span>
          ) : undefined
        }
        fields={[
          { name: 'note', label: L('రచయితకు గమనిక (ఐచ్ఛికం):', 'Note to the creator (optional):'), type: 'textarea' },
        ]}
        submitLabel={L('తిరస్కరించండి', 'Reject')}
        pending={rejectSub.isPending}
        onSubmit={(v) => {
          if (rejecting) rejectSub.mutate({ id: rejecting.id, note: (v.note ?? '').trim() || null });
        }}
      />
      {dialog}
    </AdminPage>
  );
}
