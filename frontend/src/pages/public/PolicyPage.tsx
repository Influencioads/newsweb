import { useLocation } from 'react-router-dom';
import { Mail, ScrollText } from 'lucide-react';

import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { EmptyState } from '@/components/ui/State';
import { useI18n, useScript, type Language, type StringKey } from '@/i18n';
import { cn } from '@/utils/cn';
import { useDocumentTitle } from '@/utils/motion';

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
 *
 * Each route is its own path (`/privacy`, `/terms`, …) rather than one
 * `/:slug`, so the key comes from `pathname`. Reading `useParams().slug` here
 * always returned undefined — every policy page rendered "not found".
 */

interface PolicySection {
  /** Anchor target; also the ChipRail link. */
  id: string;
  heading: string;
  body: string[];
}

interface PolicyContent {
  title: string;
  sections: PolicySection[];
}

interface PolicyEntry {
  /** Document title, per the route's own `page.*` key. */
  titleKey: StringKey;
  te: PolicyContent;
  en: PolicyContent;
}

/**
 * One date for the whole placeholder set. Counsel's copy arrives page by page
 * (§16 open item 17); give each entry its own `updated` when it does.
 */
const LAST_UPDATED = '2026-01-15';

/** Placeholder like the rest of this file — swap for the publisher's address. */
const GRIEVANCE_EMAIL = 'grievance@example.com';

const PAGES: Record<string, PolicyEntry> = {
  about: {
    titleKey: 'page.about',
    te: {
      title: 'మా గురించి',
      sections: [
        {
          id: 'who-we-are',
          heading: 'మేమెవరం',
          body: ['టాప్ తెలుగు న్యూస్ — ఆంధ్రప్రదేశ్, తెలంగాణ జిల్లా వార్తల డిజిటల్ వేదిక.'],
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
            'Top Telugu News is a digital news platform covering Andhra Pradesh and Telangana, district by district.',
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
          body: ['IT Rules 2021 ప్రకారం ఫిర్యాదులను 24 గంటల్లో స్వీకరించి, 15 రోజుల్లో పరిష్కరిస్తాం.'],
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
          body: ['Under IT Rules 2021 we acknowledge complaints within 24 hours and resolve them within 15 days.'],
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
            'కుల, మత, మతపరమైన ఘటనలు, లైంగిక దాడులు, ఆత్మహత్యలు, మైనర్లకు సంబంధించిన కథనాలు పూర్తిగా జర్నలిస్టులే రాస్తారు.',
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
            'Stories involving caste, religion, communal incidents, sexual assault, suicide or minors are written entirely by journalists.',
          ],
        },
      ],
    },
  },
};

/** `2026-01-15` in the reader's language, without pulling in a date library. */
function formatUpdated(iso: string, language: Language): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(language === 'te' ? 'te-IN' : 'en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function PolicyPage() {
  const { pathname } = useLocation();
  const { language, t } = useI18n();
  const s = useScript();
  // Page-specific copy with no strings.ts key yet (see neededStrings).
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  const entry = PAGES[slug];

  useDocumentTitle(entry ? t(entry.titleKey) : t('page.notFound'));

  if (!entry) {
    return (
      <PageContainer width="article" className="py-7 md:py-10">
        <EmptyState
          icon={ScrollText}
          headingLevel={1}
          title={t('state.notFound')}
          body={t('state.notFoundBody')}
          action={
            <ButtonLink to="/" variant="secondary">
              {t('page.home')}
            </ButtonLink>
          }
        />
      </PageContainer>
    );
  }

  const page = entry[language];
  const telugu = language === 'te';

  return (
    <PageContainer width="article" className="py-7 md:py-10">
      <PageHeader
        eyebrow={t('ui.compliance')}
        icon={ScrollText}
        title={page.title}
        back={{ to: '/', label: t('page.home') }}
      />

      <div className="space-y-7 md:space-y-10">
        {/* The revision date is the trust signal Google News looks for, and the
            first thing a regulator checks. It belongs above the copy. */}
        <p lang={language} className={cn(s.body, '-mt-4 text-meta text-muted')}>
          {L('చివరిగా సవరించినది', 'Last updated')}: {formatUpdated(LAST_UPDATED, language)}
        </p>

        {page.sections.length > 1 ? (
          <ChipRail ariaLabel={L('ఈ పేజీలోని విభాగాలు', 'Sections on this page')}>
            {page.sections.map((section) => (
              <Chip key={section.id} as="link" to={`#${section.id}`} lang={language}>
                {section.heading}
              </Chip>
            ))}
          </ChipRail>
        ) : null}

        {page.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-header">
            <h2
              lang={language}
              className={cn(s.head, 'reader-h3 mb-3 font-extrabold text-ink')}
            >
              {section.heading}
            </h2>
            {section.body.map((para) => (
              <p key={para} lang={language} className={cn(s.body, 'reader-body mb-4 text-ink')}>
                {para}
              </p>
            ))}
          </section>
        ))}

        {/* §12.5 — every compliance page ends at the same door: a real,
            reachable grievance route with the IT Rules SLA stated next to it. */}
        <Card tone="warm" padding="lg" radius="2xl">
          <h2 lang={language} className={cn(s.head, 'text-headline-md font-extrabold text-ink')}>
            {L('ఫిర్యాదు చేయాలా?', 'Need to raise a complaint?')}
          </h2>
          <p
            lang={language}
            className={cn(s.body, 'mt-2 text-muted', telugu ? 'text-te-body-xs' : 'text-ui')}
          >
            {L(
              'IT Rules 2021 ప్రకారం మీ ఫిర్యాదును 24 గంటల్లో స్వీకరించి, 15 రోజుల్లో పరిష్కరిస్తాం.',
              'Under IT Rules 2021 we acknowledge your complaint within 24 hours and resolve it within 15 days.',
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink to={`mailto:${GRIEVANCE_EMAIL}`} external icon={Mail}>
              {L('గ్రీవెన్స్ అధికారికి రాయండి', 'Email the Grievance Officer')}
            </ButtonLink>
            {slug === 'grievance' ? null : (
              <ButtonLink to="/grievance" variant="secondary">
                {t('page.grievance')}
              </ButtonLink>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
