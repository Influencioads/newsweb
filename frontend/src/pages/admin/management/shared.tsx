import { useState, type ReactNode } from 'react';
import { Search, SearchX } from 'lucide-react';

import type { DataTableColumn } from '@/components/admin/DataTable';
import { Badge, StatusPill } from '@/components/ui/Badge';
import { Field, Input } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/State';
import { useI18n } from '@/i18n';

/**
 * Shared bits for the management pages (users, roles, audit, taxonomy, media,
 * moderation): the loose row shape the `/cms/<section>` endpoints return, the
 * cell formatter as a DataTable column factory, and one client-side search box.
 */

export { useL } from '../useL';

export type Row = Record<string, unknown>;
export type ListPayload = { items: Row[]; total: number };

export const rowKey = (row: Row): string => String(row.id ?? JSON.stringify(row));

const DASH = '—';

/**
 * Column factory. Cells format the way the legacy table did: null → dash,
 * booleans → yes/no badge, `status` → StatusPill, arrays → labels in the UI
 * language, `*_at` → local time. `*_te` columns are tagged Telugu, the rest
 * Latin; pass `lang: undefined` for a column whose values follow the UI language.
 */
export function useColumn() {
  const { t, language } = useI18n();
  const en = language === 'en';
  const render = (key: string) => (row: Row): ReactNode => {
    const item = row[key];
    if (item == null || item === '') return DASH;
    if (typeof item === 'boolean') {
      return (
        <Badge tone={item ? 'success' : 'muted'} size="xs">
          {t(item ? 'ui.yes' : 'ui.no')}
        </Badge>
      );
    }
    if (key === 'status') return <StatusPill status={String(item)} />;
    if (Array.isArray(item)) {
      const labels = item.map((x) =>
        typeof x === 'object' && x
          ? String((en ? (x as Row).label_en : (x as Row).label_te) ?? (x as Row).key ?? '')
          : String(x),
      );
      return labels.join(', ') || DASH;
    }
    const text = String(item);
    return key.endsWith('_at') ? new Date(text).toLocaleString('en-IN') : text;
  };
  return (key: string, header: string, opts: Partial<DataTableColumn<Row>> = {}): DataTableColumn<Row> => ({
    key,
    header,
    render: render(key),
    lang: key.endsWith('_te') ? 'te' : 'en',
    nowrap: key === 'status' || key.endsWith('_at'),
    ...opts,
  });
}

/** Client-side search over every value of a row: the box, the filtered rows, and the no-results node. */
export function useRowSearch(rows: Row[] | undefined) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  // ponytail: substring match over JSON.stringify(row); move to a server-side `search` param when a list outgrows one page.
  const filtered = q ? (rows ?? []).filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : (rows ?? []);
  const field = (
    <Field label={t('ui.search')} className="max-w-form">
      <Input
        type="search"
        leading={Search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('ui.search')}
        autoComplete="off"
      />
    </Field>
  );
  const empty = q ? <EmptyState icon={SearchX} title={t('state.noResults')} compact /> : undefined;
  return { filtered, field, empty };
}
