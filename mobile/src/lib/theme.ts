/**
 * Design tokens — the same contract the web app compiles into Tailwind
 * (frontend/tailwind.config.ts, lifted from mockup 1a). A component that needs
 * a colour picks one of these; it does not invent one.
 *
 * Both themes are defined here. `color` remains the light palette so any code
 * that reads a token at module scope still compiles, but screens obtain their
 * palette through `makeStyles`, which re-resolves it whenever the reader
 * changes theme.
 */
export const lightColor = {
  brand: '#A61C24',
  brandDark: '#7E1219',
  brandDeep: '#8E0B16',
  brandTint: '#FDECEC',
  breaking: '#C6111F',
  ink: '#1A1714',
  inkSoft: '#4A443C',
  muted: '#6B635A',
  mutedLight: '#8A7F70',
  paper: '#FAF7F2',
  paperSub: '#F5F2EA',
  canvas: '#EFEBE3',
  rule: '#E5DFD6',
  ruleStrong: '#D8D2C8',
  exclusive: '#B98A2E',
  exclusiveTint: '#FBF3DC',
  success: '#2E7D4F',
  successTint: '#EAF4EC',
  info: '#1E66C8',
  placeholder: '#E9E2D6',
  white: '#FFFFFF',
} as const;

/** Font family names as registered with expo-font in app/_layout.tsx. */
export const font = {
  telugu: 'NotoSansTelugu_400Regular',
  teluguSemiBold: 'NotoSansTelugu_600SemiBold',
  teluguBold: 'NotoSansTelugu_700Bold',
  headline: 'AnekTelugu_700Bold',
  headlineHeavy: 'AnekTelugu_800ExtraBold',
} as const;

/**
 * §4.1: Telugu body >= 17sp on app with line-height >= 1.65× — vattulu and
 * matras clip below that. Multiply by the reader's chosen scale.
 */
export const type = {
  body: { fontSize: 17, lineHeight: 29 },
  bodySmall: { fontSize: 15, lineHeight: 26 },
  meta: { fontSize: 12, lineHeight: 18 },
  headlineLg: { fontSize: 24, lineHeight: 36 },
  headlineMd: { fontSize: 18, lineHeight: 28 },
  headlineSm: { fontSize: 15.5, lineHeight: 24 },
} as const;

export const FONT_STEPS = ['A-', 'A', 'A+', 'A++'] as const;
export type FontStep = (typeof FONT_STEPS)[number];
export const FONT_SCALE: Record<FontStep, number> = {
  'A-': 0.9,
  A: 1,
  'A+': 1.15,
  'A++': 1.32,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * Dark palette.
 *
 * Not an inversion: the brand red is lightened so it still reads as the
 * masthead colour on a dark ground rather than turning into a muddy maroon,
 * and the neutrals carry the same warm bias as the light set so the two
 * themes feel like one publication.
 */
export const darkColor: Palette = {
  brand: '#E0737A',
  brandDark: '#C85A62',
  brandDeep: '#F08A91',
  brandTint: '#3E1F21',
  breaking: '#E9848A',
  ink: '#EDE7DD',
  inkSoft: '#C9C0B3',
  muted: '#AA9F91',
  mutedLight: '#8C8172',
  paper: '#262019',
  paperSub: '#221D17',
  canvas: '#171310',
  rule: '#3A332B',
  ruleStrong: '#4D443A',
  exclusive: '#D9B366',
  exclusiveTint: '#38301F',
  success: '#79C296',
  successTint: '#22342A',
  info: '#7FAEEA',
  placeholder: '#2E2820',
  white: '#201B16',
} as const;

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
