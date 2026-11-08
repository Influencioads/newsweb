import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, Trash2, UserPlus } from 'lucide-react';

import { AdminPage } from '@/components/admin/AdminPage';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { QueryState } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/api/client';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { cn } from '@/utils/cn';

import { useL } from './shared';

/**
 * CMS → Users. Staff sign in with Google: adding someone here (name, Gmail
 * address, role) is what lets that Google account into the CMS. Admins can
 * switch a person's access off (signed out everywhere at once), back on, or
 * remove it for good. Readers are listed on their own tab.
 *
 * API: GET /cms/users?kind=, POST /cms/users, PATCH/DELETE /cms/users/{id}
 * (backend app/api/v1/cms_staff.py).
 */

type Kind = 'staff' | 'readers';

interface UserRow {
  id: number;
  name_te: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  last_login_at: string | null;
  roles: { key: string; label_en: string; label_te: string }[];
}

interface RoleRow {
  key: string;
  label_en: string;
  label_te: string;
  level: number;
}

/** Roles a reader holds; never offered when adding staff. */
const READER_ROLES = new Set(['subscriber', 'contributor', 'panchayat_secretary']);

export function UsersAdminPage() {
  const { t, language } = useI18n();
  const te = language === 'te';
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const me = useAuth((st) => st.me);
  const canManage = useAuth((st) => st.can('user.manage'));
  const [kind, setKind] = useState<Kind>('staff');

  const users = useQuery({
    queryKey: ['cms', 'users', kind],
    queryFn: async () => (await api.get<{ items: UserRow[]; total: number }>('/cms/users', { params: { kind, limit: 100 } })).data,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cms', 'users'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'disabled' }) => api.patch(`/cms/users/${id}`, { status }),
    onSuccess: refresh,
    onError: (err) => toast.error(err),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/cms/users/${id}`),
    onSuccess: refresh,
    onError: (err) => toast.error(err),
  });

  const name = (u: UserRow) => (te ? u.name_te || u.name_en : u.name_en || u.name_te) || u.email || u.phone || `#${u.id}`;
  const active = (u: UserRow) => u.status.toLowerCase() === 'active';

  async function switchOff(u: UserRow) {
    const ok = await confirm({
      title: L(`${name(u)} యాక్సెస్ ఆపాలా?`, `Switch off ${name(u)}?`),
      body: L('వారు అన్ని పరికరాల్లో వెంటనే సైన్ అవుట్ అవుతారు. తర్వాత మళ్లీ ఆన్ చేయవచ్చు.', 'They are signed out on every device at once. You can switch them back on later.'),
      confirmLabel: L('ఆపండి', 'Switch off'),
      tone: 'danger',
    });
    if (ok) setStatus.mutate({ id: u.id, status: 'disabled' });
  }

  async function removeUser(u: UserRow) {
    const ok = await confirm({
      title: L(`${name(u)} ను తొలగించాలా?`, `Remove ${name(u)}?`),
      body: L('వారి యాక్సెస్ శాశ్వతంగా పోతుంది. మళ్లీ కావాలంటే కొత్తగా జోడించాలి.', 'Their access is removed for good. To let them back in, add them again.'),
      confirmLabel: L('తొలగించండి', 'Remove'),
      tone: 'danger',
    });
    if (ok) remove.mutate(u.id);
  }

  return (
    <AdminPage
      title={t('admin.page.users')}
      subtitle={L(
        'సిబ్బంది గూగుల్‌తో సైన్ ఇన్ చేస్తారు. ఇక్కడ జోడించిన జీమెయిల్ చిరునామాలకే CMS అనుమతి.',
        'Staff sign in with Google. Only the Gmail addresses added here can get into the CMS.',
      )}
    >
      {dialog}
      {canManage && kind === 'staff' ? <AddStaff onAdded={refresh} /> : null}

      <Tabs
        ariaLabel={L('వినియోగదారులు', 'Users')}
        className="mb-4"
        items={[
          { key: 'staff', label: L('సిబ్బంది', 'Staff') },
          { key: 'readers', label: L('పాఠకులు', 'Readers') },
        ]}
        value={kind}
        onChange={(key) => setKind(key === 'readers' ? 'readers' : 'staff')}
      />

      <QueryState query={users}>
        {(data) => (
          <div className="space-y-2">
            <p className={cn(s.body, 'text-meta text-muted')}>
              {data.total} {L('ఖాతాలు', 'accounts')}
            </p>
            <ul className="space-y-2">
              {data.items.map((u) => (
                <li key={u.id}>
                  <Card padding="md" className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-sans text-ui font-semibold text-ink">
                        {name(u)}
                        {u.id === me?.user.id ? <Badge tone="muted" size="xs">{L('మీరు', 'You')}</Badge> : null}
                        <Badge tone={active(u) ? 'brand' : 'breaking'} size="xs">
                          {active(u) ? L('యాక్టివ్', 'Active') : L('ఆపబడింది', 'Switched off')}
                        </Badge>
                      </p>
                      <p className="font-sans text-meta text-muted">
                        {[u.email, u.phone, u.roles.map((r) => (te ? r.label_te : r.label_en)).join(', ')].filter(Boolean).join(' · ')}
                      </p>
                      <p className="font-sans text-meta text-muted">
                        {L('చివరి లాగిన్', 'Last sign-in')}: {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                      </p>
                    </div>
                    {canManage && u.id !== me?.user.id ? (
                      <div className="flex flex-wrap gap-2">
                        {active(u) ? (
                          <Button size="sm" variant="secondary" icon={Power} onClick={() => void switchOff(u)} pending={setStatus.isPending && setStatus.variables?.id === u.id}>
                            {L('ఆపండి', 'Switch off')}
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" icon={Power} onClick={() => setStatus.mutate({ id: u.id, status: 'active' })} pending={setStatus.isPending && setStatus.variables?.id === u.id}>
                            {L('ఆన్ చేయండి', 'Switch on')}
                          </Button>
                        )}
                        <Button size="sm" variant="danger" icon={Trash2} onClick={() => void removeUser(u)} pending={remove.isPending && remove.variables === u.id}>
                          {L('తొలగించండి', 'Remove')}
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        )}
      </QueryState>
    </AdminPage>
  );
}

function AddStaff({ onAdded }: { onAdded: () => void }) {
  const { language } = useI18n();
  const te = language === 'te';
  const L = useL();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('reporter');
  const roles = useQuery({
    queryKey: ['cms', 'roles'],
    queryFn: async () => (await api.get<{ items: RoleRow[] }>('/cms/roles')).data.items,
  });
  const add = useMutation({
    mutationFn: () => api.post('/cms/users', { email: email.trim(), name: name.trim(), role }),
    onSuccess: () => {
      toast.success(L('జోడించబడింది. వారు ఇప్పుడు గూగుల్‌తో సైన్ ఇన్ చేయవచ్చు.', 'Added. They can now sign in with Google.'));
      setEmail('');
      setName('');
      onAdded();
    },
    onError: (err) => toast.error(err),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (email.trim() && name.trim()) add.mutate();
  }

  return (
    <Card padding="md" className="mb-5">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end">
        <Field label={L('పేరు', 'Name')} htmlFor="staff-name">
          <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={L('జీమెయిల్ / గూగుల్ చిరునామా', 'Gmail / Google address')} htmlFor="staff-email">
          <Input id="staff-email" type="email" script="en" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
        </Field>
        <Field label={L('పాత్ర', 'Role')} htmlFor="staff-role">
          <Select id="staff-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {(roles.data ?? [])
              .filter((r) => !READER_ROLES.has(r.key))
              .map((r) => (
                <option key={r.key} value={r.key}>
                  {te ? r.label_te : r.label_en}
                </option>
              ))}
          </Select>
        </Field>
        <Button type="submit" icon={UserPlus} pending={add.isPending} disabled={!email.trim() || !name.trim()}>
          {L('జోడించండి', 'Add staff')}
        </Button>
      </form>
    </Card>
  );
}
