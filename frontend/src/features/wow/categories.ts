import {
  Briefcase,
  Cpu,
  Flag,
  GalleryVerticalEnd,
  Lightbulb,
  MapPin,
  Medal,
  Newspaper,
  Rocket,
  ScrollText,
  Sunrise,
  Telescope,
  Trees,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/**
 * The WOW categories, in the order the desk asked for.
 *
 * The first six (`main: true`) are the main categories: shown on the home page,
 * in the top navigation and first in the drawer. The rest sit behind
 * "Explore more categories". Each is a CMS category (slug) except Story Shots,
 * which is its own experience. The slugs must match the rows seeded in
 * backend/app/db/seed_content.py (CATEGORIES); an admin can rename them on the
 * Taxonomy page without breaking these links, because the slug is the key.
 */
export interface WowFeature {
  slug: string;
  te: string;
  en: string;
  /** One-line tagline, shown on the Explore WOW card. */
  focusTe: string;
  focusEn: string;
  icon: LucideIcon;
  /** Where the card goes. Category features open their section page. */
  to: string;
  /** One of the six main categories. */
  main: boolean;
}

const section = (slug: string) => `/section/${slug}`;

export const WOW_FEATURES: readonly WowFeature[] = [
  // ── Main six ──
  {
    slug: 'real-heroes',
    te: 'రియల్ హీరోస్',
    en: 'Real Heroes',
    focusTe: 'అసాధారణ వ్యక్తుల విజయ గాధలు',
    focusEn: 'Success stories of extraordinary people',
    icon: Medal,
    to: section('real-heroes'),
    main: true,
  },
  {
    slug: 'jai-telugoda',
    te: 'జై తెలుగోడా!',
    en: 'Jai Telugoda!',
    focusTe: 'మన తెలుగోళ్ల విజయగాథలు!',
    focusEn: 'Success stories of our Telugu people!',
    icon: Flag,
    to: section('jai-telugoda'),
    main: true,
  },
  {
    slug: 'morning-mantra',
    te: 'మార్నింగ్ మంత్ర',
    en: 'Morning Mantra',
    focusTe: 'రోజువారీ ప్రేరణ, స్ఫూర్తి, జ్ఞానం',
    focusEn: 'Daily motivation, inspiration and wisdom',
    icon: Sunrise,
    to: section('morning-mantra'),
    main: true,
  },
  {
    slug: 'startup-stories',
    te: 'స్టార్టప్ స్టోరీస్',
    en: 'Startup Stories',
    focusTe: 'కొత్త ఆలోచనలు.. సరికొత్త విజయాలు!',
    focusEn: 'New ideas.. brand-new successes!',
    icon: Rocket,
    to: section('startup-stories'),
    main: true,
  },
  {
    slug: 'wow-tech',
    te: 'వావ్ టెక్',
    en: 'WOW Tech',
    focusTe: 'ఫ్యూచర్ గాడ్జెట్స్.. లేటెస్ట్ టెక్నాలజీ!',
    focusEn: 'Future gadgets.. latest technology!',
    icon: Cpu,
    to: section('wow-tech'),
    main: true,
  },
  {
    slug: 'business-guru',
    te: 'బిజినెస్ గురు',
    en: 'Business Guru',
    focusTe: 'వ్యాపారాలు.. సలహాలు',
    focusEn: 'Businesses.. and advice',
    icon: Briefcase,
    to: section('business-guru'),
    main: true,
  },
  // ── Explore more ──
  {
    slug: 'my-village-story',
    te: 'మై విలేజ్',
    en: 'My Village',
    focusTe: 'మన ఊళ్ల కథలు.. మనుషులు..',
    focusEn: 'Stories of our villages.. and their people..',
    icon: Trees,
    to: section('my-village-story'),
    main: false,
  },
  {
    slug: 'wow-news',
    te: 'వావ్ న్యూస్',
    en: 'WOW News',
    focusTe: 'వావ్ అనిపించే వార్తలు',
    focusEn: 'News that makes you say WOW',
    icon: Newspaper,
    to: section('wow-news'),
    main: false,
  },
  {
    slug: 'local-hero',
    te: 'లోకల్ హీరో',
    en: 'Local Hero',
    focusTe: 'పల్లెలు, పట్టణాల్లోని అసాధారణ వ్యక్తులు',
    focusEn: 'Extraordinary people from villages and towns',
    icon: MapPin,
    to: section('local-hero'),
    main: false,
  },
  {
    slug: 'story-shots',
    te: 'స్టోరీ షాట్స్',
    en: 'Story Shots',
    focusTe: 'షార్ట్ స్టోరీస్.. స్మార్ట్ నాలెడ్జ్!',
    focusEn: 'Short stories.. smart knowledge!',
    icon: GalleryVerticalEnd,
    to: '/story-shots',
    main: false,
  },
  {
    slug: 'zero-to-hero',
    te: 'జీరో టు హీరో',
    en: 'Zero to Hero',
    focusTe: 'జీరో నుండి హీరోగా',
    focusEn: 'From zero to hero',
    icon: TrendingUp,
    to: section('zero-to-hero'),
    main: false,
  },
  {
    slug: 'wow-idea',
    te: 'వావ్ ఐడియా',
    en: 'WOW Idea',
    focusTe: 'ఐడియాతో మొదలైన ఆవిష్కరణలు',
    focusEn: 'Innovations that began with an idea',
    icon: Lightbulb,
    to: section('wow-idea'),
    main: false,
  },
  {
    slug: 'mystery',
    te: 'మిస్టరీ',
    en: 'Mystery',
    focusTe: 'అద్భుతాలు.. రహస్యాలు..',
    focusEn: 'Wonders.. and secrets..',
    icon: Telescope,
    to: section('mystery'),
    main: false,
  },
  {
    slug: 'wow-puranam',
    te: 'వావ్ పురాణం',
    en: 'WOW Puranam',
    focusTe: 'పురాణాలు.. ఇతిహాసాలు..',
    focusEn: 'Puranas.. and epics..',
    icon: ScrollText,
    to: section('wow-puranam'),
    main: false,
  },
];

export const MAIN_FEATURES = WOW_FEATURES.filter((f) => f.main);
export const MORE_FEATURES = WOW_FEATURES.filter((f) => !f.main);

/** Hero categories offered on the nomination form (pitch §4). */
export const HERO_CATEGORIES: readonly { value: string; te: string; en: string }[] = [
  { value: 'social-service', te: 'సామాజిక సేవ', en: 'Social Service' },
  { value: 'education', te: 'విద్య', en: 'Education' },
  { value: 'innovation', te: 'ఆవిష్కరణ', en: 'Innovation' },
  { value: 'agriculture', te: 'వ్యవసాయం', en: 'Agriculture' },
  { value: 'environment', te: 'పర్యావరణం', en: 'Environment' },
  { value: 'youth', te: 'యువ విజయం', en: 'Youth Achievement' },
  { value: 'other', te: 'ఇతరాలు', en: 'Other' },
];

/** Slug the nomination is filed under, so the desk finds them together. */
export const LOCAL_HERO_SLUG = 'local-hero';
