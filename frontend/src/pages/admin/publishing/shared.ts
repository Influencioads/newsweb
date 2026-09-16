import type { BadgeTone } from '@/components/ui/Badge';
import type { EpaperSlotSize } from '@/types/epaper';

/**
 * Bits shared by the publishing admin pages (E-Paper, polls).
 */

export { useL } from '../useL';

/** Layouts the backend accepts for e-paper pages and templates (`schemas/epaper.py`). */
export const LAYOUTS = ['lead_grid', 'two_column', 'three_column', 'image_lead', 'briefs', 'breaking'] as const;
export type LayoutType = (typeof LAYOUTS)[number];

/** Slots per layout — label counts only; the geometry itself comes in the page JSON (`epaper_layouts.LAYOUTS`). */
export const LAYOUT_SLOTS: Record<LayoutType, number> = {
  lead_grid: 9,
  two_column: 8,
  three_column: 12,
  image_lead: 7,
  briefs: 15,
  breaking: 4,
};

/** `<Select>` options for a layout, with the slot count in the label. */
export const layoutOptions = (L: (te: string, en: string) => string) =>
  LAYOUTS.map((value) => ({ value, label: `${value} · ${LAYOUT_SLOTS[value]} ${L('స్లాట్‌లు', 'slots')}` }));

export const SIZE_TONE: Record<EpaperSlotSize, BadgeTone> = { lead: 'brand', standard: 'info', brief: 'muted' };

export const SIZE_LABEL: Record<EpaperSlotSize, { te: string; en: string }> = {
  lead: { te: 'ప్రధాన', en: 'Lead' },
  standard: { te: 'సాధారణ', en: 'Standard' },
  brief: { te: 'సంక్షిప్త', en: 'Brief' },
};
