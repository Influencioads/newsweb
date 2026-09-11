import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import { Icon } from './Icon';
import { useScript } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Checkbox / Radio / Switch — 44px labelled rows over a visually-hidden native
 * input, so keyboard, forms and screen readers work for free.
 *
 *     <Checkbox checked={v} onChange={setV} label={t('ui.notifications')} />
 *     <Switch checked={dark} onChange={setDark} label={t('ui.darkMode')} hint={…} />
 */

export interface ChoiceProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  name?: string;
  value?: string;
  className?: string;
}

const PEER_FOCUS =
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand';

function ChoiceText({ label, hint }: Pick<ChoiceProps, 'label' | 'hint'>) {
  const s = useScript();
  return (
    <span className="min-w-0">
      <span className={cn(s.body, 'block text-ui-sm font-semibold text-ink')}>{label}</span>
      {hint && <span className={cn(s.body, 'block text-meta text-muted')}>{hint}</span>}
    </span>
  );
}

function Choice({ type, checked, onChange, label, hint, disabled, name, value, className }: ChoiceProps & { type: 'checkbox' | 'radio' }) {
  return (
    <label
      className={cn(
        'flex min-h-tap cursor-pointer items-start gap-3 py-2',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center border border-rule-strong bg-field text-on-brand',
          'transition-colors duration-base ease-standard peer-checked:border-brand peer-checked:bg-brand',
          // rounded-md (6px) is the accepted exception for a 20px box; rounded-xl would read as a circle.
          type === 'radio' ? 'rounded-pill' : 'rounded-md',
          PEER_FOCUS,
        )}
      >
        {type === 'radio' ? (
          <span className={cn('h-2 w-2 rounded-pill bg-on-brand', !checked && 'opacity-0')} />
        ) : (
          <Icon icon={Check} size="xs" strokeWidth={3} className={cn(!checked && 'opacity-0')} />
        )}
      </span>
      <ChoiceText label={label} hint={hint} />
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice type="checkbox" {...props} />;
}

export function Radio(props: ChoiceProps) {
  return <Choice type="radio" {...props} />;
}

export type SwitchProps = Omit<ChoiceProps, 'value'>;

export function Switch({ checked, onChange, label, hint, disabled, name, className }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex min-h-tap cursor-pointer items-start gap-3 py-2',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        name={name}
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-pill bg-rule-strong transition-colors duration-base ease-standard peer-checked:bg-brand',
          PEER_FOCUS,
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-pill bg-on-brand shadow-card transition-transform duration-base ease-standard',
            checked && 'translate-x-5',
          )}
        />
      </span>
      <ChoiceText label={label} hint={hint} />
    </label>
  );
}

