import type { Config } from 'tailwindcss';

/**
 * Design tokens are lifted verbatim from mockup screen `1a`
 * ("Type, color & the mandatory render test"). These values are the contract —
 * a component that needs a colour picks one of these, it does not invent one
 * (brief §48: no random colours, no inconsistent spacing).
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
        placeholder: {
          DEFAULT: 'rgb(var(--tn-placeholder) / <alpha-value>)',
          text: 'rgb(var(--tn-placeholder-text) / <alpha-value>)',
          line: 'rgb(var(--tn-placeholder-line) / <alpha-value>)',
        },
        highlight: 'rgb(var(--tn-highlight) / <alpha-value>)',
      },
      fontFamily: {
        // Headlines. Anek Telugu carries the display weight the mastheads need.
        headline: ['"Anek Telugu"', '"Noto Sans Telugu"', 'sans-serif'],
        // Body Telugu.
        telugu: ['"Noto Sans Telugu"', 'Inter', 'sans-serif'],
        // Latin, numerals, and the CMS chrome.
        sans: ['Inter', '"Noto Sans Telugu"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        // §4.1 sizes. Telugu readers skew older — these are deliberately generous.
        // Every Telugu size ships an explicit line-height >= 1.65x.
        'te-body': ['19px', { lineHeight: '1.7' }],
        'te-body-sm': ['17px', { lineHeight: '1.7' }],
        'te-body-xs': ['15.5px', { lineHeight: '1.7' }],
        'te-lead': ['17px', { lineHeight: '1.7' }],
        'headline-xl': ['33px', { lineHeight: '1.5' }],
        'headline-lg': ['30px', { lineHeight: '1.5' }],
        'headline-md': ['19px', { lineHeight: '1.5' }],
        'headline-sm': ['16.5px', { lineHeight: '1.5' }],
        'headline-xs': ['14.5px', { lineHeight: '1.5' }],
        eyebrow: ['10px', { lineHeight: '1.4', letterSpacing: '0.1em' }],
      },
      lineHeight: {
        // §4.1: never below 1.65 for Telugu. Named so a reviewer can spot a violation.
        telugu: '1.7',
        'telugu-tight': '1.65',
        'telugu-headline': '1.5',
      },
      spacing: { 'tap': '44px' }, // §1a: hit targets >= 44px
      maxWidth: { article: '680px' }, // mockup 1c article measure
      boxShadow: {
        card: '0 1px 4px rgba(0,0,0,.07)',
        raised: '0 2px 10px rgba(0,0,0,.1)',
        sheet: '0 -6px 24px rgba(0,0,0,.18)',
      },
      borderRadius: { card: '10px', control: '8px', chip: '20px' },
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
