import * as publicApi from '@/api/public';
import type { ArticleCard } from '@/api/types';
import type { IconName } from '@/ui/Icon';

/**
 * My Village (మై విలేజ్) — the app's copy of the website's
 * frontend/src/features/wow/myVillage.ts: the home intro, the /my-village
 * screen and the Share Your Village steps, as the desk's "WOW Indian – My
 * Village process" document sets them out.
 *
 * A shared village goes in as a reader submission in the my-village-story
 * section, so it lands in the CMS review queue and is published as an ordinary
 * story: Submitted → Under review → Approved → Published.
 */

export const MY_VILLAGE_SLUG = 'my-village-story';
/** The village-at-sunset picture (frontend/public/my-village.webp), 1024×1536. */
export const MY_VILLAGE_IMAGE = require('../../assets/images/my-village.webp');

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

/** The My Village screen's welcome message. */
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
  icon: IconName;
}

/** What makes the village special (one or more). */
export const SPECIALITIES: readonly Choice[] = [
  { value: 'history', te: 'గ్రామ చరిత్ర', en: 'Village History', icon: 'bookOpen' },
  { value: 'places', te: 'ప్రసిద్ధ ప్రదేశాలు', en: 'Famous Places', icon: 'mapPin' },
  { value: 'culture', te: 'సంస్కృతి, పండుగలు', en: 'Culture & Festivals', icon: 'sparkles' },
  { value: 'monuments', te: 'చారిత్రక కట్టడాలు', en: 'Historical Monuments', icon: 'home' },
  { value: 'people', te: 'ప్రముఖ వ్యక్తులు', en: 'Famous Personalities', icon: 'users' },
  { value: 'traditions', te: 'ప్రత్యేక సంప్రదాయాలు', en: 'Unique Traditions', icon: 'star' },
  { value: 'achievements', te: 'గ్రామ విజయాలు', en: 'Village Achievements', icon: 'award' },
  { value: 'other', te: 'ఇతర విశేషాలు', en: 'Other Specialities', icon: 'plus' },
];

/** The prompts shown beside the story box. */
export const STORY_PROMPTS = [
  { te: 'మీ గ్రామానికి ఆ పేరు ఎలా వచ్చింది?', en: 'How did your village get its name?' },
  { te: 'మీ గ్రామ చరిత్ర ఏమిటి?', en: 'What is your village’s history?' },
  { te: 'మీ ఊరు దేనికి ప్రసిద్ధి చెందింది?', en: 'What is your village famous for?' },
  { te: 'మీ గ్రామంలో చూడదగిన ప్రదేశాలు ఏమిటి?', en: 'Which places in your village are worth seeing?' },
  { te: 'మీ ఊరికి సంబంధించిన ఆసక్తికరమైన విషయాలు ఏమిటి?', en: 'What are some interesting facts about your village?' },
];

/** What each photo shows. */
export const PHOTO_KINDS: readonly Choice[] = [
  { value: 'village', te: 'గ్రామ చిత్రాలు', en: 'Village Photos', icon: 'image' },
  { value: 'famous', te: 'ప్రముఖ ప్రదేశాలు', en: 'Famous Places', icon: 'mapPin' },
  { value: 'historical', te: 'చారిత్రక ప్రదేశాలు', en: 'Historical Places', icon: 'home' },
  { value: 'festivals', te: 'పండుగలు, సంప్రదాయాలు', en: 'Culture & Festivals', icon: 'sparkles' },
];

/** Most photos a village story can carry (backend submission_service.MAX_MEDIA). */
export const MAX_VILLAGE_PHOTOS = 5;

/** The publishing stages. */
export const PUBLISH_STAGES: readonly { icon: IconName; te: string; en: string }[] = [
  { icon: 'pencil', te: 'కథనం అందింది', en: 'Story submitted' },
  { icon: 'search', te: 'ఎడిటోరియల్ పరిశీలన', en: 'Under review' },
  { icon: 'award', te: 'ప్రచురణకు ఆమోదం', en: 'Approved' },
  { icon: 'megaphone', te: 'WOW INDIANలో ప్రచురణ', en: 'Published on WOW INDIAN' },
];

const VILLAGE_SOURCES = ['my-village-story', 'local-hero', 'districts', 'andhra-pradesh', 'telangana'];

/** `count` stories: my-village-story first, topped up from the local sections (as the website). */
export async function fetchVillageStories(count = 2): Promise<{ slug: string; articles: ArticleCard[] }> {
  const articles: ArticleCard[] = [];
  let slug: string | null = null;
  for (const source of VILLAGE_SOURCES) {
    if (articles.length >= count) break;
    try {
      const feed = await publicApi.fetchFeed({ category: source, limit: count });
      for (const a of feed.articles) {
        if (articles.length < count && !articles.some((x) => x.short_id === a.short_id)) articles.push(a);
      }
      if (feed.articles.length && !slug) slug = source;
    } catch {
      // Section not created yet — try the next one.
    }
  }
  return { slug: slug ?? MY_VILLAGE_SLUG, articles };
}
