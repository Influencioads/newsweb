import { useEffect, useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Download, ImageOff, ImagePlus, RefreshCw, RotateCcw, Save, Search, SearchX, Sparkles, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/client';
import { AdminPage } from '@/components/admin/AdminPage';
import { Section } from '@/components/admin/FormControls';
import { WorkflowPill } from '@/components/admin/StatusPill';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Dialog';
import { Field, FileDrop, Input, Radio, Switch, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import type { SocialCard, SocialCardBody, SocialCardTemplate } from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { CmsArticle } from '@/types/cms';
import { cn } from '@/utils/cn';
import { downloadFile } from '@/utils/download';

import { useL } from './useL';

/**
 * Creative studio — a social creative from a story, in five steps: pick the
 * article, approve the copy, choose the size, choose the design, generate.
 *
 * The owner's rule (2026-09-28), which the page repeats to the desk: the AI
 * never redraws the news photo and never letters the news. GPT Image 2.5 draws
 * only the design — a backdrop with no text, no people and no logos, in the
 * style of the reference designs picked here. The server then places the
 * story's real photo untouched and typesets the approved copy
 * (`social_card_service`); a figure in the copy that the story does not state
 * is flagged.
 *
 * Drawing costs money and takes 15–60 s, so nothing is drawn until Generate.
 * The drawn backdrop is held by media id and sent back on every later render,
 * so a text fix, a template change or "Save" re-renders for free.
 */

const PRESETS = [
  { key: 'post', w: 1080, h: 1080, te: 'ఇన్‌స్టాగ్రామ్ పోస్ట్', en: 'Instagram post' },
  { key: 'portrait', w: 1080, h: 1350, te: 'పోర్ట్రెయిట్', en: 'Portrait' },
  { key: 'story', w: 1080, h: 1920, te: 'స్టోరీ / రీల్ / వాట్సాప్ స్టేటస్', en: 'Story / Reel / WhatsApp status' },
  { key: 'landscape', w: 1920, h: 1080, te: 'ల్యాండ్‌స్కేప్', en: 'Landscape' },
  { key: 'link', w: 1200, h: 630, te: 'లింక్ ప్రివ్యూ', en: 'Link preview' },
] as const;

const TEMPLATES: Array<{ value: SocialCardTemplate; te: string; en: string }> = [
  { value: 'frame', te: 'హెడ్‌లైన్ పైన, ఫోటో మధ్యలో', en: 'Headline on top, photo framed' },
  { value: 'panel', te: 'ఫోటో + ప్యానెల్', en: 'Photo + text panel' },
  { value: 'overlay', te: 'ఫుల్ ఫోటో', en: 'Full photo' },
];

const STEPS = [
  { te: 'కథనం', en: 'Article' },
  { te: 'పాఠ్యం', en: 'Copy' },
  { te: 'పరిమాణం', en: 'Dimensions' },
  { te: 'డిజైన్', en: 'Design' },
  { te: 'తయారీ', en: 'Generate' },
];

const MAX_REFS = 4;
const ACCEPT = 'image/jpeg,image/png,image/webp';
const MIN_SIDE = 320;
const MAX_SIDE = 4096;

type Size = { w: number; h: number };

function customSize(w: string, h: string): Size | null {
  const x = Number(w);
  const y = Number(h);
  const ok = (n: number) => Number.isInteger(n) && n >= MIN_SIDE && n <= MAX_SIDE;
  return ok(x) && ok(y) ? { w: x, h: y } : null;
}

/** A small outline of the shape, so the choice is visible, not just numeric. */
function ShapeBox({ w, h }: Size) {
  const scale = 36 / Math.max(w, h);
  return (
    <span aria-hidden className="flex h-10 items-center justify-center text-muted">
      <span className="rounded-md border-2 border-current" style={{ width: Math.max(8, w * scale), height: Math.max(8, h * scale) }} />
    </span>
  );
}

export default function CreativeStudio() {
  const { t } = useI18n();
  const L = useL();
  const s = useScript();
  const toast = useToast();
  const can = useAuth((st) => st.can);
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const name = useId();

  const [step, setStep] = useState(0);
  const [q, setQ] = useState('');
  const [article, setArticle] = useState<CmsArticle | null>(null);
  const [tag, setTag] = useState('');
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  const [copyNote, setCopyNote] = useState<string[]>([]);
  const [preset, setPreset] = useState<string | null>(null);
  const [customW, setCustomW] = useState('1080');
  const [customH, setCustomH] = useState('1350');
  const [template, setTemplate] = useState<SocialCardTemplate>('frame');
  const [useAi, setUseAi] = useState(true);
  const [refs, setRefs] = useState<number[]>([]);
  const [brief, setBrief] = useState('');
  /** The backdrop already drawn, and the design settings it was drawn for. */
  const [held, setHeld] = useState<{ id: number; design: string } | null>(null);
  const [renderedKey, setRenderedKey] = useState('');

  const size: Size | null =
    preset === 'custom' ? customSize(customW, customH) : (PRESETS.find((p) => p.key === preset) ?? null);
  // Which steps may be opened: each needs everything before it.
  const hasCopy = !!article && !!headline.trim();
  const ready = [true, !!article, hasCopy, hasCopy && !!size, hasCopy && !!size];
  // The full-photo layout is all photo when the story has one: a design under
  // it would be paid for and never seen (the server draws none either).
  const covered = template === 'overlay' && !!article?.hero_media_id;
  const aiOn = useAi && !covered;

  // ------------------------------------------------------------ queries --
  const articles = useQuery({
    queryKey: ['cms', 'creative-articles', q.trim()],
    queryFn: () => cmsApi.fetchArticles({ search: q.trim() || undefined, limit: 24 }),
  });
  const canSeeRefs = can('media.view');
  const references = useQuery({
    queryKey: ['cms', 'creative-refs'],
    queryFn: cmsApi.fetchCreativeRefs,
    enabled: canSeeRefs && step === 3 && aiOn,
  });
  const refreshRefs = () => void queryClient.invalidateQueries({ queryKey: ['cms', 'creative-refs'] });
  // A reference deleted elsewhere leaves the selection with its tile; kept, it
  // would 404 every Generate with nothing on screen to deselect.
  useEffect(() => {
    const known = references.data;
    if (known) setRefs((cur) => cur.filter((id) => known.some((r) => r.id === id)));
  }, [references.data]);

  // --------------------------------------------------------------- copy --
  // The card takes 32 / 160 / 400 characters and 422s past them.
  function fill(nextTag: string, nextHeadline: string, nextSummary: string) {
    setTag(nextTag.slice(0, 32));
    setHeadline(nextHeadline.slice(0, 160));
    setText(nextSummary.slice(0, 400));
  }
  const resetCopy = (a: CmsArticle) => {
    // The tag left blank takes the story's section name on the server.
    fill('', a.title_te, a.summary_te ?? '');
    setCopyNote([]);
  };

  function pick(a: CmsArticle) {
    setArticle(a);
    resetCopy(a);
    write.reset();
    make.reset();
    setRenderedKey('');
  }

  const write = useMutation({
    mutationFn: (id: number) => cmsApi.socialCardText(id),
    onError: (e) => toast.error(e),
  });
  // Filled from the per-call callback: pick() resets `write`, which detaches
  // it, so copy still in flight for the story left behind never lands here.
  const writeCopy = (id: number) =>
    write.mutate(id, {
      onSuccess: (r) => {
        fill(r.tag, r.headline, r.summary);
        setCopyNote([...(r.engine === 'heuristic' ? ['heuristic'] : []), ...(r.warnings ?? [])]);
      },
    });

  // --------------------------------------------------------- references --
  const upload = useMutation({
    mutationFn: (file: File) => cmsApi.uploadCreativeRef(file),
    onSuccess: (r) => {
      // Selected only where its tile shows, so it can be deselected.
      if (canSeeRefs) setRefs((cur) => (cur.length < MAX_REFS ? [...cur, r.id] : cur));
      refreshRefs();
    },
    onError: () => toast.error(L('అప్‌లోడ్ విఫలమైంది — JPEG/PNG/WebP మాత్రమే, 15MB లోపు.', 'Upload failed — JPEG, PNG or WebP only, under 15MB.')),
  });
  const remove = useMutation({
    mutationFn: (id: number) => cmsApi.deleteCreativeRef(id),
    onSuccess: (_r, id) => {
      setRefs((cur) => cur.filter((x) => x !== id));
      refreshRefs();
    },
    onError: (e) => toast.error(e),
  });
  async function askRemove(id: number) {
    const ok = await confirm({
      title: L('ఈ రిఫరెన్స్ డిజైన్ తొలగించాలా?', 'Delete this reference design?'),
      body: L('ఇప్పటికే తయారైన క్రియేటివ్‌లపై ప్రభావం ఉండదు.', 'Creatives already made from it are not affected.'),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    });
    if (ok) remove.mutate(id);
  }
  const toggleRef = (id: number) =>
    setRefs((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX_REFS ? [...cur, id] : cur));

  // ------------------------------------------------------------- render --
  const refIds = aiOn ? refs : [];
  const designBrief = aiOn && brief.trim() ? brief.trim() : null;
  const design = JSON.stringify([size?.w, size?.h, refIds, designBrief]);
  const designOf = (b: SocialCardBody) => JSON.stringify([b.width, b.height, b.reference_media_ids, b.backdrop_brief]);
  const backdropId = aiOn && held?.design === design ? held.id : null;

  const body = (save = false): SocialCardBody => ({
    aspect: '4:5', // ignored: width and height decide
    template,
    headline: headline.trim(),
    summary: text.trim(),
    tag: tag.trim() || null,
    photo: 'story',
    photo_media_id: null,
    brief: null,
    width: size?.w,
    height: size?.h,
    use_ai_backdrop: aiOn && backdropId === null,
    reference_media_ids: refIds,
    backdrop_media_id: backdropId,
    backdrop_brief: designBrief,
    save,
  });
  const keyOf = (b: SocialCardBody) =>
    JSON.stringify([article?.id, b.template, b.headline, b.summary, b.tag, b.width, b.height, !!(b.use_ai_backdrop || b.backdrop_media_id), designOf(b)]);

  const make = useMutation({
    mutationFn: ({ id, b }: { id: number; b: SocialCardBody }) => cmsApi.makeSocialCard(id, b),
    onSuccess: (r, { b }) => {
      setRenderedKey(keyOf(b));
      if (r.card?.backdrop) setHeld({ id: r.card.backdrop.media_id, design: designOf(b) });
      if (b.save && r.card?.media_id) toast.success(L('మీడియా లైబ్రరీలో సేవ్ అయింది.', 'Saved to the media library.'));
    },
    onError: (e, { b }) => {
      // A backdrop drawn and paid for before a later step failed comes back
      // on the error; hold it so the retry does not pay again.
      if (e instanceof ApiError && typeof e.details.backdrop_media_id === 'number') setHeld({ id: e.details.backdrop_media_id, design: designOf(b) });
      if (!(e instanceof ApiError && e.status === 422)) toast.error(e);
    },
  });
  const run = (b: SocialCardBody) => {
    if (article) make.mutate({ id: article.id, b });
  };
  // A 422 is a refusal (sensitive topic, a model without references) — the
  // feature working, so shown in place rather than as a red toast.
  const refusal = make.error instanceof ApiError && make.error.status === 422 ? make.error.displayMessage : null;
  const card: SocialCard | null = make.data?.card ?? null;
  const stale = card !== null && renderedKey !== keyOf(body());
  const drawing = make.isPending ? !!make.variables?.b.use_ai_backdrop : aiOn && backdropId === null;
  const busy = make.isPending || write.isPending;

  const WARNINGS: Record<string, string> = {
    headline_truncated: L('శీర్షిక చాలా పొడవుగా ఉంది — కత్తిరించాం.', 'The headline was too long and was trimmed.'),
    summary_truncated: L('సారాంశం చాలా పొడవుగా ఉంది — కత్తిరించాం.', 'The summary was too long and was trimmed.'),
    no_photo: L('ఫోటో లేదు — డిజైన్‌పై పాఠ్యం మాత్రమే.', 'No photo — the creative is text over the design.'),
    unsupported_characters: L('కొన్ని అక్షరాలు (ఎమోజీ వంటివి) బాక్సులుగా వస్తాయి — తీసివేయండి.', 'Some characters (emoji and the like) print as boxes — remove them.'),
    unverified_figure: L('కార్డ్‌లోని ఒక సంఖ్య కథనంలో లేదు — పోస్ట్ చేసే ముందు సరిచూడండి.', 'A figure on the card is not in the story — check it before posting.'),
  };
  const COPY_NOTES: Record<string, string> = {
    heuristic: L('AI అందుబాటులో లేదు — కథనం నుంచే తీశాం.', 'AI was unavailable — taken from the story itself.'),
    unverified_figure: L(
      'AI రాసిన పాఠ్యంలో కథనంలో లేని సంఖ్య ఉంది — కాబట్టి కథనం సొంత పాఠ్యం వాడాం.',
      'The AI copy had a figure the story does not state, so the story’s own words were used.',
    ),
  };

  const legend = cn(s.body, 'mb-2 block text-ui-sm font-semibold text-ink');
  const note = cn(s.body, 'text-meta text-muted');
  const alert = cn(s.body, 'rounded-xl border border-partial-border bg-partial-tint p-3 text-ui-sm text-partial');
  const tile = cn(
    'flex h-full flex-col items-center gap-1 rounded-xl border-2 border-rule bg-surface p-2 text-center',
    'transition-colors duration-base ease-standard hover:border-brand peer-checked:border-brand peer-checked:bg-brand-tint',
    'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand',
  );

  const nav = (next?: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-4">
      {step > 0 ? (
        <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
          {t('ui.back')}
        </Button>
      ) : (
        <span />
      )}
      {next ?? (
        <Button icon={ArrowRight} disabled={!ready[step + 1]} onClick={() => setStep(step + 1)}>
          {t('ui.next')}
        </Button>
      )}
    </div>
  );

  const copyFields = (
    <div className="space-y-3">
      <Field label={L('ట్యాగ్', 'Tag')} optionalLabel hint={L('ఖాళీగా వదిలితే కథనం విభాగం పేరు.', 'Left blank, the story’s section name is used.')}>
        <Input script="te" maxLength={32} value={tag} onChange={(e) => setTag(e.target.value)} />
      </Field>
      <Field label={L('శీర్షిక', 'Headline')} required>
        <Textarea script="te" rows={2} counter={160} value={headline} onChange={(e) => setHeadline(e.target.value)} />
      </Field>
      <Field label={L('సారాంశం', 'Summary')} optionalLabel>
        <Textarea script="te" rows={3} counter={400} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </div>
  );

  return (
    <AdminPage
      title={t('admin.page.creative')}
      subtitle={L(
        'కథనం నుంచి సోషల్ క్రియేటివ్. GPT Image 2.5 డిజైన్ మాత్రమే గీస్తుంది — పాఠ్యం, వ్యక్తులు, లోగోలు లేకుండా, మీ రిఫరెన్స్ డిజైన్ల శైలిలో. కథనం అసలు ఫోటో మార్పు లేకుండా పెడతాం, మీరు ఆమోదించిన పాఠ్యాన్నే ముద్రిస్తాం.',
        'A social creative from a story. GPT Image 2.5 draws only the design — no text, no people, no logos — in the style of your reference designs. The story’s real photo is placed untouched, and every word is the copy you approve.',
      )}
    >
      {dialog}
      {/* ------------------------------------------------------ stepper -- */}
      <nav aria-label={L('దశలు', 'Steps')}>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((st, i) => {
            const reachable = ready.slice(0, i + 1).every(Boolean);
            return (
              <li key={st.en}>
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={step === i ? 'step' : undefined}
                  onClick={() => setStep(i)}
                  className={cn(
                    s.body,
                    'flex min-h-tap items-center gap-2 rounded-pill border-2 px-3 text-ui-sm font-semibold',
                    'transition-colors duration-base ease-standard disabled:cursor-not-allowed disabled:opacity-50',
                    step === i ? 'border-brand bg-brand-tint text-brand' : 'border-rule bg-surface text-ink hover:border-brand',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-pill font-sans text-meta font-bold tabular-nums',
                      step === i || i < step ? 'bg-brand text-on-brand' : 'bg-rule-soft text-muted',
                    )}
                  >
                    {i < step ? <Icon icon={Check} size="xs" strokeWidth={3} /> : i + 1}
                  </span>
                  {L(st.te, st.en)}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ------------------------------------------------ 1. article -- */}
      {step === 0 ? (
        <Section
          title={L('1. కథనం ఎంచుకోండి', '1. Choose the article')}
          subtitle={L('క్రియేటివ్‌లో కథనం ప్రధాన ఫోటో, దాని పాఠ్యం మాత్రమే ఉంటాయి.', 'The creative carries only this story’s main photo and its words.')}
        >
          <Input leading={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('శీర్షిక లేదా ID తో వెతకండి', 'Search by headline or ID')} aria-label={t('ui.search')} />
          <QueryState
            query={articles}
            isEmpty={(d) => d.articles.length === 0}
            skeleton={
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} variant="image" ratio="4/1" />
                ))}
              </div>
            }
            empty={<EmptyState compact icon={SearchX} title={t('state.noResults')} />}
          >
            {(d) => (
              <ul className="grid gap-3 sm:grid-cols-2">
                {d.articles.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => pick(a)}
                      aria-pressed={article?.id === a.id}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border-2 bg-surface p-2 text-left',
                        'transition-colors duration-base ease-standard hover:border-brand',
                        article?.id === a.id ? 'border-brand bg-brand-tint' : 'border-rule',
                      )}
                    >
                      {a.hero_media ? (
                        <img src={a.hero_media.url} alt="" loading="lazy" className="aspect-[4/3] w-24 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span aria-hidden className="flex aspect-[4/3] w-24 shrink-0 items-center justify-center rounded-lg bg-placeholder text-muted">
                          <Icon icon={ImageOff} size="sm" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 space-y-1">
                        <span lang="te" className="te te-clamp-2 block text-te-body-xs font-semibold text-ink">
                          {a.title_te}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <WorkflowPill status={a.workflow_state} />
                          {a.hero_media_id ? null : <Badge tone="partial" size="xs">{L('ఫోటో లేదు', 'No photo')}</Badge>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
          {article && !article.hero_media_id ? (
            <p role="note" className={alert}>
              {L(
                'ఈ కథనానికి ప్రధాన ఫోటో లేదు — క్రియేటివ్ డిజైన్‌పై పాఠ్యం మాత్రమే ఉంటుంది. AI ఎప్పుడూ వార్తా ఫోటోను గీయదు.',
                'This story has no main photo — the creative will be text over the design only. The AI never draws a news photo.',
              )}
            </p>
          ) : null}
          {nav()}
        </Section>
      ) : null}

      {/* --------------------------------------------------- 2. copy -- */}
      {step === 1 && article ? (
        <Section
          title={L('2. పాఠ్యం', '2. Copy')}
          subtitle={L('AI కథనంలోని వాస్తవాలు మాత్రమే వాడుతుంది. పూర్తిగా మార్చుకోవచ్చు.', 'The AI may use only facts in the story. Everything is editable.')}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Sparkles} pending={write.isPending} onClick={() => writeCopy(article.id)}>
              {L('AI తో రాయండి', 'Write with AI')}
            </Button>
            <Button variant="ghost" size="sm" icon={RotateCcw} disabled={write.isPending} onClick={() => resetCopy(article)}>
              {L('కథనం పాఠ్యానికి మార్చండి', 'Reset to article text')}
            </Button>
          </div>
          {copyNote.map((n) => (
            <p key={n} role="status" className={n === 'heuristic' ? note : alert}>
              {COPY_NOTES[n] ?? n}
            </p>
          ))}
          {copyFields}
          {nav()}
        </Section>
      ) : null}

      {/* --------------------------------------------- 3. dimensions -- */}
      {step === 2 ? (
        <Section title={L('3. పరిమాణం', '3. Dimensions')} subtitle={L('ఎక్కడ పోస్ట్ చేస్తారో ఎంచుకోండి — తప్పనిసరి.', 'Choose where it will be posted — required.')}>
          <fieldset>
            <legend className={legend}>{L('పరిమాణం (పిక్సెల్స్)', 'Size (pixels)')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[...PRESETS, { key: 'custom', w: 0, h: 0, te: 'మీ పరిమాణం', en: 'Custom' }].map((o) => (
                <label key={o.key} className="cursor-pointer">
                  <input type="radio" name={`${name}-size`} value={o.key} checked={preset === o.key} onChange={() => setPreset(o.key)} className="peer sr-only" />
                  <span className={tile}>
                    {o.key === 'custom' ? <ShapeBox w={customSize(customW, customH)?.w ?? 1} h={customSize(customW, customH)?.h ?? 1} /> : <ShapeBox w={o.w} h={o.h} />}
                    <span className="font-sans text-ui font-bold tabular-nums text-ink">{o.key === 'custom' ? 'W × H' : `${o.w} × ${o.h}`} </span>
                    <span className={cn(s.body, 'text-meta font-semibold text-ink')}>{L(o.te, o.en)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {preset === 'custom' ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={L('వెడల్పు', 'Width')} className="w-32" error={customSize(customW, customH) ? undefined : `${MIN_SIDE}–${MAX_SIDE}`}>
                <Input type="number" inputMode="numeric" min={MIN_SIDE} max={MAX_SIDE} value={customW} onChange={(e) => setCustomW(e.target.value)} />
              </Field>
              <Field label={L('ఎత్తు', 'Height')} className="w-32">
                <Input type="number" inputMode="numeric" min={MIN_SIDE} max={MAX_SIDE} value={customH} onChange={(e) => setCustomH(e.target.value)} />
              </Field>
            </div>
          ) : null}
          {!size ? <p className={note}>{L('కొనసాగడానికి ఒక పరిమాణం ఎంచుకోండి.', 'Choose a size to continue.')}</p> : null}
          {nav()}
        </Section>
      ) : null}

      {/* ------------------------------------------------- 4. design -- */}
      {step === 3 ? (
        <Section title={L('4. డిజైన్', '4. Design')} subtitle={L('లేఅవుట్, రిఫరెన్స్ డిజైన్లు, AI నేపథ్యం.', 'Layout, reference designs and the AI backdrop.')}>
          <fieldset>
            <legend className={legend}>{L('లేఅవుట్', 'Layout')}</legend>
            {TEMPLATES.map((o) => (
              <Radio key={o.value} name={`${name}-template`} value={o.value} checked={template === o.value} onChange={() => setTemplate(o.value)} label={L(o.te, o.en)} className="py-1" />
            ))}
          </fieldset>
          <Switch
            checked={aiOn}
            disabled={covered}
            onChange={setUseAi}
            label={L('AI డిజైన్ నేపథ్యం (GPT Image 2.5)', 'AI design backdrop (GPT Image 2.5)')}
            hint={
              covered
                ? L('ఫుల్ ఫోటో లేఅవుట్‌లో ఫోటో మొత్తం కార్డ్‌ను కప్పేస్తుంది — డిజైన్ కనిపించదు, కాబట్టి గీయం.', 'The full-photo layout covers the whole card with the photo — a design would not show, so none is drawn.')
                : L(
                    'పాఠ్యం, వ్యక్తులు, లోగోలు లేని నేపథ్యం మాత్రమే. ఆఫ్ చేస్తే మా బ్రాండ్ నీలం.',
                    'A backdrop only — no text, no people, no logos. Off: our brand blue, and nothing is drawn.',
                  )
            }
          />
          {aiOn ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <span className={legend}>
                  {L('రిఫరెన్స్ డిజైన్లు', 'Reference designs')}{' '}
                  <span className="font-normal text-muted">
                    ({refs.length}/{MAX_REFS})
                  </span>
                </span>
                <p className={note}>
                  {L(
                    'AI వీటి రంగులు, ఆకారాలు, శైలి మాత్రమే తీసుకుంటుంది. ఏదీ ఎంచుకోకపోతే మా బ్రాండ్ రంగులు.',
                    'The AI takes only their colours, shapes and style. With none selected it uses our brand colours.',
                  )}
                </p>
                {can('media.upload') ? (
                  <FileDrop
                    accept={ACCEPT}
                    multiple
                    disabled={upload.isPending}
                    label={upload.isPending ? t('ui.uploading') : L('రిఫరెన్స్ డిజైన్ అప్‌లోడ్ చేయండి', 'Upload a reference design')}
                    hint={L('JPEG, PNG లేదా WebP — 15MB లోపు', 'JPEG, PNG or WebP — under 15MB')}
                    onFiles={(files) => files.slice(0, 8).forEach((f) => upload.mutate(f))}
                  />
                ) : null}
                {canSeeRefs ? (
                  <QueryState
                    query={references}
                    isEmpty={(d) => d.length === 0}
                    compact
                    skeleton={
                      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Skeleton key={i} variant="image" ratio="1/1" />
                        ))}
                      </div>
                    }
                    empty={<EmptyState compact icon={ImagePlus} title={L('ఇంకా రిఫరెన్స్‌లు లేవు', 'No reference designs yet')} />}
                  >
                    {(items) => (
                      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                        {items.map((r) => {
                          const on = refs.includes(r.id);
                          return (
                            <li key={r.id} className="relative">
                              <button
                                type="button"
                                aria-pressed={on}
                                aria-label={`${L('రిఫరెన్స్', 'Reference')} ${r.filename}`}
                                disabled={!on && refs.length >= MAX_REFS}
                                onClick={() => toggleRef(r.id)}
                                className={cn(
                                  'relative block w-full overflow-hidden rounded-xl border-2 bg-placeholder',
                                  'transition-colors duration-base ease-standard disabled:cursor-not-allowed disabled:opacity-50',
                                  on ? 'border-brand' : 'border-rule hover:border-brand',
                                )}
                              >
                                <img src={r.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                                {on ? (
                                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-pill bg-brand text-on-brand">
                                    <Icon icon={Check} size="xs" strokeWidth={3} />
                                  </span>
                                ) : null}
                              </button>
                              {can('media.delete') ? (
                                <IconButton
                                  icon={Trash2}
                                  label={`${t('ui.delete')} ${r.filename}`}
                                  variant="secondary"
                                  iconSize="sm"
                                  className="absolute -left-2 -top-2 shadow-card"
                                  disabled={remove.isPending}
                                  onClick={() => void askRemove(r.id)}
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </QueryState>
                ) : (
                  <p className={note}>{L('రిఫరెన్స్ లైబ్రరీ చూసే అనుమతి మీకు లేదు.', 'You do not have access to the reference library.')}</p>
                )}
              </div>
              <Field
                label={L('డిజైన్ సూచన', 'Design direction')}
                optionalLabel
                hint={L('శైలి మాత్రమే — ఉదా. "వికర్ణ ఎరుపు పట్టీలు, మెత్తని నీడ".', 'Style only — e.g. "diagonal red bands, soft grain".')}
              >
                <Textarea rows={2} counter={300} maxLength={300} value={brief} onChange={(e) => setBrief(e.target.value)} />
              </Field>
            </div>
          ) : null}
          {nav()}
        </Section>
      ) : null}

      {/* ----------------------------------------------- 5. generate -- */}
      {step === 4 && article && size ? (
        <Section title={L('5. తయారీ', '5. Generate')} subtitle={`${article.title_te} · ${size.w} × ${size.h}`}>
          <div className="grid gap-6 md:grid-cols-2">
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <legend className={legend}>{L('పాఠ్యం సవరించండి — మళ్లీ తయారీ ఉచితం', 'Edit the text — re-rendering is free')}</legend>
              {copyFields}
            </fieldset>
            <div className="min-w-0 space-y-3 md:sticky md:top-0 md:self-start">
              <div className="flex flex-wrap gap-2">
                <Button icon={ImagePlus} pending={make.isPending} disabled={!headline.trim() || busy} onClick={() => run(body())}>
                  {make.isPending ? t('ui.generating') : card ? L('మళ్లీ తయారు చేయండి', 'Update creative') : L('క్రియేటివ్ తయారు చేయండి', 'Generate creative')}
                </Button>
                {aiOn && backdropId !== null ? (
                  <Button variant="ghost" icon={RefreshCw} disabled={busy} onClick={() => run({ ...body(), use_ai_backdrop: true, backdrop_media_id: null })}>
                    {L('కొత్త డిజైన్', 'New design')}
                  </Button>
                ) : null}
              </div>
              {make.isPending ? (
                <p role="status" className={note}>
                  {drawing
                    ? L('GPT Image 2.5 డిజైన్ గీస్తోంది — 15–60 సెకన్లు. ఈ పేజీ మూసివేయకండి.', 'GPT Image 2.5 is drawing the design — 15 to 60 seconds. Leave this page open.')
                    : L('క్రియేటివ్ తయారవుతోంది…', 'Making the creative…')}
                </p>
              ) : drawing ? (
                <p className={note}>{L('కొత్త డిజైన్ గీయడానికి 15–60 సెకన్లు పడుతుంది, AI బడ్జెట్ నుంచి ఖర్చవుతుంది.', 'Drawing a new design takes 15 to 60 seconds and is charged to the AI budget.')}</p>
              ) : null}

              {refusal ? (
                <p role="alert" className={alert}>
                  {refusal}
                </p>
              ) : null}
              {make.data && !make.data.available ? (
                <p role="alert" className={alert}>
                  {make.data.reason ?? L('క్రియేటివ్ తయారు కాలేదు.', 'No creative was made.')}
                </p>
              ) : card ? (
                <div className="space-y-3">
                  {stale ? (
                    <p role="status" className={cn(s.body, 'text-meta font-semibold text-partial')}>
                      {L('మార్పులు ఇంకా వర్తించలేదు — మళ్లీ తయారు చేయండి.', 'Changes not applied yet — press "Update creative".')}
                    </p>
                  ) : null}
                  <img
                    src={card.url}
                    alt={make.variables?.b.headline ?? headline}
                    width={card.width}
                    height={card.height}
                    className={cn('mx-auto h-auto max-h-[70vh] w-auto max-w-full rounded-xl border border-rule object-contain', stale && 'opacity-60')}
                  />
                  {card.warnings.length ? (
                    <ul className={cn(note, 'list-disc space-y-0.5 pl-5')}>
                      {card.warnings.map((w) => (
                        <li key={w}>{WARNINGS[w] ?? w}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" icon={Download} onClick={() => void downloadFile(card.url, card.filename)}>
                      {L('డౌన్‌లోడ్', 'Download')}
                    </Button>
                    {can('media.upload') ? (
                      <Button variant="secondary" size="sm" icon={Save} disabled={busy || !headline.trim()} onClick={() => run(body(true))}>
                        {card.media_id ? L('మళ్లీ సేవ్ చేయండి', 'Save again') : L('మీడియా లైబ్రరీలో సేవ్ చేయండి', 'Save to media library')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div
                  aria-hidden
                  className="mx-auto flex max-w-full items-center justify-center rounded-xl border-2 border-dashed border-rule bg-canvas font-sans text-ui-sm font-bold tabular-nums text-muted"
                  style={{ aspectRatio: `${size.w} / ${size.h}`, maxHeight: '50vh' }}
                >
                  {size.w} × {size.h}
                </div>
              )}
            </div>
          </div>
          {nav(<span />)}
        </Section>
      ) : null}
    </AdminPage>
  );
}
