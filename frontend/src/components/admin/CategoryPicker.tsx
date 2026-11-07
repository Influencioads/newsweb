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
 * A story can sit in up to MAX_CATEGORIES sections. The first one picked is
 * the main category (it gives the story's link and label); the others only
 * list the story on their pages too. Removing the main one promotes the next.
 *
 * Subcategories appear only once a main category is chosen, and only that
 * category's children, which is the same rule the server enforces on save.
 */
export const MAX_CATEGORIES = 4;

export interface CategoryPickerProps {
  categories: CmsCategoryOption[];
  categoryId: number | null;
  subcategoryId: number | null;
  extraIds: number[];
  onChange: (categoryId: number | null, subcategoryId: number | null, extraIds: number[]) => void;
  error?: ReactNode;
}

export function CategoryPicker({ categories, categoryId, subcategoryId, extraIds, onChange, error }: CategoryPickerProps) {
  const { language } = useI18n();
  const s = useScript();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const roots = categories.filter((c) => c.parent_id == null);
  const children = categoryId == null ? [] : categories.filter((c) => c.parent_id === categoryId);
  const legend = cn(s.body, 'mb-1.5 flex items-baseline gap-1.5 text-ui-sm font-semibold text-ink');

  const chosen = [...(categoryId == null ? [] : [categoryId]), ...extraIds.filter((id) => id !== categoryId)];
  const full = chosen.length >= MAX_CATEGORIES;
  const name = (id: number) => {
    const c = categories.find((x) => x.id === id);
    return c ? s.pick(c.name_te, c.name_en) : `#${id}`;
  };

  const toggle = (id: number) => {
    if (chosen.includes(id)) {
      const rest = chosen.filter((x) => x !== id);
      const main = rest[0] ?? null;
      // The subcategory belongs to the main category; it goes when that does.
      onChange(main, main === categoryId ? subcategoryId : null, rest.slice(1));
    } else if (!full) {
      const next = [...chosen, id];
      onChange(next[0] ?? null, next[0] === categoryId ? subcategoryId : null, next.slice(1));
    }
  };

  return (
    <div className="space-y-4">
      <fieldset className="min-w-0">
        <legend className={legend}>
          {L('విభాగం', 'Category')}
          <span aria-hidden className="text-breaking">
            *
          </span>
          <span className="font-normal text-muted">
            · {L(`${MAX_CATEGORIES} వరకు`, `up to ${MAX_CATEGORIES}`)} ({chosen.length}/{MAX_CATEGORIES})
          </span>
        </legend>
        <p className={cn(s.body, 'mb-2 text-meta text-muted')}>
          {L(
            'మొదట ఎంచుకున్నది ప్రధాన విభాగం (లింక్‌లో అదే వస్తుంది). మిగతా విభాగాల పేజీల్లోనూ ఈ కథనం కనిపిస్తుంది.',
            'The first one you pick is the main category (used in the link). The story also shows on the other categories’ pages.',
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {roots.map((c) => {
            const at = chosen.indexOf(c.id);
            const active = at >= 0;
            return (
              <Chip
                key={c.id}
                as="button"
                selected={active}
                disabled={!active && full}
                lang={s.forText(c.name_te, c.name_en).lang}
                onClick={() => toggle(c.id)}
              >
                {active ? (
                  <span aria-hidden className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-paper px-1 font-sans text-meta font-bold text-ink">
                    {at + 1}
                  </span>
                ) : null}
                {s.pick(c.name_te, c.name_en)}
              </Chip>
            );
          })}
        </div>
        {categoryId != null ? (
          <p className={cn(s.body, 'mt-2 text-meta text-ink')}>
            <span className="font-semibold">{L('ప్రధాన విభాగం:', 'Main category:')}</span> {name(categoryId)}
            {chosen.length > 1 ? (
              <>
                {' · '}
                <span className="font-semibold">{L('ఇవి కూడా:', 'Also in:')}</span> {chosen.slice(1).map(name).join(', ')}
              </>
            ) : null}
          </p>
        ) : null}
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
                <Chip key={c.id} as="button" selected={active} lang={s.forText(c.name_te, c.name_en).lang} onClick={() => onChange(categoryId, active ? null : c.id, extraIds)}>
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
