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
  brand: '#A61C24',
  brandDark: '#7E1219',
  brandDeep: '#8E0B16',
  brandTint: '#FDECEC',
  breaking: '#C6111F',
  breakingTint: '#FDECEC',
  ink: '#1A1714',
  inkSoft: '#4A443C',
  /** Constant-dark panel (footer / ink cards) — the same in both themes. */
  inkDeep: '#14110E',
  muted: '#6B635A',
  mutedLight: '#8A7F70',
  paper: '#FAF7F2',
  paperSub: '#F5F2EA',
  canvas: '#EFEBE3',
  rule: '#E5DFD6',
  ruleSoft: '#F1EDE4',
  ruleStrong: '#D8D2C8',
  ai: '#6D4FC4',
  aiTint: '#F4F0FB',
  exclusive: '#B98A2E',
  exclusiveTint: '#FBF3DC',
  success: '#2E7D4F',
  successTint: '#EAF4EC',
  info: '#1E66C8',
  infoTint: '#E8F0FB',
  /** Pending / partially-available / warning tone (amber). */
  partial: '#B87014',
  partialTint: '#FDF3E2',
  highlight: '#FBE9A9',
  placeholder: '#E9E2D6',
  /** Card / sheet fill — white in light, warm charcoal in dark. */
  surface: '#FFFFFF',
  /** Input / textarea fill. */
  field: '#FFFFFF',
  /** Scrim behind sheets; use with an alpha via `rgba(palette.overlay, .55)` → see `alpha()`. */
  overlay: '#14110E',
  /** Foreground on top of an overlay / image scrim / ink panel (always light). */
  onOverlay: '#FFFFFF',
  /** Foreground on a brand-filled surface. Light on the deep red here; dark on
   *  the lightened red the dark palette uses, where white would not contrast. */
  onBrand: '#FFFFFF',
} as const;

/** Font family names as registered with expo-font in app/_layout.tsx. */
export const font = {
  telugu: 'NotoSansTelugu_400Regular',
  teluguSemiBold: 'NotoSansTelugu_600SemiBold',
  teluguBold: 'NotoSansTelugu_700Bold',
  headline: 'AnekTelugu_700Bold',
  headlineHeavy: 'AnekTelugu_800ExtraBold',
  /** Inter — Latin chrome, numerals, eyebrows. Loaded in app/_layout.tsx. */
  latin: 'Inter_400Regular',
  latinMedium: 'Inter_500Medium',
  latinSemiBold: 'Inter_600SemiBold',
  latinBold: 'Inter_700Bold',
} as const;

/**
 * §4.1: Telugu body >= 17sp on app with line-height >= 1.65× — vattulu and
 * matras clip below that. Multiply by the reader's chosen scale via
 * `readerType()`; every Telugu style here is already >= 1.65.
 *
 * Mirrors the web scale: display 34 → 30 here, headline-xl/lg → headlineLg,
 * headline-md → headlineMd, headline-sm/xs → headlineSm, ui/ui-sm → ui,
 * meta 12.5, eyebrow 11 (Inter, Latin only — never on Telugu text).
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
 * line-height ratio (>= 1.65 for body, 1.5 for Anek headlines) and the 17sp
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
 * Not an inversion: the brand red is lightened so it still reads as the
 * masthead colour on a dark ground rather than turning into a muddy maroon,
 * and the neutrals carry the same warm bias as the light set so the two
 * themes feel like one publication. Values are the web `.dark` tokens
 * (frontend/src/assets/index.css) converted to hex.
 */
export const darkColor: Palette = {
  brand: '#D9575E',
  brandDark: '#E77A80',
  brandDeep: '#8E0B16',
  brandTint: '#401F20',
  breaking: '#C6111F',
  breakingTint: '#402525',
  ink: '#EDE7DD',
  inkSoft: '#C9C0B3',
  inkDeep: '#14110E',
  muted: '#AA9F91',
  mutedLight: '#8C8172',
  paper: '#201B16',
  paperSub: '#2C261F',
  canvas: '#171310',
  rule: '#3A332B',
  ruleSoft: '#2F2922',
  ruleStrong: '#4D443A',
  ai: '#A48FE0',
  aiTint: '#2D273E',
  exclusive: '#D3A853',
  exclusiveTint: '#382F1E',
  success: '#6DBB8C',
  successTint: '#213329',
  info: '#6FA3E8',
  infoTint: '#1E2938',
  partial: '#E8AA52',
  partialTint: '#3A2C1A',
  highlight: '#5C4A1B',
  placeholder: '#2E2822',
  surface: '#26201A',
  field: '#1F1A15',
  overlay: '#000000',
  onOverlay: '#FFFFFF',
  onBrand: '#FFFFFF',
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
