import { Children, type ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import {
  BODY_FLOOR,
  FONT_SCALE,
  MAX_FONT_MULTIPLIER,
  font,
  readerType,
  type,
  type Palette,
  type TypeVariant,
} from '@/lib/theme';
import { useColors } from '@/lib/useTheme';
import { usePrefs } from '@/stores/prefs';

/**
 * T — every piece of text in the app.
 *
 * Picks the face (Anek for Telugu headlines, Noto Sans Telugu for Telugu
 * copy, Inter for Latin), the §4.1-safe size/line-height from the type scale,
 * the reader's A-/A/A+/A++ step when `scaled`, and caps the OS font slider at
 * MAX_FONT_MULTIPLIER so layouts hold. Telugu is detected from string
 * children unless `lang` says otherwise.
 */
export type TWeight = 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy';
export type TLang = 'te' | 'en' | 'auto';
/** Palette keys text may be painted with (`white` is the deprecated surface alias). */
export type PaletteKey = Exclude<keyof Palette, 'white'>;

export interface TProps extends TextProps {
  /** Type-scale step. `eyebrow` is Latin-only (Inter, uppercase, tracked). */
  variant?: TypeVariant;
  weight?: TWeight;
  /** Palette key, resolved against the active theme. */
  color?: PaletteKey;
  /** Multiply by the reader's font step (body copy never drops below 17). */
  scaled?: boolean;
  lang?: TLang;
  align?: TextStyle['textAlign'];
  children?: ReactNode;
}

export interface TextStyleTokens {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
}

const TELUGU = /[\u0C00-\u0C7F]/;
/** §4.1: Noto Sans Telugu needs >= 1.65x line-height or vattulu clip. Anek headlines sit at 1.5. */
const TELUGU_LINE_RATIO = 1.65;

/** True when the string contains any Telugu-block character. */
export function hasTelugu(s: string): boolean {
  return TELUGU.test(s);
}

function isHeadline(variant: TypeVariant): boolean {
  return variant === 'display' || variant.startsWith('headline');
}

function face(variant: TypeVariant, weight: TWeight, telugu: boolean): string {
  if (telugu) {
    if (isHeadline(variant)) {
      return weight === 'heavy' ? font.headlineHeavy : font.headline;
    }
    if (weight === 'bold' || weight === 'heavy') return font.teluguBold;
    if (weight === 'medium' || weight === 'semibold') return font.teluguSemiBold;
    return font.telugu;
  }
  switch (weight) {
    case 'medium':
      return font.latinMedium;
    case 'semibold':
      return font.latinSemiBold;
    case 'bold':
    case 'heavy':
      return font.latinBold;
    default:
      return font.latin;
  }
}

// Memoised per (variant, weight, script, scale, scaled): list rows share one object.
const cache = new Map<string, TextStyleTokens>();

/**
 * The font tokens `<T>` would use, for the rare non-Text consumer (TextInput).
 * `scale` is a FONT_SCALE value; when `scaled`, body/bodySmall floor at
 * BODY_FLOOR (even at scale 1). Telugu in a Noto variant is floored at 1.65x.
 */
export function textStyle(
  variant: TypeVariant,
  weight: TWeight = 'regular',
  telugu = false,
  scale = 1,
  scaled = scale !== 1,
): TextStyleTokens {
  const key = `${variant}|${weight}|${telugu ? 't' : 'l'}|${scale}|${scaled ? 's' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = type[variant];
  const floor = scaled && (variant === 'body' || variant === 'bodySmall') ? BODY_FLOOR : 0;
  const { fontSize, lineHeight } = scaled ? readerType(base, scale, floor) : base;
  const lh = telugu && !isHeadline(variant) ? Math.max(lineHeight, Math.ceil(fontSize * TELUGU_LINE_RATIO)) : lineHeight;
  const out: TextStyleTokens = { fontFamily: face(variant, weight, telugu), fontSize, lineHeight: lh };
  if ('letterSpacing' in base) out.letterSpacing = base.letterSpacing;
  cache.set(key, out);
  return out;
}

function detect(lang: TLang, children: ReactNode): boolean {
  if (lang !== 'auto') return lang === 'te';
  return Children.toArray(children).some((c) => typeof c === 'string' && TELUGU.test(c));
}

export function T({
  variant = 'body',
  weight,
  color,
  scaled = false,
  lang = 'auto',
  align,
  style,
  children,
  ...rest
}: TProps) {
  const palette = useColors();
  const fontStep = usePrefs((s) => s.fontStep);
  const hasTe = detect('auto', children);
  // Eyebrow is Inter uppercase; a Telugu string that lands here (whatever
  // `lang` claims) gets Noto meta instead — never uppercase on Telugu.
  const telugu = lang === 'auto' ? hasTe : lang === 'te' || (variant === 'eyebrow' && hasTe);
  const eyebrow = variant === 'eyebrow' && !telugu;
  const v: TypeVariant = variant === 'eyebrow' && telugu ? 'meta' : variant;
  const w: TWeight = weight ?? (eyebrow ? 'semibold' : 'regular');
  const tokens = textStyle(v, w, telugu, scaled ? FONT_SCALE[fontStep] : 1, scaled);
  const tone = palette[color ?? (eyebrow ? 'muted' : 'ink')];
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={MAX_FONT_MULTIPLIER}
      style={[
        tokens,
        { color: tone },
        eyebrow && { textTransform: 'uppercase' },
        align !== undefined && { textAlign: align },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
