import { useQuery } from '@tanstack/react-query';

import * as publicApi from '@/features/public/api';
import type { NavCategoryOut, SiteContent } from '@/types/public';

import { WOW_FEATURES, type WowFeature } from './categories';
import { wowIcon } from './icons';

/**
 * Site content the desk edits in CMS → Site content, read from
 * `/public/config`. The defaults below are what the site shipped with (the
 * backend has the same, app/services/site_content.py); they cover the first
 * paint and an older API that does not send `content` yet.
 */
export const DEFAULT_CONTENT: SiteContent = {
  brand: {
    logo_url: '',
    tagline_te: 'Ordinary People. Extraordinary Stories.',
    tagline_en: 'Ordinary People. Extraordinary Stories.',
  },
  home: { banner_tag_te: 'Every Story Has a WOW!', banner_tag_en: 'Every Story Has a WOW!' },
  radio: {
    image_url: '',
    segments: [
      {
        id: 'morning-mantra',
        te: 'మార్నింగ్ మంత్ర',
        en: 'Morning Mantra',
        tagline_te: 'రోజుకు సానుకూల ఆరంభం',
        tagline_en: 'A positive start to the day',
        icon: 'sunrise',
        tone: 'orange',
        categories: ['morning-mantra', 'devotional'],
      },
      {
        id: 'spoorthi',
        te: 'స్ఫూర్తి',
        en: 'Spoorthi',
        tagline_te: 'హీరోల కథలు, విజయ గాథలు',
        tagline_en: 'Hero stories that inspire',
        icon: 'lightbulb',
        tone: 'green',
        categories: ['real-heroes', 'zero-to-hero', 'inspiring'],
      },
      {
        id: 'wow-news',
        te: 'వావ్ న్యూస్',
        en: 'WOW News',
        tagline_te: 'వావ్ అనిపించే వార్తలు',
        tagline_en: 'News that makes you say WOW',
        icon: 'newspaper',
        tone: 'blue',
        categories: ['jai-telugoda', 'business-guru', 'wow-tech', 'startup-stories', 'wow-idea'],
      },
      {
        id: 'mystery',
        te: 'మిస్టరీ',
        en: 'Mystery',
        tagline_te: 'వివరించలేని సంఘటనలు, రహస్యాలు',
        tagline_en: 'Unexplained events and secrets',
        icon: 'ghost',
        tone: 'purple',
        categories: ['mystery', 'wow-puranam'],
      },
    ],
  },
  story_shots: { shots: [] },
  nominate: {
    categories: [
      { value: 'social-service', te: 'సామాజిక సేవ', en: 'Social Service' },
      { value: 'education', te: 'విద్య', en: 'Education' },
      { value: 'innovation', te: 'ఆవిష్కరణ', en: 'Innovation' },
      { value: 'agriculture', te: 'వ్యవసాయం', en: 'Agriculture' },
      { value: 'environment', te: 'పర్యావరణం', en: 'Environment' },
      { value: 'youth', te: 'యువ విజయం', en: 'Youth Achievement' },
      { value: 'other', te: 'ఇతరాలు', en: 'Other' },
    ],
  },
  contact: { grievance_email: 'grievance@example.com' },
};

/** The built-in pictures, used while the CMS field is blank. */
export const DEFAULT_LOGO = '/wow-indian-logo.webp';
export const DEFAULT_RADIO_IMAGE = '/wow-radio.webp';

/**
 * `lang` and font class for a line the desk typed: the Telugu fonts when it
 * contains Telugu script, the Latin ones otherwise — the WOW lines are often
 * English in both language fields.
 */
export function scriptOf(text: string): { lang: 'te' | 'en'; cls: string; head: string } {
  return /[ఀ-౿]/.test(text)
    ? { lang: 'te', cls: 'te', head: 'th' }
    : { lang: 'en', cls: 'font-sans', head: 'font-serif' };
}

export function useSiteConfig() {
  return useQuery({ queryKey: ['public', 'config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
}

/** Every block, saved values over the defaults. */
export function useSiteContent(): SiteContent {
  const content = useSiteConfig().data?.content;
  return {
    brand: { ...DEFAULT_CONTENT.brand, ...content?.brand },
    home: { ...DEFAULT_CONTENT.home, ...content?.home },
    radio: { ...DEFAULT_CONTENT.radio, ...content?.radio },
    story_shots: { ...DEFAULT_CONTENT.story_shots, ...content?.story_shots },
    nominate: { ...DEFAULT_CONTENT.nominate, ...content?.nominate },
    contact: { ...DEFAULT_CONTENT.contact, ...content?.contact },
  };
}

/** The logo to show: the uploaded one, else the built-in file. */
export function useLogoUrl(): string {
  return useSiteContent().brand.logo_url || DEFAULT_LOGO;
}

const STORY_SHOTS = WOW_FEATURES.find((f) => f.slug === 'story-shots') as WowFeature;

/**
 * The WOW category cards from the Taxonomy page: categories marked "WOW
 * category", in their Taxonomy order; the ones also in the navigation are the
 * main ones. Story Shots is a page, not a category, so its card is added to
 * the "more" list in its usual second place. Until the config arrives, or
 * from an API without the card fields, the built-in list is used.
 */
export function featuresFrom(categories: NavCategoryOut[] | undefined): WowFeature[] {
  const listed = (categories ?? []).filter((c) => c.in_explore);
  if (!listed.length) return [...WOW_FEATURES];
  const cards: WowFeature[] = listed.map((c) => ({
    slug: c.slug,
    te: c.name_te,
    en: c.name_en,
    focusTe: c.tagline_te ?? '',
    focusEn: c.tagline_en ?? c.tagline_te ?? '',
    icon: wowIcon(c.icon),
    to: `/section/${c.slug}`,
    main: c.show_in_nav,
  }));
  const main = cards.filter((f) => f.main);
  const more = cards.filter((f) => !f.main);
  more.splice(Math.min(1, more.length), 0, STORY_SHOTS);
  return [...main, ...more];
}

export function useWowFeatures() {
  const all = featuresFrom(useSiteConfig().data?.categories);
  return { all, main: all.filter((f) => f.main), more: all.filter((f) => !f.main) };
}
