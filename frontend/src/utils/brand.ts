/**
 * Admin-set brand colours (Settings → Branding) as a stylesheet over the
 * `--tn-*` tokens in assets/index.css.
 *
 * `/public/config` sends only the colours an admin changed, so a default one
 * emits nothing here and the hand-tuned palette and its dark-mode values stay
 * exactly as designed. A changed colour gets its shades derived here, and a
 * dark-mode variant lightened until it clears 4.5:1 as text on the dark paper.
 *
 * Selectors are `html:root` / `html.dark` (0,1,1) so they beat index.css's
 * `:root` / `.dark` (0,1,0) whatever order the stylesheets load in.
 */
export interface Brand {
  primary?: string;
  breaking?: string;
  accent?: string;
}

/** Read before first paint by the boot script in index.html. */
export const BRAND_STORAGE_KEY = 'tn.brand-css';

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const DARK_PAPER: RGB = [22, 24, 28];

const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as RGB;

/** WCAG relative luminance, 0–1. */
export function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lighten toward white until it reads as text on the dark paper (L ≥ 0.24 ≈ 4.5:1). */
function forDark(c: RGB): RGB {
  for (let t = 0; t <= 1; t += 0.05) {
    const out = mix(c, WHITE, t);
    if (luminance(out) >= 0.24) return out;
  }
  return WHITE;
}

export function brandCss(brand: Brand): string {
  const light: string[] = [];
  const dark: string[] = [];
  const put = (list: string[], name: string, c: RGB) => list.push(`--tn-${name}:${c.join(' ')};`);
  const changed = (k: keyof Brand) => {
    const v = brand[k]?.toLowerCase();
    return v && /^#[0-9a-f]{6}$/.test(v) ? rgb(v) : null;
  };

  const p = changed('primary');
  if (p) {
    const d = forDark(p);
    put(light, 'brand', p);
    put(light, 'brand-dark', mix(p, BLACK, 0.25));
    put(light, 'brand-deep', mix(p, BLACK, 0.45));
    put(light, 'brand-tint', mix(p, WHITE, 0.9));
    // White text on a light fill fails AA; ink takes over above L 0.2.
    light.push(`--tn-on-brand:${luminance(p) > 0.2 ? '23 25 30' : '255 255 255'};`);
    put(dark, 'brand', d);
    put(dark, 'brand-dark', mix(d, BLACK, 0.15));
    put(dark, 'brand-tint', mix(d, DARK_PAPER, 0.85));
    dark.push('--tn-on-brand:16 18 22;');
  }

  const b = changed('breaking');
  if (b) {
    const d = forDark(b);
    put(light, 'breaking', b);
    put(light, 'breaking-tint', mix(b, WHITE, 0.9));
    put(light, 'breaking-border', mix(b, WHITE, 0.7));
    put(dark, 'breaking', d);
    put(dark, 'breaking-tint', mix(d, DARK_PAPER, 0.8));
    put(dark, 'breaking-border', mix(d, DARK_PAPER, 0.55));
  }

  const a = changed('accent');
  if (a) {
    const d = forDark(a);
    put(light, 'exclusive', a);
    put(light, 'exclusive-tint', mix(a, WHITE, 0.9));
    put(light, 'exclusive-border', mix(a, WHITE, 0.65));
    put(light, 'exclusive-text', mix(a, BLACK, 0.3));
    put(dark, 'exclusive', d);
    put(dark, 'exclusive-tint', mix(d, DARK_PAPER, 0.8));
    put(dark, 'exclusive-border', mix(d, DARK_PAPER, 0.55));
    put(dark, 'exclusive-text', mix(d, WHITE, 0.3));
  }

  if (!light.length) return '';
  return `html:root{${light.join('')}}html.dark{${dark.join('')}}`;
}

/** Swap the live stylesheet and remember it for the next first paint. */
export function applyBrand(css: string): void {
  let el = document.getElementById('tn-brand');
  if (!el) {
    el = document.createElement('style');
    el.id = 'tn-brand';
    document.head.appendChild(el);
  }
  el.textContent = css;
  try {
    if (css) localStorage.setItem(BRAND_STORAGE_KEY, css);
    else localStorage.removeItem(BRAND_STORAGE_KEY);
  } catch {
    // Private mode: colours still apply, only the first-paint cache is lost.
  }
}
