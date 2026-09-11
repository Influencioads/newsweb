import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from './Button';
import { Dialog } from './Dialog';
import { Field, Input, Select, Textarea } from './Field';
import { useI18n } from '@/i18n';

/**
 * PromptDialog — a small form in a Dialog; the replacement for `window.prompt`.
 *
 * Values reset on every open. The caller owns `open` and closes after a
 * successful `onSubmit` (keeping it open on a failed mutation is then free).
 * Native `required` validation applies before `onSubmit` fires.
 *
 *     <PromptDialog open={open} onClose={close} title={t('ui.edit')}
 *       fields={[{ name: 'title', label: t('ui.edit'), required: true }]}
 *       onSubmit={async (v) => { await rename(v.title); close(); }} />
 */

export interface PromptField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'url' | 'date';
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
}

export interface PromptDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  fields: PromptField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  pending?: boolean;
}

/** Mounted only while open, so values reset on every open. */
function PromptForm({
  id,
  fields,
  onSubmit,
}: {
  id: string;
  fields: PromptField[];
  onSubmit: PromptDialogProps['onSubmit'];
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? f.options?.[0]?.value ?? ''])),
  );
  const set = (name: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit(values);
  };
  return (
    <form id={id} onSubmit={submit} className="flex flex-col gap-4">
      {fields.map((f, i) => {
        const fid = `${id}-${f.name}`;
        const common = {
          id: fid,
          name: f.name,
          required: f.required,
          placeholder: f.placeholder,
          value: values[f.name] ?? '',
          onChange: set(f.name),
          'data-autofocus': i === 0 ? '' : undefined,
        };
        return (
          <Field key={f.name} label={f.label} hint={f.hint} required={f.required} htmlFor={fid}>
            {f.type === 'textarea' ? (
              <Textarea {...common} rows={3} autoGrow />
            ) : f.type === 'select' ? (
              <Select {...common}>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input {...common} type={f.type ?? 'text'} />
            )}
          </Field>
        );
      })}
    </form>
  );
}

export function PromptDialog({
  open,
  onClose,
  title,
  description,
  fields,
  submitLabel,
  onSubmit,
  pending,
}: PromptDialogProps) {
  const { t } = useI18n();
  const formId = `${useId()}-form`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('ui.cancel')}
          </Button>
          <Button type="submit" form={formId} pending={pending}>
            {submitLabel ?? t('ui.save')}
          </Button>
        </>
      }
    >
      <PromptForm id={formId} fields={fields} onSubmit={onSubmit} />
    </Dialog>
  );
}
