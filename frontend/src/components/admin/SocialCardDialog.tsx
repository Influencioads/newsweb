import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, ImagePlus, RefreshCw, Sparkles } from 'lucide-react';

import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Radio, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import type { SocialCard, SocialCardAspect, SocialCardBody, SocialCardPhoto, SocialCardTemplate } from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import { cn } from '@/utils/cn';
import { downloadFile } from '@/utils/download';

/**
 * "న్యూస్ కార్డ్" — the story's glimpse (short headline + two sentences) over a
 * photo with our logo, sized for Instagram, WhatsApp or X.
 *
 * Every render can cost money (the text model, GPT Image 2.5), so nothing is
 * called on open and nothing re-renders on its own: changing a setting after a
 * render only marks the preview stale until "Make card" is pressed again. An AI
 * picture, once drawn, is held by media id and sent back on every later render
 * so fixing a typo in the headline never pays for a second drawing.
 */

const SIZES: Array<{ value: SocialCardAspect; te: string; en: string; caption: string; box: [number, number] }> = [
  { value: '1:1', te: 'చతురస్రం', en: 'Square', caption: 'Instagram / Facebook post', box: [24, 24] },
  { value: '4:5', te: 'పోర్ట్రెయిట్', en: 'Portrait', caption: 'Instagram feed', box: [22, 28] },
  { value: '16:9', te: 'వెడల్పు', en: 'Landscape', caption: 'X / Facebook / YouTube', box: [36, 20] },
  { value: '9:16', te: 'స్టోరీ', en: 'Story', caption: 'Reels / Status / Stories', box: [20, 36] },
];

const TEMPLATES: Array<{ value: SocialCardTemplate; te: string; en: string }> = [
  { value: 'panel', te: 'ఫోటో + ప్యానెల్', en: 'Photo + panel' },
  { value: 'overlay', te: 'ఫుల్ ఫోటో', en: 'Full photo' },
  { value: 'frame', te: 'హెడ్‌లైన్ పైన', en: 'Headline on top' },
];

export interface SocialCardDialogProps {
  open: boolean;
  onClose: () => void;
  articleId: number;
  title: string;
  summary: string | null;
  hasHero: boolean;
  categoryName?: string | null;
}

