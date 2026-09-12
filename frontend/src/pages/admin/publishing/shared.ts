/**
 * Bits shared by the publishing admin pages (E-Paper, polls).
 */

export { useL } from '../useL';

/** Layouts the backend accepts for e-paper pages and templates (`schemas/epaper.py`). */
export const LAYOUTS = ['lead_grid', 'two_column', 'three_column', 'image_lead', 'briefs', 'breaking'] as const;
