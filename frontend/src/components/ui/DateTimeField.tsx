import { useI18n } from '@/i18n';
import { cn } from '@/utils/cn';

import { Input, Select } from './Field';

/**
 * A date and a time with AM / PM, in place of the browser's
 * `datetime-local`, whose picker follows the device and often shows a 24-hour
 * clock. `value` is the same local "YYYY-MM-DDTHH:mm" string a
 * `datetime-local` gives (blank: no time), so callers convert it exactly as
 * before. A line underneath says the chosen moment in words.
 */

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const pad = (n: number) => String(n).padStart(2, '0');

function split(value: string): { date: string; hour: number; minute: number; pm: boolean } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h24 = Number(m[2]);
  return { date: m[1]!, hour: h24 % 12 || 12, minute: Number(m[3]), pm: h24 >= 12 };
}

function join(date: string, hour: number, minute: number, pm: boolean): string {
  const h24 = (hour % 12) + (pm ? 12 : 0);
  return `${date}T${pad(h24)}:${pad(minute)}`;
}

export function DateTimeField({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { language } = useI18n();
  const te = language === 'te';
  const parts = split(value);
  // A time picked before the date: 10:00 AM until changed.
  const hour = parts?.hour ?? 10;
  const minute = parts?.minute ?? 0;
  const pm = parts?.pm ?? false;
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);
  const set = (change: Partial<{ date: string; hour: number; minute: number; pm: boolean }>) => {
    const date = change.date ?? parts?.date;
    if (!date) return;
    onChange(join(date, change.hour ?? hour, change.minute ?? minute, change.pm ?? pm));
  };
  const when = value ? new Date(value) : null;

  return (
    <div className={cn('space-y-2', className)}>
      <Input
        id={id}
        type="date"
        script="en"
        value={parts?.date ?? ''}
        disabled={disabled}
        aria-label={te ? 'తేదీ' : 'Date'}
        onChange={(e) => (e.target.value ? set({ date: e.target.value }) : onChange(''))}
      />
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <Select aria-label={te ? 'గంట' : 'Hour'} value={hour} disabled={disabled || !parts} onChange={(e) => set({ hour: Number(e.target.value) })}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
        <Select aria-label={te ? 'నిమిషం' : 'Minute'} value={minute} disabled={disabled || !parts} onChange={(e) => set({ minute: Number(e.target.value) })}>
          {minutes.map((m) => (
            <option key={m} value={m}>
              {pad(m)}
            </option>
          ))}
        </Select>
        <Select aria-label="AM / PM" value={pm ? 'PM' : 'AM'} disabled={disabled || !parts} onChange={(e) => set({ pm: e.target.value === 'PM' })}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </Select>
      </div>
      {when && !Number.isNaN(when.getTime()) ? (
        <p className="flex flex-wrap items-center justify-between gap-2 font-sans text-meta text-muted">
          <span>
            {when.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
          </span>
          {!disabled ? (
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => onChange('')}>
              {te ? 'తొలగించండి' : 'Clear'}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
