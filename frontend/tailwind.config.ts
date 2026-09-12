import type { Config } from 'tailwindcss';

/**
 * Design tokens are lifted verbatim from mockup screen `1a`
 * ("Type, color & the mandatory render test"). These values are the contract —
 * a component that needs a colour picks one of these, it does not invent one
 * (brief §48: no random colours, no inconsistent spacing).
 *
 * UI-upgrade additions (one system, shared with mobile/src/lib/theme.ts):
 *   - surface / field / partial / overlay / on-brand colour tokens
 *   - a NAMED type scale (`text-ui`, `text-meta`, `text-headline-md`, …).
 *     The `text-[Npx]` idiom is banned by scripts/audit-ui.mjs.
 *   - radius ladder (xl 12 / 2xl 16 / pill), elevation ladder, motion tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // §1.1 dark mode. Every token below resolves through a CSS variable defined
  // in assets/index.css (:root = light, .dark = dark), so the whole app
  // re-themes from one place and utility class names never change.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--tn-brand) / <alpha-value>)',
          dark: 'rgb(var(--tn-brand-dark) / <alpha-value>)',
          deep: 'rgb(var(--tn-brand-deep) / <alpha-value>)',
          tint: 'rgb(var(--tn-brand-tint) / <alpha-value>)',
        },
        breaking: {
          DEFAULT: 'rgb(var(--tn-breaking) / <alpha-value>)',
          tint: 'rgb(var(--tn-breaking-tint) / <alpha-value>)',
          border: 'rgb(var(--tn-breaking-border) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--tn-ink) / <alpha-value>)',
          soft: 'rgb(var(--tn-ink-soft) / <alpha-value>)',
          panel: 'rgb(var(--tn-ink-panel) / <alpha-value>)',
          deep: 'rgb(var(--tn-ink-deep) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--tn-muted) / <alpha-value>)',
          light: 'rgb(var(--tn-muted-light) / <alpha-value>)',
          inverse: 'rgb(var(--tn-muted-inverse) / <alpha-value>)',
        },
        paper: {
          DEFAULT: 'rgb(var(--tn-paper) / <alpha-value>)',
          warm: 'rgb(var(--tn-paper-warm) / <alpha-value>)',
          sub: 'rgb(var(--tn-paper-sub) / <alpha-value>)',
        },
        /** Card / sheet fill — white in light, warm charcoal in dark. */
        surface: {
          DEFAULT: 'rgb(var(--tn-surface) / <alpha-value>)',
          sub: 'rgb(var(--tn-surface-sub) / <alpha-value>)',
        },
        /** Input / textarea / select fill. */
        field: 'rgb(var(--tn-field) / <alpha-value>)',
        canvas: {
          DEFAULT: 'rgb(var(--tn-canvas) / <alpha-value>)',
          cms: 'rgb(var(--tn-canvas-cms) / <alpha-value>)',
        },
        rule: {
          DEFAULT: 'rgb(var(--tn-rule) / <alpha-value>)',
          soft: 'rgb(var(--tn-rule-soft) / <alpha-value>)',
          strong: 'rgb(var(--tn-rule-strong) / <alpha-value>)',
          input: 'rgb(var(--tn-rule-input) / <alpha-value>)',
        },
        ai: {
          DEFAULT: 'rgb(var(--tn-ai) / <alpha-value>)',
          tint: 'rgb(var(--tn-ai-tint) / <alpha-value>)',
          border: 'rgb(var(--tn-ai-border) / <alpha-value>)',
          text: 'rgb(var(--tn-ai-text) / <alpha-value>)',
        },
        exclusive: {
          DEFAULT: 'rgb(var(--tn-exclusive) / <alpha-value>)',
          tint: 'rgb(var(--tn-exclusive-tint) / <alpha-value>)',
          border: 'rgb(var(--tn-exclusive-border) / <alpha-value>)',
          text: 'rgb(var(--tn-exclusive-text) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--tn-success) / <alpha-value>)',
          tint: 'rgb(var(--tn-success-tint) / <alpha-value>)',
          border: 'rgb(var(--tn-success-border) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--tn-info) / <alpha-value>)',
          tint: 'rgb(var(--tn-info-tint) / <alpha-value>)',
        },
        /** "Partially available" / pending / warning tone (amber). */
        partial: {
          DEFAULT: 'rgb(var(--tn-partial) / <alpha-value>)',
          tint: 'rgb(var(--tn-partial-tint) / <alpha-value>)',
          border: 'rgb(var(--tn-partial-border) / <alpha-value>)',
        },
        placeholder: {
          DEFAULT: 'rgb(var(--tn-placeholder) / <alpha-value>)',
          text: 'rgb(var(--tn-placeholder-text) / <alpha-value>)',
          line: 'rgb(var(--tn-placeholder-line) / <alpha-value>)',
        },
        highlight: 'rgb(var(--tn-highlight) / <alpha-value>)',
        /** Scrim behind dialogs / sheets. Use with an alpha: `bg-overlay/60`. */
        overlay: 'rgb(var(--tn-overlay) / <alpha-value>)',
        /**
         * Foreground on a brand / breaking fill: white on the deep light-mode fills,
         * ink on the light dark-mode fills. Constant-dark panels use `on-ink` instead.
         */
        'on-brand': 'rgb(var(--tn-on-brand) / <alpha-value>)',
        /** Foreground on a constant-dark panel (footer, ink cards, image scrims). */
        'on-ink': 'rgb(var(--tn-on-ink) / <alpha-value>)',
      },
      fontFamily: {
        // Headlines and the wordmark: a serif Telugu voice — the editorial
        // register that separates this product from the sans-only Telugu press.
        headline: ['"Noto Serif Telugu"', '"Noto Sans Telugu"', 'serif'],
        // Body Telugu stays a sans: the most legible face at 19px on the
        // mid-range Android we target.
        telugu: ['"Noto Sans Telugu"', 'Manrope', 'sans-serif'],
        // Latin chrome, numerals and the CMS. Inside a `te` run Latin and numerals
        // come from Noto Sans Telugu's own Latin subset (x-heights match), not Manrope.
        sans: ['Manrope', '"Noto Sans Telugu"', 'system-ui', 'sans-serif'],
        // Latin display: English headlines, pull quotes.
        serif: ['Fraunces', '"Noto Serif Telugu"', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        // ------------------------------------------------------------------
        // Named type scale. Telugu readers skew older — sizes are generous.
        // Every Telugu size ships an explicit line-height >= 1.65 (body) or
        // 1.5 (Noto Serif Telugu headlines, which sit tighter by design of the face).
        // Minimum chrome size is 12.5px (`text-meta`).
        // ------------------------------------------------------------------
        /**
         * Masthead wordmark. 1.5, not the 1.35 a Latin display face would take:
         * the wordmark is Telugu (Noto Serif Telugu), and §4.1 puts the floor for a Telugu
         * headline at 1.5. A responsive variant such as `md:text-display`
         * outranks the `.th` rule (same layer, emitted later), so the token
         * itself has to satisfy the floor.
         */
        display: ['34px', { lineHeight: '1.5' }],
        'headline-xl': ['33px', { lineHeight: '1.5' }],
        'headline-lg': ['28px', { lineHeight: '1.5' }],
        'headline-md': ['20px', { lineHeight: '1.5' }],
        'headline-sm': ['17px', { lineHeight: '1.5' }],
        'headline-xs': ['15.5px', { lineHeight: '1.5' }],
        'te-body': ['19px', { lineHeight: '1.7' }],
        'te-body-sm': ['17px', { lineHeight: '1.7' }],
        'te-body-xs': ['15.5px', { lineHeight: '1.7' }],
        /** @deprecated alias of te-body-sm; kept for existing call sites. */
        'te-lead': ['17px', { lineHeight: '1.7' }],
        /** Latin UI chrome (buttons, nav, labels). */
        ui: ['14px', { lineHeight: '1.5' }],
        'ui-sm': ['13px', { lineHeight: '1.5' }],
        /** Timestamps, bylines, captions. The floor. */
        meta: ['12.5px', { lineHeight: '1.5' }],
        /** Uppercase Latin-only kicker. Never apply to Telugu text. */
        eyebrow: ['11px', { lineHeight: '1.4', letterSpacing: '0.12em' }],
      },
      lineHeight: {
        // §4.1: never below 1.65 for Telugu. Named so a reviewer can spot a violation.
        telugu: '1.7',
        'telugu-tight': '1.65',
        'telugu-headline': '1.5',
      },
      letterSpacing: {
        /** The masthead tagline under the Telugu wordmark. */
        wordmark: '0.24em',
      },
      spacing: {
        tap: '44px', // §1a: hit targets >= 44px
        'tap-lg': '48px',
        header: 'var(--header-h)',
      },
      maxWidth: {
        site: '1200px',
        page: '960px',
        wrap: '880px',
        article: '680px', // mockup 1c article measure
        form: '560px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(25,28,28,.04), 0 6px 20px -8px rgba(25,28,28,.10)',
        raised: '0 8px 28px -10px rgba(25,28,28,.18)',
        sheet: '0 -6px 24px rgba(0,0,0,.18)',
        header: '0 1px 0 rgb(var(--tn-rule)), 0 8px 24px -16px rgba(25,28,28,.18)',
      },
      borderRadius: {
        /** Cards and controls. */
        xl: '12px',
        /** Hero / promo / sheets. */
        '2xl': '16px',
        pill: '999px',
        // Legacy names, now aliases of the ladder so old call sites converge.
        card: '12px',
        control: '12px',
        chip: '999px',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(.2,.8,.2,1)',
        emphasized: 'cubic-bezier(.32,.72,0,1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        pop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)' },
        },
        // The ticker track holds two copies, so one seamless lap is -50%.
        marquee: {
          from: { transform: 'translate3d(0,0,0)' },
          to: { transform: 'translate3d(-50%,0,0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 320ms cubic-bezier(.2,.8,.2,1) both',
        'fade-in': 'fade-in 200ms cubic-bezier(.2,.8,.2,1) both',
        'slide-up': 'slide-up 200ms cubic-bezier(.32,.72,0,1) both',
        'slide-in-left': 'slide-in-left 200ms cubic-bezier(.32,.72,0,1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(.2,.8,.2,1) both',
        shimmer: 'shimmer 1.6s linear infinite',
        pop: 'pop 320ms cubic-bezier(.32,.72,0,1)',
        marquee: 'marquee var(--marquee-duration, 40s) linear infinite',
      },
      zIndex: {
        header: '40',
        overlay: '50',
        toast: '60',
      },
      screens: {
        // Device widths named in brief §28.
        xs: '360px',
        sm: '390px',
        smplus: '412px',
        md: '768px',
        lg: '1024px',
        xl: '1440px',
      },
    },
  },
  plugins: [],
} satisfies Config;
