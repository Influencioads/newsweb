import {
  Briefcase,
  Cpu,
  Flag,
  GalleryVerticalEnd,
  Lightbulb,
  MapPin,
  Medal,
  Newspaper,
  NotebookPen,
  Radio,
  Rocket,
  ScrollText,
  Sunrise,
  Telescope,
  Trees,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/**
 * The WOW content features: the 15 from the "WOW Indian Telugu" concept pitch
 * plus Business Guru.
 *
 * Each one is a category (slug) in the CMS, except WOW Radio and Story Shots,
 * which are experiences with their own routes. The slugs must match the rows
 * seeded in backend/app/db/seed_content.py (CATEGORIES); an admin can rename
 * them on the Taxonomy page without breaking these links, because the slug is
 * the key.
 */
export interface WowFeature {
  slug: string;
  te: string;
  en: string;
  /** One-line editorial focus, shown on the Explore WOW card. */
  focusTe: string;
  focusEn: string;
  icon: LucideIcon;
  /** Where the card goes. Category features open their section page. */
  to: string;
}

const section = (slug: string) => `/section/${slug}`;

export const WOW_FEATURES: readonly WowFeature[] = [
  {
    slug: 'real-heroes',
    te: 'రియల్ హీరోస్',
    en: 'Real Heroes',
    focusTe: 'అసాధారణ మార్పు తెస్తున్న సాధారణ మనుషులు',
    focusEn: 'Real people creating extraordinary impact',
    icon: Medal,
    to: section('real-heroes'),
  },
  {
    slug: 'morning-mantra',
    te: 'మార్నింగ్ మంత్ర',
    en: 'Morning Mantra',
    focusTe: 'రోజువారీ ప్రేరణ, జ్ఞానం, సానుకూలత',
    focusEn: 'Daily motivation, wisdom and positivity',
    icon: Sunrise,
    to: section('morning-mantra'),
  },
  {
    slug: 'startup-stories',
    te: 'స్టార్టప్ స్టోరీస్',
    en: 'Startup Stories',
    focusTe: 'వ్యాపారవేత్తలు, ఆవిష్కరణలు, వ్యాపార ప్రయాణాలు',
    focusEn: 'Entrepreneurs, innovations and business journeys',
    icon: Rocket,
    to: section('startup-stories'),
  },
  {
    slug: 'business-guru',
    te: 'బిజినెస్ గురు',
    en: 'Business Guru',
    focusTe: 'వ్యాపార పాఠాలు, డబ్బు చిట్కాలు, విజయ సూత్రాలు',
    focusEn: 'Business lessons, money tips and success mantras',
    icon: Briefcase,
    to: section('business-guru'),
  },
  {
    slug: 'jai-telugoda',
    te: 'జై తెలుగోడా',
    en: 'Jai Telugoda',
    focusTe: 'తమదైన ముద్ర వేస్తున్న తెలుగువారు',
    focusEn: 'Telugu achievers making a mark',
    icon: Flag,
    to: section('jai-telugoda'),
  },
  {
    slug: 'local-hero',
    te: 'లోకల్ హీరో',
    en: 'Local Hero',
    focusTe: 'పల్లెలు, పట్టణాల్లో గుర్తింపు లేని హీరోలు',
    focusEn: 'Unsung heroes from towns and villages',
    icon: MapPin,
    to: section('local-hero'),
  },
  {
    slug: 'wow-radio',
    te: 'వావ్ రేడియో',
    en: 'WOW Radio',
    focusTe: 'ప్రేరణ, హాస్యం, కథలు — వినండి',
    focusEn: 'Audio inspiration, comedy and stories',
    icon: Radio,
    to: '/radio',
  },
  {
    slug: 'zero-to-hero',
    te: 'జీరో టు హీరో',
    en: 'Zero to Hero',
    focusTe: 'చిన్న మొదలు నుంచి అసాధారణ ప్రయాణాలు',
    focusEn: 'Extraordinary journeys from humble beginnings',
    icon: TrendingUp,
    to: section('zero-to-hero'),
  },
  {
    slug: 'my-village-story',
    te: 'మై విలేజ్ స్టోరీ',
    en: 'My Village Story',
    focusTe: 'ఊరి చరిత్ర, పేర్లు, ప్రత్యేక సంప్రదాయాలు',
    focusEn: 'Village history, names and unique traditions',
    icon: Trees,
    to: section('my-village-story'),
  },
  {
    slug: 'wow-idea',
    te: 'వావ్ ఐడియా',
    en: 'WOW Idea',
    focusTe: 'సృజనాత్మక పరిష్కారాలు, కొత్త ఆలోచనలు',
    focusEn: 'Creative solutions and breakthrough ideas',
    icon: Lightbulb,
    to: section('wow-idea'),
  },
  {
    slug: 'wow-news',
    te: 'వావ్ న్యూస్',
    en: 'WOW News',
    focusTe: 'ఆసక్తికరమైన, ఉపయోగకరమైన, ఆశ్చర్యపరిచే వార్తలు',
    focusEn: 'Interesting, useful and surprising news',
    icon: Newspaper,
    to: section('wow-news'),
  },
  {
    slug: 'my-story',
    te: 'మై స్టోరీ',
    en: 'My Story',
    focusTe: 'స్వీయ అనుభవాలు, వ్యక్తిగత ప్రయాణాలు',
    focusEn: 'First-person experiences and personal journeys',
    icon: NotebookPen,
    to: section('my-story'),
  },
  {
    slug: 'wow-tech',
    te: 'వావ్ టెక్',
    en: 'WOW Tech',
    focusTe: 'గ్యాడ్జెట్లు, AI, రోబోటిక్స్, కొత్త టెక్నాలజీ',
    focusEn: 'Gadgets, AI, robotics and emerging technology',
    icon: Cpu,
    to: section('wow-tech'),
  },
  {
    slug: 'mystery',
    te: 'మిస్టరీ',
    en: 'Mystery',
    focusTe: 'వివరించలేని సంఘటనలు, ఆసక్తికర ఆవిష్కరణలు',
    focusEn: 'Unexplained events and fascinating discoveries',
    icon: Telescope,
    to: section('mystery'),
  },
  {
    slug: 'wow-puranam',
    te: 'వావ్ పురాణం',
    en: 'WOW Puranam',
    focusTe: 'పురాణాలు, ఇతిహాసాలు, ప్రాచీన కథలు',
    focusEn: 'Mythology, epics and ancient stories',
    icon: ScrollText,
    to: section('wow-puranam'),
  },
  {
    slug: 'story-shots',
    te: 'స్టోరీ షాట్స్',
    en: 'Story Shots',
    focusTe: 'స్వైప్ చేసి చూసే చిన్న విజువల్ కథలు',
    focusEn: 'Quick, swipeable visual stories',
    icon: GalleryVerticalEnd,
    to: '/story-shots',
  },
];

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
