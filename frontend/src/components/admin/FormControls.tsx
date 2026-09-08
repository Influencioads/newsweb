import { ReactNode } from 'react';

/**
 * Shared chrome for the §1 article form.
 *
 * §33 asks for an admin UI that reads as a considered form rather than a wall
 * of inputs, so the field label, hint and error live in one place and every
 * control inherits the same spacing and focus ring.
 */

export function Field({
  label, hint, error, required, children,
}: { label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="te mb-1 flex items-baseline gap-1.5 text-[12px] font-bold text-ink">
        {label}
        {required ? <span className="text-breaking" aria-hidden>*</span> : null}
        {hint ? <span className="te text-[11px] font-normal text-muted">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="te mt-1 block text-[11.5px] text-breaking">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-control border border-rule-input bg-white px-3 py-2.5 text-[14px] text-ink ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 ' +
  'dark:bg-surface dark:text-ink';

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-white p-5 shadow-card dark:bg-surface">
      <div className="mb-4 border-b border-rule pb-2.5">
        <h2 className="th text-[15px] font-bold text-ink">{title}</h2>
        {subtitle ? <p className="te mt-0.5 text-[12px] text-muted">{subtitle}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Toggle({
  checked, onChange, label, hint, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
      />
      <span>
        <span className="te block text-[13px] font-semibold text-ink">{label}</span>
        {hint ? <span className="te block text-[11.5px] leading-telugu text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
