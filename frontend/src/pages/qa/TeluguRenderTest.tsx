import type { ReactNode } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { Chip, ChipRail } from '@/components/ui/Chip';
import { PageContainer, PageHeader } from '@/components/ui/Layout';
import { useReaderPrefs, FONT_STEPS, type Theme } from '@/stores/readerPrefs';
import { useDocumentTitle } from '@/utils/motion';

/**
 * The mandatory Telugu render test (§4.1, §15.4).
 *
 * The spec is explicit: "If any glyph in that block clips, boxes, or reorders on
 * any target device, the build is not shippable." This page is the QA checklist
 * item — it must stay in the app, and it must be checked on Samsung One UI,
 * Xiaomi HyperOS/MIUI, Realme/Oppo, a 3-year-old budget Android, iPhone (2
 * versions), Chrome desktop and Safari desktop before every release.
 *
 * A standalone route with no layout around it, so it owns the one
 * `<main id="main">` landmark itself.
 */

const TEST_LINES = [
  'ఆంధ్రప్రదేశ్ · తెలంగాణ · శ్రీకాకుళం · ఖమ్మం · విశాఖపట్నం',
  'క్ష్ణ · ష్ట్ర · ంద్ర · ద్వి · స్త్రీ · ర్జు · ళ్ళ · ౦౧౨౩౪౫౬౭౮౯',
  'CM చంద్రబాబు 2026లో ₹1,250 కోట్లు #Breaking',
];

/** 120 Telugu characters — §15.4 requires this not to clip in any surface. */
const LONG_HEADLINE =
  'అమరావతి రాజధాని నిర్మాణానికి కేంద్ర ప్రభుత్వం తొలి విడతగా ఒక వెయ్యి రెండు వందల యాభై కోట్ల రూపాయల నిధులు విడుదల చేసినట్లు అధికారులు వెల్లడించారు';

/** The three faces, compared at one size so the difference read is the face. */
const FACES: Array<[string, string]> = [
  ['Noto Serif Telugu', 'th font-bold'],
  ['Noto Sans Telugu', 'te'],
  ['Manrope', 'font-sans'],
  ['Fraunces', 'font-serif font-semibold'],
];

