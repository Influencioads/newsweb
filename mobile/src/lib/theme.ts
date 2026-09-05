/**
 * Design tokens — the same contract the web app compiles into Tailwind
 * (frontend/tailwind.config.ts, lifted from mockup 1a). A component that needs
 * a colour picks one of these; it does not invent one.
 */
export const color = {
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
