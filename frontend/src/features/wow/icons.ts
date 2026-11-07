import {
  BookOpen,
  Briefcase,
  Camera,
  Cpu,
  Film,
  Flag,
  GalleryVerticalEnd,
  Ghost,
  Globe,
  GraduationCap,
  HandHeart,
  Heart,
  Landmark,
  Leaf,
  Lightbulb,
  MapPin,
  Medal,
  Mic,
  Music,
  Newspaper,
  Rocket,
  ScrollText,
  Sparkles,
  Sprout,
  Star,
  Sunrise,
  Telescope,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * The icons the CMS can pick for a WOW category card or a WOW Radio segment.
 * The names are the API's (backend app/services/site_content.py ICONS); keep
 * the two lists the same.
 */
export const WOW_ICONS: Record<string, LucideIcon> = {
  medal: Medal,
  flag: Flag,
  sunrise: Sunrise,
  rocket: Rocket,
  cpu: Cpu,
  briefcase: Briefcase,
  'map-pin': MapPin,
  gallery: GalleryVerticalEnd,
  'trending-up': TrendingUp,
  lightbulb: Lightbulb,
  telescope: Telescope,
  scroll: ScrollText,
  ghost: Ghost,
  newspaper: Newspaper,
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  trophy: Trophy,
  users: Users,
  globe: Globe,
  book: BookOpen,
  'graduation-cap': GraduationCap,
  leaf: Leaf,
  music: Music,
  camera: Camera,
  film: Film,
  mic: Mic,
  landmark: Landmark,
  'hand-heart': HandHeart,
  sprout: Sprout,
};

/** The icon for a stored name; an unknown or empty one gets the sparkle. */
export function wowIcon(name: string | null | undefined): LucideIcon {
  return (name && WOW_ICONS[name]) || Sparkles;
}
