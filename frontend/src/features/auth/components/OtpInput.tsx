import { useEffect, useRef, type KeyboardEvent } from 'react';

import { cn } from '@/utils/cn';

/**
 * Segmented code input (mockup 1k).
 *
 * Real inputs, not styled divs: field staff use password managers and SMS
 * autofill, and `autoComplete="one-time-code"` is what makes the iOS/Android
 * keyboard offer the code. Pasting or autofilling the whole code arrives as a
 * multi-character change on one box and fills every box from the start.
 *
 * Each box is 44×48 (the tap floor on the narrow axis), carries its own
 * `aria-label` ("OTP code 3" — a spoken "3/6" is unreliable, so the total sits
 * on the group instead) and sits in a labelled `role="group"`.
 * `onComplete` fires once the last digit lands, so a caller can submit without
 * the reader reaching for a button.
 *
 *     <OtpInput id="otp-0" label={t('…')} value={otp} onChange={setOtp}
 *               onComplete={() => verify.mutate()} autoFocus />
 */
export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Accessible name of the group ("<label> (6)"); each box is named "<label> N". */
  label: string;
  /** Id of the first box, so an enclosing Field can point its <label> at it. */
  id: string;
  /** Called with the full code the moment every box is filled. */
  onComplete?: (value: string) => void;
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  autoFocus = false,
  label,
  id,
  onComplete,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // Latest callback without re-arming the completion effect on every render.
  const complete = useRef(onComplete);
  complete.current = onComplete;

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // Fires on the transition into "full", so a backspace-then-retype submits again.
  useEffect(() => {
    if (value.length === length) complete.current?.(value);
  }, [value, length]);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function setDigit(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, length));
  }

  function handleChange(index: number, raw: string) {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      setDigit(index, '');
      return;
    }
    if (cleaned.length > 1) {
      // Pasted or autofilled the whole code.
      onChange(cleaned.slice(0, length));
      refs.current[Math.min(cleaned.length, length - 1)]?.focus();
      return;
    }
    setDigit(index, cleaned);
    if (index < length - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault();
      setDigit(index - 1, '');
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="sr-only">
        {label} ({length})
      </span>
      {/* 6 × 44px + gaps outgrows a padded card below ~360px, so the row
          scrolls rather than shrinking the boxes under the tap floor. */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto py-1">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={i === 0 ? id : undefined}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={length}
            value={digit}
            disabled={disabled}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
            className={cn(
              'h-tap-lg w-tap shrink-0 rounded-xl bg-field text-center font-sans text-headline-sm font-bold text-ink',
              'outline-none transition-[colors,transform,box-shadow,opacity] duration-base ease-standard',
              digit ? 'border-2 border-brand' : 'border border-rule-input',
              'focus:border-2 focus:border-brand disabled:opacity-60',
            )}
          />
        ))}
      </div>
    </div>
  );
}
