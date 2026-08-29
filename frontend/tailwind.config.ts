import type { Config } from 'tailwindcss';

/**
 * Design tokens are lifted verbatim from mockup screen `1a`
 * ("Type, color & the mandatory render test"). These values are the contract —
 * a component that needs a colour picks one of these, it does not invent one
 * (brief §48: no random colours, no inconsistent spacing).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#A61C24', dark: '#7E1219', deep: '#8E0B16', tint: '#FDECEC' },
        breaking: { DEFAULT: '#C6111F', tint: '#FDECEC', border: '#F2C4C7' },
        ink: { DEFAULT: '#1A1714', soft: '#4A443C', panel: '#242019', deep: '#14110E' },
        muted: { DEFAULT: '#6B635A', light: '#8A7F70', inverse: '#B7AFA4' },
        paper: { DEFAULT: '#FAF7F2', warm: '#FFFDF8', sub: '#F5F2EA' },
        canvas: { DEFAULT: '#EFEBE3', cms: '#F4F2ED' },
        rule: { DEFAULT: '#E5DFD6', soft: '#F1EDE4', strong: '#D8D2C8', input: '#DDD8CE' },
        ai: { DEFAULT: '#6D4FC4', tint: '#F4F0FB', border: '#DDD2F2', text: '#4A3F6E' },
        exclusive: { DEFAULT: '#B98A2E', tint: '#FBF3DC', border: '#EBD9A8', text: '#7A611E' },
        success: { DEFAULT: '#2E7D4F', tint: '#EAF4EC', border: '#BFDCC6' },
        info: { DEFAULT: '#1E66C8', tint: '#E8F0FB' },
        placeholder: { DEFAULT: '#E9E2D6', text: '#8A7F70', line: '#C9C2B6' },
        highlight: '#FBE9A9',
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
