import { useEffect, useRef } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Mockup 1k uses 40x44 boxes for the OTP card and 34x38 for the TOTP step. */
  size?: 'lg' | 'sm';
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
  id: string;
}

/**
 * Segmented code input (mockup 1k).
 *
 * Real inputs, not styled divs: field staff use password managers and SMS
 * autofill, and `autoComplete="one-time-code"` is what makes the iOS/Android
 * keyboard offer the code. Paste of a full code fills every box.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  size = 'lg',
  disabled = false,
  autoFocus = false,
  label,
  id,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

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

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
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

  const box =
    size === 'lg'
      ? 'w-10 h-11 text-[17px]'
      : 'w-[34px] h-[38px] text-[15px] bg-white';

  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <div className="flex gap-1.5">
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
            className={[
              box,
              'rounded-control text-center font-sans font-bold text-ink outline-none transition-colors',
              digit ? 'border-2 border-brand' : 'border border-rule-input',
              'focus:border-2 focus:border-brand disabled:opacity-50',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  );
}
