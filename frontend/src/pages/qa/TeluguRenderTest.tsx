import { useReaderPrefs, FONT_STEPS } from '@/stores/readerPrefs';

/**
 * The mandatory Telugu render test (§4.1, §15.4).
 *
 * The spec is explicit: "If any glyph in that block clips, boxes, or reorders on
 * any target device, the build is not shippable." This page is the QA checklist
 * item — it must stay in the app, and it must be checked on Samsung One UI,
 * Xiaomi HyperOS/MIUI, Realme/Oppo, a 3-year-old budget Android, iPhone (2
 * versions), Chrome desktop and Safari desktop before every release.
 */

const TEST_LINES = [
  'ఆంధ్రప్రదేశ్ · తెలంగాణ · శ్రీకాకుళం · ఖమ్మం · విశాఖపట్నం',
  'క్ష్ణ · ష్ట్ర · ంద్ర · ద్వి · స్త్రీ · ర్జు · ళ్ళ · ౦౧౨౩౪౫౬౭౮౯',
  'CM చంద్రబాబు 2026లో ₹1,250 కోట్లు #Breaking',
];

/** 120 Telugu characters — §15.4 requires this not to clip in any surface. */
const LONG_HEADLINE =
  'అమరావతి రాజధాని నిర్మాణానికి కేంద్ర ప్రభుత్వం తొలి విడతగా ఒక వెయ్యి రెండు వందల యాభై కోట్ల రూపాయల నిధులు విడుదల చేసినట్లు అధికారులు వెల్లడించారు';

function Section({ title, spec, children }: { title: string; spec: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-white p-5 shadow-card">
      <header className="mb-3">
        <h2 className="font-sans text-[13px] font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 font-sans text-[11px] text-muted-light">{spec}</p>
      </header>
      {children}
    </section>
  );
}

export default function TeluguRenderTest() {
  const { fontStep, setFontStep } = useReaderPrefs();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-headline text-headline-lg font-bold text-brand">
          తెలుగు రెండరింగ్ పరీక్ష
        </h1>
        <p className="mt-1 font-sans text-[12px] text-muted">
          Telugu render test · Build Instructions §4.1 + §15.4 QA checklist. If any glyph clips,
          boxes, or reorders, the build is not shippable.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <Section
          title="Mandatory render test string"
          spec="§4.1 — must not clip, box, or reorder on any target device"
        >
          <div className="rounded-control border-[1.5px] border-dashed border-breaking bg-[#FFF9F4] p-4">
            {TEST_LINES.map((line) => (
              <p key={line} className="te text-te-body-sm">
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
              <p className="mb-1 font-sans text-eyebrow uppercase tracking-[0.1em] text-muted-light">
                Article header · Anek Telugu 700 · 33px
              </p>
              <h3 className="th text-headline-xl font-extrabold">{LONG_HEADLINE}</h3>
            </div>
            <div className="max-w-[320px]">
              <p className="mb-1 font-sans text-eyebrow uppercase tracking-[0.1em] text-muted-light">
                Narrow feed card · 320px — elastic height, never a fixed one
              </p>
              <div className="rounded-control border border-rule p-3">
                <h4 className="th text-headline-xs font-bold">{LONG_HEADLINE}</h4>
              </div>
            </div>
            <div className="max-w-[320px]">
              <p className="mb-1 font-sans text-eyebrow uppercase tracking-[0.1em] text-muted-light">
                Push notification · truncated at 65 chars for Android collapsed view (§4.6)
              </p>
              <div className="rounded-control bg-ink-panel p-3">
                <p className="te text-[13px] font-semibold leading-[1.6] text-white">
                  {LONG_HEADLINE.slice(0, 65)}…
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Type scale"
          spec="§4.1 — body 19px web / headline 30-34px / line-height >= 1.65x"
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 font-sans text-eyebrow uppercase tracking-[0.1em] text-muted-light">
                Headline — Anek Telugu 700
              </p>
              <p className="th text-headline-lg font-bold">
                అమరావతి రాజధాని నిధులు విడుదల: తొలి విడత ₹1,250 కోట్లు
              </p>
            </div>
            <div>
              <p className="mb-1 font-sans text-eyebrow uppercase tracking-[0.1em] text-muted-light">
                Body — Noto Sans Telugu 400 · 19px · lh 1.7
              </p>
              <p className="te text-te-body">
                రాజధాని అమరావతి నిర్మాణానికి కేంద్ర ప్రభుత్వం తొలి విడత నిధులు విడుదల చేసింది. CRDA
                అధికారులు వివరాలు వెల్లడించారు.
              </p>
            </div>
            <div>
              <p className="mb-1 font-sans text-eyebrow uppercase tracking-[0.1em] text-muted-light">
                Mixed script — Latin fallback must match x-height
              </p>
              <p className="text-[16px]">₹1,250 కోట్లు · 26 Aug 2026 · #Breaking · CM చంద్రబాబు · IPL</p>
            </div>
          </div>
        </Section>

        <Section
          title="Reader font-size switcher"
          spec="§4.1 — required feature; persists in localStorage across sessions"
        >
          <div className="flex flex-wrap items-center gap-2">
            {FONT_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setFontStep(step)}
                aria-pressed={fontStep === step}
                className={[
                  'min-h-tap min-w-tap rounded-control border px-4 font-sans font-semibold transition-colors',
                  fontStep === step
                    ? 'border-brand bg-brand-tint text-brand'
                    : 'border-rule text-ink-soft hover:border-brand',
                ].join(' ')}
              >
                {step}
              </button>
            ))}
            <span className="ml-2 font-sans text-[11px] text-muted-light">
              current: {fontStep}
            </span>
          </div>
          <p className="reader-body te mt-4">
            ఈ వాక్యం పైన ఎంచుకున్న అక్షర పరిమాణానికి అనుగుణంగా మారుతుంది. ఎంపిక అన్ని కథనాలకూ
            వర్తిస్తుంది.
          </p>
        </Section>

        <Section title="Font loading" spec="§4.1 — self-hosted WOFF2, no Google Fonts CDN">
          <dl className="grid grid-cols-1 gap-2 font-sans text-[12px] sm:grid-cols-3">
            {[
              ['Anek Telugu', 'th text-[20px] font-bold'],
              ['Noto Sans Telugu', 'te text-[18px]'],
              ['Inter', 'text-[18px]'],
            ].map(([family, cls]) => (
              <div key={family} className="rounded-control border border-rule p-3">
                <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-light">{family}</dt>
                <dd className={cls as string}>తెలుగు Abc 123</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </main>
  );
}
