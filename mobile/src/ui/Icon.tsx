import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePlay,
  CircleQuestionMark,
  CircleX,
  Clock,
  Copy,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  FaceAngry,
  FaceSlightlyFrowning,
  FaceSlightlySmiling,
  FileText,
  Flag,
  Funnel,
  Globe,
  Headphones,
  Heart,
  House,
  Image,
  Inbox,
  Info,
  Languages,
  LayoutGrid,
  Link,
  List,
  LoaderCircle,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Maximize2,
  MessageCircle,
  Mic,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  Newspaper,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcwClock,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Star,
  Sun,
  ThumbsUp,
  Trash,
  Type,
  User,
  Users,
  Video,
  Volume2,
  WifiOff,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useColors } from '@/lib/useTheme';

/**
 * Icon — the only way glyphs enter the app (audit-ui rejects emoji and
 * Unicode glyph icons). A curated map over lucide-react-native so screens
 * pick a name, not a component, and the set stays visually consistent.
 * Names keep the familiar lucide 0.x spelling where 1.x renamed a glyph
 * (`alertCircle` → CircleAlert, `history` → RotateCcwClock, …).
 */
const MAP = {
  home: House,
  mapPin: MapPin,
  play: Play,
  search: Search,
  user: User,
  bell: Bell,
  zap: Zap,
  newspaper: Newspaper,
  headphones: Headphones,
  share2: Share2,
  bookmark: Bookmark,
  bookmarkCheck: BookmarkCheck,
  heart: Heart,
  messageCircle: MessageCircle,
  moreHorizontal: Ellipsis,
  moreVertical: EllipsisVertical,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  x: X,
  check: Check,
  plus: Plus,
  minus: Minus,
  settings: Settings,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  type: Type,
  volume2: Volume2,
  pause: Pause,
  flag: Flag,
  trash2: Trash,
  pencil: Pencil,
  copy: Copy,
  externalLink: ExternalLink,
  download: Download,
  refreshCw: RefreshCw,
  alertCircle: CircleAlert,
  info: Info,
  wifiOff: WifiOff,
  inbox: Inbox,
  filter: Funnel,
  calendar: Calendar,
  clock: Clock,
  eye: Eye,
  star: Star,
  sparkles: Sparkles,
  radio: Radio,
  image: Image,
  video: Video,
  list: List,
  layoutGrid: LayoutGrid,
  logOut: LogOut,
  logIn: LogIn,
  phone: Phone,
  mail: Mail,
  globe: Globe,
  languages: Languages,
  chevronsUp: ChevronsUp,
  maximize2: Maximize2,
  minimize2: Minimize2,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  fileText: FileText,
  send: Send,
  thumbsUp: ThumbsUp,
  smile: FaceSlightlySmiling,
  frown: FaceSlightlyFrowning,
  angry: FaceAngry,
  link: Link,
  mic: Mic,
  playCircle: CirclePlay,
  bookOpen: BookOpen,
  history: RotateCcwClock,
  users: Users,
  shield: Shield,
  helpCircle: CircleQuestionMark,
  circleDot: CircleDot,
  checkCircle2: CircleCheck,
  xCircle: CircleX,
  loader2: LoaderCircle,
} as const;

export type IconName = keyof typeof MAP;
export type IconSize = 16 | 20 | 24 | 28 | 32;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** Defaults to the themed `ink`. Pass a palette value, never a literal. */
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/** Decorative by default: the parent control carries the accessibilityLabel. */
export function Icon({ name, size = 20, color, strokeWidth = 1.75, style }: IconProps) {
  const palette = useColors();
  const Glyph = MAP[name];
  return (
    <Glyph
      size={size}
      color={color ?? palette.ink}
      strokeWidth={strokeWidth}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export interface TabIconProps {
  name: IconName;
  focused: boolean;
  color: string;
}

/** Bottom-tab glyph: 24px, stroke thickens when focused. */
export function TabIcon({ name, focused, color }: TabIconProps) {
  return <Icon name={name} size={24} color={color} strokeWidth={focused ? 2 : 1.75} />;
}
