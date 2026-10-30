import {
  Award,
  BookOpen,
  Camera,
  FileSearch,
  Landmark,
  MapPin,
  Megaphone,
  PartyPopper,
  PenLine,
  Sparkles,
  Star,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * My Village (మై విలేజ్) — the copy and lists behind the home intro, the
 * /my-village landing page and the Share Your Village steps, as the desk's
 * "WOW Indian – My Village process" document sets them out.
 *
 * A shared village goes in as a reader submission in the my-village-story
 * section, so it lands in the existing review queue (CMS → Review) and is
 * published as an ordinary story there: Submitted → Under review → Approved
 * → Published.
 */

export const MY_VILLAGE_SLUG = 'my-village-story';
export const MY_VILLAGE_PATH = '/my-village';
export const SHARE_VILLAGE_PATH = '/my-village/share';

export const MY_VILLAGE_TITLE = { te: 'మై విలేజ్ – మన ఊరు.. మన గొప్పతనం!', en: 'My Village – our village, our pride!' };

/** The home section's two paragraphs. */
export const MY_VILLAGE_INTRO = {
  te: [
    'ప్రతి ఊరికీ ఓ చరిత్ర.. ఓ ప్రత్యేక గుర్తింపు! మీ ఊరి పేరు వెనుక కథ, ప్రసిద్ధ దేవాలయాలు, చారిత్రక విశేషాలు, పండుగలు, ఆచారాలు, సంప్రదాయాలు, ప్రముఖ వ్యక్తులు.. ఇలా మీ ఊరి గొప్పతనాన్ని ప్రపంచానికి పరిచయం చేసే వేదిక మై విలేజ్.',
    'మీ ఊరి విశేషాలను, ఆసక్తికరమైన కథలను, ఫొటోలను మాతో పంచుకోండి. మీ ఊరి గొప్పతనాన్ని ప్రపంచానికి చాటండి!',
  ],
  en: [
    'Every village has a history and an identity of its own — the story behind its name, its famous temples, historic places, festivals, customs and traditions, and its well-known people. My Village is where you introduce your village to the world.',
    'Share your village’s highlights, its stories and its photos with us, and tell the world what makes it great!',
  ],
};

/** The landing page's welcome message (Step 1). */
export const MY_VILLAGE_WELCOME = {
  te: [
    'ప్రతి ఊరికీ ఓ కథ ఉంటుంది.. ఓ చరిత్ర ఉంటుంది.. ఓ ప్రత్యేకత ఉంటుంది!',
    'మీ ఊరి గొప్పతనాన్ని ప్రపంచానికి పరిచయం చేయండి.',
  ],
  en: ['Every village has a story, a history and something special!', 'Introduce your village to the world.'],
};

export interface Choice {
  value: string;
  te: string;
  en: string;
  icon: LucideIcon;
}

/** Step 3 — what makes the village special (one or more). */
export const SPECIALITIES: readonly Choice[] = [
  { value: 'history', te: 'గ్రామ చరిత్ర', en: 'Village History', icon: BookOpen },
  { value: 'places', te: 'ప్రసిద్ధ ప్రదేశాలు', en: 'Famous Places', icon: MapPin },
  { value: 'culture', te: 'సంస్కృతి, పండుగలు', en: 'Culture & Festivals', icon: PartyPopper },
  { value: 'monuments', te: 'చారిత్రక కట్టడాలు', en: 'Historical Monuments', icon: Landmark },
  { value: 'people', te: 'ప్రముఖ వ్యక్తులు', en: 'Famous Personalities', icon: Users },
  { value: 'traditions', te: 'ప్రత్యేక సంప్రదాయాలు', en: 'Unique Traditions', icon: Sparkles },
  { value: 'achievements', te: 'గ్రామ విజయాలు', en: 'Village Achievements', icon: Award },
  { value: 'other', te: 'ఇతర విశేషాలు', en: 'Other Specialities', icon: Star },
];

/** Step 4 — the prompts shown beside the story box. */
export const STORY_PROMPTS = [
  { te: 'మీ గ్రామానికి ఆ పేరు ఎలా వచ్చింది?', en: 'How did your village get its name?' },
  { te: 'మీ గ్రామ చరిత్ర ఏమిటి?', en: 'What is your village’s history?' },
  { te: 'మీ ఊరు దేనికి ప్రసిద్ధి చెందింది?', en: 'What is your village famous for?' },
  { te: 'మీ గ్రామంలో చూడదగిన ప్రదేశాలు ఏమిటి?', en: 'Which places in your village are worth seeing?' },
  { te: 'మీ ఊరికి సంబంధించిన ఆసక్తికరమైన విషయాలు ఏమిటి?', en: 'What are some interesting facts about your village?' },
];

/** Step 5 — what each photo shows. */
export const PHOTO_KINDS: readonly Choice[] = [
  { value: 'village', te: 'గ్రామ చిత్రాలు', en: 'Village Photos', icon: Camera },
  { value: 'famous', te: 'ప్రముఖ ప్రదేశాలు', en: 'Famous Places', icon: MapPin },
  { value: 'historical', te: 'చారిత్రక ప్రదేశాలు', en: 'Historical Places', icon: Landmark },
  { value: 'festivals', te: 'పండుగలు, సంప్రదాయాలు', en: 'Culture & Festivals', icon: PartyPopper },
];

/** Most photos a village story can carry (backend submission_service.MAX_MEDIA). */
export const MAX_VILLAGE_PHOTOS = 5;

/** Step 9 — the publishing stages. */
export const PUBLISH_STAGES = [
  { icon: PenLine, te: 'కథనం అందింది', en: 'Story submitted' },
  { icon: FileSearch, te: 'ఎడిటోరియల్ పరిశీలన', en: 'Under review' },
  { icon: Award, te: 'ప్రచురణకు ఆమోదం', en: 'Approved' },
  { icon: Megaphone, te: 'WOW INDIANలో ప్రచురణ', en: 'Published on WOW INDIAN' },
];
