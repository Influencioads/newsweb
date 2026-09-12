import type { ReactNode } from 'react';

import { Chip } from '@/components/ui/Chip';
import { useI18n, useScript } from '@/i18n';
import type { CmsCategoryOption } from '@/types/cms';
import { cn } from '@/utils/cn';

/**
 * §33 asks for categories as clickable chips rather than a dropdown — an
 * editor filing under Cinema should see every option at once, not hunt a
 * 19-item select.
 *
 * Subcategories appear only once a parent is chosen, and only that parent's
 * children, which is the same rule the server enforces on save.
 */
export interface CategoryPickerProps {
  categories: CmsCategoryOption[];
  categoryId: number | null;
  subcategoryId: number | null;
  onChange: (categoryId: number | null, subcategoryId: number | null) => void;
  error?: ReactNode;
}

export function CategoryPicker({ categories, categoryId, subcategoryId, onChange, error }: CategoryPickerProps) {
  const { language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const roots = categories.filter((c) => c.parent_id == null);
  const children = categoryId == null ? [] : categories.filter((c) => c.parent_id === categoryId);
  const legend = cn(s.body, 'mb-1.5 flex items-baseline gap-1.5 text-ui-sm font-semibold text-ink');

  return (
    <div className="space-y-4">
      <fieldset className="min-w-0">
        <legend className={legend}>
          {L('విభాగం', 'Category')}
          <span aria-hidden className="text-breaking">
            *
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {roots.map((c) => {
            const active = c.id === categoryId;
            return (
              <Chip key={c.id} as="button" selected={active} lang={s.forText(c.name_te, c.name_en).lang} onClick={() => onChange(active ? null : c.id, null)}>
                {s.pick(c.name_te, c.name_en)}
              </Chip>
            );
          })}
        </div>
        {error ? (
          <p role="alert" className={cn(s.body, 'mt-1.5 text-meta text-breaking')}>
            {error}
          </p>
        ) : null}
      </fieldset>

      {children.length > 0 ? (
        <fieldset className="min-w-0">
          <legend className={legend}>{L('ఉప విభాగం', 'Subcategory')}</legend>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => {
              const active = c.id === subcategoryId;
              return (
                <Chip key={c.id} as="button" selected={active} lang={s.forText(c.name_te, c.name_en).lang} onClick={() => onChange(categoryId, active ? null : c.id)}>
                  {s.pick(c.name_te, c.name_en)}
                </Chip>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
