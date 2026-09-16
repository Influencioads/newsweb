import type { EpaperSlot, EpaperSlotSize } from '@/types/epaper';

/**
 * Pure helpers for placing stories on a page's slots. The page JSON is the
 * source of truth (`slots` geometry, `articles[].slot`); these only compute the
 * next slot-aligned `article_ids` list a PATCH sends.
 */

/** Mirrors `epaper_layouts.SIZE_RANK`. */
export const SIZE_RANK: Record<EpaperSlotSize, number> = { brief: 0, standard: 1, lead: 2 };

/** Article ids aligned to the page's slots; `null` marks an empty slot. */
export function slotIds(page: { slots: EpaperSlot[]; articles: Array<{ id: number; slot: number }> }): (number | null)[] {
  const ids: (number | null)[] = page.slots.map(() => null);
  for (const a of page.articles) if (a.slot >= 0 && a.slot < ids.length) ids[a.slot] = a.id;
  return ids;
}

/** Put `id` into `slot`, clearing it from wherever else it sat on the page. */
export function placeAt(ids: (number | null)[], slot: number, id: number): (number | null)[] {
  return ids.map((x, i) => (i === slot ? id : x === id ? null : x));
}

export function swapSlots(ids: (number | null)[], a: number, b: number): (number | null)[] {
  const next = [...ids];
  const held = next[a] ?? null;
  next[a] = next[b] ?? null;
  next[b] = held;
  return next;
}

/**
 * Where a story of `size` should land: the empty slot whose budget is closest
 * to the story's without exceeding it (a lead fills a standard slot before a
 * brief one), then any empty slot at all; `null` when the page is full.
 */
export function firstEmptySlot(slots: EpaperSlot[], ids: (number | null)[], size: EpaperSlotSize): number | null {
  const empty = slots.filter((s) => ids[s.index] == null);
  const fit = empty
    .filter((s) => SIZE_RANK[s.size] <= SIZE_RANK[size])
    .sort((a, b) => SIZE_RANK[b.size] - SIZE_RANK[a.size] || a.index - b.index);
  return (fit[0] ?? empty[0])?.index ?? null;
}
