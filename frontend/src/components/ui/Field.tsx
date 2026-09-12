import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';

import { Icon, type LucideIcon } from './Icon';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Form primitives — Field (label / hint / error), Input, Select, Textarea,
 * Checkbox, Radio, Switch, FileDrop.
 *
 * A Field owns the ids: it labels the control and wires `aria-describedby` /
 * `aria-invalid` onto whichever Input / Select / Textarea it wraps (through
 * context), so callers never hand-roll ids. A raw `<input className={inputClass}>`
 * still renders correctly but gets no label association — pass `htmlFor` + `id`
 * for that, or use `<Input>`.
 *
 *     <Field label={t('admin.headline')} required error={errors.title}>
 *       <Input script="te" value={v} onChange={…} />
 *     </Field>
 *     <Switch checked={on} onChange={setOn} label={t('ui.darkMode')} />
 */

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

interface FieldCtx {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldCtx | null>(null);

type Script = 'te' | 'en' | 'auto';

interface ControlA11y {
  id?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
}

/** Merge a control's own a11y props with what the enclosing Field provides. */
function useFieldControl(own: ControlA11y) {
  const ctx = useContext(FieldContext);
  return {
    id: own.id ?? ctx?.id,
    describedBy: own['aria-describedby'] ?? ctx?.describedBy,
    invalid: own.invalid ?? ctx?.invalid ?? false,
    required: ctx?.required ?? false,
  };
}

/** Font + size class for a control's value; `auto` follows the interface language. */
function useControlScript(script: Script = 'auto') {
  const s = useScript();
  const te = script === 'auto' ? s.te : script === 'te';
  return {
    cls: te ? 'te text-te-body-xs' : 'font-sans text-ui',
    lang: script === 'auto' ? undefined : script,
  };
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | null;
  required?: boolean;
  /** Id of the control. Generated when omitted; Input/Select/Textarea adopt it. */
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  /** Show an "optional" tag after the label (ignored when `required`). */
  optionalLabel?: boolean;
}

export function Field({ label, hint, error, required, htmlFor, children, className, optionalLabel }: FieldProps) {
  const { t } = useI18n();
  const s = useScript();
  const auto = useId();
  const id = htmlFor ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error), required: Boolean(required) }}>
      <div className={cn('block', className)}>
        <label
          htmlFor={id}
          className={cn(s.body, 'mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-ui-sm font-semibold text-ink')}
        >
          {label}
          {required && (
            <span aria-hidden className="text-breaking">
              *
            </span>
          )}
          {optionalLabel && !required && <span className="font-normal text-muted">({t('ui.optional')})</span>}
        </label>
        {children}
        {hint && (
          <p id={hintId} className={cn(s.body, 'mt-1.5 text-meta text-muted')}>
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className={cn(s.body, 'mt-1.5 text-meta text-breaking')}>
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Input / Select / Textarea
// ---------------------------------------------------------------------------

// The global :focus-visible outline (index.css) stays on: it sits 2px outside
// the subtle 20% ring, so keyboard focus is unmistakable while mouse focus is quiet.
const INPUT_BASE =
  'w-full min-h-tap rounded-xl border border-rule-input bg-field px-3 text-ink placeholder:text-muted ' +
  'transition-colors duration-base focus:border-brand focus:ring-2 focus:ring-brand/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Class string for a raw `<input>` / `<select>` / `<textarea>` (legacy admin
 * forms). 15.5px / 1.7 is right for both scripts — editors type Telugu body
 * copy into these — and matches what `<Input script="te">` renders.
 */
export const inputClass = `${INPUT_BASE} text-te-body-xs`;

const ADORN = 'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'md' | 'lg';
  invalid?: boolean;
  leading?: LucideIcon;
  /** Slot at the right edge — an icon, a unit, or a 44px IconButton. */
  trailing?: ReactNode;
  /** Script of the value; `auto` follows the interface language. */
  script?: Script;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', invalid, leading, trailing, script, className, id, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const field = useFieldControl({ id, 'aria-describedby': describedBy, invalid });
  const sc = useControlScript(script);
  const control = (
    <input
      ref={ref}
      id={field.id}
      lang={sc.lang}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      aria-required={field.required || undefined}
      className={cn(
        INPUT_BASE,
        sc.cls,
        size === 'lg' && 'min-h-tap-lg',
        leading && 'pl-10',
        trailing && 'pr-12',
        field.invalid && 'border-breaking',
        className,
      )}
      {...rest}
    />
  );
  if (!leading && !trailing) return control;
  return (
    <div className="relative w-full">
      {leading && <Icon icon={leading} size="sm" className={cn(ADORN, 'left-3')} />}
      {control}
      {trailing && <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>}
    </div>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'md' | 'lg';
  invalid?: boolean;
  script?: Script;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', invalid, script, className, id, 'aria-describedby': describedBy, ...rest },
  ref,
) {
  const field = useFieldControl({ id, 'aria-describedby': describedBy, invalid });
  const sc = useControlScript(script);
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        id={field.id}
        lang={sc.lang}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid || undefined}
        aria-required={field.required || undefined}
        className={cn(
          INPUT_BASE,
          sc.cls,
          'cursor-pointer appearance-none pr-10',
          size === 'lg' && 'min-h-tap-lg',
          field.invalid && 'border-breaking',
          className,
        )}
        {...rest}
      />
      <Icon icon={ChevronDown} size="sm" className={cn(ADORN, 'right-3')} />
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  script?: Script;
  /** Grow with the content instead of scrolling. */
  autoGrow?: boolean;
  /** Max length; shows `n/max` under the box and sets `maxLength`. */
  counter?: number;
}

function grow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    invalid,
    script,
    autoGrow,
    counter,
    className,
    id,
    'aria-describedby': describedBy,
    onChange,
    value,
    defaultValue,
    maxLength,
    rows = 4,
    ...rest
  },
  ref,
) {
  const field = useFieldControl({ id, 'aria-describedby': describedBy, invalid });
  const sc = useControlScript(script);
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [len, setLen] = useState(() => String(value ?? defaultValue ?? '').length);
  const count = value != null ? String(value).length : len;

  useEffect(() => {
    if (autoGrow && inner.current) grow(inner.current);
  }, [autoGrow, value]);

  return (
    <>
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        id={field.id}
        lang={sc.lang}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        maxLength={counter ?? maxLength}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid || undefined}
        aria-required={field.required || undefined}
        onChange={(e) => {
          if (autoGrow) grow(e.currentTarget);
          if (value == null) setLen(e.currentTarget.value.length);
          onChange?.(e);
        }}
        className={cn(
          INPUT_BASE,
          sc.cls,
          'py-2.5',
          autoGrow ? 'resize-none' : 'resize-y',
          field.invalid && 'border-breaking',
          className,
        )}
        {...rest}
      />
      {counter != null && (
        <p aria-live="polite" className="mt-1 text-right font-sans text-meta tabular-nums text-muted">
          {count}/{counter}
        </p>
      )}
    </>
  );
});

// Siblings, re-exported so `@/components/ui/Field` stays the one import.
export { Checkbox, Radio, Switch, type ChoiceProps, type SwitchProps } from './Choice';
export { FileDrop, type FileDropPreview, type FileDropProps } from './FileDrop';
