import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';
import { EmptyState, Skeleton, SkeletonCard } from '@/components/ui/State';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * DataTable — the one list surface for CMS rows.
 *
 * From `md` a real `<table>` in a borderless Card (sticky header, hover rows,
 * horizontal scroll when the columns need it); below `md` every row becomes a
 * Card holding a `<dl>` of header / value pairs. Columns marked `hideBelow`
 * drop out of narrow layouts. Loading renders Skeleton rows, an empty `rows`
 * renders `empty` (default EmptyState). `onRowClick` is a pointer convenience
 * only — the row keeps its table semantics, so the keyboard path must be a real
 * control the caller renders (a headline `<Link>` or an edit button in
 * `rowActions`). Telugu (`lang: 'te'`) cells use the `te-body-xs` scale.
 *
 *     <DataTable rows={articles} rowKey={(a) => a.id} onRowClick={open}
 *       columns={[
 *         { key: 'title', header: L('శీర్షిక', 'Headline'), lang: 'te', render: (a) => a.title_te },
 *         { key: 'state', header: t('ui.settings'), hideBelow: 'md', render: (a) => <WorkflowPill status={a.workflow_state} /> },
 *       ]} />
 */
export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Tailwind width class for the column (`w-40`, `w-1/3`). */
  width?: string;
  align?: 'left' | 'right' | 'center';
  /** Cell content; defaults to `String(row[key])`. */
  render?: (row: Row) => ReactNode;
  hideBelow?: 'md' | 'lg';
  /** Script of the cell text when it is DB content in a known language. */
  lang?: 'te' | 'en';
  nowrap?: boolean;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  rowKey: (row: Row) => string | number;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  /** Trailing cell (md+) / footer strip (mobile) of controls; clicks there never trigger `onRowClick`. */
  rowActions?: (row: Row) => ReactNode;
  caption?: string;
  dense?: boolean;
  skeletonRows?: number;
}

const HIDE: Record<NonNullable<DataTableColumn<unknown>['hideBelow']>, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

const ALIGN: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

function cellValue<Row>(col: DataTableColumn<Row>, row: Row): ReactNode {
  if (col.render) return col.render(row);
  const raw = (row as Record<string, unknown>)[col.key];
  return raw == null ? '' : String(raw);
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading,
  empty,
  onRowClick,
  rowActions,
  caption,
  dense,
  skeletonRows = 6,
}: DataTableProps<Row>) {
  const { t } = useI18n();
  const s = useScript();
  const cellPad = dense ? 'px-4 py-2' : 'px-4 py-3';
  // Size rides with the script: Telugu DB content never drops below te-body-xs.
  const cellFont = (col: DataTableColumn<Row>) =>
    col.lang === 'te'
      ? 'te text-te-body-xs'
      : col.lang === 'en'
        ? 'font-sans text-ui-sm'
        : cn(s.body, s.te ? 'text-te-body-xs' : 'text-ui-sm');
  const stackCols = columns.filter((c) => !c.hideBelow);

  // Pointer-only: no role/tabIndex, so the row stays a row and the real
  // controls inside it (rowActions, headline links) keep their semantics.
  const rowClick = (row: Row) => (onRowClick ? { onClick: () => onRowClick(row) } : {});

  if (!loading && rows.length === 0) {
    return <Card padding="none">{empty ?? <EmptyState title={t('state.emptyTitle')} compact />}</Card>;
  }

  const status = loading ? (
    <span role="status" className="sr-only">
      {t('state.loading')}
    </span>
  ) : null;

  return (
    <div aria-busy={loading || undefined}>
      {status}

      {/* md+: the table */}
      <Card padding="none" className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead className="sticky top-0 z-10 bg-surface-sub">
              <tr className="border-b border-rule">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      cellPad,
                      s.body,
                      'text-ui-sm font-semibold text-muted',
                      ALIGN[col.align ?? 'left'],
                      col.hideBelow && HIDE[col.hideBelow],
                      col.width,
                      col.nowrap && 'whitespace-nowrap',
                    )}
                  >
                    {col.header}
                  </th>
                ))}
                {rowActions ? (
                  <th scope="col" className={cn(cellPad, 'w-px text-right')}>
                    <span className="sr-only">{t('ui.more')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: skeletonRows }, (_, i) => (
                    <tr key={i} aria-hidden className="border-b border-rule-soft last:border-b-0">
                      {columns.map((col) => (
                        <td key={col.key} className={cn(cellPad, col.hideBelow && HIDE[col.hideBelow])}>
                          <Skeleton />
                        </td>
                      ))}
                      {rowActions ? <td className={cellPad} /> : null}
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      {...rowClick(row)}
                      className={cn(
                        'border-b border-rule-soft transition-[colors,transform,box-shadow,opacity] duration-base ease-standard last:border-b-0',
                        onRowClick && 'cursor-pointer hover:bg-paper-sub',
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          lang={col.lang}
                          className={cn(
                            cellPad,
                            cellFont(col),
                            'align-top text-ink',
                            ALIGN[col.align ?? 'left'],
                            col.hideBelow && HIDE[col.hideBelow],
                            col.nowrap && 'whitespace-nowrap',
                          )}
                        >
                          {cellValue(col, row)}
                        </td>
                      ))}
                      {rowActions ? (
                        <td
                          className={cn(cellPad, 'w-px whitespace-nowrap text-right align-top')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">{rowActions(row)}</div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* below md: one Card per row */}
      <ul className="space-y-3 md:hidden">
        {loading
          ? Array.from({ length: Math.min(skeletonRows, 3) }, (_, i) => (
              <li key={i} aria-hidden>
                <Card padding="sm">
                  <SkeletonCard variant="compact" />
                </Card>
              </li>
            ))
          : rows.map((row) => (
              <li key={rowKey(row)}>
                <Card padding="sm" interactive={Boolean(onRowClick)} className={cn(onRowClick && 'cursor-pointer')} {...rowClick(row)}>
                  <dl className="space-y-2">
                    {stackCols.map((col) => (
                      <div key={col.key} className="flex gap-3">
                        <dt className={cn(s.body, 'w-28 shrink-0 text-meta font-semibold text-muted')}>{col.header}</dt>
                        <dd
                          lang={col.lang}
                          className={cn(cellFont(col), 'min-w-0 flex-1 text-ink', ALIGN[col.align ?? 'left'])}
                        >
                          {cellValue(col, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {rowActions ? (
                    <div
                      className="mt-3 flex flex-wrap items-center gap-1 border-t border-rule-soft pt-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rowActions(row)}
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
      </ul>
    </div>
  );
}
