import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Send } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { dateTime, useL } from './shared';

/** §13 Notifications — compose and send reader alerts; level-60 approval enforced by the API. */

type CampaignRow = { id: number; title_te: string; audience: string; sent_count: number; created_at: string };

const TITLE_MAX = 120;
const BODY_MAX = 500;

export function NotificationsAdminPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [audienceSlug, setAudienceSlug] = useState('');
  const [confirming, setConfirming] = useState(false);
  const log = useQuery({ queryKey: ['cms', 'campaigns'], queryFn: () => cmsApi.fetchCampaigns<{ items: CampaignRow[] }>() });
  const send = useMutation({
    mutationFn: () =>
      cmsApi.sendCampaign({
        title_te: title,
        body_te: body || null,
        audience: audience === 'all' ? 'all' : `${audience}:${audienceSlug}`,
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['cms', 'campaigns'] });
      toast.success(L('పంపబడింది.', 'Sent.'));
    },
    onError: (err) => toast.error(err),
  });

  const audienceLabel =
    audience === 'all'
      ? L('అందరు పాఠకులు', 'All readers')
      : audience === 'district'
        ? L('జిల్లా ఫాలోవర్లు', 'District followers')
        : L('విభాగ ఫాలోవర్లు', 'Category followers');
  const ready = Boolean(title.trim()) && (audience === 'all' || Boolean(audienceSlug));

  return (
    <AdminPage
      title={t('admin.page.notifications')}
      subtitle={L('పాఠకులకు ప్రకటనలు పంపండి', 'Compose and send reader alerts (§13); level-60 approval enforced by the API')}
    >
      <section>
        <SectionHeader title={L('కొత్త నోటిఫికేషన్', 'Compose')} tone="ink" />
        {/* No submit-on-Enter: the only way to send is the button, then the confirm. */}
        <Card>
          <div className="space-y-4">
            <Field label={L('శీర్షిక', 'Title (Telugu)')} required hint={`${title.length}/${TITLE_MAX}`}>
              <Input
                script="te"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX}
                placeholder="ముఖ్యమైన ప్రకటన…"
              />
            </Field>
            <Field label={L('వివరము', 'Body')} optionalLabel>
              <Textarea script="te" value={body} onChange={(e) => setBody(e.target.value)} rows={2} counter={BODY_MAX} autoGrow />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={L('శ్రోతలు', 'Audience')}>
                <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                  <option value="all">{L('అందరు పాఠకులు', 'All readers')}</option>
                  <option value="district">{L('జిల్లా ఫాలోవర్లు', 'District followers')}</option>
                  <option value="category">{L('విభాగ ఫాలోవర్లు', 'Category followers')}</option>
                </Select>
              </Field>
              {audience !== 'all' ? (
                <Field label="Slug" required>
                  <Input
                    script="en"
                    value={audienceSlug}
                    onChange={(e) => setAudienceSlug(e.target.value)}
                    placeholder={audience === 'district' ? 'guntur' : 'cinema'}
                  />
                </Field>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button icon={Send} disabled={!ready} pending={send.isPending} onClick={() => setConfirming(true)}>
              {L('పంపండి', 'Send now')}
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title={L('పంపిన నోటిఫికేషన్లు', 'Sent campaigns')} tone="ink" />
        {log.isError ? (
          <ErrorState error={log.error} onRetry={() => void log.refetch()} compact />
        ) : (
          <DataTable
            rows={log.data?.items ?? []}
            rowKey={(c) => c.id}
            loading={log.isLoading}
            caption={t('admin.page.notifications')}
            empty={<EmptyState icon={Bell} title={t('state.emptyTitle')} compact />}
            columns={[
              {
                key: 'title',
                header: L('శీర్షిక', 'Title'),
                lang: 'te',
                render: (c) => <span className="font-semibold">{c.title_te}</span>,
              },
              {
                key: 'audience',
                header: L('శ్రోతలు', 'Audience'),
                nowrap: true,
                render: (c) => (
                  <Badge size="xs" lang="en" className="font-mono">
                    {c.audience}
                  </Badge>
                ),
              },
              {
                key: 'sent',
                header: L('పంపిన', 'Sent'),
                align: 'right',
                nowrap: true,
                render: (c) => (
                  <Badge tone="success" size="xs" lang="en" className="tabular-nums">
                    {c.sent_count}
                  </Badge>
                ),
              },
              {
                key: 'created',
                header: L('పంపిన సమయం', 'Sent at'),
                lang: 'en',
                nowrap: true,
                hideBelow: 'md',
                render: (c) => <span className="text-muted">{dateTime(c.created_at)}</span>,
              },
            ]}
          />
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={L('పుష్ నోటిఫికేషన్ పంపాలా?', 'Send this push notification?')}
        body={
          <>
            {audienceLabel}
            {audience === 'all' ? '' : ` · ${audienceSlug}`} —{' '}
            <span lang="te" className="te">
              {title}
            </span>
          </>
        }
        confirmLabel={L('పంపండి', 'Send now')}
        tone="primary"
        pending={send.isPending}
        onConfirm={() => send.mutate()}
      />
    </AdminPage>
  );
}
