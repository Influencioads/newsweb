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
  /** The logo's blue: buttons, links, active tabs. */
  brand: '#0D47A1',
  brandDark: '#0A3780',
  brandDeep: '#072659',
  brandTint: '#E8EFFB',
  breaking: '#BE0A14',
  breakingTint: '#FDEAEB',
  ink: '#17191E',
  inkSoft: '#484C54',
  /** Constant-dark panel (footer / ink cards) — the same in both themes. */
  inkDeep: '#101216',
  muted: '#666B75',
  mutedLight: '#8A8F99',
  paper: '#FFFFFF',
  paperSub: '#F6F7F9',
  canvas: '#FFFFFF',
  rule: '#E5E7EB',
  ruleSoft: '#EFF1F4',
  ruleStrong: '#D1D5DB',
  ai: '#6D4FC4',
  aiTint: '#F4F0FB',
  /** The logo's red — the accent. */
  exclusive: '#D0101A',
  exclusiveTint: '#FDECED',
  /** Text / glyph on exclusiveTint (web --tn-exclusive-text). */
  exclusiveText: '#A80C14',
  success: '#2F703A',
  successTint: '#E8F2E9',
  info: '#2F5E8C',
  infoTint: '#E7EEF6',
  /** Pending / partially-available / warning tone (amber). */
  partial: '#7A6A25',
  partialTint: '#F6F2E1',
  highlight: '#F7E9BC',
  placeholder: '#ECEEF1',
  /** Card / sheet fill — white in light, charcoal in dark. */
  surface: '#FFFFFF',
  /** Input / textarea fill. */
  field: '#FFFFFF',
  /** Scrim behind sheets; use with an alpha via `rgba(palette.overlay, .55)` → see `alpha()`. */
  overlay: '#101216',
  /** Foreground on top of an overlay / image scrim / ink panel (always light). */
  onOverlay: '#FFFFFF',
  /** Foreground on a brand-filled surface. White on the logo blue here; ink on
   *  the lightened blue the dark palette uses, where white would not contrast. */
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
 * Not an inversion: the logo red and blue are lightened so they still read
 * on a dark ground rather than sinking into it, over cool neutral greys.
 * Values are the web `.dark` tokens (frontend/src/assets/index.css) converted
 * to hex.
 */
export const darkColor: Palette = {
  brand: '#6EA0FF',
  brandDark: '#588CF0',
  brandDeep: '#072659',
  brandTint: '#1B263E',
  breaking: '#FF6E6E',
  breakingTint: '#3E1C1D',
  ink: '#ECEDF0',
  inkSoft: '#C5C8CE',
  inkDeep: '#0E1013',
  muted: '#A4A8B0',
  mutedLight: '#8A8F99',
  paper: '#16181C',
  paperSub: '#212429',
  canvas: '#101114',
  rule: '#2F333A',
  ruleSoft: '#26292F',
  ruleStrong: '#42464E',
  ai: '#A48FE0',
  aiTint: '#2D273E',
  exclusive: '#FF5C62',
  exclusiveTint: '#3A1A1D',
  exclusiveText: '#FF969A',
  success: '#79BE84',
  successTint: '#1E3022',
  info: '#7FA9DA',
  infoTint: '#1C2634',
  partial: '#C9B25A',
  partialTint: '#342E1A',
  highlight: '#5A4C1E',
  placeholder: '#282B31',
  surface: '#1C1E23',
  field: '#14161A',
  overlay: '#000000',
  onOverlay: '#FFFFFF',
  onBrand: '#101216',
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