export function SocialCardDialog({ open, onClose, articleId, title, summary, hasHero, categoryName }: SocialCardDialogProps) {
  const { t, language } = useI18n();
  const s = useScript();
  const toast = useToast();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const name = useId();

  const [aspect, setAspect] = useState<SocialCardAspect>('4:5');
  const [template, setTemplate] = useState<SocialCardTemplate>('panel');
  const [photo, setPhoto] = useState<SocialCardPhoto>('story');
  const [brief, setBrief] = useState('');
  const [tag, setTag] = useState('');
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  /** The AI picture already drawn for this card; reused until "Redraw". */
  const [heldId, setHeldId] = useState<number | null>(null);
  const [renderedKey, setRenderedKey] = useState('');

  // The card takes 32 / 160 / 400 characters and 422s past them, but a story's
  // headline runs to 400 and its standfirst to 1000 — so clip what we put in.
  function fill(nextTag: string, nextHeadline: string, nextSummary: string) {
    setTag(nextTag.slice(0, 32));
    setHeadline(nextHeadline.slice(0, 160));
    setText(nextSummary.slice(0, 400));
  }

  // Prefill from the editor each time the dialog opens — never from the AI.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) fill(categoryName || 'తాజా వార్తలు', title, summary ?? '');
  }

  const keyOf = (b: Pick<SocialCardBody, 'aspect' | 'template' | 'photo' | 'headline' | 'summary' | 'tag'>) =>
    JSON.stringify([b.aspect, b.template, b.photo, b.headline, b.summary, b.tag]);

  const body = (): SocialCardBody => ({
    aspect,
    template,
    headline: headline.trim(),
    summary: text.trim(),
    tag: tag.trim() || null,
    photo,
    photo_media_id: photo === 'ai' ? heldId : null,
    brief: photo === 'ai' && brief.trim() ? brief.trim() : null,
  });

  const write = useMutation({
    mutationFn: () => cmsApi.socialCardText(articleId),
    onSuccess: (r) => fill(r.tag, r.headline, r.summary),
    onError: (e) => toast.error(e),
  });

  const make = useMutation({
    mutationFn: (b: SocialCardBody) => cmsApi.makeSocialCard(articleId, b),
    onSuccess: (r, b) => {
      setRenderedKey(keyOf(b));
      if (b.photo === 'ai' && r.card?.photo) setHeldId(r.card.photo.media_id);
    },
    onError: (e) => {
      // A picture drawn and paid for before the store failed comes back on
      // the error; hold it so the retry reuses it.
      if (e instanceof ApiError && typeof e.details.photo_media_id === 'number') setHeldId(e.details.photo_media_id);
      if (!(e instanceof ApiError && e.status === 422)) toast.error(e);
    },
  });
  // As in MediaPicker: a 422 is the sensitive-topic screen refusing the picture.
  const refusal = make.error instanceof ApiError && make.error.status === 422 ? make.error.displayMessage : null;
  const card: SocialCard | null = make.data?.card ?? null;
  const stale = card !== null && renderedKey !== keyOf(body());
  const drawing = photo === 'ai' && (make.isPending ? make.variables?.photo_media_id == null : heldId === null);
  const busy = make.isPending || write.isPending;

  // The held picture survives a look at the other photo modes (`body()` only
  // sends it in AI mode) and a refused or failed redraw: onSuccess replaces it
  // only when a new one has actually been drawn.
  const pickPhoto = setPhoto;

  function redraw() {
    make.mutate({ ...body(), photo_media_id: null });
  }

  const WARNINGS: Record<string, string> = {
    headline_truncated: L('శీర్షిక చాలా పొడవుగా ఉంది — కత్తిరించాం.', 'The headline was too long and was trimmed.'),
    summary_truncated: L('సారాంశం చాలా పొడవుగా ఉంది — కత్తిరించాం.', 'The summary was too long and was trimmed.'),
    no_photo: L('ఫోటో లేదు — బ్రాండ్ నేపథ్యం వాడాం.', 'No photo — the brand background was used.'),
    unsupported_characters: L('కొన్ని అక్షరాలు (ఎమోజీ వంటివి) కార్డ్‌పై బాక్సులుగా వస్తాయి — తీసివేయండి.', 'Some characters (emoji and the like) print as boxes on the card — remove them.'),
  };
  const legend = cn(s.body, 'mb-2 block text-ui-sm font-semibold text-ink');
  const note = cn(s.body, 'text-meta text-muted');
  const [bw, bh] = SIZES.find((o) => o.value === aspect)?.box ?? [24, 24];

  return (
    <Dialog open={open} onClose={onClose} size="lg" className="md:max-w-4xl" title={L('న్యూస్ కార్డ్', 'News card')}>
      <div className="grid gap-6 md:grid-cols-2">
        {/* ------------------------------------------------- controls -- */}
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <fieldset>
            <legend className={legend}>{L('పరిమాణం', 'Size')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SIZES.map((o) => (
                <label key={o.value} className="cursor-pointer">
                  <input
                    type="radio"
                    name={`${name}-size`}
                    value={o.value}
                    checked={aspect === o.value}
                    onChange={() => setAspect(o.value)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'flex h-full flex-col items-center gap-1 rounded-xl border-2 border-rule bg-surface p-2 text-center',
                      'transition-colors duration-base ease-standard hover:border-brand peer-checked:border-brand peer-checked:bg-brand-tint',
                      'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand',
                    )}
                  >
                    <span aria-hidden className="flex h-10 items-center justify-center text-muted">
                      <span className="rounded-md border-2 border-current" style={{ width: o.box[0], height: o.box[1] }} />
                    </span>
                    <span className="font-sans text-ui font-bold tabular-nums text-ink">{o.value} </span>
                    <span className={cn(s.body, 'text-meta font-semibold text-ink')}>{L(o.te, o.en)} </span>
                    <span className="font-sans text-meta text-muted">{o.caption}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={legend}>{L('శైలి', 'Style')}</legend>
            {TEMPLATES.map((o) => (
              <Radio
                key={o.value}
                name={`${name}-template`}
                value={o.value}
                checked={template === o.value}
                onChange={() => setTemplate(o.value)}
                label={L(o.te, o.en)}
                className="py-1"
              />
            ))}
          </fieldset>

          <fieldset>
            <legend className={legend}>{L('ఫోటో', 'Photo')}</legend>
            <Radio
              name={`${name}-photo`}
              value="story"
              checked={photo === 'story'}
              onChange={() => pickPhoto('story')}
              label={L('కథనం ఫోటో', 'Story photo')}
              hint={
                hasHero
                  ? undefined
                  : L('ఈ కథనానికి ప్రధాన చిత్రం లేదు — కార్డ్ బ్రాండ్ నేపథ్యంతో వస్తుంది.', 'This story has no main image — the card will use the brand background.')
              }
              className="py-1"
            />
            <Radio
              name={`${name}-photo`}
              value="ai"
              checked={photo === 'ai'}
              onChange={() => pickPhoto('ai')}
              label={L('GPT Image 2.5 తో AI చిత్రం రూపొందించండి', 'Make an AI picture with GPT Image 2.5')}
              hint={L(
                'సుమారు 25 సెకన్లు. వాస్తవంగా కనిపించే ప్రతీకాత్మక చిత్రం — కార్డ్‌పై "ప్రతీకాత్మక చిత్రం" అని ఉంటుంది.',
                'About 25 seconds. A realistic, representative picture — the card is labelled "ప్రతీకాత్మక చిత్రం".',
              )}
              className="py-1"
            />
            <Radio
              name={`${name}-photo`}
              value="none"
              checked={photo === 'none'}
              onChange={() => pickPhoto('none')}
              label={L('ఫోటో లేదు', 'No photo')}
              className="py-1"
            />
            {photo === 'ai' ? (
              <Field
                className="mt-2"
                label={L('ఏ దృశ్యం కావాలి', 'Describe the scene')}
                optionalLabel
                hint={
                  heldId !== null
                    ? L('చిత్రం ఇప్పటికే తయారైంది — మార్చాలంటే "కొత్త చిత్రం" నొక్కండి.', 'Already made — press "New picture" to use a new brief.')
                    : L('ఉన్న వ్యక్తుల ఫోటోలు తయారు చేయబడవు.', 'Photoreal images of real people are never made.')
                }
              >
                <Textarea rows={2} counter={500} value={brief} onChange={(e) => setBrief(e.target.value)} />
              </Field>
            ) : null}
          </fieldset>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn(legend, 'mb-0')}>{L('పాఠ్యం', 'Text')}</span>
              <Button variant="secondary" size="sm" icon={Sparkles} pending={write.isPending} onClick={() => write.mutate()}>
                {L('AI తో రాయండి', 'Write with AI')}
              </Button>
            </div>
            {write.data?.engine === 'heuristic' ? (
              <p className={note}>{L('AI అందుబాటులో లేదు — కథనం నుంచే తీశాం.', 'AI was unavailable — taken from the story itself.')}</p>
            ) : null}
            <Field label={L('ట్యాగ్', 'Tag')} optionalLabel>
              <Input script="te" maxLength={32} value={tag} onChange={(e) => setTag(e.target.value)} />
            </Field>
            <Field label={L('శీర్షిక', 'Headline')} required>
              <Textarea script="te" rows={2} counter={160} value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </Field>
            <Field label={L('సారాంశం', 'Summary')} optionalLabel>
              <Textarea script="te" rows={3} counter={400} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </div>
        </fieldset>

        {/* -------------------------------------------------- preview -- */}
        <div className="min-w-0 space-y-3 md:sticky md:top-0 md:self-start">
          <Button icon={ImagePlus} pending={make.isPending} disabled={!headline.trim() || busy} onClick={() => make.mutate(body())}>
            {make.isPending ? t('ui.generating') : L('కార్డ్ తయారు చేయండి', 'Make card')}
          </Button>
          {make.isPending ? (
            <p role="status" className={note}>
              {drawing
                ? L('GPT Image 2.5 చిత్రం రూపొందిస్తోంది — సుమారు 25 సెకన్లు. ఈ విండో మూసివేయకండి.', 'GPT Image 2.5 is making the picture — about 25 seconds. Leave this window open.')
                : L('కార్డ్ తయారవుతోంది…', 'Making the card…')}
            </p>
          ) : drawing ? (
            <p className={note}>{L('కొత్త చిత్రం రూపొందించడానికి సుమారు 25 సెకన్లు పట్టవచ్చు.', 'A new picture may take about 25 seconds.')}</p>
          ) : null}

          {refusal ? (
            <p role="alert" className={cn(s.body, 'rounded-xl border border-partial-border bg-partial-tint p-3 text-ui-sm text-partial')}>
              {refusal}
            </p>
          ) : null}

          {make.data && !make.data.available ? (
            <p role="alert" className={cn(s.body, 'rounded-xl border border-partial-border bg-partial-tint p-3 text-ui-sm text-partial')}>
              {make.data.reason ?? L('కార్డ్ తయారు కాలేదు.', 'No card was made.')}
            </p>
          ) : card ? (
            <div className="space-y-3">
              {stale ? (
                <p role="status" className={cn(s.body, 'text-meta font-semibold text-partial')}>
                  {L('మార్పులు ఇంకా వర్తించలేదు — మళ్లీ "కార్డ్ తయారు చేయండి" నొక్కండి.', 'Changes not applied yet — press "Make card" again.')}
                </p>
              ) : null}
              <img
                src={card.url}
                alt={make.variables?.headline ?? headline}
                width={card.width}
                height={card.height}
                className={cn('mx-auto h-auto max-h-[60vh] w-auto max-w-full rounded-xl border border-rule object-contain', stale && 'opacity-60')}
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
                {photo === 'ai' && heldId !== null ? (
                  <Button variant="ghost" size="sm" icon={RefreshCw} disabled={busy} onClick={redraw}>
                    {L('కొత్త చిత్రం', 'New picture')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              aria-hidden
              className="mx-auto flex max-w-full items-center justify-center rounded-xl border-2 border-dashed border-rule bg-canvas font-sans text-ui-sm font-bold text-muted"
              style={{ width: bw * 8, height: bh * 8 }}
            >
              {aspect}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
