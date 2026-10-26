/** The day's slots, in hours IST (`bulletin_service.SLOTS`). */
export const SLOTS = [7, 9, 15, 17, 19, 21];

/** Each slot's show banner (black background, "Click To Listen" drawn in). Null off-schedule. */
export const bulletinArt = (slot: number | null | undefined) =>
  slot != null && SLOTS.includes(slot) ? `/bulletins/${slot}.webp` : null;
