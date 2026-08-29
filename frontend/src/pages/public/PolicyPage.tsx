import { useParams } from 'react-router-dom';

import { useI18n } from '@/i18n';

/**
 * Static compliance pages (§12.5).
 *
 * IT Rules 2021 Part III and Google News trust signals both require these live
 * at launch. Bilingual because a compliance page a reader cannot read is not
 * compliance — the Grievance Officer route in particular has to be legible to
 * whoever needs to use it.
 *
 * The copy is placeholder pending the client's counsel (§16 open item 17). The
 * routes, the Grievance Officer slot and the SLA language are built, so filling
 * them in is a content edit rather than a code change.
 */

interface PolicyContent {
  title: string;
  body: string[];
}

const PAGES: Record<string, { te: PolicyContent; en: PolicyContent }> = {
  about: {
    te: {
      title: 'మా గురించి',
      body: ['టాప్ తెలుగు న్యూస్ — ఆంధ్రప్రదేశ్, తెలంగాణ జిల్లా వార్తల డిజిటల్ వేదిక.'],
    },
    en: {
      title: 'About us',
      body: [
        'Top Telugu News is a digital news platform covering Andhra Pradesh and Telangana, district by district.',
      ],
    },
  },
  contact: {
    te: {
      title: 'సంప్రదించండి',
      body: ['సంపాదకీయ విభాగం: editor@example.com', 'ప్రకటనల విభాగం: ads@example.com'],
    },
    en: {
      title: 'Contact',
      body: ['Editorial desk: editor@example.com', 'Advertising: ads@example.com'],
    },
  },
  'editorial-policy': {
    te: {
      title: 'ఎడిటోరియల్ పాలసీ',
      body: [
        'ప్రతి కథనం ప్రచురణకు ముందు సీనియర్ ఎడిటర్ ఆమోదం పొందుతుంది. ఏ కథనమూ ఆమోదం లేకుండా పాఠకులకు చేరదు.',
        'ప్రతి వాదనకు మూలాన్ని పేర్కొంటాం. ఏజెన్సీ కథనాలకు తప్పనిసరిగా మూల ప్రస్తావన ఉంటుంది.',
      ],
    },
    en: {
      title: 'Editorial policy',
      body: [
        'Every story is approved by a senior editor before publication. Nothing reaches a reader without that approval.',
        'We attribute every claim to a source. Agency copy always carries its credit.',
      ],
    },
  },
  corrections: {
    te: {
      title: 'సవరణల విధానం',
      body: [
        'తప్పు గుర్తించిన వెంటనే సవరిస్తాం. సవరించిన కథనంపై "సవరించబడింది" తేదీ కనిపిస్తుంది.',
        'ముఖ్యమైన సవరణలకు ఎడిటర్ నోట్ జతచేస్తాం.',
      ],
    },
    en: {
      title: 'Corrections policy',
      body: [
        'We correct errors as soon as we find them. A corrected story shows the date it was amended.',
        "Material corrections carry an editor's note explaining what changed.",
      ],
    },
  },
  grievance: {
    te: {
      title: 'గ్రీవెన్స్ అధికారి',
      body: [
        'IT Rules 2021 ప్రకారం ఫిర్యాదులను 24 గంటల్లో స్వీకరించి, 15 రోజుల్లో పరిష్కరిస్తాం.',
        'గ్రీవెన్స్ అధికారి పేరు మరియు సంప్రదింపు వివరాలు: [క్లయింట్ ద్వారా పూరించాలి]',
      ],
    },
    en: {
      title: 'Grievance officer',
      body: [
        'Under IT Rules 2021 we acknowledge complaints within 24 hours and resolve them within 15 days.',
        'Grievance Officer name and contact details: [to be completed by the publisher]',
      ],
    },
  },
  privacy: {
    te: {
      title: 'ప్రైవసీ విధానం',
      body: [
        'DPDP Act 2023 ప్రకారం అవసరమైన సమాచారాన్ని మాత్రమే సేకరిస్తాం.',
        'మీ ఖాతాను, డేటాను తొలగించమని కోరే హక్కు మీకు ఉంది.',
      ],
    },
    en: {
      title: 'Privacy policy',
      body: [
        'Under the DPDP Act 2023 we collect only the data we actually need.',
        'You have the right to ask us to delete your account and your data.',
      ],
    },
  },
  terms: {
    te: { title: 'నిబంధనలు', body: ['ఈ వెబ్‌సైట్ వినియోగానికి వర్తించే నిబంధనలు.'] },
    en: { title: 'Terms', body: ['The terms that apply to your use of this website.'] },
  },
  'ai-disclosure': {
    te: {
      title: 'AI వినియోగ ప్రకటన',
      body: [
        'కొన్ని కథనాల తయారీలో AI సహాయాన్ని ఉపయోగిస్తాం. అటువంటి ప్రతి కథనంపై స్పష్టమైన గుర్తు ఉంటుంది.',
        'AI రూపొందించిన ఏ కథనమూ ఎడిటర్ సమీక్ష, ఆమోదం లేకుండా ప్రచురితం కాదు.',
        'కుల, మత, మతపరమైన ఘటనలు, లైంగిక దాడులు, ఆత్మహత్యలు, మైనర్లకు సంబంధించిన కథనాలు పూర్తిగా జర్నలిస్టులే రాస్తారు.',
      ],
    },
    en: {
      title: 'AI usage disclosure',
      body: [
        'We use AI assistance in producing some stories. Every such story is clearly labelled.',
        'No AI-generated story is published without editor review and approval.',
        'Stories involving caste, religion, communal incidents, sexual assault, suicide or minors are written entirely by journalists.',
      ],
    },
  },
};

export default function PolicyPage() {
  const { slug } = useParams<{ slug: string }>();
  const { language, t } = useI18n();
  const entry = slug ? PAGES[slug] : undefined;

  if (!entry) {
    return (
      <main className="mx-auto max-w-article px-4 py-16 text-center">
        <h1 className={`${language === 'te' ? 'th' : 'font-sans'} text-[22px] font-bold text-ink`}>
          {t('state.articleNotFound')}
        </h1>
      </main>
    );
  }

  const page = entry[language];
  const script = language === 'te' ? 'te' : 'font-sans';

  return (
    <main className="mx-auto max-w-article bg-white px-4 py-8">
      <h1
        className={`${language === 'te' ? 'th' : 'font-sans'} text-[26px] font-extrabold text-ink`}
      >
        {page.title}
      </h1>
      <div className="mt-4">
        {page.body.map((para) => (
          <p key={para} className={`${script} reader-body mb-4 text-ink`}>
            {para}
          </p>
        ))}
      </div>
    </main>
  );
}
