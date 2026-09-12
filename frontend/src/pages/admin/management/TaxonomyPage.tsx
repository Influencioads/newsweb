import { useQuery } from '@tanstack/react-query';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable } from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/Badge';
import { SectionHeader } from '@/components/ui/Layout';
import { QueryState } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n } from '@/i18n';

import { rowKey, useColumn, useL, type Row } from './shared';

/** Taxonomy — the read-only catalogue of categories, districts and tags, one table each. */

type TaxonomyPayload = { categories: Row[]; districts: Row[]; tags: Row[] };

export function TaxonomyPage() {
  const { t } = useI18n();
  const L = useL();
  const col = useColumn();
  const q = useQuery({ queryKey: ['cms', 'taxonomy'], queryFn: () => cmsApi.fetchManagement<TaxonomyPayload>('taxonomy') });

  const name = col('name_te', L('పేరు', 'Name'));
  const active = col('active', L('క్రియాశీలం', 'Active'));
  const categories = [name, col('slug', 'Slug'), col('in_nav', L('నావిగేషన్', 'Navigation')), active];
  const groups: Array<{ key: keyof TaxonomyPayload; title: string; columns: typeof categories }> = [
    { key: 'categories', title: L('విభాగాలు', 'Categories'), columns: categories },
    { key: 'districts', title: L('జిల్లాలు', 'Districts'), columns: [name, col('state', L('రాష్ట్రం', 'State')), col('slug', 'Slug'), active] },
    {
      key: 'tags',
      title: L('ట్యాగ్‌లు', 'Tags'),
      columns: [name, col('type', L('రకం', 'Type')), col('usage_count', L('వినియోగం', 'Usage'), { align: 'right' }), active],
    },
  ];

  return (
    <AdminPage
      title={t('admin.page.taxonomy')}
      subtitle={L('విభాగాలు, జిల్లాలు మరియు ట్యాగ్‌ల కేంద్ర జాబితా', 'Central catalogue of sections, districts, and tags')}
    >
      <QueryState query={q} skeleton={<DataTable rows={[]} columns={categories} rowKey={rowKey} loading />}>
        {(data) =>
          groups.map((g) => (
            <section key={g.key} aria-label={g.title}>
              <SectionHeader
                title={g.title}
                tone="ink"
                action={
                  <Badge lang="en" className="tabular-nums">
                    {data[g.key].length}
                  </Badge>
                }
              />
              <DataTable rows={data[g.key]} columns={g.columns} rowKey={rowKey} caption={g.title} />
            </section>
          ))
        }
      </QueryState>
    </AdminPage>
  );
}
