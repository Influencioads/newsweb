import { describe, expect, it } from 'vitest';

import { brandCss, luminance } from './brand';

describe('brandCss', () => {
  it('emits nothing when no colour is changed, so the designed palette is untouched', () => {
    expect(brandCss({})).toBe('');
  });

  it('ignores anything that is not #rrggbb', () => {
    expect(brandCss({ primary: 'red;}body{display:none' })).toBe('');
  });

  it('overrides only the changed colour, in both themes', () => {
    const css = brandCss({ primary: '#C0392B' });
    expect(css).toContain('html:root{--tn-brand:192 57 43;');
    expect(css).toContain('html.dark{--tn-brand:');
    expect(css).not.toContain('--tn-breaking');
  });

  it('keeps dark-mode brand readable and flips on-brand text for light fills', () => {
    const navy = brandCss({ primary: '#001f5b' });
    const dark = navy.split('html.dark{')[1]!.match(/--tn-brand:(\d+) (\d+) (\d+)/)!.slice(1).map(Number) as [number, number, number];
    expect(luminance(dark)).toBeGreaterThanOrEqual(0.24);
    expect(navy).toContain('--tn-on-brand:255 255 255');
    expect(brandCss({ primary: '#f5d000' })).toContain('--tn-on-brand:23 25 30');
  });
});
