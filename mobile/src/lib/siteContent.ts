import { useQuery } from '@tanstack/react-query';

import { absoluteMediaUrl } from '@/api/client';
import * as publicApi from '@/api/public';
import type { NavCategoryOut, SiteContent } from '@/api/types';
import type { IconName } from '@/ui/Icon';

import { HERO_CATEGORIES, RADIO_SEGMENTS, WOW_FEATURES, WOW_TAGLINE, type RadioSegment, type WowFeature } from './wow';

/**
 * CMS → Site content in the app (website: frontend/src/features/wow/siteContent.ts).
 * The desk edits the logo, tagline, banner tag, hero slides, WOW Radio, Story
 * Shots, the Nominate banner and form, and the grievance address there; the
 * app reads them from `/public/config` and falls back to what it shipped with
 * until the config arrives or from an older API that does not send them.
 */
export const DEFAULT_CONTENT: SiteContent = {
  brand: { logo_url: '', tagline_te: WOW_TAGLINE, tagline_en: WOW_TAGLINE },
  home: { banner_tag_te: 'Every Story Has a WOW!', banner_tag_en: 'Every Story Has a WOW!' },
  hero: { article_ids: [] },
  radio: {
    image_url: '',
    mobile_image_url: '',
    segments: RADIO_SEGMENTS.map((sg) => ({
      id: sg.id,
      te: sg.te,
      en: sg.en,
      tagline_te: sg.taglineTe,
      tagline_en: sg.taglineEn,
      icon: sg.icon,
      tone: 'orange',
      categories: [...sg.categories],
    })),
  },
  story_shots: { shots: [] },
  nominate: { image_url: '', mobile_image_url: '', categories: HERO_CATEGORIES.map((c) => ({ ...c })) },
  contact: { grievance_email: 'grievance@example.com' },
};

export function useSiteConfig() {
  return useQuery({ queryKey: ['config'], queryFn: publicApi.fetchSiteConfig, staleTime: 300_000 });
}

/** Every block, saved values over the defaults. */
export function useSiteContent(): SiteContent {
  const content = useSiteConfig().data?.content;
  return {
    brand: { ...DEFAULT_CONTENT.brand, ...content?.brand },
    home: { ...DEFAULT_CONTENT.home, ...content?.home },
    hero: { ...DEFAULT_CONTENT.hero, ...content?.hero },
    radio: { ...DEFAULT_CONTENT.radio, ...content?.radio },
    story_shots: { ...DEFAULT_CONTENT.story_shots, ...content?.story_shots },
    nominate: { ...DEFAULT_CONTENT.nominate, ...content?.nominate },
    contact: { ...DEFAULT_CONTENT.contact, ...content?.contact },
  };
}

/** The website's icon names (backend site_content.ICONS) as the app's icons. */
const ICON_MAP: Record<string, IconName> = {
  medal: 'medal',
  flag: 'flag',
  sunrise: 'sunrise',
  rocket: 'rocket',
  cpu: 'cpu',
  briefcase: 'briefcase',
  'map-pin': 'mapPin',
  gallery: 'galleryVertical',
  'trending-up': 'trendingUp',
  lightbulb: 'lightbulb',
  telescope: 'telescope',
  scroll: 'scrollText',
  ghost: 'ghost',
  newspaper: 'newspaper',
  sparkles: 'sparkles',
  star: 'star',
  heart: 'heart',
  trophy: 'award',
  users: 'users',
  globe: 'globe',
  book: 'bookOpen',
  'graduation-cap': 'bookOpen',
  music: 'radio',
  camera: 'image',
  film: 'video',
  mic: 'mic',
  landmark: 'home',
  'hand-heart': 'heartHandshake',
};

export function wowIcon(name: string | null | undefined): IconName {
  return (name && ICON_MAP[name]) || 'sparkles';
}

const RADIO_ART = require('../../assets/images/wow-radio.webp');
const LOGO = require('../../assets/images/logo.png');

/** The masthead logo: the one uploaded in CMS → Site content, else the built-in one. */
export function useLogo(): number | { uri: string } {
  const uri = absoluteMediaUrl(useSiteContent().brand.logo_url || null);
  return uri ? { uri } : LOGO;
}

/** The WOW Radio picture: the CMS upload (its mobile version first), else the built-in art. */
export function useRadioArt(): number | { uri: string } {
  const { radio } = useSiteContent();
  const uri = absoluteMediaUrl(radio.mobile_image_url || radio.image_url || null);
  return uri ? { uri } : RADIO_ART;
}

/** WOW Radio's programmes, as the desk set them in CMS → Site content. */
export function useRadioSegments(): RadioSegment[] {
  const segments = useSiteContent().radio.segments;
  return segments.map((sg) => ({
    id: sg.id,
    te: sg.te,
    en: sg.en,
    taglineTe: sg.tagline_te,
    taglineEn: sg.tagline_en,
    icon: wowIcon(sg.icon),
    categories: sg.categories,
    tone: sg.tone,
  }));
}

const STORY_SHOTS_CARD = WOW_FEATURES.find((f) => f.slug === 'story-shots') as WowFeature;

/**
 * The Explore WOW cards from the CMS Taxonomy page (website: siteContent.ts
 * `featuresFrom`): categories marked "WOW category", in Taxonomy order; those
 * also in the navigation are the main ones. Story Shots is a page, so its card
 * is added second in the "more" list. Until the config arrives, the built-in list.
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
    href: { pathname: '/section/[slug]', params: { slug: c.slug } },
    main: c.show_in_nav,
  }));
  const main = cards.filter((f) => f.main);
  const more = cards.filter((f) => !f.main);
  more.splice(Math.min(1, more.length), 0, STORY_SHOTS_CARD);
  return [...main, ...more];
}

export function useWowFeatures() {
  const all = featuresFrom(useSiteConfig().data?.categories);
  return { all, main: all.filter((f) => f.main), more: all.filter((f) => !f.main) };
}
