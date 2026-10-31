import type { Href } from 'expo-router';

import type { IconName } from '@/ui/Icon';

/**
 * WOW Indian Telugu — the app's copy of the website's WOW data
 * (frontend/src/features/wow/categories.ts and WowRadio.tsx). Keep the two in
 * step: the slugs are the category rows seeded in
 * backend/app/db/seed_content.py, so a link here opens the same section the
 * website does.
 */

export interface WowFeature {
  slug: string;
  te: string;
  en: string;
  /** One-line tagline, shown on the Explore WOW card. */
  focusTe: string;
  focusEn: string;
  icon: IconName;
  /** Where the card goes. Category features open their section screen. */
  href: Href;
  /** One of the six main categories (the website's top navigation). */
  main: boolean;
}

const section = (slug: string): Href => ({ pathname: '/section/[slug]', params: { slug } });

export const WOW_FEATURES: readonly WowFeature[] = [
  // ── Main six ──
  { slug: 'real-heroes', te: 'రియల్ హీరోస్', en: 'Real Heroes', focusTe: 'అసాధారణ వ్యక్తుల విజయ గాధలు', focusEn: 'Success stories of extraordinary people', icon: 'medal', href: section('real-heroes'), main: true },
  { slug: 'jai-telugoda', te: 'జై తెలుగోడా!', en: 'Jai Telugoda!', focusTe: 'మన తెలుగోళ్ల విజయగాథలు!', focusEn: 'Success stories of our Telugu people!', icon: 'flag', href: section('jai-telugoda'), main: true },
  { slug: 'morning-mantra', te: 'మార్నింగ్ మంత్ర', en: 'Morning Mantra', focusTe: 'రోజువారీ ప్రేరణ, స్ఫూర్తి, జ్ఞానం', focusEn: 'Daily motivation, inspiration and wisdom', icon: 'sunrise', href: section('morning-mantra'), main: true },
  { slug: 'startup-stories', te: 'స్టార్టప్ స్టోరీస్', en: 'Startup Stories', focusTe: 'కొత్త ఆలోచనలు.. సరికొత్త విజయాలు!', focusEn: 'New ideas.. brand-new successes!', icon: 'rocket', href: section('startup-stories'), main: true },
  { slug: 'wow-tech', te: 'వావ్ టెక్', en: 'WOW Tech', focusTe: 'ఫ్యూచర్ గాడ్జెట్స్.. లేటెస్ట్ టెక్నాలజీ!', focusEn: 'Future gadgets.. latest technology!', icon: 'cpu', href: section('wow-tech'), main: true },
  { slug: 'business-guru', te: 'బిజినెస్ గురు', en: 'Business Guru', focusTe: 'వ్యాపారాలు.. సలహాలు', focusEn: 'Businesses.. and advice', icon: 'briefcase', href: section('business-guru'), main: true },
  // ── Explore more ──
  { slug: 'local-hero', te: 'లోకల్ హీరో', en: 'Local Hero', focusTe: 'పల్లెలు, పట్టణాల్లోని అసాధారణ వ్యక్తులు', focusEn: 'Extraordinary people from villages and towns', icon: 'mapPin', href: section('local-hero'), main: false },
  { slug: 'story-shots', te: 'స్టోరీ షాట్స్', en: 'Story Shots', focusTe: 'షార్ట్ స్టోరీస్.. స్మార్ట్ నాలెడ్జ్!', focusEn: 'Short stories.. smart knowledge!', icon: 'galleryVertical', href: '/story-shots', main: false },
  { slug: 'zero-to-hero', te: 'జీరో టు హీరో', en: 'Zero to Hero', focusTe: 'జీరో నుండి హీరోగా', focusEn: 'From zero to hero', icon: 'trendingUp', href: section('zero-to-hero'), main: false },
  { slug: 'wow-idea', te: 'వావ్ ఐడియా', en: 'WOW Idea', focusTe: 'ఐడియాతో మొదలైన ఆవిష్కరణలు', focusEn: 'Innovations that began with an idea', icon: 'lightbulb', href: section('wow-idea'), main: false },
  { slug: 'mystery', te: 'మిస్టరీ', en: 'Mystery', focusTe: 'అద్భుతాలు.. రహస్యాలు..', focusEn: 'Wonders.. and secrets..', icon: 'telescope', href: section('mystery'), main: false },
  { slug: 'wow-puranam', te: 'వావ్ పురాణం', en: 'WOW Puranam', focusTe: 'పురాణాలు.. ఇతిహాసాలు..', focusEn: 'Puranas.. and epics..', icon: 'scrollText', href: section('wow-puranam'), main: false },
];

