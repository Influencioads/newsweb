import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import * as cmsApi from '@/features/cms/api';
import { useI18n, useScript } from '@/i18n';
import type { ContentPolicy, ContentSource, SourceBeat, SourceLicence } from '@/types/cms';
import { cn } from '@/utils/cn';

import { BEATS, LICENCES, POLICIES, licenceAllowsFullText } from './labels';

/**
 * Add / edit a content source in a Dialog.
 *
 * The licence is not metadata here, it is the control: the server refuses
 * full-text republication unless the source carries an agreement-based licence
 * *and* a note recording which agreement. The form makes that visible so an
 * editor sees the terms while deciding, rather than discovering them after a
 * takedown notice. There is deliberately no auto-publish control — imports go
 * to the review queue, always.
 */

export interface SourceFormDialogProps {
  open: boolean;
  /** `null` = create; a row = edit that source. */
  source: ContentSource | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Mounted only while the dialog is open, so values reset on every open. */
function SourceForm({ id, source, error, onSubmit }: {
  id: string;
  source: ContentSource | null;
  error: ApiError | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const s = useScript();
  const [slug, setSlug] = useState(source?.slug ?? '');
  const [name, setName] = useState(source?.name ?? '');
  const [feedUrl, setFeedUrl] = useState(source?.feed_url ?? '');
  const [licence, setLicence] = useState<SourceLicence>(source?.licence ?? 'rss_public');
  const [policy, setPolicy] = useState<ContentPolicy>(source?.content_policy ?? 'excerpt_only');
  const [note, setNote] = useState(source?.licence_note ?? '');
  const [interval, setInterval] = useState(source?.fetch_interval_minutes ?? 30);
  const [beat, setBeat] = useState<SourceBeat>(source?.beat ?? 'general');
  const [perHour, setPerHour] = useState(source?.max_items_per_hour ?? 8);
  const [rewrite, setRewrite] = useState(source?.rewrite_enabled ?? false);
  const [htmlFallback, setHtmlFallback] = useState(source?.allow_html_fallback ?? false);

  const fieldError = (key: string) => {
    const v = error?.details[key];
    return typeof v === 'string' ? v : undefined;
  };
  const message = error ? s.text(error.messageTe, error.messageEn) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      slug, name, feed_url: feedUrl, licence, content_policy: policy,
      licence_note: note || null, fetch_interval_minutes: interval,
      beat, max_items_per_hour: perHour,
      rewrite_enabled: rewrite, allow_html_fallback: htmlFallback,
    });
  };

  return (
    <form id={id} onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L('ప్రచురణకర్త పేరు', 'Publisher name')} required>
          <Input required script="en" value={name} onChange={(e) => setName(e.target.value)} data-autofocus="" />
        </Field>
        <Field label="Slug" required hint="a-z, 0-9, -" error={fieldError('slug')}>
          <Input
            required
            pattern="[a-z0-9-]+"
            script="en"
            disabled={source !== null}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="font-mono"
          />
        </Field>
      </div>

      <Field label={L('ఫీడ్ URL (RSS లేదా Atom)', 'Feed URL (RSS or Atom)')} required error={fieldError('feed_url')}>
        <Input
          required
          type="url"
          script="en"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder="https://publisher.example.com/feed.xml"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L('లైసెన్స్', 'Licence')}>
          <Select
            value={licence}
            onChange={(e) => {
              const next = e.target.value as SourceLicence;
              setLicence(next);
              // A policy the new licence cannot support is not offered — the
              // server would refuse it anyway, and a form that lets you pick
              // an impossible option is a form that lies.
              if (!licenceAllowsFullText(next) && policy === 'full_text') setPolicy('excerpt_only');
            }}
          >
            {LICENCES.map((l) => (
              <option key={l.value} value={l.value}>
                {L(l.te, l.en)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={L('ఎంత భద్రపరచాలి', 'How much we keep')} error={fieldError('content_policy')}>
          <Select value={policy} onChange={(e) => setPolicy(e.target.value as ContentPolicy)}>
            {POLICIES.filter((p) => p.value !== 'full_text' || licenceAllowsFullText(licence)).map((p) => (
              <option key={p.value} value={p.value}>
                {L(p.te, p.en)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={L('బీట్', 'Beat')}
          hint={L('ఏ గంటవారీ కోటా నుంచి తీసుకోవాలో నిర్ణయిస్తుంది. సాధారణానికి కోటా లేదు.', 'Decides which hourly quota this source draws from. General has none.')}
        >
          <Select value={beat} onChange={(e) => setBeat(e.target.value as SourceBeat)}>
            {BEATS.map((b) => (
              <option key={b.value} value={b.value}>
                {L(b.te, b.en)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={L('గంటకు గరిష్ఠ వార్తలు', 'Max stories per hour')}
          hint={L('ఒకే ఫీడ్ మొత్తం కోటాను తినకుండా ఆపుతుంది.', 'Stops one busy feed consuming the whole beat budget.')}
        >
          <Input type="number" script="en" min={0} max={500} value={perHour} onChange={(e) => setPerHour(Number(e.target.value))} />
        </Field>
      </div>

      <Checkbox
        checked={rewrite}
        onChange={setRewrite}
        label={L(
          'ఈ మూలాన్ని మన సొంత తెలుగులో రాయండి, ప్రచురణకర్తకు క్రెడిట్ ఇస్తూ. ఫలితం ఎడిటర్ వద్దకే వెళ్తుంది.',
          'Rewrite this source in our own Telugu, crediting the publisher. The result still goes to an editor.',
        )}
      />
      <Checkbox
        checked={htmlFallback}
        onChange={setHtmlFallback}
        label={L(
          'ఫీడ్‌లో చిన్న ముక్క మాత్రమే ఉంటే వ్యాసం పేజీని తెండి. ఇది ఈ ప్రచురణకర్తకు ఎందుకు సమ్మతమో కింద రాయాలి.',
          'When the feed carries only a stub, fetch the article page. Needs a written note below saying why that is acceptable for this publisher.',
        )}
      />

      {policy === 'full_text' || htmlFallback ? (
        <Field
          label={L('ఏ ఒప్పందం దీన్ని అనుమతిస్తుంది?', 'Which agreement permits this?')}
          required
          hint={L('ఆడిట్ లాగ్‌లో నమోదవుతుంది', 'Recorded in the audit log')}
          error={fieldError('licence_note')}
        >
          <Textarea
            required
            rows={3}
            autoGrow
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={L('ఉదా: సిండికేషన్ ఒప్పందం, 1 జనవరి 2026', 'e.g. Signed syndication agreement, 1 Jan 2026')}
          />
        </Field>
      ) : null}

      <Field label={L('ఎన్ని నిమిషాలకోసారి తనిఖీ', 'Check every (minutes)')} className="max-w-40">
        <Input type="number" script="en" min={5} max={1440} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />
      </Field>

      {message ? (
        <p
          role="alert"
          lang={message.lang}
          className={cn(message.cls, message.telugu ? 'text-te-body-xs' : 'text-ui-sm', 'rounded-xl border border-breaking-border bg-breaking-tint p-3 text-breaking')}
        >
          {message.text || t('state.errorBody')}
        </p>
      ) : null}
    </form>
  );
}

export function SourceFormDialog({ open, source, onClose, onSaved }: SourceFormDialogProps) {
  const { t, language } = useI18n();
  const L = (te: string, en: string) => (language === 'te' ? te : en);
  const toast = useToast();
  const formId = `${useId()}-form`;

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      source ? cmsApi.patchSource(source.id, payload) : cmsApi.createSource(payload),
    onSuccess: () => {
      toast.success(t('state.saved'));
      onSaved();
    },
    onError: (e) => toast.error(e),
  });

  const close = () => {
    save.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={source ? L('మూలం సవరించండి', 'Edit source') : L('కొత్త మూలం జోడించండి', 'Add a source')}
      description={L(
        'బహిరంగ ఫీడ్ నుంచి శీర్షిక, సారాంశం, లింక్ మాత్రమే. పూర్తి పాఠ్యానికి ఒప్పందం అవసరం.',
        'A public feed lets you show a headline, an excerpt and a link. Republishing the full text needs an agreement.',
      )}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            {t('ui.cancel')}
          </Button>
          <Button type="submit" form={formId} pending={save.isPending}>
            {source ? t('ui.save') : L('జోడించండి', 'Add source')}
          </Button>
        </>
      }
    >
      <SourceForm
        id={formId}
        source={source}
        error={save.error instanceof ApiError ? save.error : null}
        onSubmit={(payload) => save.mutate(payload)}
      />
    </Dialog>
  );
}
