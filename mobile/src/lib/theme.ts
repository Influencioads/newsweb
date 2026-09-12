import { Platform, type ViewStyle } from 'react-native';

/**
 * Design tokens — the same contract the web app compiles into Tailwind
 * (frontend/tailwind.config.ts + assets/index.css, lifted from mockup 1a).
 * A component that needs a colour picks one of these; it does not invent one.
 *
 * Both themes are defined here. `color` remains the light palette so any code
 * that reads a token at module scope still compiles, but screens obtain their
 * palette through `makeStyles` / `useColors`, which re-resolve it whenever the
 * reader changes theme.
 *
 * mobile/scripts/audit-ui.mjs blocks hex/rgba literals outside this file.
 */
export const lightColor = {
  brand: '#0F5F57',
  brandDark: '#0B4841',
  brandDeep: '#08362F',
  brandTint: '#E4F1EE',
  breaking: '#9A5B0B',
  breakingTint: '#FBF0DC',
  ink: '#191C1C',
  inkSoft: '#4A4E4C',
  /** Constant-dark panel (footer / ink cards) — the same in both themes. */
  inkDeep: '#111414',
  muted: '#6A6E6B',
  mutedLight: '#8C918D',
  paper: '#FBF9F4',
  paperSub: '#F5F2EB',
  canvas: '#F2EFE8',
  rule: '#E4E0D6',
  ruleSoft: '#EFECE4',
  ruleStrong: '#D5D0C4',
  ai: '#6D4FC4',
  aiTint: '#F4F0FB',
  exclusive: '#B48A2A',
  exclusiveTint: '#FBF3DC',
  /** Text / glyph on exclusiveTint — the gold fill itself is too light for AA there (web --tn-exclusive-text). */
  exclusiveText: '#7C5D1C',
  success: '#2F703A',
  successTint: '#E8F2E9',
  info: '#2F5E8C',
  infoTint: '#E7EEF6',
  /** Pending / partially-available / warning tone (amber). */
  partial: '#7A6A25',
  partialTint: '#F6F2E1',
  highlight: '#F7E9BC',
  placeholder: '#E9E5DC',
  /** Card / sheet fill — white in light, warm charcoal in dark. */
  surface: '#FFFFFF',
  /** Input / textarea fill. */
  field: '#FFFFFF',
  /** Scrim behind sheets; use with an alpha via `rgba(palette.overlay, .55)` → see `alpha()`. */
  overlay: '#111414',
  /** Foreground on top of an overlay / image scrim / ink panel (always light). */
  onOverlay: '#FFFFFF',
  /** Foreground on a brand-filled surface. Light on the deep teal here; ink on
   *  the lightened teal the dark palette uses, where white would not contrast. */
  onBrand: '#FFFFFF',
} as const;

/** Font family names as registered with expo-font in app/_layout.tsx. */
export const font = {
  telugu: 'NotoSansTelugu_400Regular',
  teluguSemiBold: 'NotoSansTelugu_600SemiBold',
  teluguBold: 'NotoSansTelugu_700Bold',
  /** Noto Serif Telugu — headlines and the wordmark: the editorial voice. */
  headline: 'NotoSerifTelugu_700Bold',
  headlineHeavy: 'NotoSerifTelugu_800ExtraBold',
  /** Manrope — Latin chrome, numerals, eyebrows. Loaded in app/_layout.tsx. */
  latin: 'Manrope_400Regular',
  latinMedium: 'Manrope_500Medium',
  latinSemiBold: 'Manrope_600SemiBold',
  latinBold: 'Manrope_700Bold',
  /** Fraunces — Latin display: English headlines and the wordmark tagline. */
  latinDisplay: 'Fraunces_600SemiBold',
  latinDisplayHeavy: 'Fraunces_800ExtraBold',
} as const;

/**
 * §4.1: Telugu body >= 17sp on app with line-height >= 1.65× — vattulu and
 * matras clip below that. Multiply by the reader's chosen scale via
 * `readerType()`; every Telugu style here is already >= 1.65.
 *
 * Mirrors the web scale: display 34 → 30 here, headline-xl/lg → headlineLg,
 * headline-md → headlineMd, headline-sm/xs → headlineSm, ui/ui-sm → ui,
 * meta 12.5, eyebrow 11 (Manrope, Latin only — never on Telugu text).
 */
export const type = {
  /** Masthead wordmark. */
  display: { fontSize: 30, lineHeight: 45 },
  headlineLg: { fontSize: 24, lineHeight: 36 },
  headlineMd: { fontSize: 19, lineHeight: 29 },
  headlineSm: { fontSize: 16.5, lineHeight: 25 },
  body: { fontSize: 17, lineHeight: 29 },
  bodySmall: { fontSize: 15.5, lineHeight: 26 },
  /** Latin chrome: buttons, tabs, labels. */
  ui: { fontSize: 14, lineHeight: 22 },
  /** Timestamps, bylines, captions. The floor. */
  meta: { fontSize: 12.5, lineHeight: 20 },
  /** Uppercase Latin kicker. */
  eyebrow: { fontSize: 11, lineHeight: 17, letterSpacing: 0.9 },
} as const;

