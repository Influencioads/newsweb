import type { StringKey } from '@/i18n';

/**
 * The footer pages' original copy (About, Contact, the policies).
 *
 * CMS → Footer pages edits these: a page saved there is served by
 * `/public/pages/<slug>` and replaces the copy below on the site; "Reset"
 * comes back to it. The CMS editor starts from this copy, so the desk edits
 * what readers see rather than a blank page.
 */

export interface PolicySection {
  /** Anchor target; also the ChipRail link. */
  id: string;
  heading: string;
  body: string[];
}

export interface PolicyContent {
  title: string;
  sections: PolicySection[];
}

export interface PolicyEntry {
  /** Document title, per the route's own `page.*` key. */
  titleKey: StringKey;
  te: PolicyContent;
  en: PolicyContent;
}

/**
 * One date for the whole placeholder set. Counsel's copy arrives page by page
 * (§16 open item 17); give each entry its own `updated` when it does.
 */
export const LAST_UPDATED = '2026-01-15';

export const PAGES: Record<string, PolicyEntry> = {
  about: {
    titleKey: 'page.about',
    te: {
      title: 'మా గురించి',
      sections: [
        {
          id: 'who-we-are',
          heading: 'మేమెవరం',
          body: ['వావ్ ఇండియన్ — ఆంధ్రప్రదేశ్, తెలంగాణ జిల్లా వార్తల డిజిటల్ వేదిక.'],
        },
      ],
    },
    en: {
      title: 'About us',
      sections: [
        {
          id: 'who-we-are',
          heading: 'Who we are',
          body: [
            'WowIndian is a digital news platform covering Andhra Pradesh and Telangana, district by district.',
          ],
        },
      ],
    },
  },
  contact: {
    titleKey: 'page.contact',
    te: {
      title: 'సంప్రదించండి',
      sections: [
        { id: 'editorial', heading: 'సంపాదకీయ విభాగం', body: ['సంపాదకీయ విభాగం: editor@example.com'] },
        { id: 'advertising', heading: 'ప్రకటనల విభాగం', body: ['ప్రకటనల విభాగం: ads@example.com'] },
      ],
    },
    en: {
      title: 'Contact',
      sections: [
        { id: 'editorial', heading: 'Editorial desk', body: ['Editorial desk: editor@example.com'] },
        { id: 'advertising', heading: 'Advertising', body: ['Advertising: ads@example.com'] },
      ],
    },
  },
  'editorial-policy': {
    titleKey: 'page.editorialPolicy',
    te: {
      title: 'ఎడిటోరియల్ పాలసీ',
      sections: [
        {
          id: 'approval',
          heading: 'ఆమోద ప్రక్రియ',
          body: [
            'ప్రతి కథనం ప్రచురణకు ముందు సీనియర్ ఎడిటర్ ఆమోదం పొందుతుంది. ఏ కథనమూ ఆమోదం లేకుండా పాఠకులకు చేరదు.',
          ],
        },
        {
          id: 'attribution',
          heading: 'మూలాల ప్రస్తావన',
          body: ['ప్రతి వాదనకు మూలాన్ని పేర్కొంటాం. ఏజెన్సీ కథనాలకు తప్పనిసరిగా మూల ప్రస్తావన ఉంటుంది.'],
        },
      ],
    },
    en: {
      title: 'Editorial policy',
      sections: [
        {
          id: 'approval',
          heading: 'Approval',
          body: ['Every story is approved by a senior editor before publication. Nothing reaches a reader without that approval.'],
        },
        {
          id: 'attribution',
          heading: 'Attribution',
          body: ['We attribute every claim to a source. Agency copy always carries its credit.'],
        },
      ],
    },
  },
  corrections: {
    titleKey: 'page.corrections',
    te: {
      title: 'సవరణల విధానం',
      sections: [
        {
          id: 'how-we-correct',
          heading: 'సవరణలు ఎలా చేస్తాం',
          body: ['తప్పు గుర్తించిన వెంటనే సవరిస్తాం. సవరించిన కథనంపై "సవరించబడింది" తేదీ కనిపిస్తుంది.'],
        },
        { id: 'editor-note', heading: 'ఎడిటర్ నోట్', body: ['ముఖ్యమైన సవరణలకు ఎడిటర్ నోట్ జతచేస్తాం.'] },
      ],
    },
    en: {
      title: 'Corrections policy',
      sections: [
        {
          id: 'how-we-correct',
          heading: 'How we correct',
          body: ['We correct errors as soon as we find them. A corrected story shows the date it was amended.'],
        },
        {
          id: 'editor-note',
          heading: "Editor's note",
          body: ["Material corrections carry an editor's note explaining what changed."],
        },
      ],
    },
  },
  grievance: {
    titleKey: 'page.grievance',
    te: {
      title: 'గ్రీవెన్స్ అధికారి',
      sections: [
        {
          id: 'timelines',
          heading: 'పరిష్కార గడువు',
          body: ['IT Rules 2021 ప్రకారం ఫిర్యాదులను 24 గంటల్లో స్వీకరించి, 30 రోజుల్లో పరిష్కరిస్తాం.'],
        },
        {
          id: 'officer',
          heading: 'అధికారి వివరాలు',
          body: ['గ్రీవెన్స్ అధికారి పేరు మరియు సంప్రదింపు వివరాలు: [క్లయింట్ ద్వారా పూరించాలి]'],
        },
      ],
    },
    en: {
      title: 'Grievance officer',
      sections: [
        {
          id: 'timelines',
          heading: 'Response times',
          body: ['Under IT Rules 2021 we acknowledge complaints within 24 hours and resolve them within 30 days.'],
        },
        {
          id: 'officer',
          heading: 'Officer details',
          body: ['Grievance Officer name and contact details: [to be completed by the publisher]'],
        },
      ],
    },
  },
  privacy: {
    titleKey: 'page.privacy',
    te: {
      title: 'ప్రైవసీ విధానం',
      sections: [
        {
          id: 'what-we-collect',
          heading: 'ఏమి సేకరిస్తాం',
          body: ['DPDP Act 2023 ప్రకారం అవసరమైన సమాచారాన్ని మాత్రమే సేకరిస్తాం.'],
        },
        { id: 'your-rights', heading: 'మీ హక్కులు', body: ['మీ ఖాతాను, డేటాను తొలగించమని కోరే హక్కు మీకు ఉంది.'] },
      ],
    },
    en: {
      title: 'Privacy policy',
      sections: [
        {
          id: 'what-we-collect',
          heading: 'What we collect',
          body: ['Under the DPDP Act 2023 we collect only the data we actually need.'],
        },
        {
          id: 'your-rights',
          heading: 'Your rights',
          body: ['You have the right to ask us to delete your account and your data.'],
        },
      ],
    },
  },
  terms: {
    titleKey: 'page.terms',
    te: {
      title: 'నిబంధనలు',
      sections: [{ id: 'use', heading: 'వినియోగ నిబంధనలు', body: ['ఈ వెబ్‌సైట్ వినియోగానికి వర్తించే నిబంధనలు.'] }],
    },
    en: {
      title: 'Terms',
      sections: [{ id: 'use', heading: 'Terms of use', body: ['The terms that apply to your use of this website.'] }],
    },
  },
  /**
   * §0 / IT Rules 2021 Rule 3(1)(b)-(d). The one page that has to be blunt:
   * a panchayat secretary's copy reaches readers unread, so the terms say so
   * in the second section rather than in a sub-clause, and the takedown clock
   * is stated in hours next to it.
   */
  'ugc-terms': {
    titleKey: 'page.ugcTerms',
    te: {
      title: 'పాఠకుల కథనాల నిబంధనలు',
      sections: [
        {
          id: 'responsibility',
          heading: 'బాధ్యత ఎవరిది',
          body: [
            'పాఠకులు, పౌర విలేకరులు, పంచాయతీ కార్యదర్శులు పంపే కథనాల్లోని వాస్తవాలకు, అభిప్రాయాలకు, చిత్రాలకు ఆ రచయితే పూర్తి బాధ్యులు.',
            'ఆ కథనాలను సంస్థ తన సొంత ప్రకటనగా స్వీకరించదు. IT Rules 2021 కింద మేము వాటికి మధ్యవర్తి మాత్రమే. ఎవరి కథనమైనా చట్టవిరుద్ధమని తేలితే దాని పర్యవసానాలు ఆ రచయితవే.',
          ],
        },
        {
          id: 'not-pre-reviewed',
          heading: 'పంచాయతీ కథనాలు ముందుగా సమీక్షించబడవు',
          body: [
            'మా వేదికలో దాదాపు ప్రతి కథనాన్నీ ప్రచురణకు ముందు ఒక ఎడిటర్ చదువుతారు. ఒకే ఒక మినహాయింపు ఉంది: ప్రత్యేక అనుమతి పొందిన పంచాయతీ కార్యదర్శి పంపే కథనాలు ఎడిటర్ చదవకుండానే నేరుగా ప్రచురితమవుతాయి.',
            'అటువంటి ప్రతి కథనంపై "ఇది ముందుగా సమీక్షించలేదు" అనే గుర్తు కనిపిస్తుంది. ఈ అనుమతిని ఎప్పుడైనా ఉపసంహరించవచ్చు; ఉపసంహరించిన క్షణమే ఆ వ్యక్తి ప్రచురించిన కథనాలు కూడా వెనక్కి తీసుకుంటాం.',
          ],
        },
        {
          id: 'how-to-report',
          heading: 'ఒక కథనంపై ఫిర్యాదు ఎలా చేయాలి',
          body: [
            'ప్రతి కథనం కింద "నివేదించండి" బటన్ ఉంటుంది. దాన్ని నొక్కి కారణం ఎంచుకోండి — ఫిర్యాదు వెంటనే మోడరేషన్ క్యూకు చేరుతుంది.',
            'ఖాతా లేకపోయినా ఫిర్యాదు చేయవచ్చు: ఈ పేజీ కింద ఉన్న గ్రీవెన్స్ అధికారి చిరునామాకు కథనం లింక్‌తో రాయండి.',
          ],
        },
        {
          id: 'takedown',
          heading: 'తొలగింపు గడువు',
          body: [
            'ముందుగా సమీక్షించని కథనంపై ఫిర్యాదు వస్తే 24 గంటల్లోపు ఒక ఎడిటర్ దాన్ని పరిశీలిస్తారు.',
            'చట్టవిరుద్ధమని తేలిన విషయాన్ని 36 గంటల్లోపు తొలగిస్తాం — IT Rules 2021 నిర్దేశించిన గడువు ఇదే. ఫిర్యాదును 24 గంటల్లో స్వీకరిస్తాం, 30 రోజుల్లో పరిష్కరిస్తాం.',
          ],
        },
        {
          id: 'officer',
          heading: 'గ్రీవెన్స్ అధికారి',
          body: [
            'IT Rules 2021 ప్రకారం నియమించిన గ్రీవెన్స్ అధికారి వివరాలు, సంప్రదింపు మార్గం ఈ పేజీ కింద ఉన్నాయి.',
          ],
        },
      ],
    },
    en: {
      title: 'Reader content terms',
      sections: [
        {
          id: 'responsibility',
          heading: 'Who is responsible',
          body: [
            'The writer is fully responsible for the facts, the opinions and the pictures in a story they send us — readers, citizen reporters and panchayat secretaries alike.',
            'The company does not adopt those statements as its own. Under IT Rules 2021 we are an intermediary for them. If a story is found unlawful, the consequences are the writer’s.',
          ],
        },
        {
          id: 'not-pre-reviewed',
          heading: 'Panchayat stories are not pre-reviewed',
          body: [
            'Almost every story on this platform is read by an editor before it is published. There is exactly one exception: when a panchayat secretary has been granted the publishing exception, their stories go live without an editor reading them first.',
            'Every such story carries a notice saying it was not pre-reviewed. The grant can be withdrawn at any time, and withdrawing it also pulls back the stories that person has already published.',
          ],
        },
        {
          id: 'how-to-report',
          heading: 'How to report a story',
          body: [
            'Every story carries a Report control. Press it, pick a reason, and the report reaches the moderation queue immediately.',
            'You can report without an account: write to the Grievance Officer at the address below, with a link to the story.',
          ],
        },
        {
          id: 'takedown',
          heading: 'Takedown times',
          body: [
            'A report against a story that was not pre-reviewed is looked at by an editor within 24 hours.',
            'Content found unlawful is taken down within 36 hours — the deadline IT Rules 2021 sets. We acknowledge every complaint within 24 hours and resolve it within 30 days.',
          ],
        },
        {
          id: 'officer',
          heading: 'Grievance Officer',
          body: [
            'The Grievance Officer appointed under IT Rules 2021, and the way to reach them, are at the foot of this page.',
          ],
        },
      ],
    },
  },
  'ai-disclosure': {
    titleKey: 'page.aiDisclosure',
    te: {
      title: 'AI వినియోగ ప్రకటన',
      sections: [
        {
          id: 'labelling',
          heading: 'లేబులింగ్',
          body: ['కొన్ని కథనాల తయారీలో AI సహాయాన్ని ఉపయోగిస్తాం. అటువంటి ప్రతి కథనంపై స్పష్టమైన గుర్తు ఉంటుంది.'],
        },
        {
          id: 'editor-review',
          heading: 'ఎడిటర్ సమీక్ష',
          body: ['AI రూపొందించిన ఏ కథనమూ ఎడిటర్ సమీక్ష, ఆమోదం లేకుండా ప్రచురితం కాదు.'],
        },
        {
          id: 'exclusions',
          heading: 'మినహాయింపులు',
          body: [
            'కుల, మత, లైంగిక దాడులు, ఆత్మహత్యలు, మైనర్లకు సంబంధించిన కథనాలు పూర్తిగా జర్నలిస్టులే రాస్తారు.',
          ],
        },
      ],
    },
    en: {
      title: 'AI usage disclosure',
      sections: [
        {
          id: 'labelling',
          heading: 'Labelling',
          body: ['We use AI assistance in producing some stories. Every such story is clearly labelled.'],
        },
        {
          id: 'editor-review',
          heading: 'Editor review',
          body: ['No AI-generated story is published without editor review and approval.'],
        },
        {
          id: 'exclusions',
          heading: 'Exclusions',
          body: [
            'Stories involving caste, religion, sexual assault, suicide or minors are written entirely by journalists.',
          ],
        },
      ],
    },
  },
};

