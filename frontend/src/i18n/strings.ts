/**
 * UI string catalogue — Telugu and English.
 *
 * Context: §16 open item 3 asked "Telugu only, or Telugu + English edition?"
 * with a default of "Telugu only; schema is i18n-ready". The client has since
 * decided both, so this is that decision implemented. Brief §49 ("do not
 * translate Telugu UI into English") is superseded by it — recorded in
 * docs/SOURCE_CONFLICTS.md rather than silently reversed.
 *
 * Telugu is the default and the fallback: an untranslated key renders Telugu,
 * never a raw key or an empty string. This is a Telugu-first product and an
 * English gap must degrade toward Telugu, not toward nothing.
 *
 * Deliberately dependency-free. The catalogue is small and typed, so a missing
 * or misspelled key is a compile error rather than a runtime blank.
 */

export const LANGUAGES = ['te', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  te: 'తెలుగు',
  en: 'English',
};

/** Every translatable string in the reader UI. */
export const STRINGS = {
  // --- masthead / chrome ---------------------------------------------------
  'site.name': { te: 'టాప్ తెలుగు న్యూస్', en: 'Top Telugu News' },
  'site.tagline': { te: 'Top Telugu News', en: 'Top Telugu News' },
  'nav.home': { te: 'హోమ్', en: 'Home' },
  'nav.epaper': { te: 'ఈ-పేపర్', en: 'E-Paper' },
  'nav.search': { te: 'వెతకండి', en: 'Search' },
  'nav.menu': { te: 'విభాగాల మెనూ', en: 'Sections menu' },
  'nav.sections': { te: 'విభాగాలు', en: 'Sections' },
  'nav.signIn': { te: 'సైన్ ఇన్', en: 'Sign in' },
  'nav.edition': { te: 'ఎడిషన్', en: 'Edition' },
  'nav.editionAll': { te: 'ఎడిషన్: అన్నీ', en: 'Edition: All' },
  'nav.chooseEdition': { te: 'ఎడిషన్ ఎంచుకోండి', en: 'Choose edition' },

  // --- reader controls -----------------------------------------------------
  'reader.fontSize': { te: 'అక్షర పరిమాణం', en: 'Text size' },
  'reader.language': { te: 'భాష', en: 'Language' },
  'reader.listen': { te: 'వినండి', en: 'Listen' },
  'reader.listenSoon': { te: 'టెక్స్ట్-టు-స్పీచ్ త్వరలో', en: 'Text-to-speech coming soon' },
  'reader.bookmark': { te: 'బుక్‌మార్క్', en: 'Bookmark' },
  'reader.bookmarkLogin': {
    te: 'బుక్‌మార్క్‌లకు లాగిన్ అవసరం',
    en: 'Sign in to bookmark',
  },
  'reader.share': { te: 'షేర్', en: 'Share' },
  'reader.authorPage': { te: 'రచయిత పేజీ', en: 'Author page' },
  'reader.readingTime': { te: 'నిమిషాల చదువు', en: 'min read' },
  'reader.desk': { te: 'టాప్ తెలుగు డెస్క్', en: 'Top Telugu Desk' },

  // --- home ----------------------------------------------------------------
  'home.breaking': { te: 'బ్రేకింగ్', en: 'Breaking' },
  'home.latest': { te: 'తాజా వార్తలు', en: 'Latest News' },
  'home.briefs': { te: 'క్లుప్తంగా', en: 'In Brief' },
  'home.seeAll': { te: 'అన్నీ చూడండి', en: 'See all' },
  'home.moreStories': { te: 'మరిన్ని కథనాలు', en: 'More stories' },
  'home.readEpaper': { te: 'ఈ-పేపర్ చదవండి', en: 'Read the e-paper' },
  'home.todaysPage': { te: 'నేటి పేజీ 1', en: "Today's page 1" },
  'home.advertisement': { te: 'ప్రకటన', en: 'Advertisement' },

  // --- article -------------------------------------------------------------
  'article.related': { te: 'సంబంధిత కథనాలు', en: 'Related stories' },
  'article.gallery': { te: 'ఫోటో గ్యాలరీ', en: 'Photo gallery' },
  'article.photoBy': { te: 'ఫోటో', en: 'Photo' },
  'article.source': { te: 'మూలం', en: 'Source' },
  'article.corrected': { te: 'సవరించబడింది', en: 'Corrected' },
  'article.editorNote': { te: 'ఎడిటర్ నోట్ · సవరణ', en: "Editor's note · Correction" },
  'article.exclusive': { te: 'ఎక్స్‌క్లూజివ్', en: 'Exclusive' },
  'article.aiDisclosure': {
    te: 'ఈ కథనం AI సహాయంతో రూపొందించబడి, ప్రచురణకు ముందు సీనియర్ ఎడిటర్ ద్వారా సమీక్షించబడింది.',
    en: 'This article was produced with AI assistance and reviewed by a senior editor before publication.',
  },
  'article.aiImage': {
    te: 'AI రూపొందించిన చిత్రం',
    en: 'AI-generated image',
  },
  /** Shown when a story has no English headline yet (§7.3 translation is Phase 7). */
  'article.teluguOnly': {
    te: 'ఈ కథనం తెలుగులో మాత్రమే అందుబాటులో ఉంది.',
    en: 'This story is available in Telugu only.',
  },
  'article.viewInTelugu': { te: 'తెలుగులో చదవండి', en: 'Read in Telugu' },

  // --- gallery -------------------------------------------------------------
  'gallery.enlarge': { te: 'పెద్దదిగా చూడండి', en: 'View larger' },
  'gallery.close': { te: 'మూసివేయండి', en: 'Close' },
  'gallery.previous': { te: 'మునుపటి ఫోటో', en: 'Previous photo' },
  'gallery.next': { te: 'తదుపరి ఫోటో', en: 'Next photo' },

  // --- states --------------------------------------------------------------
  'state.loading': { te: 'లోడ్ అవుతోంది…', en: 'Loading…' },
  'state.loadingNews': { te: 'వార్తలు లోడ్ అవుతున్నాయి', en: 'Loading news' },
  'state.loadingArticle': { te: 'కథనం లోడ్ అవుతోంది', en: 'Loading article' },
  'state.retry': { te: 'మళ్లీ ప్రయత్నించండి', en: 'Try again' },
  'state.newsFailed': { te: 'వార్తలు లోడ్ కాలేదు', en: 'Could not load the news' },
  'state.newsFailedBody': {
    te: 'వార్తలు చదవడంలో సమస్య వచ్చింది.',
    en: 'Something went wrong loading the news.',
  },
  'state.articleFailed': { te: 'కథనం లోడ్ కాలేదు', en: 'Could not load the article' },
  'state.articleNotFound': { te: 'కథనం కనిపించలేదు', en: 'Article not found' },
  'state.empty': { te: 'ఇంకా కథనాలు లేవు', en: 'No stories yet' },
  'state.emptyEdition': {
    te: 'ఈ ఎడిషన్‌లో ప్రస్తుతం ప్రచురించిన కథనాలు లేవు.',
    en: 'No published stories in this edition right now.',
  },
  'state.emptySection': {
    te: 'ఈ విభాగంలో ఇంకా కథనాలు లేవు.',
    en: 'No stories in this section yet.',
  },
  'state.goHome': { te: 'హోమ్‌కు వెళ్లండి', en: 'Go to the home page' },
  'state.photo': { te: 'ఫోటో', en: 'Photo' },
  'state.heroPhoto': { te: 'హీరో ఫోటో', en: 'Lead photo' },
  'state.noPermission': { te: 'ఈ పేజీకి మీకు అనుమతి లేదు', en: 'You do not have access to this page' },

  // --- time ----------------------------------------------------------------
  'time.now': { te: 'ఇప్పుడే', en: 'just now' },
  'time.minutesAgo': { te: 'నిమిషాల క్రితం', en: 'min ago' },
  'time.hoursAgo': { te: 'గం. క్రితం', en: 'hr ago' },
  'time.yesterday': { te: 'నిన్న', en: 'yesterday' },
  'time.daysAgo': { te: 'రోజుల క్రితం', en: 'days ago' },

  // --- footer / policy -----------------------------------------------------
  'footer.about': { te: 'మా గురించి', en: 'About us' },
  'footer.contact': { te: 'సంప్రదించండి', en: 'Contact' },
  'footer.editorial': { te: 'ఎడిటోరియల్ పాలసీ', en: 'Editorial policy' },
  'footer.corrections': { te: 'సవరణల విధానం', en: 'Corrections policy' },
  'footer.grievance': { te: 'గ్రీవెన్స్ అధికారి', en: 'Grievance officer' },
  'footer.privacy': { te: 'ప్రైవసీ', en: 'Privacy' },
  'footer.terms': { te: 'నిబంధనలు', en: 'Terms' },
  'footer.aiDisclosure': { te: 'AI వినియోగ ప్రకటన', en: 'AI usage disclosure' },
} as const satisfies Record<string, Record<Language, string>>;

export type StringKey = keyof typeof STRINGS;
