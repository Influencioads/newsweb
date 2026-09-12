import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Film, Plus, Trash2 } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { StatusPill } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { SectionHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { useL } from './shared';

/** §15 Videos admin — YouTube links only: paste a URL, it joins the hub. */

type VideoRow = {
  id: number;
  youtube_id: string;
  thumbnail_url: string;
  watch_url: string;
  title_te: string;
  is_published: boolean;
  published_at: string | null;
};

export function VideosAdminPage() {
  const { t } = useI18n();
  const L = useL();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [tab, setTab] = useState('all');
  const list = useQuery({ queryKey: ['cms', 'videos'], queryFn: () => cmsApi.fetchCmsVideos<{ items: VideoRow[] }>() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'videos'] });
  const add = useMutation({
    mutationFn: () => cmsApi.addCmsVideo({ youtube_url: url, title_te: title, category_slug: categorySlug || null }),
    onSuccess: () => {
      setUrl('');
      setTitle('');
      invalidate();
      toast.success(t('state.saved'));
    },
    onError: (err) => toast.error(err),
  });
  const toggle = useMutation({
    mutationFn: (video: VideoRow) => cmsApi.patchCmsVideo(video.id, { is_published: !video.is_published }),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.updated'));
    },
    onError: (err) => toast.error(err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => cmsApi.deleteCmsVideo(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('state.deleted'));
    },
    onError: (err) => toast.error(err),
  });

  const titleOf = (v: VideoRow) => (
    <span lang="te" className="te">
      {v.title_te}
    </span>
  );
  const del = async (v: VideoRow) => {
    const ok = await confirm({ title: t('state.confirmDelete'), body: titleOf(v), tone: 'danger', confirmLabel: t('ui.delete') });
    if (ok) remove.mutate(v.id);
  };
  /** Publishing is direct; pulling a live video from the hub is confirmed first. */
  const unpublish = async (v: VideoRow) => {
    if (
      v.is_published &&
      !(await confirm({ title: L('వీడియోను దాచాలా?', 'Unpublish this video?'), body: titleOf(v), tone: 'danger', confirmLabel: L('దాచండి', 'Unpublish') }))
    )
      return;
    toggle.mutate(v);
  };

  const items = list.data?.items ?? [];
  const rows = tab === 'all' ? items : items.filter((v) => v.is_published === (tab === 'published'));
  const tabLabel = tab === 'all' ? t('ui.showAll') : tab === 'published' ? L('ప్రచురితం', 'Published') : L('దాచబడింది', 'Hidden');

  return (
    <AdminPage
      title={t('admin.page.videos')}
      subtitle={L('YouTube లింక్ అతికించండి — హబ్‌లో చేరుతుంది', 'YouTube links only — paste a URL, it joins the hub (§15)')}
    >
      <section>
        <SectionHeader title={L('వీడియో జోడించండి', 'Add a video')} tone="ink" />
        <Card
          as="form"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-4 md:grid-cols-[2fr_2fr_1fr]">
            <Field label="YouTube URL" required>
              <Input
                script="en"
                className="font-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtu.be/…"
              />
            </Field>
            <Field label={L('శీర్షిక', 'Title (Telugu)')} required>
              <Input script="te" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="వీడియో శీర్షిక…" />
            </Field>
            <Field label="Category slug" optionalLabel>
              <Input script="en" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} placeholder="cinema" />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" icon={Plus} disabled={!url.trim() || title.trim().length < 3} pending={add.isPending}>
              {t('ui.add')}
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <Tabs
          ariaLabel={t('admin.page.videos')}
          className="mb-4"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'all', label: t('ui.showAll'), count: items.length },
            { key: 'published', label: L('ప్రచురితం', 'Published'), count: items.filter((v) => v.is_published).length },
            { key: 'hidden', label: L('దాచబడింది', 'Hidden'), count: items.filter((v) => !v.is_published).length },
          ]}
        />
        <div role="tabpanel" aria-label={tabLabel}>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(v) => v.id}
            loading={list.isLoading}
            caption={t('admin.page.videos')}
            empty={<EmptyState icon={Film} title={L('వీడియోలు లేవు.', 'No videos yet.')} compact />}
            columns={[
              {
                key: 'thumb',
                header: t('state.photo'),
                width: 'w-32',
                render: (v) => (
                  <img
                    src={v.thumbnail_url}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-28 rounded-xl bg-placeholder object-cover"
                  />
                ),
              },
              {
                key: 'title',
                header: L('శీర్షిక', 'Title'),
                lang: 'te',
                render: (v) => <span className="font-semibold">{v.title_te}</span>,
              },
              {
                key: 'youtube',
                header: 'YouTube',
                lang: 'en',
                nowrap: true,
                hideBelow: 'md',
                render: (v) => (
                  <ButtonLink to={v.watch_url} external variant="link" size="sm" className="font-mono text-info">
                    {v.youtube_id}
                  </ButtonLink>
                ),
              },
              {
                key: 'status',
                header: L('స్థితి', 'Status'),
                nowrap: true,
                render: (v) => <StatusPill status={v.is_published ? 'published' : 'hidden'} />,
              },
            ]}
            rowActions={(v) => (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={v.is_published ? EyeOff : Eye}
                  onClick={() => void unpublish(v)}
                  pending={toggle.isPending && toggle.variables?.id === v.id}
                >
                  {v.is_published ? L('దాచండి', 'Unpublish') : L('ప్రచురించండి', 'Publish')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash2}
                  onClick={() => void del(v)}
                  pending={remove.isPending && remove.variables === v.id}
                >
                  {t('ui.delete')}
                </Button>
              </>
            )}
          />
        )}
        </div>
      </section>
      {dialog}
    </AdminPage>
  );
}
