import { describe, expect, it } from 'vitest';

import type { EpaperSlot } from '@/types/epaper';

import { firstEmptySlot, placeAt, slotIds, swapSlots } from './slots';

const slot = (index: number, size: EpaperSlot['size']): EpaperSlot => ({ index, x: 0, y: index, w: 6, h: 1, size });
const SLOTS = [slot(0, 'lead'), slot(1, 'standard'), slot(2, 'brief'), slot(3, 'standard')];

describe('slots', () => {
  it('slotIds aligns article ids to slots and leaves gaps null', () => {
    const articles = [{ id: 7, slot: 2 }, { id: 9, slot: 0 }, { id: 11, slot: 99 }];
    expect(slotIds({ slots: SLOTS, articles })).toEqual([9, null, 7, null]);
  });

  it('placeAt fills the slot and dedupes the id elsewhere on the page', () => {
    expect(placeAt([9, null, 7, null], 1, 7)).toEqual([9, 7, null, null]);
    expect(placeAt([9, null, 7, null], 3, 5)).toEqual([9, null, 7, 5]);
  });

  it('swapSlots exchanges two slots, empties included', () => {
    expect(swapSlots([9, null, 7, null], 0, 1)).toEqual([null, 9, 7, null]);
    expect(swapSlots([9, null, 7, null], 2, 3)).toEqual([9, null, null, 7]);
  });

  it('firstEmptySlot prefers the closest slot no larger than the story, then falls back', () => {
    // A lead story: slot 0 (lead) is taken, so the standard slot 1 wins over brief slot 2.
    expect(firstEmptySlot(SLOTS, [9, null, null, null], 'lead')).toBe(1);
    // A brief story fits only brief slots when one is empty.
    expect(firstEmptySlot(SLOTS, [null, null, null, null], 'brief')).toBe(2);
    // No slot small enough: any empty slot, lowest index first.
    expect(firstEmptySlot(SLOTS, [null, 4, 7, 8], 'brief')).toBe(0);
    expect(firstEmptySlot(SLOTS, [1, 4, 7, 8], 'standard')).toBeNull();
  });
});