export type TypeVariant = keyof typeof type;

export const FONT_STEPS = ['A-', 'A', 'A+', 'A++'] as const;
export type FontStep = (typeof FONT_STEPS)[number];
/** A- is 0.94 (not 0.9) so 17sp body never drops below the §4.1 floor. */
export const FONT_SCALE: Record<FontStep, number> = {
  'A-': 0.94,
  A: 1,
  'A+': 1.15,
  'A++': 1.32,
};

/** Body copy never renders below this, whatever the scale. */
export const BODY_FLOOR = 17;

/**
 * A type style scaled by the reader's A-/A/A+/A++ choice, keeping the
 * line-height ratio (>= 1.65 for body, 1.5 for Noto Serif Telugu headlines) and the 17sp
 * body floor.
 */
export function readerType(
  base: { fontSize: number; lineHeight: number },
  scale: number,
  floor = 0,
): { fontSize: number; lineHeight: number } {
  const ratio = base.lineHeight / base.fontSize;
  const fontSize = Math.max(floor, Math.round(base.fontSize * scale * 2) / 2);
  return { fontSize, lineHeight: Math.ceil(fontSize * ratio) };
}

/** 8-pt spacing ladder. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** @deprecated use `space`. */
export const spacing = space;

/** Radius ladder — cards/controls md, hero/sheets lg, chips pill. */
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
/** Minimum touch target (§1a). */
export const TAP = 44;
export const TAP_LG = 48;

/** Text never scales past this with the OS accessibility slider (layouts stay intact). */
export const MAX_FONT_MULTIPLIER = 1.3;

/**
 * Dark palette.
 *
 * Not an inversion: the peacock teal is lightened so it still reads as the
 * masthead colour on a dark ground rather than sinking into it,
 * and the neutrals carry the same warm bias as the light set so the two
 * themes feel like one publication. Values are the web `.dark` tokens
 * (frontend/src/assets/index.css) converted to hex.
 */
export const darkColor: Palette = {
  brand: '#4DB6A6',
  brandDark: '#3C9C8E',
  brandDeep: '#1B5F55',
  brandTint: '#1E3330',
  breaking: '#D9A055',
  breakingTint: '#3B2C17',
  ink: '#ECEAE3',
  inkSoft: '#C6C3BA',
  inkDeep: '#0E1111',
  muted: '#A9ADA6',
  mutedLight: '#8C918D',
  paper: '#1A1F1E',
  paperSub: '#242A29',
  canvas: '#121615',
  rule: '#313837',
  ruleSoft: '#283030',
  ruleStrong: '#43494A',
  ai: '#A48FE0',
  aiTint: '#2D273E',
  exclusive: '#D4B061',
  exclusiveTint: '#362E1E',
  exclusiveText: '#E2C480',
  success: '#79BE84',
  successTint: '#1E3022',
  info: '#7FA9DA',
  infoTint: '#1C2634',
  partial: '#C9B25A',
  partialTint: '#342E1A',
  highlight: '#5A4C1E',
  placeholder: '#2A302F',
  surface: '#202625',
  field: '#171C1B',
  overlay: '#000000',
  onOverlay: '#FFFFFF',
  onBrand: '#0E1111',
};

export type Palette = { -readonly [K in keyof typeof lightColor]: string };
export type ThemeName = 'light' | 'dark';

/**
 * The light palette, kept under its original name so module-scope reads and
 * non-themed call sites (navigation options, one-off constants) still work.
 */
export const color = lightColor;

export const palettes: Record<ThemeName, Palette> = {
  light: lightColor,
  dark: darkColor,
};

/** `#RRGGBB` → `rgba(r,g,b,a)`. The only sanctioned way to make a translucent token. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export type ShadowName = 'card' | 'raised' | 'sheet' | 'none';

/**
 * Elevation ladder — the web `shadow-card` / `shadow-raised` / `shadow-sheet`
 * translated to iOS shadow props + Android elevation. Shadows lighten in dark
 * mode, where the surface/canvas contrast does most of the work.
 */
export function shadow(name: ShadowName, palette: Palette): ViewStyle {
  if (name === 'none') return { shadowOpacity: 0, elevation: 0 };
  const dark = palette.canvas === darkColor.canvas;
  const spec = {
    card: { offset: 4, radius: 10, opacity: dark ? 0.35 : 0.08, elevation: 2 },
    raised: { offset: 8, radius: 18, opacity: dark ? 0.45 : 0.14, elevation: 6 },
    sheet: { offset: -6, radius: 24, opacity: dark ? 0.5 : 0.18, elevation: 12 },
  }[name];
  return Platform.select<ViewStyle>({
    android: { elevation: spec.elevation, shadowColor: palette.inkDeep },
    default: {
      shadowColor: palette.inkDeep,
      shadowOffset: { width: 0, height: spec.offset },
      shadowRadius: spec.radius,
      shadowOpacity: spec.opacity,
    },
  })!;
}
