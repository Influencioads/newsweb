import { usePrefs } from '@/stores/prefs';

/**
 * Bilingual chrome, Telugu-first — the same rule the web app applies: if an
 * English value is missing, the reader gets Telugu, never a blank.
 */
export type Language = 'te' | 'en';

const STRINGS = {
  'tab.home': { te: 'హోమ్', en: 'Home' },
  'tab.local': { te: 'లోకల్', en: 'Local' },
  'tab.search': { te: 'వెతకండి', en: 'Search' },
  'tab.profile': { te: 'ప్రొఫైల్', en: 'Profile' },
  'home.breaking': { te: 'బ్రేకింగ్', en: 'BREAKING' },
  'home.latest': { te: 'తాజా వార్తలు', en: 'Latest' },
  'home.seeAll': { te: 'అన్నీ చూడండి', en: 'See all' },
  'state.loading': { te: 'లోడ్ అవుతోంది…', en: 'Loading…' },
  'state.error': { te: 'లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.', en: 'Could not load. Try again.' },
  'state.retry': { te: 'మళ్లీ ప్రయత్నించండి', en: 'Retry' },
  'state.empty': { te: 'ఇంకా వార్తలు లేవు.', en: 'No stories yet.' },
  'state.loadMore': { te: 'మరిన్ని వార్తలు', en: 'Load more' },
  'local.title': { te: 'లోకల్ వార్తలు', en: 'Local news' },
  'local.chooseDistrict': { te: 'మీ జిల్లాను ఎంచుకోండి', en: 'Choose your district' },
  'local.state': { te: 'రాష్ట్రం', en: 'State' },
  'local.district': { te: 'జిల్లా', en: 'District' },
  'local.mandal': { te: 'మండలం', en: 'Mandal' },
  'local.all': { te: '— అన్నీ —', en: '— all —' },
  'local.choose': { te: '— ఎంచుకోండి —', en: '— choose —' },
  'search.title': { te: 'వార్తల అన్వేషణ', en: 'News search' },
  'search.placeholder': { te: 'శీర్షిక, అంశం లేదా పేరు…', en: 'Headline, topic or name…' },
  'search.popular': { te: 'ప్రజాదరణ పొందిన శోధనలు', en: 'Popular searches' },
  'search.recent': { te: 'మీ ఇటీవలి శోధనలు', en: 'Your recent searches' },
  'search.noResults': { te: 'వార్తలు దొరకలేదు', en: 'No stories found' },
  'search.minChars': { te: 'కనీసం రెండు అక్షరాలు నమోదు చేయండి.', en: 'Enter at least two characters.' },
  'auth.signIn': { te: 'సైన్ ఇన్ / నమోదు', en: 'Sign in or register' },
  'auth.phoneHint': {
    te: 'మీ ఫోన్ నంబర్‌కు OTP పంపుతాం. కొత్త నంబర్ అయితే ఖాతా దానంతట అదే సృష్టించబడుతుంది.',
    en: 'We will send an OTP to your phone. A new number gets an account automatically.',
  },
  'auth.phone': { te: 'ఫోన్ నంబర్', en: 'Phone number' },
  'auth.sendOtp': { te: 'OTP పంపండి', en: 'Send OTP' },
  'auth.sending': { te: 'పంపుతోంది…', en: 'Sending…' },
  'auth.enterOtp': { te: 'OTP నమోదు చేయండి', en: 'Enter the OTP' },
  'auth.verify': { te: 'నిర్ధారించండి', en: 'Verify' },
  'auth.verifying': { te: 'పరిశీలిస్తోంది…', en: 'Verifying…' },
  'auth.changeNumber': { te: '← నంబర్ మార్చండి', en: '← Change number' },
  'auth.resend': { te: 'మళ్లీ పంపండి', en: 'Resend OTP' },
  'auth.signOut': { te: 'సైన్ అవుట్', en: 'Sign out' },
  'profile.title': { te: 'నా ఖాతా', en: 'My account' },
  'profile.language': { te: 'భాష', en: 'Language' },
  'profile.location': { te: 'నా ప్రాంతం', en: 'My location' },
  'profile.locationHint': {
    te: 'లోకల్ వార్తలు ఈ ఎంపిక ప్రకారం కనిపిస్తాయి — గ్రామం/మండలం వార్తలు ముందుగా.',
    en: 'The Local feed follows this choice — village/mandal stories rank first.',
  },
  'profile.interests': { te: 'ఆసక్తులు', en: 'Interests' },
  'profile.interestsHint': {
    te: 'ఎంచుకున్న విభాగాలు మీ ఫీడ్‌లో ప్రాధాన్యం పొందుతాయి.',
    en: 'Chosen sections get priority in your feed.',
  },
  'profile.notifications': { te: 'నోటిఫికేషన్లు', en: 'Notifications' },
  'profile.notifyBreaking': { te: 'బ్రేకింగ్ న్యూస్', en: 'Breaking news' },
  'profile.notifyLocal': { te: 'లోకల్ వార్తలు', en: 'Local news' },
  'profile.notifyTopics': { te: 'నా అంశాల అప్‌డేట్లు', en: 'My topics' },
  'profile.fontSize': { te: 'అక్షర పరిమాణం', en: 'Text size' },
  'profile.save': { te: 'సేవ్ చేయండి', en: 'Save preferences' },
  'profile.saving': { te: 'సేవ్ అవుతోంది…', en: 'Saving…' },
  'profile.saved': { te: 'సేవ్ అయింది', en: 'Saved' },
  'article.share': { te: 'షేర్ చేయండి', en: 'Share' },
  'article.related': { te: 'సంబంధిత కథనాలు', en: 'Related stories' },
  'engage.like': { te: 'ఇష్టం', en: 'Like' },
  'engage.save': { te: 'సేవ్', en: 'Save' },
  'engage.saved': { te: 'సేవ్ అయింది', en: 'Saved' },
  'engage.report': { te: 'నివేదించండి', en: 'Report' },
  'engage.reported': { te: 'నివేదించారు', en: 'Reported' },
  'engage.follow': { te: 'ఫాలో అవ్వండి:', en: 'Follow:' },
  'comments.title': { te: 'వ్యాఖ్యలు', en: 'Comments' },
  'comments.placeholder': { te: 'మీ అభిప్రాయం రాయండి…', en: 'Write your comment…' },
  'comments.post': { te: 'పోస్ట్ చేయండి', en: 'Post' },
  'comments.posting': { te: 'పంపుతోంది…', en: 'Posting…' },
  'comments.first': { te: 'మొదటి వ్యాఖ్య మీదే కావచ్చు.', en: 'Be the first to comment.' },
  'comments.signIn': { te: 'వ్యాఖ్యానించడానికి ప్రొఫైల్‌లో సైన్ ఇన్ చేయండి.', en: 'Sign in from the Profile tab to comment.' },
  'notify.title': { te: 'నోటిఫికేషన్లు', en: 'Notifications' },
  'notify.empty': {
    te: 'ఇంకా నోటిఫికేషన్లు లేవు. ప్రాంతాలు, విభాగాలను ఫాలో అయితే ముఖ్య వార్తలు ఇక్కడ చేరతాయి.',
    en: 'No notifications yet. Follow places and sections to get important stories here.',
  },
  'trending.title': { te: 'ట్రెండింగ్ వార్తలు', en: 'Trending stories' },
  'tab.videos': { te: 'వీడియో', en: 'Video' },
  'videos.title': { te: 'వీడియోలు', en: 'Videos' },
  'videos.empty': { te: 'ఇంకా వీడియోలు లేవు.', en: 'No videos yet.' },
  'shorts.title': { te: 'షార్ట్ న్యూస్', en: 'Short News' },
  'shorts.hint': { te: 'పైకి స్వైప్ చేసి చదవండి', en: 'Swipe up to read' },
  'shorts.readFull': { te: 'పూర్తి కథనం చదవండి →', en: 'Read the full story →' },
  'foryou.title': { te: 'మీ కోసం', en: 'For you' },
  'article.listen': { te: 'వినండి', en: 'Listen' },
  'article.stopListening': { te: 'ఆపండి', en: 'Stop' },
  'submit.title': { te: 'కథనం పంపండి', en: 'Submit a story' },
  'submit.hint': {
    te: 'మీ ప్రాంత విశేషాలు రాయండి. మోడరేషన్, సంపాదకీయ సమీక్ష తర్వాత మీ పేరుతో ప్రచురిస్తాం.',
    en: 'Write what is happening around you. After review it publishes with your name.',
  },
  'submit.headline': { te: 'శీర్షిక', en: 'Headline' },
  'submit.body': { te: 'కథనం (కనీసం 100 అక్షరాలు)', en: 'Story (min 100 characters)' },
  'submit.guidelines': {
    te: 'ఇది నా సొంత రచన; కంటెంట్ మార్గదర్శకాలను అంగీకరిస్తున్నాను.',
    en: 'This is my own writing; I accept the content guidelines.',
  },
  'submit.send': { te: 'మోడరేషన్‌కు పంపండి', en: 'Send for moderation' },
  'submit.sending': { te: 'పంపుతోంది…', en: 'Submitting…' },
  'submit.received': { te: '✓ అందింది! సమీక్ష తర్వాత తెలియజేస్తాం.', en: '✓ Received! We will update you after review.' },
  'submit.mine': { te: 'నా సమర్పణలు', en: 'My submissions' },
  'submit.pending': { te: 'సమీక్షలో', en: 'In review' },
  'submit.approved': { te: 'ఆమోదించబడింది', en: 'Approved' },
  'submit.rejected': { te: 'తిరస్కరించబడింది', en: 'Rejected' },
  'library.following': { te: 'ఫాలోయింగ్', en: 'Following' },
  'library.bookmarks': { te: 'సేవ్ చేసినవి', en: 'Saved articles' },
  'library.history': { te: 'చదివినవి', en: 'Reading history' },
  'library.followingEmpty': {
    te: 'విభాగాలు, ప్రాంతాలను ఫాలో అయితే వారి వార్తలు ఇక్కడ కనిపిస్తాయి.',
    en: 'Follow sections and places — their stories appear here.',
  },
  'library.bookmarksEmpty': {
    te: 'కథనంలో “సేవ్” నొక్కితే ఇక్కడ కనిపిస్తుంది.',
    en: 'Tap “Save” on an article and it shows up here.',
  },
  'library.historyEmpty': { te: 'చదివిన కథనాలు ఇక్కడ కనిపిస్తాయి.', en: 'Articles you read appear here.' },
  'article.exclusive': { te: 'ఎక్స్‌క్లూజివ్', en: 'EXCLUSIVE' },
  'article.aiLabel': { te: 'AI సహాయంతో రూపొందించినది', en: 'AI-assisted' },
  'time.justNow': { te: 'ఇప్పుడే', en: 'just now' },
  'time.minutes': { te: 'ని. క్రితం', en: 'm ago' },
  'time.hours': { te: 'గం. క్రితం', en: 'h ago' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function useI18n() {
  const language = usePrefs((s) => s.language);
  const setLanguage = usePrefs((s) => s.setLanguage);
  return {
    language,
    setLanguage,
    isTelugu: language === 'te',
    t: (key: StringKey): string => STRINGS[key][language] || STRINGS[key].te,
    pick: (te: string | null | undefined, en: string | null | undefined): string =>
      (language === 'en' ? en || te : te || en) ?? '',
  };
}

/** Compact relative time for cards: "5 ని. క్రితం", "2 గం. క్రితం", else a date. */
export function timeAgo(iso: string | null, language: Language): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return STRINGS['time.justNow'][language];
  if (minutes < 60) return `${minutes} ${STRINGS['time.minutes'][language]}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${STRINGS['time.hours'][language]}`;
  return new Date(iso).toLocaleDateString(language === 'te' ? 'te-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
  });
}
