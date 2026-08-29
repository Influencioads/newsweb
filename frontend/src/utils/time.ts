import type { Language } from '@/i18n/strings';

/**
 * Date and relative-time formatting in Telugu or English.
 *
 * Telugu month and weekday names are written out rather than delegated to
 * `Intl`: browser Telugu locale data is inconsistent across the mid-range
 * Android estate this product targets (§4.1 makes the same point about fonts),
 * and a month rendering as "M08" on one device is not acceptable on a news site.
 */

const TE_MONTHS = [
  'జనవరి', 'ఫిబ్రవరి', 'మార్చి', 'ఏప్రిల్', 'మే', 'జూన్',
  'జూలై', 'ఆగస్టు', 'సెప్టెంబర్', 'అక్టోబర్', 'నవంబర్', 'డిసెంబర్',
];

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TE_WEEKDAYS = [
  'ఆదివారం', 'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం',
];

const EN_WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relativeTime(iso: string | null | undefined, lang: Language = 'te'): string {
  const then = parse(iso);
  if (!then) return '';

  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (lang === 'en') {
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return formatDate(iso, lang);
  }

  if (seconds < 60) return 'ఇప్పుడే';
  if (minutes < 60) return `${minutes} నిమిషాల క్రితం`;
  if (hours < 24) return `${hours} గం. క్రితం`;
  if (days === 1) return 'నిన్న';
  if (days < 7) return `${days} రోజుల క్రితం`;
  return formatDate(iso, lang);
}

export function formatDate(iso: string | null | undefined, lang: Language = 'te'): string {
  const d = parse(iso);
  if (!d) return '';
  const months = lang === 'en' ? EN_MONTHS : TE_MONTHS;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatFullDate(d: Date = new Date(), lang: Language = 'te'): string {
  const weekdays = lang === 'en' ? EN_WEEKDAYS : TE_WEEKDAYS;
  const months = lang === 'en' ? EN_MONTHS : TE_MONTHS;
  return `${weekdays[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

export function formatTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return '';
  // Numerals stay Latin in both languages — §4.2 converts Telugu digits to
  // Latin in numeric fields, and readers expect "4:15 PM" either way.
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function readingTime(seconds: number, lang: Language = 'te'): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return lang === 'en' ? `${minutes} min read` : `${minutes} నిమిషాల చదువు`;
}

// --- Telugu-only aliases, kept so existing call sites keep working ---------
export const relativeTimeTe = (iso: string | null | undefined) => relativeTime(iso, 'te');
export const formatDateTe = (iso: string | null | undefined) => formatDate(iso, 'te');
export const formatFullDateTe = (d: Date = new Date()) => formatFullDate(d, 'te');
export const formatTimeTe = formatTime;
export const readingTimeTe = (seconds: number) => readingTime(seconds, 'te');
