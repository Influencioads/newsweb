import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dialog } from '@/components/ui/Dialog';
import * as epaperApi from '@/features/epaper/api';
import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatDate, formatMonth, formatWeekday, isoDate } from '@/utils/time';

/**
 * The edition date picker — the toolbar's date button opens a month grid
 * (Monday first) with a quick list above it: today, yesterday, then the
 * latest published days. Only a day that has a published edition is a link;
 * the rest are dimmed text. The set of available days comes from the public
 * archive (a year of it), cached in the query layer like everything else.
 */

const ARCHIVE_LIMIT = 365;
const TE_DAYS = ['సో', 'మం', 'బు', 'గు', 'శు', 'శ', 'ఆ'];
const EN_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** `YYYY-MM-DD` as a local date (no UTC shift). */
function localDate(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Published edition dates, newest first, shared by every reader instance. */
export function useEditionDates() {
  return useQuery({
    queryKey: ['epaper-archive', ARCHIVE_LIMIT],
    queryFn: () => epaperApi.fetchEpaperArchive(ARCHIVE_LIMIT),
    staleTime: 5 * 60_000,
    select: (d) => d.items.map((e) => e.edition_date),
  });
}

export interface EpaperDatePickerProps {
  /** The open edition's date. */
  current: string;
  className?: string;
}

export function EpaperDatePicker({ current, className }: EpaperDatePickerProps) {
  const { language } = useI18n();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(localDate(current)));
  const dates = useEditionDates();
  const available = new Set(dates.data ?? []);
  const today = isoDate(new Date());
  const yesterday = isoDate(addDays(new Date(), -1));

  const quick = [
    { iso: today, label: L('ఈ రోజు', 'Today') },
    { iso: yesterday, label: L('నిన్న', 'Yesterday') },
    ...(dates.data ?? [])
      .filter((d) => d !== today && d !== yesterday)
      .slice(0, 5)
      .map((d) => ({ iso: d, label: `${formatWeekday(localDate(d), language)} · ${formatDate(d, language)}` })),
  ];

  const firstOfMonth = month;
  const offset = (firstOfMonth.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const openPicker = () => {
    setMonth(startOfMonth(localDate(current)));
    setOpen(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={CalendarDays}
        aria-haspopup="dialog"
        onClick={openPicker}
        className={cn('-ml-3 font-sans tabular-nums text-muted', className)}
      >
        {formatDate(current, language)}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={L('ఎడిషన్ ఎంచుకోండి', 'Pick an edition')}>
        <div className="flex flex-wrap gap-2">
          {quick.map((q) =>
            available.has(q.iso) ? (
              <Chip key={q.iso} as="link" to={`/epaper/${q.iso}`} selected={q.iso === current} onClick={() => setOpen(false)}>
                {q.label}
              </Chip>
            ) : (
              <Chip key={q.iso} as="span" size="sm" className="opacity-60">
                {q.label}
              </Chip>
            ),
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <IconButton
            icon={ChevronLeft}
            label={L('మునుపటి నెల', 'Previous month')}
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          />
          <h3 className={cn(language === 'te' ? 'th' : 'font-serif', 'text-headline-xs font-bold text-ink')} aria-live="polite">
            {formatMonth(month, language)}
          </h3>
          <IconButton
            icon={ChevronRight}
            label={L('తదుపరి నెల', 'Next month')}
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          />
        </div>

        <div role="grid" aria-label={formatMonth(month, language)} className="mt-2 grid grid-cols-7 gap-1">
          {(language === 'te' ? TE_DAYS : EN_DAYS).map((d, i) => (
            <div key={i} role="columnheader" className={cn(language === 'te' ? 'te' : 'font-sans', 'py-1 text-center text-meta font-semibold text-muted')}>
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} role="gridcell" aria-hidden />;
            const iso = isoDate(new Date(month.getFullYear(), month.getMonth(), day));
            const isToday = iso === today;
            const name = `${formatDate(iso, language)}${isToday ? ` · ${L('ఈ రోజు', 'Today')}` : ''}`;
            const cell = 'flex min-h-tap items-center justify-center rounded-xl font-sans text-ui tabular-nums';
            return (
              <div key={iso} role="gridcell">
                {available.has(iso) ? (
                  <Link
                    to={`/epaper/${iso}`}
                    aria-label={name}
                    aria-current={iso === current ? 'date' : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      cell,
                      'font-semibold transition-[colors,transform,box-shadow] duration-base ease-standard',
                      iso === current ? 'bg-brand text-on-brand' : 'bg-brand-tint text-brand hover:bg-brand hover:text-on-brand',
                      isToday && 'ring-2 ring-exclusive',
                    )}
                  >
                    {day}
                  </Link>
                ) : (
                  <span aria-label={name} aria-disabled="true" className={cn(cell, 'text-muted-light', isToday && 'ring-2 ring-exclusive')}>
                    {day}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}
