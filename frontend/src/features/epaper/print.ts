import type { EpaperArticle, EpaperSlot } from '@/types/epaper';

/**
 * Geometry of the printed sheet — one broadsheet page as a fixed 1200 × 1860
 * canvas (aspect 0.645). Everything on it is placed in canvas px from these
 * constants, so a hotspot, a thumbnail and the print page all agree to the
 * pixel; the viewport scales the whole canvas with one `transform`.
 */
export const SHEET_W = 1200;
export const SHEET_H = 1860;
export const MARGIN = 36;
export const GUTTER = 18;
export const FOLIO_H = 34;
export const MASTHEAD_H = 170;
export const COLS = 6;
export const ROWS = 6;
/** (1128 − 5·18) / 6 */
export const COL_W = (SHEET_W - 2 * MARGIN - (COLS - 1) * GUTTER) / COLS;
export const CONTENT_W = SHEET_W - 2 * MARGIN;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the slot grid starts: under the folio, and under the masthead on page 1. */
export const contentTop = (pageNumber: number) =>
  MARGIN + FOLIO_H + (pageNumber === 1 ? MASTHEAD_H : 0) + 12;

export const rowHeight = (pageNumber: number, rows = ROWS) =>
  (SHEET_H - contentTop(pageNumber) - MARGIN - (rows - 1) * GUTTER) / rows;

/** Canvas rectangle of a slot. `rows` only differs from 6 for the legacy row layout. */
export function slotRect(slot: Pick<EpaperSlot, 'x' | 'y' | 'w' | 'h'>, pageNumber: number, rows = ROWS): Rect {
  const rowH = rowHeight(pageNumber, rows);
  return {
    left: MARGIN + slot.x * (COL_W + GUTTER),
    top: contentTop(pageNumber) + slot.y * (rowH + GUTTER),
    width: slot.w * COL_W + (slot.w - 1) * GUTTER,
    height: slot.h * rowH + (slot.h - 1) * GUTTER,
  };
}

/**
 * Pages from before the slot grid (and personal editions) carry no geometry:
 * full-width rows, the first a double-height lead. `rows` is the grid height
 * those rows imply — pass it back into `slotRect`.
 */
export function legacySlots(articles: EpaperArticle[], extraRows = 0): { slots: EpaperSlot[]; rows: number } {
  const slots = articles.map<EpaperSlot>((_, i) => ({
    index: i,
    x: 0,
    y: i === 0 ? 0 : i + 1,
    w: COLS,
    h: i === 0 ? 2 : 1,
    size: i === 0 ? 'lead' : 'standard',
  }));
  return { slots, rows: Math.max(1, articles.length + 1) + extraRows };
}
