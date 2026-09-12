import { useQuery } from '@tanstack/react-query';

import { AdminPage } from '@/components/admin/AdminPage';
import { DataTable, type DataTableColumn } from '@/components/admin/DataTable';
import { QueryState } from '@/components/ui/State';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

import { rowKey, useColumn, useL, useRowSearch, type ListPayload, type Row } from './shared';

/**
 * Users, roles and audit log — one read-only `/cms/<section>` list each:
 * search box, record count, DataTable.
 */

function ListPage({
  section,
  title,
  subtitle,
  columns,
}: {
  section: string;
  title: string;
  subtitle: string;
  columns: DataTableColumn<Row>[];
}) {
  const L = useL();
  const s = useScript();
  const q = useQuery({ queryKey: ['cms', section], queryFn: () => cmsApi.fetchManagement<ListPayload>(section) });
  const search = useRowSearch(q.data?.items);
  return (
    <AdminPage title={title} subtitle={subtitle}>
      {search.field}
      <QueryState query={q} skeleton={<DataTable rows={[]} columns={columns} rowKey={rowKey} loading />}>
        {(data) => (
          <div className="space-y-3">
            <p className={cn(s.body, 'text-meta text-muted')}>
              {data.total} {L('రికార్డులు', 'records')}
            </p>
            <DataTable rows={search.filtered} columns={columns} rowKey={rowKey} empty={search.empty} caption={title} />
          </div>
        )}
      </QueryState>
    </AdminPage>
  );
}

export function UsersPage() {
  const { t, language } = useI18n();
  const L = useL();
  const col = useColumn();
  return (
    <ListPage
      section="users"
      title={t('admin.page.users')}
      subtitle={L('సిబ్బంది ఖాతాలు, స్థితి, పాత్రలు మరియు భద్రత', 'Staff accounts, status, roles, and security')}
      columns={[
        col(language === 'en' ? 'name_en' : 'name_te', L('పేరు', 'Name')),
        col('email', 'Email'),
        col('phone', L('ఫోన్', 'Phone'), { hideBelow: 'lg' }),
        col('status', L('స్థితి', 'Status')),
        col('roles', L('పాత్రలు', 'Roles'), { lang: undefined }),
        col('two_factor_enabled', '2FA', { hideBelow: 'lg' }),
        col('last_login_at', L('చివరి లాగిన్', 'Last login')),
      ]}
    />
  );
}

export function RolesPage() {
  const { t, language } = useI18n();
  const L = useL();
  const col = useColumn();
  return (
    <ListPage
      section="roles"
      title={t('admin.page.roles')}
      subtitle={L('పాత్ర పేరుకు బదులుగా permission key ఆధారంగా నియంత్రణ', 'Access is controlled by permission keys, not role names')}
      columns={[
        col(language === 'en' ? 'label_en' : 'label_te', L('పాత్ర', 'Role')),
        col('key', 'Key'),
        col('level', L('స్థాయి', 'Level'), { align: 'right' }),
        col('scope', L('డిఫాల్ట్ పరిధి', 'Default scope')),
        col('permissions', L('అనుమతులు', 'Permissions'), { lang: undefined }),
      ]}
    />
  );
}

export function AuditPage() {
  const { t } = useI18n();
  const L = useL();
  const col = useColumn();
  return (
    <ListPage
      section="audit"
      title={t('admin.page.audit')}
      subtitle={L('మార్చలేని సంపాదకీయ మరియు భద్రతా చర్యల చరిత్ర', 'Immutable history of editorial and security actions')}
      columns={[
        col('created_at', L('సమయం', 'Time')),
        col('actor', L('చేసినవారు', 'Actor')),
        col('action', L('చర్య', 'Action')),
        col('entity_type', L('ఎంటిటీ', 'Entity')),
        col('entity_id', 'ID'),
        col('ip', 'IP', { hideBelow: 'lg' }),
        col('request_id', 'Request ID', { hideBelow: 'lg' }),
      ]}
    />
  );
}
