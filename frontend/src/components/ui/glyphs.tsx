import type { LucideProps } from 'lucide-react';

/**
 * The house's own glyphs — the marks lucide does not have, or does not have
 * distinctively enough.
 *
 * lucide ships no brand icons at all, so the WhatsApp button was wearing a
 * generic speech bubble. On the app this button is the product's main
 * distribution channel; it lives or dies on being recognised in a tenth of a
 * second, and a bubble is not that.
 *
 * Drawn on lucide's own 24 grid and typed as an `LucideProps` component, so they
 * drop into `Button`'s `icon` slot unchanged. Colour comes from
 * `currentColor` — never a literal, which the ui audit forbids and which
 * would break dark mode anyway. That also keeps WhatsApp green out of a
 * two-hue identity: on a brand-filled button this inherits the on-brand ink.
 *
 * The mobile twin is `mobile/src/ui/glyphs.tsx`.
 */
export function WhatsAppIcon({ size = 20, strokeWidth: _sw, absoluteStrokeWidth: _asw, ...props }: LucideProps) {
  // A solid mark has no stroke; the props are accepted and dropped so this
  // still slots in anywhere a lucide icon does.
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.86-7.01ZM12 20.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Z" />
      <path d="M16.53 14.02c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.15.16-.29.19-.53.06-.25-.12-1.05-.38-1.99-1.23-.74-.66-1.23-1.47-1.38-1.71-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.41-.56-.42h-.48c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.06s.89 2.39 1.01 2.56c.12.16 1.74 2.66 4.22 3.73.59.25 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.46-.6 1.67-1.18.2-.57.2-1.07.14-1.17-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}
