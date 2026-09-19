import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { StyleProp, ViewStyle } from 'react-native';

/**
 * The house's own glyphs, for the handful of marks that carry the product.
 *
 * Two reasons these are not lucide. WhatsApp is a brand mark and lucide ships
 * no brand icons at all, so the share row was using a generic speech bubble
 * for it. And share / comment / place are the three marks a reader meets on
 * every single card — leaving them as the stock shapes every app uses is
 * exactly the sameness we were asked to get away from.
 *
 * Everything else stays lucide. A whole hand-drawn set would cost a lot and
 * look *less* coherent, not more; the win is in the few marks that repeat.
 *
 * These are drawn on lucide's own 24 grid with its round caps and joins and
 * take the same props, so they drop into `Icon`'s MAP unchanged and inherit
 * the themed colour. No literal colours here — the ui audit forbids them
 * outside theme.ts, and an icon that ignores the palette breaks in dark mode.
 */

export interface GlyphProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/**
 * WhatsApp. A solid mark, because the logo is a solid mark — an outlined
 * version reads as "a phone in a bubble" rather than as the app, and the
 * whole point of this button is instant recognition.
 *
 * Filled with `color`, so on the brand-filled share button it inherits the
 * on-brand ink and never introduces WhatsApp green as a third house hue.
 */
export function WhatsAppGlyph({ size = 20, color, style }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path
        fill={color}
        d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.86-7.01ZM12 20.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Z"
      />
      <Path
        fill={color}
        d="M16.53 14.02c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.15.16-.29.19-.53.06-.25-.12-1.05-.38-1.99-1.23-.74-.66-1.23-1.47-1.38-1.71-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.41-.56-.42h-.48c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.06s.89 2.39 1.01 2.56c.12.16 1.74 2.66 4.22 3.73.59.25 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.46-.6 1.67-1.18.2-.57.2-1.07.14-1.17-.06-.1-.22-.16-.47-.29Z"
      />
    </Svg>
  );
}

/**
 * Share. Three linked nodes — the graph, not lucide's box-with-an-arrow,
 * which reads as "export a file" more than "send this to someone".
 */
export function ShareGlyph({ size = 20, color, strokeWidth = 1.75, style }: GlyphProps) {
  return (
    <Svg width={size} height={size} {...BASE} style={style}>
      <Circle cx={18} cy={5} r={2.6} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx={6} cy={12} r={2.6} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx={18} cy={19} r={2.6} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M8.3 10.8 15.7 6.4M8.3 13.2l7.4 4.4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Comment. A bubble with lines in it, so at 20px it reads as *a conversation*
 * rather than as an empty rounded rectangle, which is what the stock circle
 * turns into once it is small enough to sit on a card.
 */
export function CommentGlyph({ size = 20, color, strokeWidth = 1.75, style }: GlyphProps) {
  return (
    <Svg width={size} height={size} {...BASE} style={style}>
      <Path
        d="M20 12.2a7.2 7.2 0 0 1-7.4 7.2 8.3 8.3 0 0 1-3.3-.62L4 20.5l1.8-4.2A7 7 0 0 1 4.8 12.2 7.2 7.2 0 0 1 12.2 5h.4A7.2 7.2 0 0 1 20 11.8Z"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <Path
        d="M9 10.5h7M9 13.8h4.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Place. A marker whose head is a rounded square rather than the universal
 * teardrop — this one means "the mandal or village you read", which is a
 * district on a map, not a dropped pin.
 */
export function PlaceGlyph({ size = 20, color, strokeWidth = 1.75, style }: GlyphProps) {
  return (
    <Svg width={size} height={size} {...BASE} style={style}>
      <Rect
        x={4}
        y={3}
        width={16}
        height={13}
        rx={3.2}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <Path
        d="M9.2 16 12 21l2.8-5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={9.5} r={2.4} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
