import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Card } from '@/components/ui/Card';
import { EmptyState, SkeletonCard, QueryState } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { useReveal } from '@/utils/motion';

import { useL, useRowSearch, type ListPayload } from './shared';

/** Media library — every uploaded asset as a card: preview, filename, credit. */

const GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4';

export function MediaPage() {
  const { t } = useI18n();
  const L = useL();
  const s = useScript();
  const q = useQuery({ queryKey: ['cms', 'media'], queryFn: () => cmsApi.fetchManagement<ListPayload>('media') });
  const search = useRowSearch(q.data?.items);
  const reveal = useReveal<HTMLLIElement>();

  return (
    <AdminPage
      title={t('admin.page.media')}
      subtitle={L('లైసెన్స్, క్రెడిట్ మరియు AI మూలంతో ప్రచురణ ఆస్తులు', 'Publishing assets with licence, credit, and AI provenance')}
    >
      {search.field}
      <QueryState
        query={q}
        isEmpty={(d) => d.items.length === 0}
        skeleton={
          <div className={GRID}>
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} variant="grid" />
            ))}
          </div>
        }
        empty={<EmptyState icon={ImageIcon} title={L('ఇంకా మీడియా లేదు', 'No media yet')} />}
      >
        {() =>
          search.filtered.length === 0 ? (
            search.empty
          ) : (
            <ul className={GRID}>
              {search.filtered.map((x) => (
                <li key={String(x.id)} ref={reveal}>
                  <Card as="article" padding="none">
                    {String(x.mime).startsWith('image/') ? (
                      <img
                        src={String(x.url)}
                        alt={String(x.alt_te ?? '')}
                        loading="lazy"
                        className="aspect-video w-full rounded-t-xl bg-placeholder object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-t-xl bg-placeholder font-sans text-ui-sm font-semibold text-placeholder-text">
                        {String(x.type)}
                      </div>
                    )}
                    <div className="p-3">
                      <p lang="en" className="truncate font-sans text-ui-sm font-semibold text-ink">
                        {String(x.filename)}
                      </p>
                      <p className={cn(s.body, 'mt-1 text-meta text-muted')}>
                        {x.credit ? String(x.credit) : L('క్రెడిట్ లేదు', 'Credit not set')}
                      </p>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </AdminPage>
  );
}
