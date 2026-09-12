import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, LayoutGrid, Pencil } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink, IconButton } from '@/components/ui/Button';
import { PromptDialog, useConfirm } from '@/components/ui/Dialog';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { useL } from './shared';

/** §24 admin-controlled homepage: order, toggle, count — no deploy needed. */

type SectionRow = {
  id: number;
  key: string;
  kind: string;
  title_te: string | null;
  title_en: string | null;
  sort: number;
  is_enabled: boolean;
  item_count: number;
};

const COUNTS = [3, 4, 5, 6, 7, 8, 10];

export function HomepageSectionsPage() {
  const { t, pick } = useI18n();
  const { forText } = useScript();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const q = useQuery({
    queryKey: ['cms', 'home-sections'],
    queryFn: () => cmsApi.fetchHomeSections<{ items: SectionRow[] }>(),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'home-sections'] });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => cmsApi.patchHomeSection(id, body),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => cmsApi.reorderHomeSections(ids),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });
  const items = q.data?.items ?? [];

  function move(index: number, delta: number) {
    const next = [...items];
    const target = index + delta;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    reorder.mutate(next.map((s) => s.id));
  }

  /** Section title in the script actually shown (Telugu fallback tagged lang="te"). */
  const titleOf = (s: SectionRow, head = false) => {
    const a = forText(s.title_te, s.title_en);
    return (
      <span lang={a.lang} className={head ? a.head : a.cls}>
        {pick(s.title_te, s.title_en) || s.key}
      </span>
    );
  };

  /** Enable is direct; disabling pulls a block off the live front page, so it is confirmed. */
  const toggleEnabled = async (s: SectionRow) => {
    if (
      s.is_enabled &&
      !(await confirm({ title: L('ఈ విభాగాన్ని దాచాలా?', 'Disable this section?'), body: titleOf(s), tone: 'danger', confirmLabel: L('ఆపండి', 'Disable') }))
    )
      return;
    patch.mutate({ id: s.id, body: { is_enabled: !s.is_enabled } });
  };

  return (
    <AdminPage
      title={t('admin.page.homepage')}
      subtitle={L(
        'హోమ్ పేజీ బ్లాకుల క్రమం, స్థితి, పరిమాణం — మార్పులు వెంటనే అమలు',
        'Reorder, toggle and size the front-page blocks (§24); changes go live instantly',
      )}
      actions={
        // §24 "preview before publishing" — the cache purges on save, so the
        // live front page IS the preview; open it beside the editor.
        <ButtonLink to="/" external variant="secondary" iconRight={ExternalLink}>
          {L('హోమ్ ప్రివ్యూ', 'Preview homepage')}
        </ButtonLink>
      }
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : (
        <DataTable
          rows={items}
          rowKey={(s) => s.id}
          loading={q.isLoading}
          caption={t('admin.page.homepage')}
          empty={<EmptyState icon={LayoutGrid} title={t('state.emptyTitle')} compact />}
          columns={[
            {
              key: 'order',
              header: '#',
              lang: 'en',
              nowrap: true,
              render: (s) => {
                const i = items.indexOf(s);
                return (
                  <span className="flex items-center gap-1">
                    <span className="w-6 text-center font-extrabold text-muted">{i + 1}</span>
                    <IconButton
                      icon={ArrowUp}
                      label={L('పైకి', 'Move up')}
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || reorder.isPending}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label={L('కిందకు', 'Move down')}
                      onClick={() => move(i, 1)}
                      disabled={i === items.length - 1 || reorder.isPending}
                    />
                  </span>
                );
              },
            },
            {
              key: 'title',
              header: L('విభాగం', 'Section'),
              render: (s) => <span className={cn('font-semibold', !s.is_enabled && 'text-muted')}>{titleOf(s)}</span>,
            },
            {
              key: 'kind',
              header: L('రకం', 'Kind'),
              hideBelow: 'md',
              nowrap: true,
              render: (s) => (
                <Badge size="xs" lang="en" className="font-mono">
                  {s.kind}
                </Badge>
              ),
            },
            {
              key: 'count',
              header: L('కథనాలు', 'Stories'),
              lang: 'en',
              align: 'right',
              nowrap: true,
              render: (s) => <span className="tabular-nums">{s.item_count}</span>,
            },
            {
              key: 'status',
              header: L('స్థితి', 'Status'),
              nowrap: true,
              render: (s) => <StatusPill status={s.is_enabled ? 'enabled' : 'disabled'} />,
            },
          ]}
          rowActions={(s) => (
            <>
              <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(s)}>
                {t('ui.edit')}
              </Button>
              <Button
                variant={s.is_enabled ? 'ghost' : 'secondary'}
                size="sm"
                onClick={() => void toggleEnabled(s)}
                pending={patch.isPending && patch.variables?.id === s.id}
              >
                {s.is_enabled ? L('ఆపండి', 'Disable') : L('చూపించండి', 'Enable')}
              </Button>
            </>
          )}
        />
      )}

      <PromptDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? titleOf(editing, true) : ''}
        fields={[
          {
            name: 'item_count',
            label: L('కథనాలు', 'Stories'),
            type: 'select',
            defaultValue: String(editing?.item_count ?? ''),
            options: COUNTS.map((n) => ({ value: String(n), label: String(n) })),
          },
        ]}
        pending={patch.isPending}
        onSubmit={(v) => {
          if (!editing) return;
          // Failure already toasts via onError; the dialog stays open for a retry.
          patch
            .mutateAsync({ id: editing.id, body: { item_count: Number(v.item_count) } })
            .then(() => setEditing(null), () => undefined);
        }}
      />
      {dialog}
    </AdminPage>
  );
}