export const MAIN_FEATURES = WOW_FEATURES.filter((f) => f.main);
export const MORE_FEATURES = WOW_FEATURES.filter((f) => !f.main);

/** WOW Radio segments (website: features/wow/WowRadio.tsx `SEGMENTS`). */
export interface RadioSegment {
  id: string;
  te: string;
  en: string;
  taglineTe: string;
  taglineEn: string;
  icon: IconName;
  /** Tried in order; the first category with stories is played. */
  categories: readonly string[];
  /** The CMS colour: orange, green, blue or purple. */
  tone?: string;
}

export const RADIO_SEGMENTS: readonly RadioSegment[] = [
  { id: 'morning-mantra', te: 'మార్నింగ్ మంత్ర', en: 'Morning Mantra', taglineTe: 'రోజుకు సానుకూల ఆరంభం', taglineEn: 'A positive start to the day', icon: 'sunrise', categories: ['morning-mantra', 'devotional'] },
  { id: 'spoorthi', te: 'స్ఫూర్తి', en: 'Spoorthi', taglineTe: 'హీరోల కథలు, విజయ గాథలు', taglineEn: 'Hero stories that inspire', icon: 'lightbulb', categories: ['real-heroes', 'zero-to-hero', 'inspiring'] },
  { id: 'wow-news', te: 'వావ్ న్యూస్', en: 'WOW News', taglineTe: 'వావ్ అనిపించే వార్తలు', taglineEn: 'News that makes you say WOW', icon: 'newspaper', categories: ['jai-telugoda', 'business-guru', 'wow-tech', 'startup-stories', 'wow-idea'] },
  { id: 'mystery', te: 'మిస్టరీ', en: 'Mystery', taglineTe: 'వివరించలేని సంఘటనలు, రహస్యాలు', taglineEn: 'Unexplained events and secrets', icon: 'ghost', categories: ['mystery', 'wow-puranam'] },
];

/** Stories per radio programme. */
export const RADIO_PER_SEGMENT = 5;

/** The words WOW Radio speaks for one programme (same script as the website). */
export function radioScript(segment: RadioSegment, items: readonly { title_te: string; summary_te?: string | null }[]): string {
  if (!items.length) return '';
  const intro = `వావ్ రేడియోకి స్వాగతం. ఇది ${segment.te}.`;
  const body = items.map((a) => [a.title_te, a.summary_te].filter(Boolean).join('. ')).join('. తర్వాత కథ. ');
  return `${intro} ${body}. వింటున్నందుకు ధన్యవాదాలు.`;
}

/** Hero categories offered on the nomination form (pitch §4). */
export const HERO_CATEGORIES: readonly { value: string; te: string; en: string }[] = [
  { value: 'social-service', te: 'సామాజిక సేవ', en: 'Social Service' },
  { value: 'education', te: 'విద్య', en: 'Education' },
  { value: 'innovation', te: 'ఆవిష్కరణ', en: 'Innovation' },
  { value: 'agriculture', te: 'వ్యవసాయం', en: 'Agriculture' },
  { value: 'environment', te: 'పర్యావరణం', en: 'Environment' },
  { value: 'sports', te: 'క్రీడలు', en: 'Sports' },
  { value: 'youth', te: 'యువత', en: 'Youth' },
  { value: 'other', te: 'ఇతరులు', en: 'Other' },
];

/** Category the nomination is filed under, so the desk finds them together. */
export const LOCAL_HERO_SLUG = 'local-hero';

/** Brand line under the logo (website Masthead). */
export const WOW_TAGLINE = 'Ordinary People. Extraordinary Stories.';
