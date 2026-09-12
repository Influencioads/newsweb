import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, PinOff, Timer } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { dateTime, useL } from './shared';

/** §8 / §19 Pinned news — editorial slots with automatic expiry. */

type PinRow = {
  id: number;
  article_title_te: string | null;
  article_short_id: string | null;
  placement: string;
  starts_at: string;
  ends_at: string;
  active: boolean;
  seconds_remaining: number;
  note: string | null;
};

/** §8 presets. Minutes, because pinning for five while a story develops is the
 *  real newsroom action the old 1h floor made impossible. */
const PIN_PRESETS: Array<[string, string]> = [
  ['5', '5m'],
  ['10', '10m'],
  ['15', '15m'],
  ['30', '30m'],
  ['60', '1h'],
  ['180', '3h'],
  ['360', '6h'],
  ['720', '12h'],
  ['1440', '24h'],
  ['4320', '3d'],
];

/** Live countdown for an active pin (§8 "show remaining time"). */
function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
  }, [seconds]);
  const running = left > 0;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (left <= 0) return <StatusPill status="expired" />;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  return (
    <Badge tone="brand" size="xs" icon={Timer} lang="en" className="tabular-nums">
      {h ? `${h}h ` : ''}
      {String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}
    </Badge>
  );
}

export function PinsPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const [articleId, setArticleId] = useState('');
  const [placement, setPlacement] = useState('home');
  const [scopeSlug, setScopeSlug] = useState('');
  const [minutes, setMinutes] = useState('1440');
  const pins = useQuery({ queryKey: ['cms', 'pins'], queryFn: () => cmsApi.fetchPins<{ items: PinRow[] }>() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'pins'] });
  const create = useMutation({
    mutationFn: () =>
      cmsApi.createPin({
        article_id: Number(articleId),
        placement,
        category_slug: placement === 'category' ? scopeSlug : null,
        district_slug: placement === 'local' ? scopeSlug : null,
        duration_minutes: Number(minutes),
      }),
    onSuccess: () => {
      setArticleId('');
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => cmsApi.removePin(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });

  const unpin = async (p: PinRow) => {
    const ok = await confirm({
      title: L('పిన్ తీసివేయాలా?', 'Unpin this story?'),
      body: (
        <span lang="te" className="te">
          {p.article_title_te ?? p.article_short_id ?? ''}
        </span>
      ),
      confirmLabel: L('తీసివేయండి', 'Unpin'),
      tone: 'danger',
    });
    if (ok) remove.mutate(p.id);
  };

  return (
    <AdminPage
      title={t('admin.page.pins')}
      subtitle={L('ఆటోమేటిక్ గడువుతో సంపాదకీయ స్లాట్లు', 'Editorial slots with automatic expiry (§9)')}
    >
      <section>
        <SectionHeader title={L('కొత్త పిన్', 'New pin')} tone="ink" />
        <Card
          as="form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Article ID" required>
              <Input
                script="en"
                inputMode="numeric"
                value={articleId}
                onChange={(e) => setArticleId(e.target.value.replace(/\D/g, ''))}
                placeholder="123"
              />
            </Field>
            <Field label={L('స్థానం', 'Placement')}>
              <Select script="en" value={placement} onChange={(e) => setPlacement(e.target.value)}>
                <option value="home">Home top</option>
                <option value="category">Category top</option>
                <option value="local">Local top</option>
                <option value="breaking">Breaking ticker</option>
              </Select>
            </Field>
            {placement !== 'home' ? (
              <Field label={placement === 'category' ? 'Category slug' : 'District slug'}>
                <Input
                  script="en"
                  value={scopeSlug}
                  onChange={(e) => setScopeSlug(e.target.value)}
                  placeholder={placement === 'category' ? 'cinema' : 'guntur'}
                />
              </Field>
            ) : null}
            <Field label={L('వ్యవధి', 'Duration')}>
              <Select script="en" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
                {PIN_PRESETS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" icon={Pin} disabled={!articleId} pending={create.isPending}>
              {L('పిన్ చేయండి', 'Pin it')}
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title={t('admin.page.pins')} tone="ink" />
        {pins.isError ? (
          <ErrorState error={pins.error} onRetry={() => void pins.refetch()} compact />
        ) : (
          <DataTable
            rows={pins.data?.items ?? []}
            rowKey={(p) => p.id}
            loading={pins.isLoading}
            caption={t('admin.page.pins')}
            empty={<EmptyState icon={Pin} title={L('పిన్‌లు లేవు.', 'No active pins.')} compact />}
            columns={[
              {
                key: 'placement',
                header: L('స్థానం', 'Placement'),
                nowrap: true,
                render: (p) => (
                  <Badge tone={p.active ? 'success' : 'muted'} size="xs" lang="en">
                    {p.placement}
                  </Badge>
                ),
              },
              {
                key: 'title',
                header: L('కథనం', 'Story'),
                lang: 'te',
                render: (p) => <span className="font-semibold">{p.article_title_te ?? p.article_short_id}</span>,
              },
              {
                key: 'ends',
                header: L('ముగింపు', 'Ends'),
                lang: 'en',
                nowrap: true,
                hideBelow: 'md',
                render: (p) => <span className="text-muted">{dateTime(p.ends_at)}</span>,
              },
              {
                key: 'remaining',
                header: L('మిగిలిన సమయం', 'Remaining'),
                nowrap: true,
                render: (p) => (p.active ? <Countdown seconds={p.seconds_remaining} /> : null),
              },
            ]}
            rowActions={(p) =>
              p.active ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon={PinOff}
                  onClick={() => void unpin(p)}
                  pending={remove.isPending && remove.variables === p.id}
                >
                  {L('తీసివేయండి', 'Unpin')}
                </Button>
              ) : null
            }
          />
        )}
      </section>
      {dialog}
    </AdminPage>
  );
}
