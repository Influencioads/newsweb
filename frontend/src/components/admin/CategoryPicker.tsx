import type { CmsCategoryOption } from '@/types/cms';

/**
 * §33 asks for categories as clickable chips rather than a dropdown — an
 * editor filing under Cinema should see every option at once, not hunt a
 * 19-item select.
 *
 * Subcategories appear only once a parent is chosen, and only that parent's
 * children, which is the same rule the server enforces on save.
 */
export function CategoryPicker({
  categories, categoryId, subcategoryId, onChange,
}: {
  categories: CmsCategoryOption[];
  categoryId: number | null;
  subcategoryId: number | null;
  onChange: (categoryId: number | null, subcategoryId: number | null) => void;
}) {
  const roots = categories.filter((c) => c.parent_id == null);
  const children = categoryId == null ? [] : categories.filter((c) => c.parent_id === categoryId);

  return (
    <div className="space-y-3">
      <div>
        <span className="te mb-1.5 block text-[12px] font-bold text-ink">
          విభాగం · Category <span className="text-breaking" aria-hidden>*</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {roots.map((c) => {
            const active = c.id === categoryId;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(active ? null : c.id, null)}
                className={`te min-h-[32px] rounded-chip border px-3 text-[12.5px] font-semibold transition ${
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-rule bg-white text-ink hover:border-brand hover:text-brand dark:bg-surface'
                }`}
              >
                {c.name_te}
              </button>
            );
          })}
        </div>
      </div>

      {children.length > 0 ? (
        <div>
          <span className="te mb-1.5 block text-[12px] font-bold text-ink">ఉప విభాగం · Subcategory</span>
          <div className="flex flex-wrap gap-1.5">
            {children.map((c) => {
              const active = c.id === subcategoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange(categoryId, active ? null : c.id)}
                  className={`te min-h-[30px] rounded-chip border px-2.5 text-[12px] transition ${
                    active
                      ? 'border-ai bg-ai-tint font-semibold text-ai'
                      : 'border-rule bg-white text-ink-soft hover:border-ai dark:bg-surface'
                  }`}
                >
                  {c.name_te}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