function Section({ title, spec, children }: { title: string; spec: string; children: ReactNode }) {
  return (
    <Card as="section" padding="lg">
      <header className="mb-3">
        <h2 className="text-ui-sm font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 text-meta text-muted">{spec}</p>
      </header>
      {children}
    </Card>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-eyebrow uppercase text-muted">{children}</p>;
}

const THEMES: Array<[Theme, string, LucideIcon]> = [
  ['system', 'System', Monitor],
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
];

/**
 * Font step x theme, switched in place: every size below has to be checked at
 * all four steps in both themes, and leaving the page to do it loses the scroll
 * position on the one screen where the comparison matters.
 */
function Controls() {
  const { fontStep, setFontStep, theme, resolvedTheme, setTheme } = useReaderPrefs();
  return (
    <div className="glass sticky top-0 z-10 -mx-4 mb-8 border-b border-rule px-4 py-3 md:-mx-6 md:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-eyebrow uppercase text-muted">Font step</span>
          <ChipRail ariaLabel="Reader font step" fadeEdges={false}>
            {FONT_STEPS.map((step) => (
              <Chip key={step} selected={fontStep === step} onClick={() => setFontStep(step)} lang="en">
                {step}
              </Chip>
            ))}
          </ChipRail>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-eyebrow uppercase text-muted">Theme</span>
          <ChipRail ariaLabel="Theme" fadeEdges={false}>
            {THEMES.map(([value, label, icon]) => (
              <Chip key={value} icon={icon} selected={theme === value} onClick={() => setTheme(value)} lang="en">
                {label}
              </Chip>
            ))}
          </ChipRail>
        </div>
        <p className="text-meta text-muted">
          current: {fontStep} · {theme} ({resolvedTheme})
        </p>
      </div>
    </div>
  );
}

export default function TeluguRenderTest() {
  useDocumentTitle('Telugu render test');

  return (
    <PageContainer as="main" id="main" tabIndex={-1} width="page" className="py-8 outline-none">
      <PageHeader titleLang="te" title="తెలుగు రెండరింగ్ పరీక్ష" spacing="tight" />
      <p lang="en" className="mb-8 text-meta text-muted">
        Telugu render test · Build Instructions §4.1 + §15.4 QA checklist. If any glyph clips,
        boxes, or reorders, the build is not shippable.
      </p>

      <Controls />

      <div className="flex flex-col gap-4">
        <Section
          title="Mandatory render test string"
          spec="§4.1 — must not clip, box, or reorder on any target device"
        >
          <div className="rounded-xl border border-dashed border-breaking bg-paper-sub p-4">
            {TEST_LINES.map((line) => (
              <p key={line} lang="te" className="te text-te-body-sm">
                {line}
              </p>
            ))}
          </div>
        </Section>

        <Section
          title="Long headline — 120 Telugu characters"
          spec="§15.4 — must not clip in feed card, article header, push, or e-paper slot"
        >
          <div className="flex flex-col gap-4">
            <div>
              <Label>Article header · Noto Serif Telugu 700 · headline-xl</Label>
              <h3 lang="te" className="th text-headline-xl font-extrabold">
                {LONG_HEADLINE}
              </h3>
            </div>
            <div className="max-w-[320px]">
              <Label>Narrow feed card · 320px — elastic height, never a fixed one</Label>
              <div className="rounded-xl border border-rule p-3">
                <h4 lang="te" className="th text-headline-xs font-bold">
                  {LONG_HEADLINE}
                </h4>
              </div>
            </div>
            <div className="max-w-[320px]">
              <Label>Push notification · truncated at 65 chars for Android collapsed view (§4.6)</Label>
              <div className="rounded-xl bg-ink-panel p-3">
                <p lang="te" className="te text-te-body-xs font-semibold text-on-ink">
                  {LONG_HEADLINE.slice(0, 65)}…
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Type scale" spec="§4.1 — body 19px web / headline 30-34px / line-height >= 1.65x">
          <div className="flex flex-col gap-3">
            <div>
              <Label>Headline — Noto Serif Telugu 700</Label>
              <p lang="te" className="th text-headline-lg font-bold">
                అమరావతి రాజధాని నిధులు విడుదల: తొలి విడత ₹1,250 కోట్లు
              </p>
            </div>
            <div>
              <Label>Body — Noto Sans Telugu 400 · 19px · lh 1.7</Label>
              <p lang="te" className="te text-te-body">
                రాజధాని అమరావతి నిర్మాణానికి కేంద్ర ప్రభుత్వం తొలి విడత నిధులు విడుదల చేసింది. CRDA
                అధికారులు వివరాలు వెల్లడించారు.
              </p>
            </div>
            <div>
              <Label>Mixed script — Latin fallback must match x-height</Label>
              <p lang="te" className="te text-te-body-xs">
                ₹1,250 కోట్లు · 26 Aug 2026 · #Breaking · CM చంద్రబాబు · IPL
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="Reader font-size switcher"
          spec="§4.1 — required feature; persists in localStorage across sessions. Switch it in the bar above."
        >
          <p lang="te" className="reader-body te">
            ఈ వాక్యం పైన ఎంచుకున్న అక్షర పరిమాణానికి అనుగుణంగా మారుతుంది. ఎంపిక అన్ని కథనాలకూ
            వర్తిస్తుంది.
          </p>
        </Section>

        <Section title="Font loading" spec="§4.1 — self-hosted WOFF2, no Google Fonts CDN">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FACES.map(([family, cls]) => (
              <div key={family} className="rounded-xl border border-rule p-3">
                <dt className="text-eyebrow uppercase text-muted">{family}</dt>
                {/* The specimen demonstrates the FACE, so it carries the Telugu
                    line-height explicitly: the `font-sans` row renders Telugu
                    through the fallback stack, where text-headline-md's 1.5
                    would sit under the §4.1 floor. */}
                <dd lang="te" className={`${cls} text-headline-md leading-telugu`}>
                  తెలుగు Abc 123
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </PageContainer>
  );
}
